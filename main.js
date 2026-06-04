let isOffline = false;
let socket = {
    on: () => {},
    emit: (event) => {
        if (isOffline) {
            showToast('<i class="ph ph-warning-circle"></i> Ошибка: Нет подключения к серверу. Убедитесь, что сервер Node.js запущен (node server.js).');
            if (event === 'start_search') {
               // Remove skeletons if search fails immediately
               document.querySelectorAll('.skeleton').forEach(el => el.remove());
               showEmptyState(0);
            }
        }
    }
};
try {
    if (typeof io !== 'undefined') {
        socket = io();
    } else {
        isOffline = true;
    }
} catch (e) {
    isOffline = true;
    console.warn("Socket.io not available, running in offline mode.");
}
let selected = new Map();
let allCardsData = [];
let currentModalUrl = '';

let currentStart = 1;
let currentLimit = 50;
let lastPlaylistIndex = 0;

let currentSearchMode = 'search';
let cmTargetCard = null;

let downloadedFiles = [];
let searchReceivedCount = 0;

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeBtnText(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeBtnText(newTheme);
}

function updateThemeBtnText(theme) {
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.innerHTML = theme === 'dark' ? '<i class="ph ph-sun"></i> Светлая тема' : '<i class="ph ph-moon"></i> Темная тема';
}

window.addEventListener('DOMContentLoaded', () => {
    switchAppTab('main');
    initTheme();
    showEmptyState();
});

function switchAppTab(tab) {
    document.getElementById('appMain').style.display = tab === 'main' ? 'block' : 'none';
    document.getElementById('appAdmin').style.display = tab === 'admin' ? 'block' : 'none';
    document.querySelectorAll('.app-tab').forEach(btn => btn.classList.remove('active'));
    document.getElementById('tabBtn-' + tab).classList.add('active');
}

socket.on('queue_update', (data) => {
    const { tasks, isQueuePaused } = data;

    if (tasks.length > 0) {
        document.getElementById('queuePanel').style.display = 'flex';
    } else {
        document.getElementById('queuePanel').style.display = 'none';
    }

    const qList = document.getElementById('queueList');
    const existingIds = new Set();

    let p = 0, s = 0, e = 0;
    let hasDups = false;

    tasks.forEach(t => {
        existingIds.add(t.taskId);

        if (t.status === 'success') s++;
        else if (t.status === 'error') e++;
        else p++;

        if (t.status === 'duplicate') hasDups = true;

        let qItem = document.getElementById(`task-${t.taskId}`);
        if (!qItem) {
            qItem = document.createElement('div');
            qItem.className = 'q-item';
            qItem.id = `task-${t.taskId}`;
            qItem.innerHTML = `
                <div class="q-top-row">
                    <div class="q-title" title="${t.data.title.replace(/"/g, '&quot;')}">${t.data.title}</div>
                    <div class="q-controls" id="ctrl-${t.taskId}"></div>
                </div>
                <div class="q-bar-bg"><div class="q-bar-fill" id="fill-${t.taskId}"></div></div>
            `;
            // ИСПРАВЛЕНО: новые скачивания падают наверх списка статус-бара
            qList.prepend(qItem);
        }

        renderTaskUI(t, qItem);
    });
    Array.from(qList.children).forEach(child => {
        const id = child.id.replace('task-', '');
        if (!existingIds.has(id)) child.remove();
    });
    document.getElementById('qStats').innerHTML = `<i class="ph ph-hourglass"></i> ${p} | <i class="ph ph-check"></i> ${s} | <i class="ph ph-x"></i> ${e}`;

    const dupBtn = document.getElementById('btnConfirmAll');
    if (dupBtn) dupBtn.style.display = hasDups ? 'inline-block' : 'none';

    const pauseBtn = document.getElementById('btnPauseAll');
    const startBtn = document.getElementById('btnStartAll');
    if (pauseBtn && startBtn) {
        pauseBtn.style.display = isQueuePaused ? 'none' : 'inline-block';
        startBtn.style.display = isQueuePaused ? 'inline-block' : 'none';
    }
});

socket.on('task_completed', (task) => {
    if (task.status === 'success') {
        const cb = document.querySelector(`.checkbox[data-url="${task.url}"]`);
        if (cb) {
            const card = cb.closest('.card');
            if (card) card.classList.add('downloaded');
        }
        applyLocalFilters();

        if (!task.asZip) {
            const link = document.createElement('a');
            link.href = `/get-file?f=${task.fileName}&t=${encodeURIComponent(task.data.title.substring(0,40))}`;
            link.click();
        } else {
            downloadedFiles.push({ fileName: task.fileName, title: task.data.title });
            if (task.isLastInBatch) requestZipDownload();
        }
    } else if (task.status === 'error') {
        showToast(`<i class="ph ph-x-circle"></i> Ошибка скачивания: ${task.data.title}`);
        if (task.asZip && task.isLastInBatch && downloadedFiles.length > 0) requestZipDownload();
    }
});

