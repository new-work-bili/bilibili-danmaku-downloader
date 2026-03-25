// ==UserScript==
// @name         Bilibili 弹幕下载器 v4（本地服务版）
// @namespace    https://github.com/bilibili-danmaku-downloader
// @version      4.0
// @description  配合本地 danmaku-server.mjs 服务使用，支持自定义保存目录、自动建子文件夹、同名覆盖。降级模式下退回浏览器内置下载。
// @author       bilibili-danmaku-downloader
// @match        *://www.bilibili.com/video/BV*
// @match        *://www.bilibili.com/video/av*
// @match        *://www.bilibili.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_cookie
// @connect      api.bilibili.com
// @connect      comment.bilibili.com
// @connect      127.0.0.1
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ========== 常量 ==========
    const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;
    const MAX_LOG_ENTRIES = 500;
    const MAX_PARALLEL_REQUESTS = 3;
    const STORAGE_KEYS = {
        FAV_ID: 'ddl_fav_media_id',
        POLL_ENABLED: 'ddl_poll_enabled',
        LAST_POLL_TIME: 'ddl_last_poll_time',
        ACTIVE_TAB_TOKEN: 'ddl_active_tab_token',
        ACTIVE_TAB_TS: 'ddl_active_tab_ts',
        POLL_RUNNING: 'ddl_poll_running',
        LOGS: 'ddl_logs',
    };

    // 本地文件写入服务（danmaku-server.mjs）
    const SERVER_URL = 'http://127.0.0.1:18888';
    let serverAvailable = false;

    const MY_TAB_TOKEN = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // ========== 工具函数 ==========

    function extractBvId() {
        const match = window.location.pathname.match(/\/video\/(BV[\w]+)/i);
        return match ? match[1] : null;
    }

    function sanitizeFilename(name) {
        return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    }

    function fetchJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers: { 'Referer': 'https://www.bilibili.com/' },
                responseType: 'json',
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        resolve(res.response);
                    } else {
                        reject(new Error(`HTTP ${res.status}`));
                    }
                },
                onerror: () => reject(new Error('网络请求失败')),
            });
        });
    }

    function fetchXmlContent(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers: { 'Referer': 'https://www.bilibili.com/' },
                responseType: 'text',
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        resolve(res.responseText);
                    } else {
                        reject(new Error(`HTTP ${res.status}`));
                    }
                },
                onerror: () => reject(new Error('网络请求失败')),
            });
        });
    }

    /**
     * 发送文件到本地服务（danmaku-server.mjs）写入磁盘。
     * 服务不可用时自动降级到浏览器内置下载（文件名正确，无子文件夹）。
     * @param {string} filename  文件名（不含路径）
     * @param {string} content   文件内容
     * @param {string} [folder]  可选子文件夹，仅服务模式有效
     */
    function downloadFile(filename, content, folder = '') {
        if (serverAvailable) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${SERVER_URL}/save`,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                data: JSON.stringify({ folder, filename, content }),
                timeout: 10000,
                onload: (res) => {
                    try {
                        const result = JSON.parse(res.responseText);
                        if (!result.ok) {
                            console.error('[弹幕下载器] 服务端写入失败，降级:', result.error);
                            browserDownload(filename, content);
                        }
                    } catch (e) { browserDownload(filename, content); }
                },
                onerror:   () => { serverAvailable = false; updateServerStatus(false); browserDownload(filename, content); },
                ontimeout: () => { browserDownload(filename, content); },
            });
        } else {
            browserDownload(filename, content);
        }
    }

    function browserDownload(filename, content) {
        const mimeType = filename.endsWith('.txt') ? 'text/plain;charset=utf-8' : 'application/xml;charset=utf-8';
        const blob = new Blob([content], { type: mimeType });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    }

    function listCookiesForUrl(url) {
        return new Promise(resolve => {
            GM_cookie.list({ url }, (cookies, error) => {
                if (error || !cookies) {
                    resolve([]);
                    return;
                }
                resolve(cookies);
            });
        });
    }

    async function collectBilibiliCookies() {
        if (typeof GM_cookie === 'undefined') return [];

        const urls = [
            'https://www.bilibili.com/',
            'https://bilibili.com/',
            'https://api.bilibili.com/',
            'https://passport.bilibili.com/',
        ];

        const groups = await Promise.all(urls.map(listCookiesForUrl));
        const merged = new Map();

        groups.flat().forEach(cookie => {
            if (!cookie?.name) return;

            const key = [
                cookie.domain || '',
                cookie.path || '/',
                cookie.name,
                cookie.storeId || '',
            ].join('|');

            merged.set(key, {
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain || '',
                path: cookie.path || '/',
                secure: !!cookie.secure,
                httpOnly: !!cookie.httpOnly,
                hostOnly: !!cookie.hostOnly,
                session: !!cookie.session,
                expirationDate: cookie.expirationDate || 0,
            });
        });

        return [...merged.values()];
    }

    function downloadVideo(filename, metadata) {
        if (!serverAvailable) return;

        const sendPayload = (cookies) => {
            const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${SERVER_URL}/download-video`,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                data: JSON.stringify({ filename, metadata, cookies, cookieStr }),
                onload: (res) => {
                    try {
                        const result = JSON.parse(res.responseText);
                        if (result.skipped) {
                            console.log('[弹幕下载器] 视频已存在，跳过');
                        } else if (result.ok) {
                            console.log('[弹幕下载器] 已触发服务器下载视频:', filename);
                        }
                    } catch(e) {}
                }
            });
        };

        if (typeof GM_cookie !== 'undefined') {
            collectBilibiliCookies()
                .then(cookies => sendPayload(cookies))
                .catch(err => {
                    console.warn('[弹幕下载器] 读取 Cookie 失败，将使用空 Cookie:', err);
                    sendPayload([]);
                });
        } else {
            sendPayload([]);
        }
    }
    function checkServer() {
        GM_xmlhttpRequest({
            method: 'GET', url: `${SERVER_URL}/health`,
            timeout: 2000,
            onload: (res) => {
                try { serverAvailable = JSON.parse(res.responseText).ok === true; } catch (e) { serverAvailable = false; }
                updateServerStatus(serverAvailable);
            },
            onerror:   () => { serverAvailable = false; updateServerStatus(false); },
            ontimeout: () => { serverAvailable = false; updateServerStatus(false); },
        });
    }

    function updateServerStatus(available) {
        const el = document.getElementById('ddl-server-status');
        if (!el) return;
        el.textContent = available ? '🟢 本地服务已连接' : '🔴 本地服务未运行（降级为浏览器下载）';
        el.style.color = available ? '#52c41a' : 'rgba(255,100,80,0.9)';
    }

    /** 生用于日志文件的时间戳, 例如 "2026-03-12_21-33" */
    function formatPollTimestamp(date) {
        const pad = n => String(n).padStart(2, '0');
        return [
            date.getFullYear(),
            pad(date.getMonth() + 1),
            pad(date.getDate()),
        ].join('-') + '_' + [
            pad(date.getHours()),
            pad(date.getMinutes()),
        ].join('-');
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function formatTime(ts) {
        if (!ts) return '-';
        const d = new Date(ts);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    function formatTimeShort(ts) {
        if (!ts) return '-';
        const d = new Date(ts);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // ========== 日志系统 ==========

    function getLogs() {
        return GM_getValue(STORAGE_KEYS.LOGS, []);
    }

    function addLog(entry) {
        const logs = getLogs();
        logs.unshift({
            time: Date.now(),
            ...entry,
        });
        // 限制最大条数
        if (logs.length > MAX_LOG_ENTRIES) logs.length = MAX_LOG_ENTRIES;
        GM_setValue(STORAGE_KEYS.LOGS, logs);
    }

    function clearLogs() {
        GM_setValue(STORAGE_KEYS.LOGS, []);
    }

    // ========== 收藏夹 API ==========

    async function fetchFavoriteList(mediaId) {
        const allItems = [];
        let page = 1;
        const pageSize = 20;
        while (true) {
            const data = await fetchJson(
                `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${mediaId}&pn=${page}&ps=${pageSize}&order=mtime&type=0`
            );
            if (data.code !== 0) throw new Error(data.message || `API 错误 ${data.code}`);
            const medias = data.data?.medias;
            if (!medias || medias.length === 0) break;
            for (const item of medias) {
                // 只处理视频类型，且未失效
                if (item.type === 2 && item.attr !== 9) {
                    allItems.push({
                        bvid: item.bv_id || item.bvid,
                        title: item.title,
                        page: item.page, // 分P数
                    });
                }
            }
            if (!data.data.has_more) break;
            page++;
            await sleep(300);
        }
        return allItems;
    }

    // ========== 样式 ==========

    GM_addStyle(`
        /* ---------- 悬浮面板 ---------- */
        #danmaku-dl-panel {
            position: fixed;
            right: 20px;
            bottom: 80px;
            z-index: 100000;
            width: 340px;
            max-height: 85vh;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
            transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease;
        }
        #danmaku-dl-panel.collapsed {
            transform: translateX(calc(100% + 20px));
            opacity: 0;
            pointer-events: none;
        }

        .ddl-container {
            background: linear-gradient(135deg, rgba(25, 25, 35, 0.95), rgba(35, 35, 50, 0.92));
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(251, 114, 153, 0.25);
            border-radius: 16px;
            box-shadow:
                0 8px 32px rgba(0, 0, 0, 0.35),
                0 0 0 1px rgba(255, 255, 255, 0.05) inset,
                0 0 60px rgba(251, 114, 153, 0.08);
            overflow: hidden;
        }

        .ddl-header {
            background: linear-gradient(135deg, #fb7299, #f04b7f);
            padding: 14px 18px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .ddl-header-title {
            color: #fff;
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .ddl-header-title svg { flex-shrink: 0; }
        .ddl-close-btn {
            background: rgba(255, 255, 255, 0.2);
            border: none;
            color: #fff;
            width: 26px;
            height: 26px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            transition: background 0.2s;
        }
        .ddl-close-btn:hover { background: rgba(255, 255, 255, 0.35); }

        .ddl-body {
            padding: 16px 18px;
            max-height: 65vh;
            overflow-y: auto;
        }
        .ddl-body::-webkit-scrollbar { width: 4px; }
        .ddl-body::-webkit-scrollbar-thumb { background: rgba(251,114,153,0.3); border-radius: 2px; }

        /* 视频信息 */
        .ddl-info { margin-bottom: 14px; }
        .ddl-info-title {
            font-size: 13px;
            color: #eee;
            font-weight: 600;
            line-height: 1.5;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
        }
        .ddl-info-meta { display: flex; gap: 12px; margin-top: 6px; }
        .ddl-tag {
            font-size: 11px;
            color: rgba(251, 114, 153, 0.9);
            background: rgba(251, 114, 153, 0.12);
            padding: 2px 8px;
            border-radius: 10px;
            font-weight: 500;
        }

        /* 按钮 */
        .ddl-actions { display: flex; flex-direction: column; gap: 10px; }
        .ddl-btn {
            width: 100%;
            padding: 11px 16px;
            border: none;
            border-radius: 10px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.25s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            letter-spacing: 0.3px;
        }
        .ddl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .ddl-btn-primary {
            background: linear-gradient(135deg, #fb7299, #f04b7f);
            color: #fff;
            box-shadow: 0 4px 15px rgba(251, 114, 153, 0.3);
        }
        .ddl-btn-primary:not(:disabled):hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(251, 114, 153, 0.45);
        }
        .ddl-btn-secondary {
            background: rgba(255, 255, 255, 0.08);
            color: #ddd;
            border: 1px solid rgba(255, 255, 255, 0.12);
        }
        .ddl-btn-secondary:not(:disabled):hover {
            background: rgba(255, 255, 255, 0.14);
            border-color: rgba(251, 114, 153, 0.3);
            color: #fff;
        }
        .ddl-btn-sm {
            padding: 7px 12px;
            font-size: 12px;
            font-weight: 500;
        }

        /* 进度 */
        .ddl-progress { margin-top: 14px; display: none; }
        .ddl-progress.active { display: block; }
        .ddl-progress-bar-track {
            width: 100%;
            height: 6px;
            background: rgba(255, 255, 255, 0.08);
            border-radius: 3px;
            overflow: hidden;
        }
        .ddl-progress-bar-fill {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #fb7299, #ff9cba);
            border-radius: 3px;
            transition: width 0.3s ease;
        }
        .ddl-progress-text {
            font-size: 11px;
            color: rgba(255, 255, 255, 0.6);
            margin-top: 6px;
            text-align: center;
        }

        /* 状态 */
        .ddl-status {
            margin-top: 12px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.5);
            text-align: center;
            min-height: 18px;
            transition: color 0.2s;
        }
        .ddl-status.success { color: #52c41a; }
        .ddl-status.error { color: #ff4d4f; }

        /* ---------- 分割线 ---------- */
        .ddl-divider {
            height: 1px;
            background: rgba(255, 255, 255, 0.08);
            margin: 16px 0;
        }

        /* ---------- 自动轮询区 ---------- */
        .ddl-section-title {
            font-size: 12px;
            color: rgba(251, 114, 153, 0.8);
            font-weight: 600;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .ddl-input-group {
            display: flex;
            gap: 8px;
            align-items: center;
            margin-bottom: 10px;
        }
        .ddl-input {
            flex: 1;
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 12px;
            color: #ddd;
            outline: none;
            transition: border-color 0.2s;
        }
        .ddl-input:focus { border-color: rgba(251, 114, 153, 0.5); }
        .ddl-input::placeholder { color: rgba(255, 255, 255, 0.25); }

        .ddl-input-hint {
            font-size: 10px;
            color: rgba(255, 255, 255, 0.3);
            margin-bottom: 10px;
            line-height: 1.5;
        }

        /* 开关 */
        .ddl-switch-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        .ddl-switch-label {
            font-size: 12px;
            color: #ccc;
        }
        .ddl-switch {
            position: relative;
            width: 40px;
            height: 22px;
            background: rgba(255, 255, 255, 0.15);
            border-radius: 11px;
            cursor: pointer;
            transition: background 0.3s;
            border: none;
            outline: none;
        }
        .ddl-switch.on {
            background: linear-gradient(135deg, #fb7299, #f04b7f);
        }
        .ddl-switch::after {
            content: '';
            position: absolute;
            top: 2px;
            left: 2px;
            width: 18px;
            height: 18px;
            background: #fff;
            border-radius: 50%;
            transition: transform 0.3s;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .ddl-switch.on::after {
            transform: translateX(18px);
        }

        .ddl-poll-status {
            font-size: 11px;
            color: rgba(255, 255, 255, 0.4);
            margin-top: 4px;
            line-height: 1.6;
        }

        /* ---------- 诊断行 ---------- */
        .ddl-diag {
            margin-top: 10px;
            padding: 7px 10px;
            background: rgba(255, 255, 255, 0.04);
            border-radius: 7px;
            border: 1px solid rgba(255, 255, 255, 0.07);
            font-size: 10px;
            color: rgba(255, 255, 255, 0.3);
            line-height: 1.8;
            font-family: 'Consolas', 'Monaco', monospace;
        }
        .ddl-diag-label { color: rgba(255, 255, 255, 0.2); }
        .ddl-diag-value { color: rgba(255, 255, 255, 0.5); }

        /* ---------- 日志面板按钮行 ---------- */
        .ddl-log-buttons {
            display: flex;
            gap: 8px;
            margin-top: 10px;
        }

        /* ---------- 日志弹窗 ---------- */
        #ddl-log-overlay {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.6);
            z-index: 200000;
            justify-content: center;
            align-items: center;
        }
        #ddl-log-overlay.active { display: flex; }

        .ddl-log-modal {
            width: 520px;
            max-width: 90vw;
            max-height: 75vh;
            background: linear-gradient(135deg, rgba(25, 25, 35, 0.98), rgba(35, 35, 50, 0.96));
            backdrop-filter: blur(20px);
            border: 1px solid rgba(251, 114, 153, 0.2);
            border-radius: 16px;
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .ddl-log-header {
            background: linear-gradient(135deg, #fb7299, #f04b7f);
            padding: 14px 18px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
        }
        .ddl-log-header-title {
            color: #fff;
            font-size: 14px;
            font-weight: 700;
        }
        .ddl-log-header-actions {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .ddl-log-clear-btn {
            background: rgba(255,255,255,0.2);
            border: none;
            color: #fff;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 11px;
            cursor: pointer;
            transition: background 0.2s;
        }
        .ddl-log-clear-btn:hover { background: rgba(255,255,255,0.3); }

        .ddl-log-body {
            flex: 1;
            overflow-y: auto;
            padding: 12px 16px;
        }
        .ddl-log-body::-webkit-scrollbar { width: 4px; }
        .ddl-log-body::-webkit-scrollbar-thumb { background: rgba(251,114,153,0.3); border-radius: 2px; }

        .ddl-log-empty {
            text-align: center;
            color: rgba(255,255,255,0.3);
            font-size: 13px;
            padding: 40px 0;
        }

        .ddl-log-entry {
            padding: 8px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            font-size: 12px;
            line-height: 1.6;
        }
        .ddl-log-entry:last-child { border-bottom: none; }
        .ddl-log-time {
            color: rgba(255, 255, 255, 0.35);
            font-size: 11px;
            font-family: 'Consolas', 'Monaco', monospace;
        }
        .ddl-log-title {
            color: #eee;
            font-weight: 500;
        }
        .ddl-log-detail {
            color: rgba(255, 255, 255, 0.45);
            font-size: 11px;
        }
        .ddl-log-success { color: #52c41a; }
        .ddl-log-fail { color: #ff4d4f; }

        /* ---------- 触发按钮 ---------- */
        #danmaku-dl-trigger {
            position: fixed;
            right: 20px;
            bottom: 80px;
            z-index: 99999;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: linear-gradient(135deg, #fb7299, #f04b7f);
            border: none;
            color: #fff;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow:
                0 4px 20px rgba(251, 114, 153, 0.4),
                0 0 40px rgba(251, 114, 153, 0.15);
            transition: all 0.3s ease;
            animation: ddl-pulse 2s infinite;
        }
        #danmaku-dl-trigger:hover {
            transform: scale(1.1);
            box-shadow:
                0 6px 25px rgba(251, 114, 153, 0.55),
                0 0 50px rgba(251, 114, 153, 0.25);
        }
        /* 隐藏时暂停动画，避免后台标签页持续消耗 GPU */
        #danmaku-dl-trigger.hidden {
            transform: scale(0);
            opacity: 0;
            pointer-events: none;
            animation-play-state: paused;
        }

        @keyframes ddl-pulse {
            0%, 100% { box-shadow: 0 4px 20px rgba(251,114,153,0.4), 0 0 0 0 rgba(251,114,153,0.3); }
            50% { box-shadow: 0 4px 20px rgba(251,114,153,0.4), 0 0 0 8px rgba(251,114,153,0); }
        }
    `);

    // ========== Icons ==========

    const danmakuIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/></svg>`;
    const downloadIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    const clockIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const logIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;

    // ========== 判断当前是否在视频页 ==========

    const isVideoPage = () => /\/video\/BV/i.test(window.location.pathname);

    // ========== 构建 UI ==========

    // 触发按钮
    const triggerBtn = document.createElement('button');
    triggerBtn.id = 'danmaku-dl-trigger';
    triggerBtn.innerHTML = danmakuIcon;
    triggerBtn.title = '打开弹幕下载器';

    // 面板
    const panel = document.createElement('div');
    panel.id = 'danmaku-dl-panel';
    panel.classList.add('collapsed');

    const savedFavId = GM_getValue(STORAGE_KEYS.FAV_ID, '');
    const savedPollEnabled = GM_getValue(STORAGE_KEYS.POLL_ENABLED, false);

    panel.innerHTML = `
        <div class="ddl-container">
            <div class="ddl-header">
                <span class="ddl-header-title">${danmakuIcon} 弹幕下载器</span>
                <button class="ddl-close-btn" title="收起面板">✕</button>
            </div>
            <div class="ddl-body">
                <!-- 当前视频下载区（仅视频页显示） -->
                <div id="ddl-video-section" style="display:none">
                    <div class="ddl-info">
                        <div class="ddl-info-title" id="ddl-video-title">加载中...</div>
                        <div class="ddl-info-meta">
                            <span class="ddl-tag" id="ddl-bv-tag">-</span>
                            <span class="ddl-tag" id="ddl-parts-tag">-</span>
                        </div>
                    </div>
                    <div class="ddl-actions">
                        <button class="ddl-btn ddl-btn-primary" id="ddl-btn-split" disabled>
                            ${downloadIcon} 逐 P 下载弹幕
                        </button>
                        <button class="ddl-btn ddl-btn-secondary" id="ddl-btn-merge" disabled>
                            ${downloadIcon} 合并下载弹幕
                        </button>
                    </div>
                    <div class="ddl-progress" id="ddl-progress">
                        <div class="ddl-progress-bar-track">
                            <div class="ddl-progress-bar-fill" id="ddl-progress-fill"></div>
                        </div>
                        <div class="ddl-progress-text" id="ddl-progress-text">0%</div>
                    </div>
                    <div class="ddl-status" id="ddl-status"></div>
                    <div class="ddl-divider"></div>
                </div>

                <!-- 自动轮询区 -->
                <div class="ddl-section-title">${clockIcon} 收藏夹自动轮询</div>

                <div class="ddl-input-group">
                    <input class="ddl-input" id="ddl-fav-id" type="text"
                           placeholder="收藏夹 ID" value="${savedFavId}" />
                    <button class="ddl-btn ddl-btn-primary ddl-btn-sm" id="ddl-fav-save"
                            style="flex-shrink:0;width:auto;">保存</button>
                </div>
                <div class="ddl-input-hint">
                    收藏夹 ID 从 URL 获取：space.bilibili.com/xxx/favlist?fid=<b style="color:#fb7299">123456</b>
                </div>

                <div class="ddl-switch-row">
                    <span class="ddl-switch-label">每 6 小时自动下载</span>
                    <button class="ddl-switch ${savedPollEnabled ? 'on' : ''}" id="ddl-poll-switch"></button>
                </div>

                <div class="ddl-poll-status" id="ddl-poll-status">-</div>

                <!-- 服务器状态 + 诊断信息 -->
                <div class="ddl-diag" id="ddl-diag">
                    <span id="ddl-server-status" style="font-size:10px;color:rgba(255,100,80,0.9);">🔴 本地服务未运行（降级为浏览器下载）</span><br/>
                    <span class="ddl-diag-label">标签角色：</span><span class="ddl-diag-value" id="ddl-diag-role">初始化中...</span><br/>
                    <span class="ddl-diag-label">后台唤醒：</span><span class="ddl-diag-value" id="ddl-diag-wakes">0 次</span>
                </div>

                <button class="ddl-btn ddl-btn-secondary ddl-btn-sm" id="ddl-poll-now"
                        style="margin-top:10px;">
                    🔄 立即执行一次
                </button>

                <!-- 日志按钮 -->
                <div class="ddl-log-buttons">
                    <button class="ddl-btn ddl-btn-secondary ddl-btn-sm" id="ddl-log-open" style="flex:1">
                        ${logIcon} 查看日志
                    </button>
                </div>
            </div>
        </div>
    `;

    // 日志弹窗
    const logOverlay = document.createElement('div');
    logOverlay.id = 'ddl-log-overlay';
    logOverlay.innerHTML = `
        <div class="ddl-log-modal">
            <div class="ddl-log-header">
                <span class="ddl-log-header-title">${logIcon} 下载日志</span>
                <div class="ddl-log-header-actions">
                    <button class="ddl-log-clear-btn" id="ddl-log-clear">清空</button>
                    <button class="ddl-close-btn" id="ddl-log-close" title="关闭">✕</button>
                </div>
            </div>
            <div class="ddl-log-body" id="ddl-log-body"></div>
        </div>
    `;

    document.body.appendChild(triggerBtn);
    document.body.appendChild(panel);
    document.body.appendChild(logOverlay);

    // ========== DOM 引用 ==========

    const closeBtn = panel.querySelector('.ddl-close-btn');
    const videoSection = panel.querySelector('#ddl-video-section');
    const btnSplit = panel.querySelector('#ddl-btn-split');
    const btnMerge = panel.querySelector('#ddl-btn-merge');
    const progressEl = panel.querySelector('#ddl-progress');
    const progressFill = panel.querySelector('#ddl-progress-fill');
    const progressText = panel.querySelector('#ddl-progress-text');
    const statusEl = panel.querySelector('#ddl-status');
    const videoTitleEl = panel.querySelector('#ddl-video-title');
    const bvTagEl = panel.querySelector('#ddl-bv-tag');
    const partsTagEl = panel.querySelector('#ddl-parts-tag');

    const favIdInput = panel.querySelector('#ddl-fav-id');
    const favSaveBtn = panel.querySelector('#ddl-fav-save');
    const pollSwitch = panel.querySelector('#ddl-poll-switch');
    const pollStatusEl = panel.querySelector('#ddl-poll-status');
    const pollNowBtn = panel.querySelector('#ddl-poll-now');
    const logOpenBtn = panel.querySelector('#ddl-log-open');

    const logBody = logOverlay.querySelector('#ddl-log-body');
    const logCloseBtn = logOverlay.querySelector('#ddl-log-close');
    const logClearBtn = logOverlay.querySelector('#ddl-log-clear');

    // ========== 面板开合 ==========

    let panelOpen = false;

    function togglePanel(open) {
        panelOpen = open;
        panel.classList.toggle('collapsed', !open);
        triggerBtn.classList.toggle('hidden', open);
    }

    triggerBtn.addEventListener('click', () => togglePanel(true));
    closeBtn.addEventListener('click', () => togglePanel(false));

    // ========== 进度与状态 ==========

    function setProgress(pct, text) {
        progressEl.classList.add('active');
        progressFill.style.width = pct + '%';
        progressText.textContent = text || (Math.round(pct) + '%');
    }

    function resetProgress() {
        progressEl.classList.remove('active');
        progressFill.style.width = '0%';
        progressText.textContent = '0%';
    }

    function setStatus(msg, type) {
        statusEl.textContent = msg;
        statusEl.className = 'ddl-status' + (type ? ' ' + type : '');
    }

    function setVideoButtonsDisabled(disabled) {
        btnSplit.disabled = disabled;
        btnMerge.disabled = disabled;
    }

    // ========== 当前视频手动下载（复用 v2 逻辑） ==========

    let videoInfo = null;

    async function loadVideoInfo() {
        const bvId = extractBvId();
        if (!bvId) return;

        videoSection.style.display = 'block';
        bvTagEl.textContent = bvId;

        try {
            const data = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvId}`);
            if (data.code !== 0) throw new Error(data.message);

            const mainTitle = sanitizeFilename(data.data.title);
            const pages = data.data.pages;

            videoInfo = { 
                title: mainTitle, 
                bvId, 
                pages,
                metadata: {
                    bvid: bvId,
                    title: data.data.title,
                    cover: data.data.pic,
                    uploader: data.data.owner?.name,
                    pubdate: data.data.pubdate,
                    desc: data.data.desc,
                    updateTime: Date.now()
                }
            };

            videoTitleEl.textContent = data.data.title;
            partsTagEl.textContent = `${pages.length} P`;
            setVideoButtonsDisabled(false);
            setStatus('就绪，点击按钮开始下载');
        } catch (err) {
            videoTitleEl.textContent = '加载失败';
            setStatus('获取视频信息失败: ' + err.message, 'error');
        }
    }

    async function downloadSplit() {
        if (!videoInfo) return;
        const { title, bvId, pages } = videoInfo;
        setVideoButtonsDisabled(true);
        setStatus('');
        setProgress(0, `0 / ${pages.length}`);

        let succCount = 0, failCount = 0;

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const partName = sanitizeFilename(page.part);
            const fileName = `${title}_P${page.page}_${partName}_${bvId}.xml`;
            const url = `https://comment.bilibili.com/${page.cid}.xml`;
            try {
                const content = await fetchXmlContent(url);
                downloadFile(fileName, content);
                succCount++;
            } catch (err) {
                failCount++;
                console.error(`[弹幕下载器] P${page.page} 下载失败:`, err.message);
            }
            setProgress(((i + 1) / pages.length) * 100, `${i + 1} / ${pages.length}`);
            if (pages.length > 1) await sleep(300);
        }

        resetProgress();
        setVideoButtonsDisabled(false);
        if (failCount === 0) {
            setStatus(`✅ 全部完成！共下载 ${succCount} 个文件`, 'success');
        } else {
            setStatus(`完成：${succCount} 成功, ${failCount} 失败`, 'error');
        }
        
        // 后台触发全局视频下载
        downloadVideo(`${title}_${bvId}.mp4`, videoInfo.metadata);
    }

    async function downloadMerge() {
        if (!videoInfo) return;
        const { title, bvId, pages } = videoInfo;
        setVideoButtonsDisabled(true);
        setStatus('');
        setProgress(0, `正在下载并合并 ${pages.length} P ...`);

        const tasks = pages.map((page, idx) => {
            const url = `https://comment.bilibili.com/${page.cid}.xml`;
            return fetchXmlContent(url)
                .then(content => {
                    setProgress(((idx + 1) / pages.length) * 80, `下载中 ${idx + 1}/${pages.length}`);
                    return { cid: page.cid, content };
                })
                .catch(err => {
                    console.error(`[弹幕下载器] P${page.page} 下载失败:`, err.message);
                    return null;
                });
        });

        const results = await Promise.all(tasks);
        setProgress(85, '合并中...');

        let allDanmaku = [];
        results.forEach(res => {
            if (res && res.content) {
                const matches = res.content.match(/<d p=".*?">.*?<\/d>/g);
                if (matches) allDanmaku.push(...matches);
            }
        });

        const mergedXml = `<?xml version="1.0" encoding="UTF-8"?>
<i>
    <chatserver>chat.bilibili.com</chatserver>
    <chatid>${pages[0].cid}</chatid>
    <mission>0</mission>
    <source>k-v</source>
    ${allDanmaku.join('\n    ')}
</i>`;

        const fileName = `${title}_[全集合并]_${bvId}.xml`;
        setProgress(95, '保存文件...');
        downloadFile(fileName, mergedXml);

        resetProgress();
        setVideoButtonsDisabled(false);
        setStatus(`✅ 合并完成！共 ${allDanmaku.length} 条弹幕`, 'success');

        // 后台触发全局视频下载
        downloadVideo(`${title}_${bvId}.mp4`, videoInfo.metadata);
    }

    btnSplit.addEventListener('click', downloadSplit);
    btnMerge.addEventListener('click', downloadMerge);

    // ========== 收藏夹轮询逻辑 ==========

    let isPolling = false;
    let wakeCount = 0;       // 后台定时器活跃次数
    let schedulerRole = '初始化中'; // '主控' | '待机'

    const diagRoleEl = panel.querySelector('#ddl-diag-role');
    const diagWakesEl = panel.querySelector('#ddl-diag-wakes');

    function updateDiag() {
        diagRoleEl.textContent = schedulerRole;
        diagWakesEl.textContent = `${wakeCount} 次`;
    }

    function updatePollStatusUI() {
        const enabled = GM_getValue(STORAGE_KEYS.POLL_ENABLED, false);
        const lastPoll = GM_getValue(STORAGE_KEYS.LAST_POLL_TIME, 0);
        const favId = GM_getValue(STORAGE_KEYS.FAV_ID, '');

        let statusText = '';
        if (!favId) {
            statusText = '请先配置收藏夹 ID';
        } else if (!enabled) {
            statusText = '自动轮询已关闭';
        } else {
            statusText = `上次轮询: ${formatTimeShort(lastPoll)}`;
            if (lastPoll) {
                const nextPoll = lastPoll + POLL_INTERVAL_MS;
                statusText += ` · 下次: ${formatTimeShort(nextPoll)}`;
            }
        }
        if (isPolling) statusText = '⏳ 正在轮询中...';
        pollStatusEl.textContent = statusText;
        updateDiag();
    }

    /**
     * 为单个视频获取合并弹幕（轮询用）
     */
    async function fetchMergedDanmakuForVideo(bvId) {
        const viewData = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvId}`);
        if (viewData.code !== 0) throw new Error(viewData.message);

        const title = sanitizeFilename(viewData.data.title);
        const pages = viewData.data.pages;

        // 限并发下载所有分P弹幕，避免瞬间发出过多请求
        const results = await pooledPromiseAll(
            pages.map(page => () => {
                const url = `https://comment.bilibili.com/${page.cid}.xml`;
                return fetchXmlContent(url).then(content => ({ cid: page.cid, content })).catch(() => null);
            }),
            MAX_PARALLEL_REQUESTS
        );

        let allDanmaku = [];
        results.forEach(res => {
            if (res && res.content) {
                const matches = res.content.match(/<d p=".*?">.*?<\/d>/g);
                if (matches) allDanmaku.push(...matches);
            }
        });

        const mergedXml = `<?xml version="1.0" encoding="UTF-8"?>
<i>
    <chatserver>chat.bilibili.com</chatserver>
    <chatid>${pages[0].cid}</chatid>
    <mission>0</mission>
    <source>k-v</source>
    ${allDanmaku.join('\n    ')}
</i>`;

        const metadata = {
            bvid: bvId,
            title: viewData.data.title,
            cover: viewData.data.pic,
            uploader: viewData.data.owner?.name,
            pubdate: viewData.data.pubdate,
            desc: viewData.data.desc,
            updateTime: Date.now()
        };
        const fileName = `${title}_[全集合并]_${bvId}.xml`;
        return { fileName, mergedXml, title: viewData.data.title, danmakuCount: allDanmaku.length, pages: pages.length, metadata };
    }

    /**
     * 执行一次收藏夹轮询
     */
    async function pollFavorites() {
        const favId = GM_getValue(STORAGE_KEYS.FAV_ID, '');
        if (!favId) {
            updatePollStatusUI();
            return;
        }

        if (isPolling) return;

        // 全局轮询互斥锁：防止多个标签页实例并发运行
        const pollRunning = GM_getValue(STORAGE_KEYS.POLL_RUNNING, 0);
        if (Date.now() - pollRunning < 10 * 60 * 1000) {
            addLog({ type: 'info', message: '另一个标签页正在轮询中，跳过' });
            return;
        }

        GM_setValue(STORAGE_KEYS.POLL_RUNNING, Date.now());
        isPolling = true;
        updatePollStatusUI();

        // 本次轮询的子文件夹名（精确到分钟）
        const pollFolder = formatPollTimestamp(new Date());
        // 收集本次会话每条记录，用于生成日志文件
        const sessionLines = [];
        let totalSuccess = 0, totalFail = 0;

        try {
            addLog({ type: 'info', message: `开始轮询收藏夹 (ID: ${favId})` });
            sessionLines.push(`轮询时间: ${pollFolder.replace('_', ' ').replace(/-/g, ':')}`);
            sessionLines.push(`收藏夹 ID: ${favId}`);
            sessionLines.push('');

            const videos = await fetchFavoriteList(favId);
            addLog({ type: 'info', message: `获取到 ${videos.length} 个视频` });
            sessionLines.push(`共 ${videos.length} 个视频`);
            sessionLines.push('─'.repeat(50));

            for (let i = 0; i < videos.length; i++) {
                const video = videos[i];
                pollStatusEl.textContent = `⏳ 下载中 (${i + 1}/${videos.length}): ${video.title}`;

                try {
                    const result = await fetchMergedDanmakuForVideo(video.bvid);
                    downloadFile(result.fileName, result.mergedXml, pollFolder);
                    downloadVideo(`${sanitizeFilename(result.title)}_${video.bvid}.mp4`, result.metadata);

                    addLog({
                        type: 'success',
                        bvid: video.bvid,
                        title: video.title,
                        message: `下载成功 · ${result.pages}P · ${result.danmakuCount} 条弹幕`,
                    });
                    sessionLines.push(`✅ ${result.title}`);
                    sessionLines.push(`   ${video.bvid}  ${result.pages}P · ${result.danmakuCount} 条弹幕`);
                    totalSuccess++;
                } catch (err) {
                    addLog({
                        type: 'error',
                        bvid: video.bvid,
                        title: video.title,
                        message: `下载失败: ${err.message}`,
                    });
                    sessionLines.push(`❌ ${video.title}`);
                    sessionLines.push(`   ${video.bvid}  失败: ${err.message}`);
                    totalFail++;
                }

                // 间隔避免频率限制
                await sleep(1000);
            }

            GM_setValue(STORAGE_KEYS.LAST_POLL_TIME, Date.now());

            const summary = `轮询完成: ${totalSuccess} 成功, ${totalFail} 失败`;
            addLog({ type: totalFail > 0 ? 'error' : 'success', message: summary });

            // 生成本次轮询的日志文件
            sessionLines.push('─'.repeat(50));
            sessionLines.push(`合计: ${totalSuccess} 成功, ${totalFail} 失败`);
            const logContent = sessionLines.join('\n');
            downloadFile(`轮询日志_${pollFolder}.txt`, logContent);

            // 发送桌面通知
            try {
                GM_notification({
                    title: '弹幕下载器 - 轮询完成',
                    text: summary,
                    timeout: 5000,
                });
            } catch (e) { /* 通知可能不被允许 */ }

        } catch (err) {
            addLog({ type: 'error', message: `轮询失败: ${err.message}` });
        } finally {
            GM_setValue(STORAGE_KEYS.POLL_RUNNING, 0); // 释放全局轮询锁
            isPolling = false;
            updatePollStatusUI();
        }
    }

    // ========== 收藏夹设置事件 ==========

    favSaveBtn.addEventListener('click', () => {
        const val = favIdInput.value.trim();
        GM_setValue(STORAGE_KEYS.FAV_ID, val);
        updatePollStatusUI();
        favSaveBtn.textContent = '✓ 已保存';
        setTimeout(() => { favSaveBtn.textContent = '保存'; }, 1500);
    });

    pollSwitch.addEventListener('click', () => {
        const newState = !GM_getValue(STORAGE_KEYS.POLL_ENABLED, false);
        GM_setValue(STORAGE_KEYS.POLL_ENABLED, newState);
        pollSwitch.classList.toggle('on', newState);
        updatePollStatusUI();
        if (newState) schedulePoll();
    });

    pollNowBtn.addEventListener('click', () => {
        if (isPolling) return;
        // 重新探测服务状态（服务可能已在脚本加载后才启动）
        checkServer();
        setTimeout(() => pollFavorites(), 300); // 等探测结果稳定后再跑
    });

    // ========== 日志 UI 事件 ==========

    logOpenBtn.addEventListener('click', () => {
        renderLogList();
        logOverlay.classList.add('active');
    });

    logCloseBtn.addEventListener('click', () => {
        logOverlay.classList.remove('active');
    });

    logOverlay.addEventListener('click', (e) => {
        if (e.target === logOverlay) logOverlay.classList.remove('active');
    });

    logClearBtn.addEventListener('click', () => {
        clearLogs();
        renderLogList();
    });

    function renderLogList() {
        const logs = getLogs();
        if (logs.length === 0) {
            logBody.innerHTML = '<div class="ddl-log-empty">暂无日志记录</div>';
            return;
        }

        logBody.innerHTML = logs.map(log => {
            const statusClass = log.type === 'success' ? 'ddl-log-success' : log.type === 'error' ? 'ddl-log-fail' : '';
            const statusIcon = log.type === 'success' ? '✅' : log.type === 'error' ? '❌' : 'ℹ️';
            const titlePart = log.title
                ? `<span class="ddl-log-title">${log.title}</span> <span class="ddl-log-detail">${log.bvid || ''}</span><br/>`
                : '';

            return `
                <div class="ddl-log-entry">
                    <span class="ddl-log-time">${formatTime(log.time)}</span>
                    ${statusIcon} ${titlePart}
                    <span class="${statusClass}">${log.message}</span>
                </div>
            `;
        }).join('');
    }

    // ========== 并发池工具 ==========

    /**
     * 限制并发数的 Promise.all
     * @param {Array<() => Promise>} factories  任务工厂函数数组
     * @param {number} limit  最大并发数
     */
    async function pooledPromiseAll(factories, limit) {
        const results = new Array(factories.length);
        let nextIdx = 0;

        async function worker() {
            while (nextIdx < factories.length) {
                const idx = nextIdx++;
                results[idx] = await factories[idx]();
            }
        }

        const workers = Array.from({ length: Math.min(limit, factories.length) }, worker);
        await Promise.all(workers);
        return results;
    }

    // ========== 定时调度（多标签页竞争锁） ==========

    let pollTimer = null;

    /**
     * 尝试获取「活跃调度标签页」的令牌。
     * 只有持有最新 token 的标签页才会注册 setInterval，
     * 其余标签页保持静默，避免 N 个标签页同时跑定时器。
     */
    function tryAcquireSchedulerLock() {
        // 先检查是否已有「新鲜」的持锁者（2 分钟内）
        // 如果有，直接放弃竞争——这是此前缺失的关键逸辑
        const existingTs = GM_getValue(STORAGE_KEYS.ACTIVE_TAB_TS, 0);
        const existingToken = GM_getValue(STORAGE_KEYS.ACTIVE_TAB_TOKEN, '');
        const LOCK_GRACE_MS = 2 * 60 * 1000; // 2 分钟内认为锁仍有效
        if (existingToken && Date.now() - existingTs < LOCK_GRACE_MS) {
            return Promise.resolve(false); // 已有活跃持锁者，让路
        }

        // 没有活跃持锁者，开始竞争
        GM_setValue(STORAGE_KEYS.ACTIVE_TAB_TOKEN, MY_TAB_TOKEN);
        GM_setValue(STORAGE_KEYS.ACTIVE_TAB_TS, Date.now());
        return new Promise(resolve => {
            setTimeout(() => {
                const won = GM_getValue(STORAGE_KEYS.ACTIVE_TAB_TOKEN, '') === MY_TAB_TOKEN;
                if (won) {
                    // 将锁时间戳更新为当前，确认自己是持锁者
                    GM_setValue(STORAGE_KEYS.ACTIVE_TAB_TS, Date.now());
                }
                resolve(won);
            }, 200 + Math.random() * 300);
        });
    }

    async function schedulePoll() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }

        const enabled = GM_getValue(STORAGE_KEYS.POLL_ENABLED, false);
        if (!enabled) return;

        // 竞争调度锁：只有一个标签页负责定时
        const hasLock = await tryAcquireSchedulerLock();
        if (!hasLock) {
            // 本标签没抢到锁，每 5 分钟检查一次持锁标签页是否还活着
            // 间隔与持锁标签页保持一致，避免额外开销
            schedulerRole = '待机';
            updateDiag();
            pollTimer = setInterval(async () => {
                wakeCount++;
                updateDiag();
                const nowEnabled = GM_getValue(STORAGE_KEYS.POLL_ENABLED, false);
                if (!nowEnabled) { clearInterval(pollTimer); pollTimer = null; return; }
                // 如果发现锁已消失（持锁标签页关闭），重新竞争
                const currentToken = GM_getValue(STORAGE_KEYS.ACTIVE_TAB_TOKEN, '');
                if (!currentToken || currentToken === MY_TAB_TOKEN) {
                    clearInterval(pollTimer);
                    pollTimer = null;
                    schedulePoll(); // 重新竞争
                }
            }, 5 * 60 * 1000); // 每 5 分钟检查，最多延迟 5 分钟接管调度
            return;
        }

        // 本标签页持锁，负责实际的轮询调度
        schedulerRole = '主控';
        updateDiag();
        const lastPoll = GM_getValue(STORAGE_KEYS.LAST_POLL_TIME, 0);
        const elapsed = Date.now() - lastPoll;

        // 如果距上次轮询已超过间隔，立即执行一次
        if (elapsed >= POLL_INTERVAL_MS) {
            setTimeout(() => pollFavorites(), 3000);
        }

        // 每 5 分钟检查一次是否到了轮询时间
        pollTimer = setInterval(() => {
            wakeCount++;
            updateDiag();
            // 续期调度锁（让后就的标签页知道已有活跃持锁者）
            GM_setValue(STORAGE_KEYS.ACTIVE_TAB_TS, Date.now());
            const nowEnabled = GM_getValue(STORAGE_KEYS.POLL_ENABLED, false);
            if (!nowEnabled) { clearInterval(pollTimer); pollTimer = null; return; }
            // 失去锁时停止（说明有新标签页接管）
            if (GM_getValue(STORAGE_KEYS.ACTIVE_TAB_TOKEN, '') !== MY_TAB_TOKEN) {
                clearInterval(pollTimer); pollTimer = null;
                schedulePoll();
                return;
            }
            const last = GM_getValue(STORAGE_KEYS.LAST_POLL_TIME, 0);
            if (Date.now() - last >= POLL_INTERVAL_MS) {
                pollFavorites();
            }
        }, 5 * 60 * 1000);
    }

    // ========== 初始化 ==========

    // 如果在视频页，加载视频信息
    if (isVideoPage()) {
        loadVideoInfo();
    }

    // 更新轮询状态
    updatePollStatusUI();

    // 探测本地服务
    checkServer();

    // 启动定时调度
    schedulePoll();

})();
