// ==UserScript==
// @name         Bilibili 弹幕下载器
// @namespace    https://github.com/bilibili-danmaku-downloader
// @version      3.0
// @description  在 B 站视频页面一键下载弹幕 XML 文件，支持多 P 逐集下载和合并下载
// @author       bilibili-danmaku-downloader
// @match        *://www.bilibili.com/video/BV*
// @match        *://www.bilibili.com/video/av*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      api.bilibili.com
// @connect      comment.bilibili.com
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ========== 工具函数 ==========

    /**
     * 从当前页面 URL 中提取 BV 号
     */
    function extractBvId() {
        const match = window.location.pathname.match(/\/video\/(BV[\w]+)/i);
        return match ? match[1] : null;
    }

    /**
     * 替换文件名中的非法字符
     */
    function sanitizeFilename(name) {
        return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    }

    /**
     * 使用 GM_xmlhttpRequest 发起跨域 JSON 请求
     */
    function fetchJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers: {
                    'Referer': 'https://www.bilibili.com/',
                },
                responseType: 'json',
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        resolve(res.response);
                    } else {
                        reject(new Error(`HTTP ${res.status}`));
                    }
                },
                onerror: (err) => reject(new Error('网络请求失败')),
            });
        });
    }

    /**
     * 使用 GM_xmlhttpRequest 获取 XML 文本
     */
    function fetchXmlContent(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers: {
                    'Referer': 'https://www.bilibili.com/',
                },
                responseType: 'text',
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        resolve(res.responseText);
                    } else {
                        reject(new Error(`HTTP ${res.status}`));
                    }
                },
                onerror: (err) => reject(new Error('网络请求失败')),
            });
        });
    }

    /**
     * 触发浏览器下载文件
     */
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

    // ========== UI 样式 ==========

    GM_addStyle(`
        /* ---------- 悬浮面板 ---------- */
        #danmaku-dl-panel {
            position: fixed;
            right: 20px;
            bottom: 80px;
            z-index: 100000;
            width: 320px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
            transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease;
        }
        #danmaku-dl-panel.collapsed {
            transform: translateX(calc(100% + 20px));
            opacity: 0;
            pointer-events: none;
        }

        /* 面板容器 */
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

        /* 头部 */
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
        .ddl-header-title svg {
            flex-shrink: 0;
        }
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
        .ddl-close-btn:hover {
            background: rgba(255, 255, 255, 0.35);
        }

        /* 内容区域 */
        .ddl-body {
            padding: 16px 18px;
        }

        /* 视频信息 */
        .ddl-info {
            margin-bottom: 14px;
        }
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
        .ddl-info-meta {
            display: flex;
            gap: 12px;
            margin-top: 6px;
        }
        .ddl-tag {
            font-size: 11px;
            color: rgba(251, 114, 153, 0.9);
            background: rgba(251, 114, 153, 0.12);
            padding: 2px 8px;
            border-radius: 10px;
            font-weight: 500;
        }

        /* 按钮组 */
        .ddl-actions {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
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
        .ddl-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
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

        /* 进度区域 */
        .ddl-progress {
            margin-top: 14px;
            display: none;
        }
        .ddl-progress.active {
            display: block;
        }
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

        /* 状态消息 */
        .ddl-status {
            margin-top: 12px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.5);
            text-align: center;
            min-height: 18px;
            transition: color 0.2s;
        }
        .ddl-status.success {
            color: #52c41a;
        }
        .ddl-status.error {
            color: #ff4d4f;
        }

        /* ---------- 触发按钮（面板收起时显示） ---------- */
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
            0%, 100% { box-shadow: 0 4px 20px rgba(251, 114, 153, 0.4), 0 0 0 0 rgba(251, 114, 153, 0.3); }
            50% { box-shadow: 0 4px 20px rgba(251, 114, 153, 0.4), 0 0 0 8px rgba(251, 114, 153, 0); }
        }

        /* ---------- loading spinner ---------- */
        .ddl-spinner {
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-top-color: #fff;
            border-radius: 50%;
            animation: ddl-spin 0.6s linear infinite;
        }
        @keyframes ddl-spin {
            to { transform: rotate(360deg); }
        }
    `);

    // ========== UI 构建 ==========

    /** 弹幕 icon SVG */
    const danmakuIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/></svg>`;
    const downloadIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

    // -- 触发按钮 --
    const triggerBtn = document.createElement('button');
    triggerBtn.id = 'danmaku-dl-trigger';
    triggerBtn.innerHTML = danmakuIcon;
    triggerBtn.title = '打开弹幕下载器';

    // -- 面板 --
    const panel = document.createElement('div');
    panel.id = 'danmaku-dl-panel';
    panel.classList.add('collapsed');
    panel.innerHTML = `
        <div class="ddl-container">
            <div class="ddl-header">
                <span class="ddl-header-title">${danmakuIcon} 弹幕下载器</span>
                <button class="ddl-close-btn" title="收起面板">✕</button>
            </div>
            <div class="ddl-body">
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
            </div>
        </div>
    `;

    document.body.appendChild(triggerBtn);
    document.body.appendChild(panel);

    // ========== UI 交互逻辑 ==========

    const closeBtn = panel.querySelector('.ddl-close-btn');
    const btnSplit = panel.querySelector('#ddl-btn-split');
    const btnMerge = panel.querySelector('#ddl-btn-merge');
    const progressEl = panel.querySelector('#ddl-progress');
    const progressFill = panel.querySelector('#ddl-progress-fill');
    const progressText = panel.querySelector('#ddl-progress-text');
    const statusEl = panel.querySelector('#ddl-status');
    const videoTitleEl = panel.querySelector('#ddl-video-title');
    const bvTagEl = panel.querySelector('#ddl-bv-tag');
    const partsTagEl = panel.querySelector('#ddl-parts-tag');

    let panelOpen = false;

    function togglePanel(open) {
        panelOpen = open;
        panel.classList.toggle('collapsed', !open);
        triggerBtn.classList.toggle('hidden', open);
    }

    triggerBtn.addEventListener('click', () => togglePanel(true));
    closeBtn.addEventListener('click', () => togglePanel(false));

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

    function setButtonsDisabled(disabled) {
        btnSplit.disabled = disabled;
        btnMerge.disabled = disabled;
    }

    // ========== 核心下载逻辑（复用 v2） ==========

    let videoInfo = null; // { title, bvId, pages }

    /**
     * 加载视频信息
     */
    async function loadVideoInfo() {
        const bvId = extractBvId();
        if (!bvId) {
            setStatus('未找到 BV 号', 'error');
            return;
        }
        bvTagEl.textContent = bvId;

        try {
            const data = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvId}`);
            if (data.code !== 0) throw new Error(data.message);

            const mainTitle = sanitizeFilename(data.data.title);
            const pages = data.data.pages;

            videoInfo = { title: mainTitle, bvId, pages };

            videoTitleEl.textContent = data.data.title;
            partsTagEl.textContent = `${pages.length} P`;
            setButtonsDisabled(false);
            setStatus('就绪，点击按钮开始下载');
        } catch (err) {
            videoTitleEl.textContent = '加载失败';
            setStatus('获取视频信息失败: ' + err.message, 'error');
        }
    }

    /**
     * 逐 P 下载弹幕
     */
    async function downloadSplit() {
        if (!videoInfo) return;
        const { title, bvId, pages } = videoInfo;

        setButtonsDisabled(true);
        setStatus('');
        setProgress(0, `0 / ${pages.length}`);

        let succCount = 0;
        let failCount = 0;

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

            const pct = ((i + 1) / pages.length) * 100;
            setProgress(pct, `${i + 1} / ${pages.length}`);

            // 给浏览器一点时间消化下载
            if (pages.length > 1) await sleep(300);
        }

        resetProgress();
        setButtonsDisabled(false);

        if (failCount === 0) {
            setStatus(`✅ 全部完成！共下载 ${succCount} 个文件`, 'success');
        } else {
            setStatus(`完成：${succCount} 成功, ${failCount} 失败`, failCount > 0 ? 'error' : 'success');
        }
    }

    /**
     * 合并下载弹幕
     */
    async function downloadMerge() {
        if (!videoInfo) return;
        const { title, bvId, pages } = videoInfo;

        setButtonsDisabled(true);
        setStatus('');
        setProgress(0, `正在下载并合并 ${pages.length} P ...`);

        // 并行下载所有弹幕
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
        setButtonsDisabled(false);
        setStatus(`✅ 合并完成！共 ${allDanmaku.length} 条弹幕`, 'success');
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ========== 事件绑定 ==========

    btnSplit.addEventListener('click', downloadSplit);
    btnMerge.addEventListener('click', downloadMerge);

    // ========== 初始化 ==========

    // 页面加载后自动获取视频信息
    loadVideoInfo();

    // 监听 URL 变化（B站是 SPA，翻页不会刷新页面）
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            // 重置状态
            videoInfo = null;
            setButtonsDisabled(true);
            resetProgress();
            setStatus('');
            videoTitleEl.textContent = '加载中...';
            bvTagEl.textContent = '-';
            partsTagEl.textContent = '-';
            // 重新加载
            loadVideoInfo();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