function renderTaskUI(task, qItem) {
    const ctrl = document.getElementById(`ctrl-${task.taskId}`);
    const fill = document.getElementById(`fill-${task.taskId}`);
    qItem.classList.remove('success', 'error', 'paused', 'duplicate', 'retry');
    if (task.status === 'success') {
        fill.style.width = '100%';
        fill.style.background = '';
        let badgeHtml = '';
        if (task.isHighQuality) {
            badgeHtml = '<span class="hq-badge">Качество: HIGH</span>';
        } else {
            badgeHtml = `<span class="sd-badge">Качество: SD</span> <button class="btn-sm btn-retry-hq" onclick="retryHqTask('${task.taskId}')" title="Скачать в максимальном качестве"><i class="ph ph-arrows-clockwise"></i> Попробовать в MAX</button>`;
        }

        ctrl.innerHTML = `${badgeHtml} <span style="color:var(--success); font-weight:bold; margin-left:5px;"><i class="ph ph-check"></i></span>`;
        qItem.classList.add('success');
    } else if (task.status === 'error') {
        fill.style.width = '100%';
        fill.style.background = '';
        ctrl.innerHTML = `<button class="q-retry-btn" onclick="retryTask('${task.taskId}')" title="Повторить загрузку"><i class="ph ph-arrows-clockwise"></i></button>`;
        qItem.classList.add('error');
    } else if (task.status === 'duplicate') {
        fill.style.width = '100%';
        fill.style.background = '';
        ctrl.innerHTML = `<button class="btn-sm" style="background:#fef08a; border-color:#fde047; padding:2px 6px; font-size:11px;" onclick="confirmDuplicate('${task.taskId}')"><i class="ph ph-warning"></i> Подтвердить</button>`;
        qItem.classList.add('duplicate');
    } else if (task.status === 'paused') {
        fill.style.background = '';
        ctrl.innerHTML = `<button class="q-retry-btn" onclick="resumeTask('${task.taskId}')" title="Продолжить"><i class="ph ph-play"></i></button>`;
        qItem.classList.add('paused');
    } else if (task.status === 'pending') {
        fill.style.width = '0%';
        fill.style.background = 'var(--primary)';
        ctrl.innerHTML = `<button class="q-retry-btn" onclick="pauseTask('${task.taskId}')" title="Остановить/Отложить"><i class="ph ph-pause"></i></button>`;
    } else if (task.status.startsWith('retry_')) {
        const attempt = task.status.split('_')[1];
        fill.style.width = '100%';
        fill.style.background = '#f59e0b';
        ctrl.innerHTML = `<span style="font-size:11px; color:#b45309; font-weight:bold;"><i class="ph ph-arrows-clockwise"></i> Попытка ${attempt}...</span>`;
        qItem.classList.add('retry');
    } else if (task.status === 'active') {
        if (task.percent === 'merge') {
            fill.style.width = '100%';
            fill.style.background = '#f59e0b';
            ctrl.innerHTML = '<span style="font-size:10px; color:#f59e0b; font-weight:bold;">Склейка...</span>';
        } else {
            fill.style.width = (task.percent || 0) + '%';
            fill.style.background = 'var(--primary)';
            ctrl.innerHTML = `<button class="q-retry-btn" onclick="pauseTask('${task.taskId}')" title="Остановить"><i class="ph ph-pause"></i></button>`;
        }
    }
}

function addToQueue(asZip) {
    const quality = document.getElementById('quality').value;
    const cpack = document.getElementById('cbContentPack') ? document.getElementById('cbContentPack').checked : false;
    const sblock = document.getElementById('cbSponsorBlock') ? document.getElementById('cbSponsorBlock').checked : false;
    const items = Array.from(selected.entries());
    cancelSelect();

    document.getElementById('queuePanel').classList.remove('collapsed');
    document.getElementById('qToggleIcon').innerHTML = '<i class="ph ph-caret-down"></i>';

    if (asZip) downloadedFiles = [];
    const tasks = items.map(([url, data], idx) => ({
        url, data: { title: data.title }, quality, asZip, isLastInBatch: idx === items.length - 1,
        taskId: Date.now() + '_' + Math.floor(Math.random() * 10000),
        cpack, sblock
    }));
    socket.emit('add_to_queue', tasks);
}

function downloadFromModal() {
    const quality = document.getElementById('modalQuality').value;
    const url = currentModalUrl;
    const title = document.getElementById('mTitle').innerText;
    const cpack = document.getElementById('modalCbContentPack') ? document.getElementById('modalCbContentPack').checked : false;
    const sblock = document.getElementById('modalCbSponsorBlock') ? document.getElementById('modalCbSponsorBlock').checked : false;
    showToast('<i class="ph ph-hourglass"></i> Загрузка добавлена в очередь');
    document.getElementById('queuePanel').classList.remove('collapsed');
    document.getElementById('qToggleIcon').innerText = '🔽';

    const taskObj = {
        url, data: { title }, quality, asZip: false, isLastInBatch: true,
        taskId: Date.now() + '_' + Math.floor(Math.random() * 10000), cpack, sblock
    };
    socket.emit('add_to_queue', [taskObj]);
}

