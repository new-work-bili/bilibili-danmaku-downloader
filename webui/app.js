const FILTER_ALL = '__all__';
const BLACKLIST_EXPANDED_STORAGE_KEY = 'ddl_webui_blacklist_expanded';
const DEFAULT_COVER = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1f2430" />
      <stop offset="100%" stop-color="#11151d" />
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)" />
  <circle cx="128" cy="86" r="120" fill="rgba(251,114,153,0.22)" />
  <circle cx="550" cy="280" r="140" fill="rgba(0,161,216,0.15)" />
  <text x="44" y="196" fill="#f4f7fb" font-size="34" font-family="Segoe UI, sans-serif">Bilibili 本地视频库</text>
  <text x="44" y="238" fill="#96a0ae" font-size="18" font-family="Segoe UI, sans-serif">暂无封面，仍可查看文件与播放本地视频</text>
</svg>
`)}`;

const appState = {
    cards: [],
    blacklistEntries: [],
    blacklistThreshold: 5,
    blacklistExpanded: false,
    sortBy: 'updateTime',
    uploaderFilter: FILTER_ALL,
};

document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('refresh-btn');
    const blacklistToggle = document.getElementById('blacklist-toggle');
    const sortSelect = document.getElementById('sort-select');
    const uploaderSelect = document.getElementById('uploader-select');

    try {
        appState.blacklistExpanded = localStorage.getItem(BLACKLIST_EXPANDED_STORAGE_KEY) === 'true';
    } catch (_) {
        appState.blacklistExpanded = false;
    }

    sortSelect.addEventListener('change', (event) => {
        appState.sortBy = event.target.value || 'updateTime';
        renderCurrentView();
    });

    uploaderSelect.addEventListener('change', (event) => {
        appState.uploaderFilter = event.target.value || FILTER_ALL;
        renderCurrentView();
    });

    blacklistToggle.addEventListener('click', toggleBlacklistPanel);
    refreshBtn.addEventListener('click', loadVideos);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closePlayer();
            closeDetails();
        }
    });

    loadVideos();
});

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeTimestamp(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric < 1e12 ? numeric * 1000 : numeric;
}

function formatDate(timestamp) {
    const normalized = normalizeTimestamp(timestamp);
    if (!normalized) return '未知时间';
    const d = new Date(normalized);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getUploaderName(card) {
    return String(card?.uploader || 'UP主未知').trim() || 'UP主未知';
}

function getSortTimestamp(card, sortBy) {
    if (sortBy === 'favoriteTime') return normalizeTimestamp(card.favoriteTime);
    if (sortBy === 'publishTime') return normalizeTimestamp(card.publishTime);
    return normalizeTimestamp(card.updateTime);
}

function compareCards(left, right) {
    const leftPrimary = getSortTimestamp(left, appState.sortBy) || 0;
    const rightPrimary = getSortTimestamp(right, appState.sortBy) || 0;
    if (rightPrimary !== leftPrimary) {
        return rightPrimary - leftPrimary;
    }

    const leftFallback = normalizeTimestamp(left.updateTime) || 0;
    const rightFallback = normalizeTimestamp(right.updateTime) || 0;
    if (rightFallback !== leftFallback) {
        return rightFallback - leftFallback;
    }

    return getUploaderName(left).localeCompare(getUploaderName(right), 'zh-CN');
}

function getFilteredCards() {
    const uploaderFilter = appState.uploaderFilter;
    const visibleCards = uploaderFilter === FILTER_ALL
        ? appState.cards
        : appState.cards.filter(card => getUploaderName(card) === uploaderFilter);

    return [...visibleCards].sort(compareCards);
}

function updateToolbarOptions(cards) {
    const toolbar = document.getElementById('toolbar');
    const uploaderSelect = document.getElementById('uploader-select');
    const uniqueUploaders = [...new Set(cards.map(getUploaderName))].sort((a, b) => a.localeCompare(b, 'zh-CN'));

    uploaderSelect.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = FILTER_ALL;
    allOption.textContent = '全部UP主';
    uploaderSelect.appendChild(allOption);

    uniqueUploaders.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        uploaderSelect.appendChild(option);
    });

    if (!uniqueUploaders.includes(appState.uploaderFilter)) {
        appState.uploaderFilter = FILTER_ALL;
    }
    uploaderSelect.value = appState.uploaderFilter;

    toolbar.classList.toggle('hidden', cards.length === 0);
}

