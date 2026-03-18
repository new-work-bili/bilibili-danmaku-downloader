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
import https from 'https';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 18888;
const BASE_DIR = process.env.DANMAKU_DIR
    || 'F:\\下载\\Chrome\\弹幕';   // ← 在此修改你的默认保存目录


// 确保根目录存在
fs.mkdirSync(BASE_DIR, { recursive: true });

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
        req.on('end', () => {
            try {
                const { folder = '', filename, url, metadata } = JSON.parse(body);
                if (!filename || !url) throw new Error('filename 或 url 不能为空');

                const safeFolder = folder.replace(/\.\./g, '_');
                const safeFilename = path.basename(filename);
                const targetDir = safeFolder ? path.join(BASE_DIR, safeFolder) : BASE_DIR;

                fs.mkdirSync(targetDir, { recursive: true });

                const videoPath = path.join(targetDir, safeFilename);
                const infoPath = path.join(targetDir, safeFilename.replace(/\.[^.]+$/, '') + '.info.json');

                if (metadata) {
                    fs.writeFileSync(infoPath, JSON.stringify(metadata, null, 2), 'utf-8');
                }

                if (fs.existsSync(videoPath) && fs.statSync(videoPath).size > 0) {
                    console.log(`[视频已存在，跳过下载] ${videoPath}`);
                    json(res, 200, { ok: true, path: videoPath, skipped: true });
                    return;
                }

                console.log(`[开始下载视频] ${videoPath}`);
                json(res, 200, { ok: true, message: 'download started', path: videoPath });

                const client = url.startsWith('https') ? https : http;
                const options = {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Referer': 'https://www.bilibili.com'
                    }
                };

                client.get(url, options, (response) => {
                    if (response.statusCode === 302 || response.statusCode === 301) {
                         client.get(response.headers.location, options, (res2) => pipeStream(res2, videoPath));
                    } else {
                         pipeStream(response, videoPath);
                    }
                }).on('error', (err) => console.error(`[❌ 视频请求失败]`, err.message));

                function pipeStream(response, destPath) {
                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        const fileStream = fs.createWriteStream(destPath);
                        response.pipe(fileStream);
                        fileStream.on('finish', () => { fileStream.close(); console.log(`[✅ 视频下载完成] ${destPath}`); });
                        fileStream.on('error', (err) => { console.error(`[❌ 视频写入失败]`, err.message); fs.unlink(destPath, ()=>{}); });
                    } else {
                        console.error(`[❌ 视频流获取失败] HTTP ${response.statusCode}`);
                    }
                }
            } catch (err) {
                console.error(`[❌ 下载视频失败]`, err.message);
                if (!res.headersSent) json(res, 500, { ok: false, error: err.message });
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
            scanDir(BASE_DIR);
            
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
                        
                exec(command, (err) => {
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