async function turboDownload() {
    try {
        const rawText = await navigator.clipboard.readText();
        const text = rawText.trim();
        if (!text || !text.startsWith('http')) {
            showToast('<i class="ph ph-warning-circle"></i> В буфере нет валидной ссылки');
            return;
        }
        const turboBtn = document.getElementById('turboBtn');
        const originalHtml = turboBtn.innerHTML;
        turboBtn.innerHTML = '⏳...';
        turboBtn.disabled = true;
        showToast('<i class="ph ph-hourglass"></i> Чтение метаданных...');

        fetch(`/api/full-info?url=${encodeURIComponent(text)}`)
            .then(r => r.json())
            .then(async data => {
                turboBtn.innerHTML = originalHtml;
                turboBtn.disabled = false;

                const isTikTok = text.toLowerCase().includes('tiktok.com');
                const title = data.title || 'Видео без названия';
                let desc = (data.description || '').trim();

                if (desc.includes('Описание отсутствует') || desc.includes('Загрузка полного описания')) desc = '';
                if (desc && desc.toLowerCase().includes(title.toLowerCase())) desc = '';

                let textToCopy = desc ? `${title}\n\n${desc}` : title;
                if (isTikTok) textToCopy = desc || title;

                try { await navigator.clipboard.writeText(textToCopy); }
                catch (err) {
                    const textArea = document.createElement("textarea");
                    textArea.value = textToCopy;
                    textArea.style.position = "fixed";
                    textArea.style.left = "-999999px";
                    textArea.style.top = "-999999px";
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    try { document.execCommand('copy');
                    } catch (e) {}
                    textArea.remove();
                }

                showToast('<i class="ph ph-check-circle"></i> Данные скопированы, начинаем загрузку');
                document.getElementById('queuePanel').classList.remove('collapsed');
                document.getElementById('qToggleIcon').innerText = '🔽';

                const cpackEl = document.getElementById('cbContentPack');
                const sblockEl = document.getElementById('cbSponsorBlock');
                const taskObj = {
                    url: text, data: { title }, quality: 'max', asZip: false,
                    isLastInBatch: true, taskId: Date.now() + '_' + Math.floor(Math.random() * 10000),
                    cpack: cpackEl ? cpackEl.checked : false, sblock: sblockEl ? sblockEl.checked : false
                };
                socket.emit('add_to_queue', [taskObj]);
            })
            .catch(() => {
                turboBtn.innerHTML = originalHtml;
                turboBtn.disabled = false;
                showToast('<i class="ph ph-x-circle"></i> Ошибка получения метаданных');
            });
    } catch (err) {
        showToast('<i class="ph ph-warning-circle"></i> Кликните по странице и нажмите Турбо еще раз');
    }
}

function pauseTask(id) { socket.emit('pause_task', id); }
function resumeTask(id) { socket.emit('resume_task', id); }
function confirmDuplicate(id) { socket.emit('confirm_duplicate', id); }
function retryTask(id) { socket.emit('retry_task', id); }
function retryHqTask(id) { socket.emit('retry_hq', id); }
function pauseAll() { socket.emit('pause_all'); }
function resumeAll() { socket.emit('resume_all'); }
function confirmAllDuplicates() { socket.emit('confirm_all_duplicates'); }
function clearSuccessQueue() { socket.emit('clear_success'); }
function clearAllQueue() { socket.emit('clear_all'); }

function retryAllErrors() {
    document.querySelectorAll('.q-item.error').forEach(item => {
        socket.emit('retry_task', item.id.replace('task-', ''));
    });
}

function toggleQueuePanel() {
    const panel = document.getElementById('queuePanel');
    const icon = document.getElementById('qToggleIcon');
    panel.classList.toggle('collapsed');
    icon.innerHTML = panel.classList.contains('collapsed') ? '<i class="ph ph-caret-up"></i>' : '<i class="ph ph-caret-down"></i>';
}

function requestZipDownload() {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/download-zip';
    form.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'files';
    input.value = JSON.stringify(downloadedFiles);
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
}

function switchSearchTab(mode) {
    currentSearchMode = mode;
    const queryInput = document.getElementById('query');
    const pasteBtn = document.getElementById('pasteBtn');
    const mainSearchBtn = document.getElementById('mainSearchBtn');

    document.getElementById('tabSearch').classList.remove('active');
    document.getElementById('tabLink').classList.remove('active');

    if (mode === 'search') {
        document.getElementById('tabSearch').classList.add('active');
        queryInput.placeholder = 'Введите текст или хештег для поиска...';
        pasteBtn.style.display = 'none';
        mainSearchBtn.innerText = 'Искать';
    } else {
        document.getElementById('tabLink').classList.add('active');
        queryInput.placeholder = 'Вставьте прямую ссылку на видео или канал...';
        pasteBtn.style.display = 'block';
        mainSearchBtn.innerText = 'Загрузить';
    }
}

async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        document.getElementById('query').value = text;
        startSearch();
    } catch (err) {
        showToast('<i class="ph ph-warning-circle"></i> Ошибка доступа к буферу. Вставьте ссылку вручную (Ctrl+V).');
    }
}

function showToast(msg) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function checkAutoStart(val) {
    if (val.trim().startsWith('http')) {
        switchSearchTab('link');
        startSearch();
    }
}

