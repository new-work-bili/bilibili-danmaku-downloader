// ==UserScript==
// @name         Bilibili 弹幕下载器
// @namespace    https://github.com/bilibili-danmaku-downloader
// @version      3.1
// @description  在 B 站视频页面一键下载弹幕 XML 文件，支持多 P 逐集下载、合并下载、收藏夹定时轮询自动下载
// @author       bilibili-danmaku-downloader
// @match        *://www.bilibili.com/video/BV*
// @match        *://www.bilibili.com/video/av*
// @match        *://www.bilibili.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @connect      api.bilibili.com
// @connect      comment.bilibili.com
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ========== 常量 ==========
    const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 小时
    const MAX_LOG_ENTRIES = 500;
    const STORAGE_KEYS = {
        FAV_ID: 'ddl_fav_media_id',
        POLL_ENABLED: 'ddl_poll_enabled',
        LAST_POLL_TIME: 'ddl_last_poll_time',
        LOGS: 'ddl_logs',
    };

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

    function downloadFile(filename, content) {
        const blob = new Blob([content], { type: 'application/xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
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
        #danmaku-dl-trigger.hidden {
            transform: scale(0);
            opacity: 0;
            pointer-events: none;
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

            videoInfo = { title: mainTitle, bvId, pages };

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
    }

    btnSplit.addEventListener('click', downloadSplit);
    btnMerge.addEventListener('click', downloadMerge);

    // ========== 收藏夹轮询逻辑 ==========

    let isPolling = false;

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
    }

    /**
     * 为单个视频获取合并弹幕（轮询用）
     */
    async function fetchMergedDanmakuForVideo(bvId) {
        const viewData = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvId}`);
        if (viewData.code !== 0) throw new Error(viewData.message);

        const title = sanitizeFilename(viewData.data.title);
        const pages = viewData.data.pages;

        // 并行下载所有分P弹幕
        const tasks = pages.map(page => {
            const url = `https://comment.bilibili.com/${page.cid}.xml`;
            return fetchXmlContent(url).then(content => ({ cid: page.cid, content })).catch(() => null);
        });

        const results = await Promise.all(tasks);

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
        return { fileName, mergedXml, title: viewData.data.title, danmakuCount: allDanmaku.length, pages: pages.length };
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
        isPolling = true;
        updatePollStatusUI();

        let totalSuccess = 0, totalFail = 0;

        try {
            addLog({ type: 'info', message: `开始轮询收藏夹 (ID: ${favId})` });

            const videos = await fetchFavoriteList(favId);
            addLog({ type: 'info', message: `获取到 ${videos.length} 个视频` });

            for (let i = 0; i < videos.length; i++) {
                const video = videos[i];
                pollStatusEl.textContent = `⏳ 下载中 (${i + 1}/${videos.length}): ${video.title}`;

                try {
                    const result = await fetchMergedDanmakuForVideo(video.bvid);
                    downloadFile(result.fileName, result.mergedXml);

                    addLog({
                        type: 'success',
                        bvid: video.bvid,
                        title: video.title,
                        message: `下载成功 · ${result.pages}P · ${result.danmakuCount} 条弹幕`,
                    });
                    totalSuccess++;
                } catch (err) {
                    addLog({
                        type: 'error',
                        bvid: video.bvid,
                        title: video.title,
                        message: `下载失败: ${err.message}`,
                    });
                    totalFail++;
                }

                // 间隔避免频率限制
                await sleep(1000);
            }

            GM_setValue(STORAGE_KEYS.LAST_POLL_TIME, Date.now());

            const summary = `轮询完成: ${totalSuccess} 成功, ${totalFail} 失败`;
            addLog({ type: totalFail > 0 ? 'error' : 'success', message: summary });

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
        pollFavorites();
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

    // ========== 定时调度 ==========

    let pollTimer = null;

    function schedulePoll() {
        if (pollTimer) clearInterval(pollTimer);

        const enabled = GM_getValue(STORAGE_KEYS.POLL_ENABLED, false);
        if (!enabled) return;

        const lastPoll = GM_getValue(STORAGE_KEYS.LAST_POLL_TIME, 0);
        const elapsed = Date.now() - lastPoll;

        // 如果距上次轮询已超过间隔，立即执行一次
        if (elapsed >= POLL_INTERVAL_MS) {
            setTimeout(() => pollFavorites(), 3000); // 延迟 3 秒等页面稳定
        }

        // 设置定时器
        pollTimer = setInterval(() => {
            const nowEnabled = GM_getValue(STORAGE_KEYS.POLL_ENABLED, false);
            if (!nowEnabled) {
                clearInterval(pollTimer);
                pollTimer = null;
                return;
            }

            const last = GM_getValue(STORAGE_KEYS.LAST_POLL_TIME, 0);
            // 检查是否已被其他标签页执行过
            if (Date.now() - last >= POLL_INTERVAL_MS) {
                pollFavorites();
            }
        }, 5 * 60 * 1000); // 每 5 分钟检查一次是否该轮询
    }

    // ========== 初始化 ==========

    // 如果在视频页，加载视频信息
    if (isVideoPage()) {
        loadVideoInfo();
    }

    // 更新轮询状态
    updatePollStatusUI();

    // 启动定时调度
    schedulePoll();

    // 监听 URL 变化（B站 SPA）
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            videoInfo = null;
            setVideoButtonsDisabled(true);
            resetProgress();
            setStatus('');
            videoTitleEl.textContent = '加载中...';
            bvTagEl.textContent = '-';
            partsTagEl.textContent = '-';

            if (isVideoPage()) {
                videoSection.style.display = 'block';
                loadVideoInfo();
            } else {
                videoSection.style.display = 'none';
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
