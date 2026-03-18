document.addEventListener('DOMContentLoaded', () => {
    loadVideos();
    
    document.getElementById('refresh-btn').addEventListener('click', loadVideos);
});

async function loadVideos() {
    const grid = document.getElementById('video-grid');
    const loader = document.getElementById('loader');
    const errorState = document.getElementById('error-state');
    const emptyState = document.getElementById('empty-state');
    const totalCount = document.getElementById('total-count');

    // Reset UI
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

        totalCount.textContent = `${data.data.length} 个文件`;
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

function formatDuration(seconds) {
    // optional logic if we had duration
    return '';
}

function renderGrid(videos) {
    const grid = document.getElementById('video-grid');
    grid.innerHTML = '';
    
    videos.forEach(v => {
        // Status determination
        let statusClass = 'status-dot';
        let statusTitle = '完整 (视频和弹幕已下载)';
        
        if (!v.videoFile && !v.danmakuFile) {
            statusClass += ' missing';
            statusTitle = '文件丢失';
        } else if (!v.videoFile || !v.danmakuFile) {
            statusClass += ' partial';
            statusTitle = v.videoFile ? '仅含视频' : '仅含弹幕';
        }

        const card = document.createElement('div');
        card.className = 'video-card';
        
        // Escape strings for HTML inclusion
        const titleSafe = v.title ? v.title.replace(/"/g, '&quot;') : '未知标题';
        const coverUrl = v.cover || 'fallback.png';
        const upName = v.uploader || 'UP主未知';
        const downloadTime = formatDate(v.updateTime || v.createdAt);
        const folderSafe = v.folderPath ? v.folderPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"') : '';
        const videoUrlTemp = (v.fileUrlPrefix && v.videoFile) ? v.fileUrlPrefix + encodeURIComponent(v.videoFile) : null;

        card.innerHTML = `
            <div class="card-cover">
                <img src="${coverUrl}" alt="${titleSafe}" loading="lazy" />
                <div class="bvid-badge">${v.bvid || '未知BV号'}</div>
                <div class="cover-overlay">
                    ${videoUrlTemp ? `<button class="action-btn" title="播放" onclick="playVideo('${videoUrlTemp}', '${titleSafe}')">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </button>` : ''}
                    <button class="action-btn" title="打开本机文件夹" onclick="openFolder('${folderSafe}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    </button>
                </div>
            </div>
            <div class="card-body">
                <div class="card-title" title="${titleSafe}">${titleSafe}</div>
                <div class="card-up">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    ${upName}
                </div>
                <div class="card-footer">
                    <span>${downloadTime}</span>
                    <div class="status-indicator" title="${statusTitle}">
                        <div class="${statusClass}"></div>
                    </div>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    grid.classList.remove('hidden');
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
    player.play().catch(e => console.error("Auto-play prevented", e));
}

function closePlayer() {
    const modal = document.getElementById('player-modal');
    const player = document.getElementById('html-player');
    
    player.pause();
    player.removeAttribute('src');
    player.load();
    modal.classList.add('hidden');
}