function handleFormatChange(el) {
    const vert = document.getElementById('fmtVert');
    const horz = document.getElementById('fmtHorz');
    if (!vert.checked && !horz.checked) {
        el.checked = true;
        return;
    }
    startSearch();
}

function renderSkeletons() {
    const grid = document.getElementById('grid');
    for(let i=0; i<4; i++) {
        grid.insertAdjacentHTML('beforeend', `
            <div class="card skeleton" style="border: 1px dashed var(--border); background: transparent; box-shadow: none;">
                <div class="thumb-wrap" style="aspect-ratio: 16/9; background: var(--hover-bg);"></div>
                <div class="card-body">
                    <div class="s-line"></div>
                    <div class="s-line short"></div>
                </div>
            </div>
        `);
    }
}

function startSearch(isAppend = false) {
    const q = document.getElementById('query').value;
    const sort = document.getElementById('lvl1Sort').value;
    const duration = document.getElementById('lvl1Duration').value;
    const ignoreBl = document.getElementById('ignoreBl').checked;
    currentLimit = parseInt(document.getElementById('lvl1Limit').value) || 50;

    const vert = document.getElementById('fmtVert').checked;
    const horz = document.getElementById('fmtHorz').checked;
    let vFormat = 'all';
    if (vert && !horz) vFormat = 'vert';
    if (!vert && horz) vFormat = 'horz';
    if (!q) return;

    document.getElementById('loadMoreBtn').style.display = 'none';
    document.getElementById('selAllBtn').style.display = 'block';
    document.getElementById('localSearchBar').style.display = 'flex';
    if (!isAppend) {
        document.getElementById('grid').innerHTML = '';
        document.getElementById('localSearchInput').value = '';
        allCardsData = [];
        currentStart = 1;
        lastPlaylistIndex = 0;
        searchReceivedCount = 0;
    }

    document.querySelectorAll('.skeleton').forEach(el => el.remove());
    const es = document.querySelector('.empty-state'); if(es) es.remove();
    renderSkeletons();
    socket.emit('start_search', { q, sort, duration, limit: currentLimit, start: currentStart, ignoreBl, vFormat });
}

socket.on('search_result', (item) => {
    appendItem(item);
    searchReceivedCount++;
});

socket.on('search_end', () => {
    document.querySelectorAll('.skeleton').forEach(el => el.remove());
    applyLocalFilters();
    if (searchReceivedCount > 0) document.getElementById('loadMoreBtn').style.display = 'block';
    searchReceivedCount = 0;
});

function loadMore() {
    currentStart = (lastPlaylistIndex > 0) ? lastPlaylistIndex + 1 : currentStart + currentLimit;
    startSearch(true);
}

function appendItem(v) {
    const grid = document.getElementById('grid');
    const card = document.createElement('div');
    card.className = 'card loaded';
    const pIndex = parseInt(v.playlist_index);
    if (!isNaN(pIndex)) lastPlaylistIndex = Math.max(lastPlaylistIndex, pIndex);

    const dur = v.duration || 0;
    const url = v.webpage_url || v.url || v.original_url || '';
    const isShort = url.toLowerCase().includes('/shorts/') || (dur > 0 && dur <= 66);
    card.dataset.format = isShort ? 'vert' : 'horz';
    const uploader = v.uploader || v.channel || 'Неизвестен';
    card.dataset.uploader = uploader;

    const title = v.title || v.fulltitle || v.track || v.alt_title || 'Видео без названия';
    let dateStr = '';
    const ts = v.timestamp || v.release_timestamp;
    const dStrObj = String(v.upload_date || v.release_date || '');
    if (ts) {
        const d = new Date(ts * 1000);
        dateStr = d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } else if (dStrObj && dStrObj.length === 8) {
        const y = dStrObj.substring(0, 4);
        const m = dStrObj.substring(4, 6);
        const day = dStrObj.substring(6, 8);
        dateStr = `${day}.${m}.${y}`;
    }
    const dateBadge = dateStr ? `<div class="pub-date">${dateStr}</div>` : '';

    const thumbUrl = v.thumbnail || (v.thumbnails && v.thumbnails[0] ? v.thumbnails[0].url : '');

    card.innerHTML = `
        <input type="checkbox" class="checkbox">
        <div class="thumb-wrap" style="aspect-ratio: ${isShort ? '9/16' : '16/9'}">
            <img src="${thumbUrl}" loading="lazy">
            ${dateBadge}
            <div class="status-overlay"><i class="ph ph-check"></i> Скачано</div>
        </div>
        <div class="card-body"><div class="v-title" title="${title.replace(/"/g, '&quot;')}">${title}</div></div>
    `;

    const cb = card.querySelector('.checkbox');
    cb.dataset.url = url;
    cb.dataset.title = encodeURIComponent(title);

    cb.addEventListener('change', (e) => toggle({target: cb}, url, title, uploader));

    card.addEventListener('click', (e) => {
        if (!e.target.classList.contains('checkbox')) openModal(v, isShort, url, title);
    });

    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openContextMenu(e, card);
    });

    const firstSkel = document.querySelector('.skeleton');
    if (firstSkel) grid.insertBefore(card, firstSkel);
    else grid.appendChild(card);

    allCardsData.push(card);
    applyLocalFilters();
}