function updateCountLabel(filteredCount, totalCount) {
    const totalCountEl = document.getElementById('total-count');
    if (filteredCount === totalCount) {
        totalCountEl.textContent = `${totalCount} 个视频`;
        return;
    }
    totalCountEl.textContent = `${filteredCount} / ${totalCount} 个视频`;
}

function formatBlacklistSource(source) {
    if (source === 'favorites-api') return '收藏夹接口';
    if (source === 'view-api') return '视频详情接口';
    if (source === 'yt-dlp') return 'yt-dlp';
    return source || '未知来源';
}

function getBlacklistThreshold(entry) {
    return Number(entry?.threshold) || appState.blacklistThreshold || 5;
}

function persistBlacklistExpanded() {
    try {
        localStorage.setItem(BLACKLIST_EXPANDED_STORAGE_KEY, String(appState.blacklistExpanded));
    } catch (_) {
        // ignore persistence errors
    }
}

function setBlacklistPanelExpanded(expanded) {
    appState.blacklistExpanded = !!expanded;
    persistBlacklistExpanded();
    renderBlacklistPanel();
}

function toggleBlacklistPanel() {
    setBlacklistPanelExpanded(!appState.blacklistExpanded);
}

function renderBlacklistPanel() {
    const panel = document.getElementById('blacklist-panel');
    const content = document.getElementById('blacklist-content');
    const list = document.getElementById('blacklist-list');
    const empty = document.getElementById('blacklist-empty');
    const count = document.getElementById('blacklist-count');
    const summary = document.getElementById('blacklist-summary');
    const toggle = document.getElementById('blacklist-toggle');
    const entries = Array.isArray(appState.blacklistEntries) ? appState.blacklistEntries : [];

    if (entries.length === 0) {
        panel.classList.add('hidden');
        return;
    }

    count.textContent = `${entries.length} 个条目`;
    panel.classList.remove('hidden');
    list.innerHTML = '';
    summary.textContent = `当前有 ${entries.length} 个视频已进入自动跳过列表。默认折叠，按需展开查看详情和恢复下载。`;
    toggle.textContent = appState.blacklistExpanded ? '收起' : '展开';
    toggle.setAttribute('aria-expanded', appState.blacklistExpanded ? 'true' : 'false');
    panel.classList.toggle('is-expanded', appState.blacklistExpanded);
    content.classList.toggle('hidden', !appState.blacklistExpanded);

    empty.classList.add('hidden');
    entries.forEach(entry => {
        const item = document.createElement('article');
        item.className = 'blacklist-item';
        item.innerHTML = `
            <div class="blacklist-item-main">
                <div class="blacklist-item-header">
                    <div>
                        <div class="blacklist-item-title">${escapeHtml(entry.title || entry.bvid || '未知视频')}</div>
                        <div class="blacklist-item-bvid">${escapeHtml(entry.bvid || '未知 BV')}</div>
                    </div>
                    <span class="blacklist-hit-chip">${escapeHtml(`${Number(entry.hitCount) || 0}/${getBlacklistThreshold(entry)}`)}</span>
                </div>
                <div class="blacklist-item-grid">
                    <div class="blacklist-meta-card">
                        <span class="blacklist-meta-label">当前原因</span>
                        <span class="blacklist-meta-value">${escapeHtml(entry.reasonText || '资源不存在或不可访问')}</span>
                    </div>
                    <div class="blacklist-meta-card">
                        <span class="blacklist-meta-label">最近来源</span>
                        <span class="blacklist-meta-value">${escapeHtml(formatBlacklistSource(entry.lastSource))}</span>
                    </div>
                    <div class="blacklist-meta-card">
                        <span class="blacklist-meta-label">首次发现</span>
                        <span class="blacklist-meta-value">${escapeHtml(formatDate(entry.firstSeenAt))}</span>
                    </div>
                    <div class="blacklist-meta-card">
                        <span class="blacklist-meta-label">最近发现</span>
                        <span class="blacklist-meta-value">${escapeHtml(formatDate(entry.lastSeenAt))}</span>
                    </div>
                </div>
                <div class="blacklist-message">${escapeHtml(entry.lastMessage || '无额外错误摘要')}</div>
            </div>
            <div class="blacklist-item-actions">
                <button class="btn btn-outline btn-blacklist-restore">恢复下载</button>
            </div>
        `;

        item.querySelector('.btn-blacklist-restore').addEventListener('click', () => restoreBlacklistEntry(entry));
        list.appendChild(item);
    });
}

