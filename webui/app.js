document.addEventListener('DOMContentLoaded', () => {
    loadVideos();
    document.getElementById('refresh-btn').addEventListener('click', loadVideos);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closePlayer();
            closeDetails();
        }
    });
});

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function loadVideos() {
    const grid = document.getElementById('video-grid');
    const loader = document.getElementById('loader');
    const errorState = document.getElementById('error-state');
    const emptyState = document.getElementById('empty-state');
    const totalCount = document.getElementById('total-count');

    grid.classList.add('hidden');
    errorState.classList.add('hidden');
    emptyState.classList.add('hidden');
    loader.classList.remove('hidden');

    try {
        const response = await fetch('/api/videos');
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();

        loader.classList.add('hidden');

        if (!data.data || data.data.length === 0) {
            emptyState.classList.remove('hidden');
            totalCount.textContent = '0 个视频';
            return;
        }

        totalCount.textContent = `${data.data.length} 个视频`;
        renderGrid(data.data);
    } catch (error) {
        console.error('Failed to load videos:', error);
        loader.classList.add('hidden');
        errorState.classList.remove('hidden');
        document.getElementById('error-msg').textContent = '加载失败: ' + error.message;
    }
}

function formatDate(timestamp) {
    if (!timestamp) return '未知时间';
    const d = new Date(timestamp);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function renderGrid(cards) {
    const grid = document.getElementById('video-grid');
    grid.innerHTML = '';

    cards.forEach(cardData => {
        const status = getCardStatus(cardData);
        const card = document.createElement('article');
        card.className = 'video-card';

        const coverUrl = cardData.cover || 'fallback.png';
        const titleSafe = escapeHtml(cardData.title || '未知标题');
        const uploaderSafe = escapeHtml(cardData.uploader || 'UP主未知');
        const updateTime = formatDate(cardData.updateTime);
        const partCount = Number(cardData.partCount) || (cardData.parts || []).length || 1;
        const groupBadge = cardData.hasMultipleParts ? `多P · 共 ${partCount} P` : '单P';
        const detailLabel = cardData.hasMultipleParts ? '查看分P' : '查看详情';

        card.innerHTML = `
            <div class="card-cover">
                <img src="${coverUrl}" alt="${titleSafe}" loading="lazy" />
                <div class="bvid-badge">${escapeHtml(cardData.bvid || '未知BV号')}</div>
                <div class="parts-badge">${escapeHtml(groupBadge)}</div>
                <div class="cover-overlay">
                    <button class="action-btn js-open-detail" title="${escapeHtml(detailLabel)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg>
                    </button>
                    <button class="action-btn" title="打开本机文件夹">
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
                    ${uploaderSafe}
                </div>
                <div class="card-actions">
                    <button class="btn btn-outline btn-card-detail">${escapeHtml(detailLabel)}</button>
                    <button class="btn btn-outline btn-card-folder">打开文件夹</button>
                </div>
                <div class="card-footer">
                    <span>${escapeHtml(updateTime)}</span>
                    <div class="status-indicator" title="${escapeHtml(status.title)}">
                        <div class="status-dot ${status.className}"></div>
                    </div>
                </div>
            </div>
        `;

        const overlayDetailBtn = card.querySelector('.js-open-detail');
        const overlayFolderBtn = card.querySelector('.cover-overlay .action-btn:last-child');
        const bodyDetailBtn = card.querySelector('.btn-card-detail');
        const bodyFolderBtn = card.querySelector('.btn-card-folder');

        overlayDetailBtn.addEventListener('click', () => openDetails(cardData));
        bodyDetailBtn.addEventListener('click', () => openDetails(cardData));
        overlayFolderBtn.addEventListener('click', () => openFolder(cardData.folderPath));
        bodyFolderBtn.addEventListener('click', () => openFolder(cardData.folderPath));

        grid.appendChild(card);
    });

    grid.classList.remove('hidden');
}

function buildDetailPartRow(cardData, part) {
    const partStatus = getPartStatus(part);
    const row = document.createElement('div');
    row.className = 'detail-part-row';

    const playDisabled = part.videoFile ? '' : 'disabled';
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
            <button class="btn btn-outline btn-part-folder">文件夹</button>
        </div>
    `;

    const playBtn = row.querySelector('.btn-part-play');
    const folderBtn = row.querySelector('.btn-part-folder');
    if (part.videoFile) {
        playBtn.addEventListener('click', () => {
            const title = `${cardData.title} - P${part.page} ${part.partTitle || ''}`.trim();
            closeDetails();
            playVideo(part.fileUrlPrefix + encodeURIComponent(part.videoFile), title);
        });
    }
    folderBtn.addEventListener('click', () => openFolder(cardData.folderPath));

    return row;
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
    summary.innerHTML = `
        <div class="detail-summary-chip">${escapeHtml(cardData.uploader || 'UP主未知')}</div>
        <div class="detail-summary-chip">${escapeHtml(formatDate(cardData.updateTime))}</div>
        <div class="detail-summary-chip">${escapeHtml(cardData.hasMultipleParts ? '多P视频' : '单P视频')}</div>
    `;
    bodyEl.appendChild(summary);

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

async function openFolder(folderPath) {
    if (!folderPath) return;
    try {
        const response = await fetch('/api/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: folderPath })
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