function applyLocalFilters() {
    const queryText = document.getElementById('localSearchInput').value.toLowerCase();
    const terms = queryText.split(/\s+/).filter(t => t);
    const positive = terms.filter(t => !t.startsWith('-'));
    const negative = terms.filter(t => t.startsWith('-')).map(t => t.substring(1));

    let visibleCount = 0;
    allCardsData.forEach(card => {
        const title = card.querySelector('.v-title').innerText.toLowerCase();
        const uploader = (card.dataset.uploader || '').toLowerCase();

        const checkMatch = (term) => {
            if (term.startsWith('@')) return uploader.includes(term.substring(1));
            if (term.startsWith('#')) return title.includes(term);
            return title.includes(term) || uploader.includes(term);
        };

        let matchPos = positive.length === 0 || positive.every(checkMatch);
        let matchNeg = negative.some(checkMatch);

        if (matchPos && !matchNeg) {
            card.classList.remove('hidden');
            visibleCount++;
        } else {
            card.classList.add('hidden');
            const cb = card.querySelector('.checkbox');
            if (cb.checked) { cb.checked = false; toggle({target: cb}, cb.dataset.url, '', uploader); }
        }
    });
    document.getElementById('visibleCount').innerText = visibleCount;
    showEmptyState(visibleCount);
}

function toggle(e, url, title, uploader) {
    const card = e.target.closest('.card');
    if (e.target.checked) {
        selected.set(url, { title, uploader, card });
        card.classList.add('selected');
    } else {
        selected.delete(url);
        card.classList.remove('selected');
    }
    updatePanel();
}

function updatePanel() {
    const panel = document.getElementById('massPanel');
    panel.style.display = selected.size > 0 ? 'flex' : 'none';
    document.getElementById('counter').innerText = `Выбрано: ${selected.size}`;
}

function selectAll() {
    selected.clear();
    document.querySelectorAll('.card:not(.hidden)').forEach(card => {
        const cb = card.querySelector('.checkbox');
        cb.checked = true;
        card.classList.add('selected');
        selected.set(cb.dataset.url, { title: decodeURIComponent(cb.dataset.title), uploader: card.dataset.uploader, card: card });
    });
    updatePanel();
}

function cancelSelect() {
    document.querySelectorAll('.checkbox').forEach(b => b.checked = false);
    document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
    selected.clear();
    updatePanel();
}

function openContextMenu(e, card) {
    cmTargetCard = card;
    const menu = document.getElementById('customContextMenu');
    const cb = card.querySelector('.checkbox');
    document.getElementById('cmToggleBtn').innerHTML = cb.checked ? '<i class="ph ph-x-circle"></i> Отменить выделение' : '<i class="ph ph-check-circle"></i> Выделить';

    menu.style.display = 'flex';
    let x = e.clientX, y = e.clientY;
    setTimeout(() => {
        const rect = menu.getBoundingClientRect();
        if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 10;
        if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 10;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
    }, 0);
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('customContextMenu');
    if (menu && menu.style.display === 'flex') menu.style.display = 'none';
});