function setEmptyState(message) {
    document.getElementById('empty-msg').textContent = message;
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('video-grid').classList.add('hidden');
}

function renderCurrentView() {
    const filteredCards = getFilteredCards();
    updateCountLabel(filteredCards.length, appState.cards.length);

    if (filteredCards.length === 0) {
        setEmptyState(appState.cards.length === 0 ? '暂无下载的视频或弹幕' : '当前筛选条件下没有匹配的视频');
        return;
    }

    document.getElementById('empty-state').classList.add('hidden');
    renderGrid(filteredCards);
}

async function loadVideos() {
    const grid = document.getElementById('video-grid');
    const loader = document.getElementById('loader');
    const errorState = document.getElementById('error-state');
    const emptyState = document.getElementById('empty-state');
    const toolbar = document.getElementById('toolbar');
    const blacklistPanel = document.getElementById('blacklist-panel');

    grid.classList.add('hidden');
    errorState.classList.add('hidden');
    emptyState.classList.add('hidden');
    toolbar.classList.add('hidden');
    blacklistPanel.classList.add('hidden');
    loader.classList.remove('hidden');

    try {
        const [videoResponse, blacklistResponse] = await Promise.all([
            fetch('/api/videos'),
            fetch('/api/download-blacklist'),
        ]);
        if (!videoResponse.ok) throw new Error('视频列表加载失败');
        if (!blacklistResponse.ok) throw new Error('黑名单加载失败');

        const [videoData, blacklistData] = await Promise.all([
            videoResponse.json(),
            blacklistResponse.json(),
        ]);
        if (videoData.ok === false) throw new Error(videoData.error || '视频列表加载失败');
        if (blacklistData.ok === false) throw new Error(blacklistData.error || '黑名单加载失败');

        loader.classList.add('hidden');
        appState.cards = Array.isArray(videoData.data) ? videoData.data : [];
        appState.blacklistEntries = Array.isArray(blacklistData.data) ? blacklistData.data : [];
        appState.blacklistThreshold = Number(blacklistData.threshold) || 5;

        updateToolbarOptions(appState.cards);
        renderBlacklistPanel();

        if (appState.cards.length === 0) {
            updateCountLabel(0, 0);
            setEmptyState('暂无下载的视频或弹幕');
            return;
        }

        renderCurrentView();
    } catch (error) {
        console.error('Failed to load videos:', error);
        loader.classList.add('hidden');
        errorState.classList.remove('hidden');
        document.getElementById('error-msg').textContent = '加载失败: ' + error.message;
    }
}

async function restoreBlacklistEntry(entry) {
    const bvid = entry?.bvid;
    if (!bvid) return;

    try {
        const response = await fetch('/api/download-blacklist/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bvid }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
            throw new Error(data.error || '恢复失败');
        }
        await loadVideos();
        alert(`已恢复 ${bvid}，下次收藏夹轮询会重新尝试下载。`);
    } catch (error) {
        alert('恢复下载失败: ' + error.message);
    }
}

function getCardStatus(card) {
    const parts = Array.isArray(card.parts) ? card.parts : [];
    const completeCount = parts.filter(part => part.videoFile && part.danmakuFile).length;

    if (parts.length === 0 || completeCount === 0) {
        return {
            className: 'missing',
            title: '文件丢失',
            text: '未完成',
        };
    }

    if (completeCount < parts.length) {
        return {
            className: 'partial',
            title: '部分分P缺少视频或弹幕',
            text: `${completeCount}/${parts.length} 完整`,
        };
    }

    return {
        className: '',
        title: '完整 (所有分P的视频和弹幕已下载)',
        text: `${parts.length}P 完整`,
    };
}

