/**
 * danmaku-server.mjs
 * Bilibili 弹幕下载器 - 本地文件写入服务（配合 get-danmaku-v4.user.js 使用）
 *
 * 启动方式:  node danmaku-server.mjs
 * 自定义保存目录: $env:DANMAKU_DIR="D:\MyDanmaku" ; node danmaku-server.mjs
 *
 * API:
 *   GET  /health  → { ok, baseDir }
 *   POST /save    → body: { folder?, filename, content }  →  { ok, path }
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { selectVideoDownloadPlan, summarizeSelectedFormat } from './src/video-format-selector.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.DANMAKU_PORT) || 18888;
const BASE_DIR = process.env.DANMAKU_DIR
    || 'F:\\下载\\Chrome\\弹幕';   // ← 在此修改你的默认保存目录
const YT_DLP_BIN = process.env.YT_DLP_BIN || 'yt-dlp';
const YT_DLP_SCRIPT = process.env.YT_DLP_SCRIPT || '';
const DEVTOOLS_BROWSER_PATHS = [
    {
        name: 'chrome',
        activePortPath: path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'DevToolsActivePort'),
        fallbackPorts: [9222],
    },
    {
        name: 'edge',
        activePortPath: path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data', 'DevToolsActivePort'),
        fallbackPorts: [9223],
    },
];

const VIDEO_EXTENSIONS = new Set(['.mp4', '.flv', '.mkv', '.webm']);
const activeVideoDownloads = new Map();

// 确保根目录存在
fs.mkdirSync(BASE_DIR, { recursive: true });

function isDownloadedVideoFile(fileName) {
    return VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function getInfoPathForVideo(videoPath) {
    return path.join(path.dirname(videoPath), `${path.parse(videoPath).name}.info.json`);
}

function readJsonFile(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (_) {
        return null;
    }
}

function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function findExistingVideoByBvid(targetDir, bvid) {
    if (!fs.existsSync(targetDir)) return null;

    const existingFiles = fs.readdirSync(targetDir);
    const match = existingFiles.find(fileName => {
        if (!fileName.includes(`_${bvid}.`) || !isDownloadedVideoFile(fileName)) {
            return false;
        }

        const fullPath = path.join(targetDir, fileName);
        try {
            return fs.statSync(fullPath).size > 0;
        } catch (_) {
            return false;
        }
    });

    return match ? path.join(targetDir, match) : null;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '未知大小';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    const digits = unitIndex >= 2 ? 2 : 0;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function buildCookieFile(targetDir, bvid, cookies = [], cookieStr = '') {
    const cookieFile = path.join(targetDir, `.cookies_${bvid}.txt`);
    let lines = [];

    if (Array.isArray(cookies) && cookies.length > 0) {
        lines = cookies
            .filter(cookie => cookie?.name && typeof cookie.value === 'string')
            .map(cookie => {
                const rawDomain = String(cookie.domain || 'bilibili.com').trim();
                const normalizedDomain = rawDomain.startsWith('.') ? rawDomain : (cookie.hostOnly ? rawDomain : `.${rawDomain}`);
                const domainField = cookie.httpOnly ? `#HttpOnly_${normalizedDomain}` : normalizedDomain;
                const includeSubdomains = cookie.hostOnly ? 'FALSE' : 'TRUE';
                const cookiePath = cookie.path || '/';
                const secure = cookie.secure ? 'TRUE' : 'FALSE';
                const expires = Number.isFinite(Number(cookie.expirationDate))
                    ? Math.floor(Number(cookie.expirationDate))
                    : 0;

                return `${domainField}\t${includeSubdomains}\t${cookiePath}\t${secure}\t${expires}\t${cookie.name}\t${cookie.value}`;
            });
    }

    if (lines.length === 0 && cookieStr) {
        const pairs = cookieStr.split(';').map(s => s.trim()).filter(Boolean);
        lines = pairs.map(pair => {
            const eqIdx = pair.indexOf('=');
            if (eqIdx < 1) return null;
            const name = pair.substring(0, eqIdx);
            const value = pair.substring(eqIdx + 1);
            return `.bilibili.com\tTRUE\t/\tFALSE\t0\t${name}\t${value}`;
        }).filter(Boolean);
    }

    if (lines.length === 0) return null;

    fs.writeFileSync(cookieFile, `# Netscape HTTP Cookie File\n${lines.join('\n')}\n`, 'utf-8');
    console.log(`[yt-dlp] 使用 GM_cookie 提取的身份凭证 (${lines.length} 条)`);
    return cookieFile;
}

function cleanupFile(filePath) {
    if (!filePath) return;
    try {
        fs.unlinkSync(filePath);
    } catch (_) {
        // ignore cleanup failures
    }
}

function buildYtDlpCommonArgs(cookieFile) {
    const args = ['--ignore-config', '--no-warnings', '--no-playlist'];
    if (cookieFile) {
        args.push('--cookies', cookieFile);
    }
    return args;
}

function buildYtDlpSpawnArgs(args) {
    return YT_DLP_SCRIPT ? [YT_DLP_SCRIPT, ...args] : args;
}

function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }

                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(err);
                }
            });
        });

        request.setTimeout(3000, () => {
            request.destroy(new Error('timeout'));
        });
        request.on('error', reject);
    });
}

function readDevToolsEndpoint(activePortPath) {
    try {
        if (!activePortPath || !fs.existsSync(activePortPath)) return null;
        const [portLine, wsPathLine] = fs.readFileSync(activePortPath, 'utf-8').split(/\r?\n/);
        const port = Number(portLine);
        if (!Number.isFinite(port) || port <= 0) return null;

        return {
            port,
            webSocketDebuggerUrl: wsPathLine ? `ws://127.0.0.1:${port}${wsPathLine}` : null,
        };
    } catch (_) {
        return null;
    }
}

async function getBilibiliCookiesFromDevTools(endpoint) {
    const webSocketDebuggerUrl = endpoint?.webSocketDebuggerUrl
        || (await httpGetJson(`http://127.0.0.1:${endpoint.port}/json/version`))?.webSocketDebuggerUrl;
    if (!webSocketDebuggerUrl) {
        throw new Error('缺少 webSocketDebuggerUrl');
    }

    const ws = new WebSocket(webSocketDebuggerUrl);
    let nextId = 0;
    const pending = new Map();

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (!message.id || !pending.has(message.id)) return;

        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
            reject(new Error(JSON.stringify(message.error)));
            return;
        }
        resolve(message.result || {});
    };

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('websocket timeout')), 5000);
        ws.onopen = () => {
            clearTimeout(timer);
            resolve();
        };
        ws.onerror = (err) => {
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error('websocket error'));
        };
    });

    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
    });

    try {
        const result = await send('Storage.getCookies', {});
        const cookies = Array.isArray(result?.cookies) ? result.cookies : [];
        return cookies
            .filter(cookie => String(cookie.domain || '').includes('bilibili.com'))
            .map(cookie => ({
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path || '/',
                secure: !!cookie.secure,
                httpOnly: !!cookie.httpOnly,
                hostOnly: !String(cookie.domain || '').startsWith('.'),
                session: !!cookie.session,
                expirationDate: Number.isFinite(Number(cookie.expires)) ? Number(cookie.expires) : 0,
            }));
    } finally {
        try { ws.close(); } catch (_) {}
    }
}

async function resolveBrowserCookieCandidates() {
    const candidates = [];

    for (const browser of DEVTOOLS_BROWSER_PATHS) {
        const endpointCandidates = [];
        for (const fallbackPort of browser.fallbackPorts || []) {
            endpointCandidates.push({ port: fallbackPort, webSocketDebuggerUrl: null });
        }

        const activeEndpoint = readDevToolsEndpoint(browser.activePortPath);
        if (activeEndpoint) {
            endpointCandidates.push(activeEndpoint);
        }

        const seenPorts = new Set();
        for (const endpoint of endpointCandidates) {
            if (!endpoint?.port || seenPorts.has(endpoint.port)) continue;
            seenPorts.add(endpoint.port);

            try {
                const cookies = await getBilibiliCookiesFromDevTools(endpoint);
                if (cookies.length > 0) {
                    candidates.push({
                        source: `${browser.name}-devtools:${endpoint.port}`,
                        cookies,
                    });
                    break;
                }
            } catch (err) {
                console.warn(`[cookie fallback] ${browser.name} DevTools ${endpoint.port} 读取失败: ${err.message}`);
            }
        }
    }

    return candidates;
}

function hasAuthCookie(cookies = []) {
    return cookies.some(cookie => cookie?.name === 'SESSDATA');
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function runYtDlpJson(videoUrl, cookieFile) {
    const args = [
        ...buildYtDlpCommonArgs(cookieFile),
        '--skip-download',
        '-J',
        videoUrl,
    ];

    return new Promise((resolve, reject) => {
        const child = spawn(YT_DLP_BIN, buildYtDlpSpawnArgs(args), { windowsHide: true });
        let stdoutBuf = '';
        let stderrBuf = '';

        child.stdout.on('data', chunk => {
            stdoutBuf += chunk.toString();
        });
        child.stderr.on('data', chunk => {
            stderrBuf += chunk.toString();
        });
        child.on('error', err => {
            reject(new Error(`无法启动 yt-dlp: ${err.message}`));
        });
        child.on('close', code => {
            if (code !== 0) {
                const message = (stderrBuf || stdoutBuf).trim().slice(-500) || '未知错误';
                reject(new Error(`yt-dlp 格式探测失败 (exit ${code}): ${message}`));
                return;
            }

            try {
                resolve(JSON.parse(stdoutBuf));
            } catch (err) {
                reject(new Error(`yt-dlp 返回的 JSON 无法解析: ${err.message}`));
            }
        });
    });
}

async function runYtDlpJsonWithRetry(videoUrl, cookieFile, maxAttempts = 3) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await runYtDlpJson(videoUrl, cookieFile);
        } catch (err) {
            lastError = err;
            if (attempt >= maxAttempts) break;
            console.warn(`[yt-dlp probe] 第 ${attempt} 次失败，准备重试: ${err.message}`);
            await delay(attempt * 800);
        }
    }

    throw lastError || new Error('yt-dlp 格式探测失败');
}

function buildVideoMetadata(existingInfo, metadata, selectedFormat, videoPath, extras = {}) {
    return {
        ...existingInfo,
        ...metadata,
        videoPath,
        videoFilename: path.basename(videoPath),
        estimatedSize: selectedFormat?.estimatedSize ?? existingInfo?.estimatedSize ?? null,
        selectedFormat: selectedFormat || existingInfo?.selectedFormat || null,
        sourceDuration: extras.sourceDuration ?? existingInfo?.sourceDuration ?? null,
        downloadStatus: extras.downloadStatus ?? existingInfo?.downloadStatus ?? 'pending',
        downloadRequestedAt: extras.downloadRequestedAt ?? existingInfo?.downloadRequestedAt ?? Date.now(),
        downloadFinishedAt: extras.downloadFinishedAt ?? existingInfo?.downloadFinishedAt ?? null,
        downloadError: extras.downloadError ?? null,
        actualSize: extras.actualSize ?? existingInfo?.actualSize ?? null,
        lastResolvedAt: extras.lastResolvedAt ?? existingInfo?.lastResolvedAt ?? null,
        qualityVerifiedAt: extras.qualityVerifiedAt ?? existingInfo?.qualityVerifiedAt ?? null,
    };
}

function findDownloadedVideoByBaseName(targetDir, baseName) {
    if (!fs.existsSync(targetDir)) return null;

    const match = fs.readdirSync(targetDir).find(fileName => {
        return path.parse(fileName).name === baseName && isDownloadedVideoFile(fileName);
    });

    return match ? path.join(targetDir, match) : null;
}

function getSelectedDynamicRangeRank(dynamicRange) {
    const value = String(dynamicRange || '').toUpperCase();
    if (value.includes('DOLBY')) return 3;
    if (value.includes('HDR')) return 2;
    if (value.includes('HLG')) return 1;
    return 0;
}

function compareSelectedFormatQuality(existingFormat, desiredFormat) {
    const left = [
        Number(existingFormat?.height) || 0,
        Number(existingFormat?.width) || 0,
        Number(existingFormat?.quality) || 0,
        Number(existingFormat?.fps) || 0,
        getSelectedDynamicRangeRank(existingFormat?.dynamicRange || existingFormat?.dynamic_range),
    ];
    const right = [
        Number(desiredFormat?.height) || 0,
        Number(desiredFormat?.width) || 0,
        Number(desiredFormat?.quality) || 0,
        Number(desiredFormat?.fps) || 0,
        getSelectedDynamicRangeRank(desiredFormat?.dynamicRange || desiredFormat?.dynamic_range),
    ];

    for (let i = 0; i < left.length; i += 1) {
        if (left[i] > right[i]) return 1;
        if (left[i] < right[i]) return -1;
    }

    return 0;
}

function hasVerifiedExistingQuality(existingInfo) {
    return Boolean(
        existingInfo
        && existingInfo.downloadStatus === 'completed'
        && existingInfo.selectedFormat
        && existingInfo.qualityVerifiedAt,
    );
}

// ──────────────────────────────────────────────
const server = http.createServer((req, res) => {

    // CORS - 允许浏览器扩展/油猴脚本跨域调用
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // ── 健康检查 ──────────────────────────────
    if (req.method === 'GET' && req.url === '/health') {
        json(res, 200, { ok: true, baseDir: BASE_DIR });
        return;
    }

    // ── 保存文件 ──────────────────────────────
    if (req.method === 'POST' && req.url === '/save') {
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
            try {
                const { folder = '', filename, content } = JSON.parse(body);

                if (!filename) throw new Error('filename 不能为空');

                // 路径安全检查：禁止路径穿越
                const safeFolder = folder.replace(/\.\./g, '_');
                const safeFilename = path.basename(filename); // 只取文件名部分
                const targetDir = safeFolder
                    ? path.join(BASE_DIR, safeFolder)
                    : BASE_DIR;

                fs.mkdirSync(targetDir, { recursive: true });

                const filePath = path.join(targetDir, safeFilename);
                fs.writeFileSync(filePath, content, 'utf-8');

                console.log(`[✅ 已保存] ${filePath}`);
                json(res, 200, { ok: true, path: filePath });

            } catch (err) {
                console.error(`[❌ 保存失败]`, err.message);
                json(res, 500, { ok: false, error: err.message });
            }
        });
        return;
    }

    // ── 下载视频及保存元数据 ──────────────────────────────
    if (req.method === 'POST' && req.url === '/download-video') {
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', async () => {
            let cookieFile = null;
            let currentBvid = null;
            try {
                const { filename, metadata, cookieStr, cookies } = JSON.parse(body);
                const bvid = metadata?.bvid;
                currentBvid = bvid;
                if (!filename || !bvid) throw new Error('filename 或 bvid 不能为空');

                const safeFilename = path.basename(filename);
                const targetDir = path.join(BASE_DIR, 'videos');
                const requestedVideoPath = path.join(targetDir, safeFilename);

                fs.mkdirSync(targetDir, { recursive: true });

                const existingPath = findExistingVideoByBvid(targetDir, bvid);
                const existingInfo = existingPath ? readJsonFile(getInfoPathForVideo(existingPath)) : null;
                if (existingPath) {
                    const infoPath = getInfoPathForVideo(existingPath);
                    if (hasVerifiedExistingQuality(existingInfo)) {
                        writeJsonFile(infoPath, buildVideoMetadata(existingInfo, metadata, existingInfo.selectedFormat, existingPath, {
                            downloadStatus: 'completed',
                            actualSize: fs.statSync(existingPath).size,
                        }));
                        console.log(`[视频已校验存在，跳过下载] ${existingPath}`);
                        json(res, 200, { ok: true, path: existingPath, skipped: true });
                        return;
                    }
                }

                if (activeVideoDownloads.has(bvid)) {
                    const activePath = activeVideoDownloads.get(bvid);
                    console.log(`[视频正在下载中，跳过重复任务] ${activePath}`);
                    json(res, 200, { ok: true, path: activePath, inProgress: true });
                    return;
                }

                let videoPath = existingPath || requestedVideoPath;
                let infoPath = getInfoPathForVideo(videoPath);
                const videoUrl = `https://www.bilibili.com/video/${bvid}`;
                const requestCookies = Array.isArray(cookies) ? cookies.filter(cookie => cookie?.name) : [];
                const cookieCandidates = [];
                const seenSources = new Set();
                const addCookieCandidate = (source, candidateCookies = [], candidateCookieStr = '') => {
                    if (seenSources.has(source)) return;
                    if ((!candidateCookies || candidateCookies.length === 0) && !candidateCookieStr) return;
                    seenSources.add(source);
                    cookieCandidates.push({
                        source,
                        cookies: candidateCookies,
                        cookieStr: candidateCookieStr,
                    });
                };

                if (requestCookies.length > 0) {
                    addCookieCandidate(hasAuthCookie(requestCookies) ? 'request-auth' : 'request-cookies', requestCookies, cookieStr);
                } else if (cookieStr) {
                    addCookieCandidate('request-cookieStr', [], cookieStr);
                }

                if (!hasAuthCookie(requestCookies)) {
                    const browserCandidates = await resolveBrowserCookieCandidates();
                    browserCandidates.forEach(candidate => addCookieCandidate(candidate.source, candidate.cookies, ''));
                }

                if (cookieCandidates.length === 0) {
                    console.log('[yt-dlp] 未获取到登录 Cookie，将以游客身份探测');
                    cookieCandidates.push({ source: 'anonymous', cookies: [], cookieStr: '' });
                }

                let bestCandidate = null;
                let lastProbeError = null;
                for (let i = 0; i < cookieCandidates.length; i += 1) {
                    const candidate = cookieCandidates[i];
                    const probeCookieFile = buildCookieFile(targetDir, `${bvid}_probe_${i}`, candidate.cookies, candidate.cookieStr);

                    try {
                        const probeInfo = await runYtDlpJsonWithRetry(videoUrl, probeCookieFile);
                        const downloadPlan = selectVideoDownloadPlan(probeInfo);
                        if (!downloadPlan) continue;

                        const selectedFormat = summarizeSelectedFormat(downloadPlan);
                        const isBetter = !bestCandidate
                            || compareSelectedFormatQuality(bestCandidate.selectedFormat, selectedFormat) < 0
                            || (
                                compareSelectedFormatQuality(bestCandidate.selectedFormat, selectedFormat) === 0
                                && hasAuthCookie(candidate.cookies)
                                && !hasAuthCookie(bestCandidate.cookies)
                            );

                        console.log(`[yt-dlp] ${candidate.source} 探测到 ${selectedFormat.width}x${selectedFormat.height}@${selectedFormat.fps || '?'} q${selectedFormat.quality}`);

                        if (isBetter) {
                            bestCandidate = {
                                ...candidate,
                                probeInfo,
                                downloadPlan,
                                selectedFormat,
                            };
                        }
                    } catch (err) {
                        lastProbeError = err;
                        console.warn(`[yt-dlp] ${candidate.source} 探测失败: ${err.message}`);
                    } finally {
                        cleanupFile(probeCookieFile);
                    }
                }

                if (!bestCandidate) {
                    throw lastProbeError || new Error('未找到可下载的视频格式');
                }

                const probeInfo = bestCandidate.probeInfo;
                const downloadPlan = bestCandidate.downloadPlan;
                const selectedFormat = bestCandidate.selectedFormat;
                if ((bestCandidate.cookies.length > 0) || bestCandidate.cookieStr) {
                    cookieFile = buildCookieFile(targetDir, bvid, bestCandidate.cookies, bestCandidate.cookieStr);
                    console.log(`[yt-dlp] 采用 Cookie 来源: ${bestCandidate.source}`);
                } else {
                    console.log('[yt-dlp] 将以游客身份下载');
                }

                activeVideoDownloads.set(bvid, videoPath);
                if (existingPath && compareSelectedFormatQuality(existingInfo?.selectedFormat, selectedFormat) >= 0) {
                    activeVideoDownloads.delete(bvid);
                    cleanupFile(cookieFile);
                    writeJsonFile(infoPath, buildVideoMetadata(existingInfo, metadata, existingInfo?.selectedFormat || selectedFormat, existingPath, {
                        downloadStatus: 'completed',
                        actualSize: fs.statSync(existingPath).size,
                        lastResolvedAt: Date.now(),
                        qualityVerifiedAt: Date.now(),
                    }));
                    console.log(`[视频已存在且画质达标，跳过下载] ${existingPath}`);
                    json(res, 200, {
                        ok: true,
                        path: existingPath,
                        skipped: true,
                        selectedFormat: existingInfo?.selectedFormat || selectedFormat,
                    });
                    return;
                }

                if (existingPath) {
                    console.log(`[检测到已有视频可能画质不足，准备覆盖下载] ${existingPath}`);
                    videoPath = existingPath;
                    infoPath = getInfoPathForVideo(existingPath);
                    activeVideoDownloads.set(bvid, videoPath);
                }

                writeJsonFile(infoPath, buildVideoMetadata(existingInfo, metadata, selectedFormat, videoPath, {
                    sourceDuration: probeInfo.duration ?? null,
                    downloadStatus: 'queued',
                    lastResolvedAt: Date.now(),
                }));

                console.log(
                    `[yt-dlp] 已选格式 ${selectedFormat.width}x${selectedFormat.height}@${selectedFormat.fps || '?'} `
                    + `${selectedFormat.videoCodec}${downloadPlan.audio ? ` + ${selectedFormat.audioCodec}` : ''} `
                    + `(估算 ${formatBytes(selectedFormat.estimatedSize)})`
                    + `${selectedFormat.downgradeCount > 0 ? `，已降档 ${selectedFormat.downgradeCount} 次` : ''}`,
                );

                const args = [
                    ...buildYtDlpCommonArgs(cookieFile),
                    '--format', downloadPlan.formatId,
                    '--merge-output-format', 'mp4',
                    '-o', videoPath,
                    videoUrl,
                ];

                console.log(`[开始后台调用 yt-dlp] ${videoPath}`);
                json(res, 200, {
                    ok: true,
                    message: 'yt-dlp started',
                    path: videoPath,
                    selectedFormat,
                });

                const child = spawn(YT_DLP_BIN, buildYtDlpSpawnArgs(args), { windowsHide: true });

                let stderrBuf = '';
                child.stderr.on('data', d => { stderrBuf += d.toString(); });
                child.stdout.on('data', d => { process.stdout.write(`[yt-dlp stdout] ${d}`); });
                child.on('error', (err) => {
                    activeVideoDownloads.delete(bvid);
                    cleanupFile(cookieFile);
                    writeJsonFile(infoPath, buildVideoMetadata(readJsonFile(infoPath), metadata, selectedFormat, videoPath, {
                        sourceDuration: probeInfo.duration ?? null,
                        downloadStatus: 'failed',
                        downloadError: err.message,
                        lastResolvedAt: Date.now(),
                    }));
                    console.error(`[❌ yt-dlp 启动失败]`, err.message);
                });

                child.on('close', (code) => {
                    activeVideoDownloads.delete(bvid);
                    cleanupFile(cookieFile);

                    if (code !== 0) {
                        writeJsonFile(infoPath, buildVideoMetadata(readJsonFile(infoPath), metadata, selectedFormat, videoPath, {
                            sourceDuration: probeInfo.duration ?? null,
                            downloadStatus: 'failed',
                            downloadError: stderrBuf.slice(-1000) || `exit ${code}`,
                            lastResolvedAt: Date.now(),
                        }));
                        console.error(`[❌ yt-dlp 退出码 ${code}]`, stderrBuf.slice(-500));
                        return;
                    }

                    const finalVideoPath = findDownloadedVideoByBaseName(targetDir, path.parse(videoPath).name) || videoPath;
                    const actualSize = fs.existsSync(finalVideoPath) ? fs.statSync(finalVideoPath).size : null;
                    writeJsonFile(infoPath, buildVideoMetadata(readJsonFile(infoPath), metadata, selectedFormat, finalVideoPath, {
                        sourceDuration: probeInfo.duration ?? null,
                        downloadStatus: 'completed',
                        downloadFinishedAt: Date.now(),
                        actualSize,
                        lastResolvedAt: Date.now(),
                        qualityVerifiedAt: Date.now(),
                    }));
                    console.log(`[✅ 视频下载完成] ${finalVideoPath}`);
                });

            } catch (err) {
                if (currentBvid) {
                    activeVideoDownloads.delete(currentBvid);
                }
                cleanupFile(cookieFile);
                console.error(`[❌ 下载视频请求错误]`, err.message);
                if (!res.headersSent) json(res, 400, { ok: false, error: err.message });
            }
        });
        return;
    }

    // ── 获取已下载的视频列表 (供WebUI使用) ───────────────
    if (req.method === 'GET' && req.url === '/api/videos') {
        try {
            const list = [];
            function scanDir(dir) {
                if (!fs.existsSync(dir)) return;
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const fullPath = path.join(dir, file);
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        scanDir(fullPath);
                    } else if (file.endsWith('.info.json')) {
                        try {
                            const info = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                            const baseName = file.replace('.info.json', '');
                            const videoFile = fs.existsSync(path.join(dir, baseName + '.mp4')) ? baseName + '.mp4' : null;
                            const danmakuFile = fs.existsSync(path.join(dir, baseName + '.xml')) ? baseName + '.xml' : null;
                            const folderRelative = path.relative(BASE_DIR, dir).replace(/\\/g, '/');
                            
                            list.push({
                                ...info,
                                folderPath: dir,
                                fileUrlPrefix: folderRelative ? `/files/${encodeURIComponent(folderRelative)}/` : `/files/`,
                                videoFile,
                                danmakuFile,
                                filename: baseName,
                                createdAt: stat.mtimeMs
                            });
                        } catch (e) {}
                    }
                }
            }
            scanDir(path.join(BASE_DIR, 'videos'));
            
            list.sort((a, b) => (b.updateTime || b.createdAt) - (a.updateTime || a.createdAt));
            json(res, 200, { ok: true, data: list });
        } catch (err) {
            json(res, 500, { ok: false, error: err.message });
        }
        return;
    }

    // ── 打开文件夹 (供WebUI使用) ────────────────────────
    if (req.method === 'POST' && req.url === '/api/open-folder') {
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
            try {
                const { folder } = JSON.parse(body);
                if (!folder) throw new Error('folder 不能为空');
                
                const safeFolder = path.normalize(folder);
                if (!safeFolder.startsWith(path.normalize(BASE_DIR))) {
                    throw new Error('权限不足，只能打开下载目录内的文件夹');
                }
                
                const command = process.platform === 'win32'
                    ? `explorer "${safeFolder}"`
                    : process.platform === 'darwin'
                        ? `open "${safeFolder}"`
                        : `xdg-open "${safeFolder}"`;
                        
                exec(command, { windowsHide: true }, (err) => {
                    if (err) console.error('[❌ 打开文件夹失败]', err.message);
                });
                json(res, 200, { ok: true });
            } catch (err) {
                json(res, 500, { ok: false, error: err.message });
            }
        });
        return;
    }

    // ── 提供下载目录内的文件访问 (视频/弹幕等) ───────────
    if (req.method === 'GET' && req.url.startsWith('/files/')) {
        try {
            const fileUri = decodeURIComponent(req.url.replace('/files/', ''));
            const filePath = path.normalize(path.join(BASE_DIR, fileUri));
            
            if (!filePath.startsWith(path.normalize(BASE_DIR)) || !fs.existsSync(filePath)) {
                res.writeHead(404);
                res.end('Not Found');
                return;
            }
            
            const stat = fs.statSync(filePath);
            const fileSize = stat.size;
            const range = req.headers.range;
            
            const ext = path.extname(filePath);
            const mimeType = {
                '.mp4': 'video/mp4',
                '.xml': 'application/xml; charset=utf-8',
                '.json': 'application/json; charset=utf-8'
            }[ext] || 'application/octet-stream';

            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunksize = (end - start) + 1;
                const file = fs.createReadStream(filePath, {start, end});
                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': mimeType,
                });
                file.pipe(res);
            } else {
                res.writeHead(200, {
                    'Content-Length': fileSize,
                    'Content-Type': mimeType,
                });
                fs.createReadStream(filePath).pipe(res);
            }
        } catch (err) {
            res.writeHead(500);
            res.end(err.message);
        }
        return;
    }

    // ── 静态文件服务器 (WebUI) ────────────────────────
    if (req.method === 'GET') {
        let reqPath = req.url.split('?')[0];
        if (reqPath === '/' || reqPath === '/webui') {
            reqPath = '/index.html';
        }
        const webuiDir = path.join(__dirname, 'webui');
        const filePath = path.join(webuiDir, reqPath);
        
        if (filePath.startsWith(webuiDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            const mime = {
                '.html': 'text/html; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.js': 'application/javascript; charset=utf-8',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.svg': 'image/svg+xml'
            }[ext] || 'text/plain';
            
            res.writeHead(200, { 'Content-Type': mime });
            fs.createReadStream(filePath).pipe(res);
            return;
        }
    }

    res.writeHead(404);
    res.end('Not Found');
});

// ──────────────────────────────────────────────
function json(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

server.listen(PORT, '127.0.0.1', () => {
    console.log(`╔════════════════════════════════════════╗`);
    console.log(`║   Bilibili 弹幕下载服务 已启动          ║`);
    console.log(`╠════════════════════════════════════════╣`);
    console.log(`║  端口:  http://127.0.0.1:${PORT}         ║`);
    console.log(`║  目录:  ${BASE_DIR.padEnd(30)} ║`);
    console.log(`╚════════════════════════════════════════╝`);
});