function formatTextWithTags(text, isDesc = false) {
    if (!text) return isDesc ? 'Описание отсутствует.' : 'Без названия';
    let safeText = String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    safeText = safeText.replace(/\n/g, '<br>');
    return safeText.replace(/#([a-zA-Zа-яА-ЯёЁ0-9_]+)/g, `<span class="clickable-tag" onclick="searchByTag('#$1', event)">#$1</span>`);
}

function searchByTag(tag, event) {
    if (event) event.stopPropagation();
    closeModal();
    switchSearchTab('search');
    document.getElementById('query').value = tag;
    startSearch();
}

function openModal(v, isShort, url, titleFallback) {
    currentModalUrl = url;
    const layout = document.getElementById('modalLayout');

    if (isShort) layout.classList.add('vertical-mode');
    else layout.classList.remove('vertical-mode');

    let videoId = v.id || v.display_id || '';
    if (!videoId && url && (url.includes('youtube') || url.includes('youtu.be'))) {
        const match = url.match(/(?:v=|shorts\/|youtu\.be\/|\/v\/|embed\/)([a-zA-Z0-9_-]{11})/);
        if (match) videoId = match[1];
        else {
            const fallback = url.match(/([a-zA-Z0-9_-]{11})/);
            if (fallback) videoId = fallback[1];
        }
    }

    document.getElementById('mTitle').innerHTML = formatTextWithTags(titleFallback, false);
    document.getElementById('mUploader').innerText = v.uploader || v.channel || 'Канал неизвестен';
    document.getElementById('mDesc').innerHTML = '<span style="color:var(--text-muted); font-style:italic;">Загрузка полного описания...</span>';
    const targetUrlStr = (url || '').toLowerCase();
    if (targetUrlStr.includes('tiktok.com')) layout.classList.add('tiktok-mode');
    else layout.classList.remove('tiktok-mode');
    if (videoId && (targetUrlStr.includes('youtube') || targetUrlStr.includes('youtu.be'))) {
        document.getElementById('playerTarget').innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1" allowfullscreen></iframe>`;
        document.getElementById('playerTarget').style.display = 'flex';
    } else if (videoId && targetUrlStr.includes('tiktok.com')) {
        document.getElementById('playerTarget').innerHTML = `<iframe src="https://www.tiktok.com/embed/v2/${videoId}" allowfullscreen></iframe>`;
        document.getElementById('playerTarget').style.display = 'flex';
    } else {
        document.getElementById('playerTarget').innerHTML = '';
        document.getElementById('playerTarget').style.display = 'none';
    }

    document.getElementById('modalOverlay').style.display = 'flex';

    fetch(`/api/full-info?url=${encodeURIComponent(url)}`)
        .then(r => r.json())
        .then(data => {
            if (data.title && !targetUrlStr.includes('tiktok.com')) {
                document.getElementById('mTitle').innerHTML = formatTextWithTags(data.title, false);
            }
            let pubStr = '';

            if (data.upload_date && data.upload_date.length === 8) {
                pubStr = ` • Опубликовано: ${data.upload_date.substring(6,8)}.${data.upload_date.substring(4,6)}.${data.upload_date.substring(0,4)}`;
            }
            document.getElementById('mUploader').innerText = (v.uploader || v.channel || 'Канал неизвестен') + pubStr;
            const descText = data.description || v.description;
            document.getElementById('mDesc').innerHTML = formatTextWithTags(descText, true);

        }).catch(() => {
            const descText = v.description;
            document.getElementById('mDesc').innerHTML = formatTextWithTags(descText, true);
        });
}

function closeModal(e) {
    if (!e || e.target.id === 'modalOverlay' || e.target.className.includes('modal-close')) {
        document.getElementById('modalOverlay').style.display = 'none';
        document.getElementById('playerTarget').innerHTML = '';
    }
}

function copyModalText(btnElement) {
    const isTikTok = currentModalUrl.toLowerCase().includes('tiktok.com');
    const title = document.getElementById('mTitle').innerText.trim();
    let desc = document.getElementById('mDesc').innerText.trim();

    if (desc.includes('Описание отсутствует') || desc.includes('Загрузка полного описания')) desc = '';
    if (desc && desc.toLowerCase().includes(title.toLowerCase())) desc = '';

    let textToCopy = desc ? `${title}\n\n${desc}` : title;
    if (isTikTok) textToCopy = desc || title;

    navigator.clipboard.writeText(textToCopy).then(() => {
        const originalHtml = btnElement.innerHTML;
        btnElement.innerHTML = '<i class="ph ph-check"></i>';
        btnElement.classList.add('copied-success');
        setTimeout(() => {
            btnElement.innerHTML = originalHtml;
            btnElement.classList.remove('copied-success');
        }, 2000);
    });
}

function cmActionDownload() {
    if (!cmTargetCard) return;
    const cb = cmTargetCard.querySelector('.checkbox');
    const url = cb.dataset.url;
    const title = decodeURIComponent(cb.dataset.title);
    const quality = document.getElementById('quality').value;
    const cpackEl = document.getElementById('cbContentPack');
    const sblockEl = document.getElementById('cbSponsorBlock');
    showToast('⏳ Загрузка добавлена в очередь');
    document.getElementById('queuePanel').classList.remove('collapsed');
    document.getElementById('qToggleIcon').innerText = '🔽';

    const taskObj = {
        url, data: { title }, quality, asZip: false, isLastInBatch: true,
        taskId: Date.now() + '_' + Math.floor(Math.random() * 10000),
        cpack: cpackEl ? cpackEl.checked : false, sblock: sblockEl ? sblockEl.checked : false
    };
    socket.emit('add_to_queue', [taskObj]);
}

function cmActionToggle() {
    if (!cmTargetCard) return;
    const cb = cmTargetCard.querySelector('.checkbox');
    cb.checked = !cb.checked;
    toggle({target: cb}, cb.dataset.url, decodeURIComponent(cb.dataset.title), cmTargetCard.dataset.uploader);
}

function cmActionCopyDesc() {
    if (!cmTargetCard) return;
    const cb = cmTargetCard.querySelector('.checkbox');
    const url = cb.dataset.url;
    const title = decodeURIComponent(cb.dataset.title).trim();
    const isTikTok = url.toLowerCase().includes('tiktok.com');

    showToast('<i class="ph ph-hourglass"></i> Получение описания...');
    fetch(`/api/full-info?url=${encodeURIComponent(url)}`)
        .then(r => r.json())
        .then(data => {
            let desc = (data.description || '').trim();
            if (desc.includes('Описание отсутствует') || desc.includes('Загрузка полного описания')) desc = '';
            if (desc && desc.toLowerCase().includes(title.toLowerCase())) desc = '';
            let textToCopy = desc ? `${title}\n\n${desc}` : title;

            if (isTikTok) textToCopy = desc || title;
            navigator.clipboard.writeText(textToCopy).then(() => showToast('✓ Описание скопировано'));
        }).catch(() => showToast('❌ Ошибка получения описания'));
}

function openCookieModal() { document.getElementById('cookieModal').style.display = 'flex'; }
function closeCookieModal(e) {
    if (!e || e.target.id === 'cookieModal' || e.target.className.includes('bl-close')) {
        document.getElementById('cookieModal').style.display = 'none';
    }
}

const lassoBox = document.getElementById('lassoBox');
let isDrawing = false, startX, startY;
document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.card') || e.target.closest('.header') || e.target.closest('.mass-panel') || e.target.closest('.queue-panel') || e.target.closest('.modal-overlay')) return;
    if (e.button === 2) return;
    isDrawing = true;
    startX = e.clientX; startY = e.clientY;
    lassoBox.style.left = startX + 'px'; lassoBox.style.top = startY + 'px';
    lassoBox.style.width = '0px'; lassoBox.style.height = '0px';
    lassoBox.style.display = 'block';
});
document.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const x = Math.min(startX, e.clientX), y = Math.min(startY, e.clientY);
    const w = Math.abs(startX - e.clientX), h = Math.abs(startY - e.clientY);
    lassoBox.style.left = `${x}px`; lassoBox.style.top = `${y}px`;
    lassoBox.style.width = `${w}px`;
    lassoBox.style.height = `${h}px`;
});
document.addEventListener('mouseup', () => {
    if (!isDrawing) return;
    isDrawing = false;
    const rect = lassoBox.getBoundingClientRect();
    lassoBox.style.display = 'none';
    document.querySelectorAll('.card:not(.hidden)').forEach(card => {
        const cRect = card.getBoundingClientRect();
        if (!(rect.right < cRect.left || rect.left > cRect.right || rect.bottom < cRect.top || rect.top > cRect.bottom)) {
            const cb = card.querySelector('.checkbox');
            cb.checked = !cb.checked;

            toggle({target: cb}, cb.dataset.url, decodeURIComponent(cb.dataset.title), card.dataset.uploader);
        }
    });
});