function getPartStatus(part) {
    if (part.videoFile && part.danmakuFile) {
        return { className: '', text: '视频+弹幕', title: '该分P已完整下载' };
    }
    if (!part.videoFile && !part.danmakuFile) {
        return { className: 'missing', text: '缺失', title: '视频和弹幕均缺失' };
    }
    return {
        className: 'partial',
        text: part.videoFile ? '仅视频' : '仅弹幕',
        title: part.videoFile ? '仅视频已下载' : '仅弹幕已下载',
    };
}

function buildUploaderMarkup(cardData) {
    const uploaderName = escapeHtml(getUploaderName(cardData));
    if (cardData.uploaderUrl) {
        return `
            <a class="card-up-link" href="${escapeHtml(cardData.uploaderUrl)}" target="_blank" rel="noreferrer noopener" title="打开 UP 主空间">
                ${uploaderName}
            </a>
        `;
    }
    return `<span>${uploaderName}</span>`;
}

function buildCardTimeList(cardData) {
    return `
        <div class="card-time-list">
            <div class="card-time-item">
                <span class="card-time-label">收藏</span>
                <span class="card-time-value">${escapeHtml(formatDate(cardData.favoriteTime))}</span>
            </div>
            <div class="card-time-item">
                <span class="card-time-label">更新</span>
                <span class="card-time-value">${escapeHtml(formatDate(cardData.updateTime))}</span>
            </div>
            <div class="card-time-item">
                <span class="card-time-label">发布</span>
                <span class="card-time-value">${escapeHtml(formatDate(cardData.publishTime))}</span>
            </div>
        </div>
    `;
}

function buildRevealButtonClass(hasTarget, extraClass = '') {
    return `${extraClass} ${hasTarget ? '' : 'disabled'}`.trim();
}

function renderGrid(cards) {
    const grid = document.getElementById('video-grid');
    grid.innerHTML = '';

    cards.forEach(cardData => {
        const status = getCardStatus(cardData);
        const card = document.createElement('article');
        card.className = 'video-card';

        const coverUrl = cardData.cover || DEFAULT_COVER;
        const titleSafe = escapeHtml(cardData.title || '未知标题');
        const partCount = Number(cardData.partCount) || (cardData.parts || []).length || 1;
        const groupBadge = cardData.hasMultipleParts ? `多P · 共 ${partCount} P` : '单P';
        const detailLabel = cardData.hasMultipleParts ? '查看分P' : '查看详情';
        const videoHref = escapeHtml(cardData.videoUrl || '');
        const hasPrimaryVideo = Boolean(cardData.primaryVideoPath);
        const hasPrimaryDanmaku = Boolean(cardData.primaryDanmakuPath);

        card.innerHTML = `
            <div class="card-cover">
                <img src="${coverUrl}" alt="${titleSafe}" loading="lazy" />
                <div class="bvid-badge">${escapeHtml(cardData.bvid || '未知BV号')}</div>
                <div class="parts-badge">${escapeHtml(groupBadge)}</div>
                <div class="cover-overlay">
                    <button class="action-btn js-open-detail" title="${escapeHtml(detailLabel)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg>
                    </button>
                    <a class="action-btn action-link ${cardData.videoUrl ? '' : 'disabled'}" href="${videoHref}" target="_blank" rel="noreferrer noopener" title="打开 B 站视频">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v6a1 1 0 0 1-1 1h-6"/><path d="M10 21H4a1 1 0 0 1-1-1v-6"/></svg>
                    </a>
                    <button class="action-btn js-open-folder" title="打开所在目录并选中文件">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    </button>
                </div>
            </div>
            <div class="card-body">
                <div class="card-title" title="${titleSafe}">${titleSafe}</div>
                <div class="card-meta-row">
                    <span class="group-chip">${escapeHtml(groupBadge)}</span>
                    <span class="group-chip subtle">${escapeHtml(status.text)}</span>
                </div>
                <div class="card-up">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    ${buildUploaderMarkup(cardData)}
                </div>
                ${buildCardTimeList(cardData)}
                <div class="card-actions">
                    <button class="btn btn-outline btn-card-detail">${escapeHtml(detailLabel)}</button>
                    <a class="btn btn-outline btn-card-link ${cardData.videoUrl ? '' : 'disabled'}" href="${videoHref}" target="_blank" rel="noreferrer noopener">打开B站</a>
                    <button class="btn btn-outline ${buildRevealButtonClass(hasPrimaryVideo, 'btn-card-folder')}">选中视频</button>
                    <button class="btn btn-outline ${buildRevealButtonClass(hasPrimaryDanmaku, 'btn-card-danmaku')}">选中弹幕</button>
                </div>
                <div class="card-footer">
                    <span>${escapeHtml(formatDate(cardData.updateTime))}</span>
                    <div class="status-indicator" title="${escapeHtml(status.title)}">
                        <div class="status-dot ${status.className}"></div>
                    </div>
                </div>
            </div>
        `;

        card.querySelector('.js-open-detail').addEventListener('click', () => openDetails(cardData));
        card.querySelector('.btn-card-detail').addEventListener('click', () => openDetails(cardData));

        const revealCardFile = () => openFolder(cardData.folderPath, cardData.primaryVideoPath);
        const revealCardDanmaku = () => openFolder(cardData.folderPath, cardData.primaryDanmakuPath);
        card.querySelector('.js-open-folder').addEventListener('click', revealCardFile);
        card.querySelector('.btn-card-folder').addEventListener('click', revealCardFile);
        const cardDanmakuBtn = card.querySelector('.btn-card-danmaku');
        if (!cardDanmakuBtn.classList.contains('disabled')) {
            cardDanmakuBtn.addEventListener('click', revealCardDanmaku);
        }

        grid.appendChild(card);
    });

    grid.classList.remove('hidden');
}