let localBlacklist = [];
let currentBlTab = 'all';

function applyBlacklistToCurrentGallery(blacklistData) {
    if (document.getElementById('ignoreBl').checked || !blacklistData || !Array.isArray(blacklistData) || blacklistData.length === 0) return;
    allCardsData = allCardsData.filter(card => {
        const title = card.querySelector('.v-title').innerText.toLowerCase();
        const uploader = (card.dataset.uploader || '').toLowerCase();
        let isBl = false;
        for (const rule of blacklistData) {
            if (!rule || typeof rule !== 'object' || !rule.value) continue;
            const val = String(rule.value).toLowerCase();

            if (rule.type === 'channel' && uploader.includes(val)) { isBl = true; break; }
            if (rule.type === 'tag' && title.includes('#' + val)) { isBl = true; break; }
            if (rule.type === 'word' && title.includes(val)) { isBl = true; break; }
        }
        if (isBl) { card.remove(); return false; }

        return true;
    });
    applyLocalFilters();
}

function banCurrentChannel() {
    const uploader = document.getElementById('mUploader').innerText.split(' • ')[0];
    if (!uploader || uploader === 'Канал неизвестен') return;
    fetch('/api/blacklist').then(r => r.json()).then(currentList => {
        const currentSet = new Set(currentList.filter(i => i && i.type === 'channel' && i.value).map(i => String(i.value).toLowerCase()));
        if (!currentSet.has(uploader.toLowerCase())) {
            currentList.unshift({ id: Date.now(), type: 'channel', value: uploader, comment: 'Добавлено из окна видео' });
            fetch('/api/blacklist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: currentList }) })
            .then(() => {
                showToast(`<i class="ph ph-prohibit"></i> Канал @${uploader} добавлен в ЧС`);
                closeModal();
                applyBlacklistToCurrentGallery(currentList);
            });
        } else showToast('<i class="ph ph-info"></i> Канал уже находится в ЧС');
    });
}

function openBlacklistModal() {
    fetch('/api/blacklist').then(r => r.json()).then(data => {
        localBlacklist = Array.isArray(data) ? data : [];
        document.getElementById('blModal').style.display = 'flex';
        renderBlacklistUI();
    });
}

function closeBlacklistModal(e) {
    if (!e || e.target.id === 'blModal') document.getElementById('blModal').style.display = 'none';
}

function setBlTab(tabName, btnEl) {
    currentBlTab = tabName;
    document.querySelectorAll('.bl-tabs .chip').forEach(c => c.classList.remove('active'));
    btnEl.classList.add('active');
    renderBlacklistUI();
}

function renderBlacklistUI() {
    const listContainer = document.getElementById('blListContainer');
    listContainer.innerHTML = '';
    const query = document.getElementById('blSearch').value.toLowerCase();
    localBlacklist.forEach(item => {
        if (!item || !item.value) return;
        if (currentBlTab !== 'all' && item.type !== currentBlTab) return;
        if (query && !String(item.value).toLowerCase().includes(query) && !(item.comment || '').toLowerCase().includes(query)) return;
        const div = document.createElement('div');
        div.className = 'bl-item';
        let displayVal = item.value, typeName = 'Слово';
        if (item.type === 'channel') { displayVal = `@${item.value}`; typeName = 'Канал'; }
        if (item.type === 'tag') { displayVal = `#${item.value}`; typeName = 'Хештег'; }
        const valHtml = item.type === 'channel' ? `<a href="https://www.youtube.com/results?search_query=${encodeURIComponent(item.value)}" target="_blank" class="bl-item-val is-link">${displayVal}</a>` : `<span class="bl-item-val">${displayVal}</span>`;
        div.innerHTML = `<div class="bl-item-left"><div style="display:flex; align-items:center; gap:8px;">${valHtml} <span class="bl-item-type">${typeName}</span></div>${item.comment ? `<div class="bl-item-comment"><i class="ph ph-note"></i> ${item.comment}</div>` : ''}</div><button class="bl-del-btn" onclick="deleteBlacklistRule(${item.id})"><i class="ph ph-x"></i></button>`;
        listContainer.appendChild(div);
    });
}

function addRuleToBlacklist() {
    const type = document.getElementById('blNewType').value;
    let value = document.getElementById('blNewValue').value.trim();
    const comment = document.getElementById('blNewComment').value.trim();
    if (!value) return;
    if (type === 'channel' && value.startsWith('@')) value = value.substring(1);
    if (type === 'tag' && value.startsWith('#')) value = value.substring(1);
    localBlacklist.unshift({ id: Date.now(), type, value, comment });
    document.getElementById('blNewValue').value = '';
    document.getElementById('blNewComment').value = '';
    saveBlacklistData(localBlacklist);
}

function deleteBlacklistRule(id) {
    localBlacklist = localBlacklist.filter(i => i.id !== id);
    saveBlacklistData(localBlacklist);
}

function saveBlacklistData(dataArr) {
    fetch('/api/blacklist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: dataArr }) })
    .then(() => { renderBlacklistUI(); showToast('<i class="ph ph-check-circle"></i> База ЧС обновлена'); applyBlacklistToCurrentGallery(dataArr); });
}

function massAddToBlacklist() {
    const tasks = Array.from(selected.values());
    if (tasks.length === 0) return;
    fetch('/api/blacklist').then(r => r.json()).then(currentList => {
        if (!Array.isArray(currentList)) currentList = [];
        const currentSet = new Set(currentList.filter(i => i && i.type === 'channel' && i.value).map(i => String(i.value).toLowerCase()));
        let addedCount = 0;
        tasks.forEach(data => {
            if (data.uploader && data.uploader !== 'Неизвестен') {
                if (!currentSet.has(data.uploader.toLowerCase())) {
                    currentList.unshift({ id: Date.now() + Math.random(), type: 'channel', value: data.uploader, comment: 'Добавлено массовым выделением' });
                    currentSet.add(data.uploader.toLowerCase());
                    addedCount++;
                }
            }
        });
        if (addedCount > 0) {
            fetch('/api/blacklist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: currentList }) })
            .then(() => { showToast(`<i class="ph ph-prohibit"></i> В ЧС отправлено каналов: ${addedCount}`); cancelSelect(); applyBlacklistToCurrentGallery(currentList); });
        } else {
            showToast('<i class="ph ph-info"></i> Выбранные каналы уже находятся в ЧС');
            cancelSelect();
        }
    });
}

const logBox = document.getElementById('logBox');

function appendAdminLog(box, text) {
    if (!box) return;
    const div = document.createElement('div');
    div.textContent = text;
    if(text.includes('[ERROR]') || text.includes('Остановлен')) div.style.color = 'var(--danger)';
    if(text.includes('Запуск') || text.includes('[DONE]')) div.style.color = 'var(--success)';
    if(text.includes('DOWNLOAD TASK')) div.style.color = '#3b82f6';
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

socket.on('admin_init', (data) => {
    if (logBox && data.server) {
        logBox.innerHTML = '';
        data.server.forEach(l => appendAdminLog(logBox, l));
    }
});
socket.on('server_log', (msg) => appendAdminLog(logBox, msg));

function sendAdminCommand(cmd) {
    socket.emit('admin_cmd', cmd);
}


function showEmptyState(visibleCount = 0) {
    const grid = document.getElementById('grid');
    if (!grid) return;

    // Check if there are no items in allCardsData or visibleCount is 0
    if (allCardsData.length === 0) {
        let emptyState = document.getElementById('emptyState');
        if (!emptyState) {
            emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.id = 'emptyState';
            grid.appendChild(emptyState);
        }
        emptyState.innerHTML = `
            <i class="ph ph-magnifying-glass"></i>
            <h3>Начните поиск</h3>
            <p>Введите запрос или вставьте ссылку для поиска видео.</p>
        `;
        emptyState.style.display = 'flex';
    } else if (visibleCount === 0) {
        let emptyState = document.getElementById('emptyState');
        if (!emptyState) {
            emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.id = 'emptyState';
            grid.appendChild(emptyState);
        }
        emptyState.innerHTML = `
            <i class="ph ph-magnifying-glass"></i>
            <h3>Ничего не найдено</h3>
            <p>Воспользуйтесь поиском, чтобы найти видео или аудио для скачивания</p>
        `;
        emptyState.style.display = 'flex';
    } else {
        const emptyState = document.getElementById('emptyState');
        if (emptyState) emptyState.style.display = 'none';
    }
}