function buildDetailPartRow(cardData, part) {
    const partStatus = getPartStatus(part);
    const row = document.createElement('div');
    row.className = 'detail-part-row';

    const playDisabled = part.videoFile ? '' : 'disabled';
    const bilibiliDisabled = part.videoUrl ? '' : 'disabled';
    const danmakuDisabled = part.danmakuPath ? '' : 'disabled';
    const videoRevealDisabled = part.videoPath ? '' : 'disabled';
    row.innerHTML = `
        <div class="detail-part-main">
            <div class="detail-part-title-row">
                <span class="part-index">P${escapeHtml(part.page)}</span>
                <span class="part-title" title="${escapeHtml(part.partTitle || '')}">${escapeHtml(part.partTitle || `P${part.page}`)}</span>
            </div>
            <div class="part-meta">
                <span class="part-status ${partStatus.className}" title="${escapeHtml(partStatus.title)}">${escapeHtml(partStatus.text)}</span>
                <span class="part-time">${escapeHtml(formatDate(part.updateTime))}</span>
            </div>
        </div>
        <div class="part-actions">
            <button class="btn btn-outline btn-part-play" ${playDisabled}>播放</button>
            <a class="btn btn-outline btn-part-link ${bilibiliDisabled}" href="${escapeHtml(part.videoUrl || '')}" target="_blank" rel="noreferrer noopener">B站</a>
            <button class="btn btn-outline btn-part-folder ${videoRevealDisabled}">选中视频</button>
            <button class="btn btn-outline btn-part-danmaku ${danmakuDisabled}">选中弹幕</button>
        </div>
    `;

    const playBtn = row.querySelector('.btn-part-play');
    const folderBtn = row.querySelector('.btn-part-folder');
    const danmakuBtn = row.querySelector('.btn-part-danmaku');
    if (part.videoFile) {
        playBtn.addEventListener('click', () => {
            const title = `${cardData.title} - P${part.page} ${part.partTitle || ''}`.trim();
            closeDetails();
            playVideo(part.fileUrlPrefix + encodeURIComponent(part.videoFile), title);
        });
    }
    if (!folderBtn.classList.contains('disabled')) {
        folderBtn.addEventListener('click', () => openFolder(cardData.folderPath, part.videoPath));
    }
    if (!danmakuBtn.classList.contains('disabled')) {
        danmakuBtn.addEventListener('click', () => openFolder(cardData.folderPath, part.danmakuPath));
    }

    return row;
}

function createSummaryChip(label, value, href = '') {
    const chip = document.createElement(href ? 'a' : 'div');
    chip.className = 'detail-summary-chip';
    if (href) {
        chip.href = href;
        chip.target = '_blank';
        chip.rel = 'noreferrer noopener';
    }
    chip.innerHTML = `
        <span class="detail-summary-label">${escapeHtml(label)}</span>
        <span class="detail-summary-value">${escapeHtml(value)}</span>
    `;
    return chip;
}

function openDetails(cardData) {
    const modal = document.getElementById('detail-modal');
    const titleEl = document.getElementById('detail-title');
    const subtitleEl = document.getElementById('detail-subtitle');
    const bodyEl = document.getElementById('detail-body');
    const partCount = Number(cardData.partCount) || (cardData.parts || []).length || 1;

    titleEl.textContent = cardData.title || '分P详情';
    subtitleEl.textContent = `${cardData.bvid || '未知BV'} · ${cardData.hasMultipleParts ? `共 ${partCount} P` : '单P视频'}`;

    bodyEl.innerHTML = '';

    const summary = document.createElement('div');
    summary.className = 'detail-summary';
    summary.appendChild(createSummaryChip('UP主', getUploaderName(cardData), cardData.uploaderUrl || ''));
    summary.appendChild(createSummaryChip('收藏', formatDate(cardData.favoriteTime)));
    summary.appendChild(createSummaryChip('更新', formatDate(cardData.updateTime)));
    summary.appendChild(createSummaryChip('发布', formatDate(cardData.publishTime)));
    summary.appendChild(createSummaryChip('类型', cardData.hasMultipleParts ? '多P视频' : '单P视频'));
    bodyEl.appendChild(summary);

    const hasPrimaryVideo = Boolean(cardData.primaryVideoPath);
    const hasPrimaryDanmaku = Boolean(cardData.primaryDanmakuPath);
    const actionBar = document.createElement('div');
    actionBar.className = 'detail-action-bar';
    actionBar.innerHTML = `
        <a class="btn btn-outline ${cardData.videoUrl ? '' : 'disabled'}" href="${escapeHtml(cardData.videoUrl || '')}" target="_blank" rel="noreferrer noopener">打开B站</a>
        <button class="btn btn-outline ${buildRevealButtonClass(hasPrimaryVideo, 'btn-detail-folder')}">选中主视频</button>
        <button class="btn btn-outline ${buildRevealButtonClass(hasPrimaryDanmaku, 'btn-detail-danmaku')}">选中主弹幕</button>
    `;
    const detailFolderBtn = actionBar.querySelector('.btn-detail-folder');
    const detailDanmakuBtn = actionBar.querySelector('.btn-detail-danmaku');
    if (!detailFolderBtn.classList.contains('disabled')) {
        detailFolderBtn.addEventListener('click', () => openFolder(cardData.folderPath, cardData.primaryVideoPath));
    }
    if (!detailDanmakuBtn.classList.contains('disabled')) {
        detailDanmakuBtn.addEventListener('click', () => openFolder(cardData.folderPath, cardData.primaryDanmakuPath));
    }
    bodyEl.appendChild(actionBar);

    const list = document.createElement('div');
    list.className = 'detail-parts-list';
    (cardData.parts || []).forEach(part => {
        list.appendChild(buildDetailPartRow(cardData, part));
    });
    bodyEl.appendChild(list);

    modal.classList.remove('hidden');
}

function closeDetails() {
    document.getElementById('detail-modal').classList.add('hidden');
}

async function openFolder(folderPath, filePath = '') {
    if (!folderPath) return;
    try {
        const response = await fetch('/api/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: folderPath, file: filePath || '' }),
        });
        const data = await response.json();
        if (!data.ok) {
            alert('打开文件夹失败: ' + data.error);
        }
    } catch (err) {
        alert('请求失败');
    }
}

function playVideo(url, title) {
    const modal = document.getElementById('player-modal');
    const playerTitle = document.getElementById('player-title');
    const player = document.getElementById('html-player');

    playerTitle.textContent = title;
    player.src = url;
    modal.classList.remove('hidden');
    player.play().catch(error => console.error('Auto-play prevented', error));
}

function closePlayer() {
    const modal = document.getElementById('player-modal');
    const player = document.getElementById('html-player');

    player.pause();
    player.removeAttribute('src');
    player.load();
    modal.classList.add('hidden');
}
