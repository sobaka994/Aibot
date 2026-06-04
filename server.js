// --- ПРОВЕРКА ВСЕХ ЗАВИСИМОСТЕЙ ---
const { execSync } = require('child_process');
const requiredDeps = [
    'express',
    'archiver',
    'socket.io',
    'axios'
];
const missingDeps = [];
for (const dep of requiredDeps) {
    try {
        require.resolve(dep);
    } catch (e) {
        missingDeps.push(dep);
    }
}
if (missingDeps.length > 0) {
    console.log(`[SYSTEM] Не хватает библиотек: ${missingDeps.join(', ')}`);
    console.log('[SYSTEM] Начинаю автоматическую установку...');
    try {
        execSync(`npm install ${missingDeps.join(' ')}`, { stdio: 'inherit' });
        console.log('[SYSTEM] Все недостающие библиотеки установлены.');
    } catch (e) {
        console.log(`[FATAL ERROR] Не удалось установить зависимости: ${e.message}`);
        process.exit(1);
    }
}

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const http = require('http');
const socketIo = require('socket.io');
const utils = require('./utils');
// Подключение изолированных парсеров по платформам
const youtubeParser = require('./queryParser');
const socialParser = require('./socialParser');
const marketplaceParser = require('./marketplaceParser');

utils.checkAndDownloadFFmpeg();
// --- ГЛОБАЛЬНЫЕ ОБРАБОТЧИКИ ОШИБОК ПРОЦЕССА ---
process.on('uncaughtException', (err) => {
    console.log(`[FATAL ERROR] Неперехваченное исключение: ${err.message}`);
});
process.on('unhandledRejection', (reason, promise) => {
    console.log(`[FATAL ERROR] Необработанное отклонение промиса: ${reason}`);
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/main.js', (req, res) => res.sendFile(path.join(__dirname, 'main.js')));

const tempDir = path.join(__dirname, 'temp_downloads');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
const cachePath = path.join(__dirname, 'desc_cache.json');
if (!fs.existsSync(cachePath)) fs.writeFileSync(cachePath, '{}', 'utf8');

const historyPathJSON = path.join(__dirname, 'download_history.json');
if (!fs.existsSync(historyPathJSON)) fs.writeFileSync(historyPathJSON, '[]', 'utf8');
// --- БЕЗОПАСНАЯ ЗАПИСЬ ФАЙЛОВ ---
const writeQueues = {};
function safeWriteFile(filePath, dataObj) {
    return new Promise((resolve, reject) => {
        if (!writeQueues[filePath]) {
            writeQueues[filePath] = { isWriting: false, queue: [] };
        }
        const q = writeQueues[filePath];
        q.queue.push({ dataObj, resolve, reject });
        const processWQueue = () => {
            if (q.isWriting || q.queue.length === 0) return;
            q.isWriting = true;
            const task = q.queue.shift();
            fs.writeFile(filePath, JSON.stringify(task.dataObj, null, 2), 'utf8', (err) => {
                q.isWriting = false;
                if (err) task.reject(err);
                else task.resolve();
                processWQueue();
            });
        };
        processWQueue();
    });
}

async function addUrlToHistory(url) {
    let downloadHistory = [];
    try { downloadHistory = JSON.parse(fs.readFileSync(historyPathJSON, 'utf8'));
    } catch(e){}
    if (!downloadHistory.includes(url)) {
        downloadHistory.push(url);
        await safeWriteFile(historyPathJSON, downloadHistory);
    }
}

// --- ЛОГИРОВАНИЕ ---
let logHistory = [];
const originalConsoleLog = console.log;
console.log = function(...args) {
    const msg = args.join(' ');
    originalConsoleLog.apply(console, args);
    const time = new Date().toLocaleTimeString('ru-RU');
    const logMsg = `[${time}] ${msg}`;
    logHistory.push(logMsg);
    if (logHistory.length > 250) logHistory.shift();
    io.emit('server_log', logMsg);
};

console.log('[SYSTEM] Сервер Media Hub инициализирован.');
// --- ОЧЕРЕДЬ ЗАДАЧ ---
let tasksQueue = [];
let isDownloading = false;
let isQueuePaused = false;
let activeProcess = null;
function broadcastQueue() {
    io.emit('queue_update', { tasks: tasksQueue, isQueuePaused });
}

function processQueue() {
    if (isDownloading || isQueuePaused) return;
    const taskIndex = tasksQueue.findIndex(t => t.status === 'pending');
    if (taskIndex === -1) return;

    const task = tasksQueue[taskIndex];
    task.status = 'active';
    isDownloading = true;
    broadcastQueue();
    const isContentPack = task.cpack && global.ffmpegAvailable;
    const isSponsorBlock = task.sblock && global.ffmpegAvailable;
    const taskDir = path.join(tempDir, `task_${task.taskId}`);
    if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir);
    let format = 'best[ext=mp4]/best';
    if (task.quality === 'mp3') {
        format = 'bestaudio[ext=m4a]/best';
    } else if (task.quality === 'max' && global.ffmpegAvailable) {
        format = 'bestvideo+bestaudio/best';
    } else if (task.quality !== 'max') {
        format = `bestvideo[height<=${task.quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${task.quality}][ext=mp4]/best`;
    }

    let args = ['-f', format, '--newline', '--no-playlist', '--force-ipv4'];
    if (global.ffmpegAvailable) {
        args.push('--ffmpeg-location', __dirname);
    }
    if (task.quality !== 'mp3' && global.ffmpegAvailable) {
        args.push('--merge-output-format', 'mp4');
    }
    if (task.url.includes('youtube.com') || task.url.includes('youtu.be')) {
        if (fs.existsSync(path.join(__dirname, 'youtube_cookies.txt'))) args.push('--cookies', 'youtube_cookies.txt');
    } else if (task.url.includes('tiktok.com') && fs.existsSync(path.join(__dirname, 'tiktok_cookies.txt'))) {
        args.push('--cookies', 'tiktok_cookies.txt');
        args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    }

    if (isContentPack) {
        args.push('--write-thumbnail', '--write-description');
        args.push('-o', path.join(taskDir, '%(title)s.%(ext)s'));
    } else {
        args.push('-o', path.join(taskDir, `video_${task.taskId}.%(ext)s`));
    }

    if (isSponsorBlock) {
        args.push('--sponsorblock-remove', 'sponsor,intro,outro');
    }

    args.push(task.url);

    activeProcess = spawn(process.platform === 'win32' ? '.\\yt-dlp.exe' : 'yt-dlp', args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
    task.processRef = activeProcess;

    activeProcess.stdout.setEncoding('utf8');
    activeProcess.stderr.setEncoding('utf8');

    activeProcess.stderr.on('data', (data) => {
        const msg = data.trim();
        if (msg && !msg.includes('%')) {
            console.log(`[yt-dlp dl] ${msg}`);
            if (msg.includes('[Merger]') || (msg.includes('[ffmpeg]') && msg.toLowerCase().includes('merg'))) {
                task.percent = 'merge';
                task.hasMerged = true;
                broadcastQueue();
            }
        }
    });
    activeProcess.stdout.on('data', (data) => {
        const match = data.match(/(\d+\.\d+)%/);
        if (match) {
            task.percent = match[1];
            broadcastQueue();
        }
    });
    activeProcess.on('close', async (code) => {
        activeProcess = null;
        const finalCode = task.isKilled ? 'killed' : code;

        if (finalCode === 'killed') {
            task.status = 'paused';
        } else if (finalCode === 0) {
            task.status = 'success';
            task.isHighQuality = (task.quality === 'max' && !!task.hasMerged);
            await addUrlToHistory(task.url);

            if (isContentPack) {
                const packName = `pack_${task.taskId}.zip`;
                const packPath = path.join(tempDir, packName);
                const output = fs.createWriteStream(packPath);
                const archive = archiver('zip', { zlib: { level: 5 } });
                archive.pipe(output);
                archive.directory(taskDir, false);
                await archive.finalize();
                task.fileName = packName;
                utils.writeToHistory(`DOWNLOAD TASK (CPACK): ${task.url} | Code: ${code}`);
            } else {
                const files = fs.readdirSync(taskDir);
                if (files.length > 0) {
                    const downloadedFile = files[0];
                    const finalPath = path.join(tempDir, downloadedFile);
                    fs.renameSync(path.join(taskDir, downloadedFile), finalPath);
                    task.fileName = downloadedFile;
                } else {
                    task.status = 'error';
                }
                utils.writeToHistory(`DOWNLOAD TASK: ${task.url} | Code: ${code}`);
            }
        } else {
            utils.writeToHistory(`DOWNLOAD ERROR: ${task.url} | Code: ${finalCode}`);
            if (task.retryCount < 3) {
                task.retryCount++;
                task.status = `retry_${task.retryCount}`;
                broadcastQueue();
                setTimeout(() => {
                    const tIndex = tasksQueue.findIndex(t => t.taskId === task.taskId);
                    if (tIndex > -1) {
                        tasksQueue[tIndex].status = 'pending';
                        const [t] = tasksQueue.splice(tIndex, 1);
                        tasksQueue.unshift(t);
                    }
                    isDownloading = false;
                    processQueue();
                    broadcastQueue();
                }, 3000);
                try { fs.rmSync(taskDir, { recursive: true, force: true }); } catch (e) {}
                return;
            } else {
                task.status = 'error';
            }
        }

        try { fs.rmSync(taskDir, { recursive: true, force: true });
        } catch (e) {}
        isDownloading = false;
        broadcastQueue();
        processQueue();
        if (task.status === 'success' || task.status === 'error') {
            io.emit('task_completed', task);
        }
    });
}

// --- API МАРШРУТЫ (HTTP) ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/api/blacklist', (req, res) => {
    res.json(utils.getBlacklist());
});

app.post('/api/blacklist', async (req, res) => {
    try {
        await safeWriteFile(path.join(__dirname, 'blacklist.json'), req.body.data || []);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: true });
    }
});
app.get('/api/full-info', async (req, res) => {
    const { url } = req.query;
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch (e) {}
    if (cache[url]) return res.json(cache[url]);

    if (marketplaceParser.isMarketplaceUrl(url)) {
        try {
            const data = await marketplaceParser.extractMarketplaceVideo(url);
            if (data.directVideoUrl) {
                const resObj = { title: `Видео с ${data.platform}`, description: `Прямая ссылка на файл: ${data.directVideoUrl}`, webpage_url: url };
                cache[url] = resObj;
                await safeWriteFile(cachePath, cache);
                return res.json(resObj);
            }
        } catch(e) {}
        return res.status(404).json({ error: true });
    }

    let args = ['--dump-json', '--no-playlist', '--force-ipv4'];
    const urlStr = url.toLowerCase();
    if (urlStr.includes('youtube.com') || urlStr.includes('youtu.be')) {
        if (fs.existsSync(path.join(__dirname, 'youtube_cookies.txt'))) args.push('--cookies', 'youtube_cookies.txt');
    } else if (urlStr.includes('tiktok.com')) {
        if (fs.existsSync(path.join(__dirname, 'tiktok_cookies.txt'))) args.push('--cookies', 'tiktok_cookies.txt');
        args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    }
    args.push(url);
    const yt = spawn(process.platform === 'win32' ? '.\\yt-dlp.exe' : 'yt-dlp', args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
    yt.stdout.setEncoding('utf8');
    let buffer = '';
    yt.stdout.on('data', d => buffer += d);
    yt.on('close', async () => {
        try {
            const parsed = JSON.parse(buffer);
            cache[url] = parsed;
            await safeWriteFile(cachePath, cache);
            res.json(parsed);
        } catch (e) {
            res.status(500).json({ error: true });
        }
    });
});
app.get('/get-file', (req, res) => {
    const file = req.query.f;
    const title = req.query.t || 'video';
    const ext = path.extname(file);
    const filePath = path.join(tempDir, file);
    if (fs.existsSync(filePath)) res.download(filePath, `${title}${ext}`);
    else res.status(404).send('Файл не найден');
});
app.post('/download-zip', (req, res) => {
    let files = req.body.files;
    if (typeof files === 'string') files = JSON.parse(files);
    if (!files || !files.length) return res.status(400).send('Нет файлов');

    res.attachment('MediaHub_Archive.zip');
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', err => res.status(500).send({ error: err.message }));
    archive.pipe(res);
    files.forEach(item => {
        const filePath = path.join(tempDir, item.fileName);
        if (fs.existsSync(filePath)) {
            const ext = path.extname(item.fileName);
            archive.file(filePath, { name: `${item.title || 'video'}${ext}` });
        }
    });
    archive.finalize();
});
app.post('/cleanup', (req, res) => {
    let files = req.body.files;
    if (typeof files === 'string') files = JSON.parse(files);
    if (files && files.length) {
        files.forEach(item => {
            const filePath = path.join(tempDir, item.fileName);
            if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch (e) {} }
        });
    }
    res.json({ success: true });
});
// --- SOCKET.IO СОЕДИНЕНИЕ ---
io.on('connection', (socket) => {
    socket.emit('admin_init', { server: logHistory, bot: [] });
    socket.emit('queue_update', { tasks: tasksQueue, isQueuePaused });

    // ИСПРАВЛЕНО: событие переименовано под вызов из main.js и добавлены обработчики чистки кэша
    socket.on('admin_cmd', cmd => {
        if (cmd === 'clear-console') {
            logHistory = [];
            socket.emit('admin_init', { server: [], bot: [] });
        } else if (cmd === 'clear-temp') {
            console.log('[SYSTEM] Запрос на полную очистку временных файлов и кэша описаний...');
            try {
                const activeTaskIds = new Set(tasksQueue.filter(t => t.status === 'active').map(t => t.taskId));
                if (fs.existsSync(tempDir)) {
                    const files = fs.readdirSync(tempDir);
                    files.forEach(file => {
                        const filePath = path.join(tempDir, file);
                        if (file.startsWith('task_')) {
                            const taskId = file.replace('task_', '');
                            if (activeTaskIds.has(taskId)) return;
                        }
                        fs.rmSync(filePath, { recursive: true, force: true });
                    });
                }
                if (fs.existsSync(cachePath)) {
                    fs.writeFileSync(cachePath, '{}', 'utf8');
                }
                console.log('[SYSTEM] Временные файлы и кэш успешно зачищены.');
            } catch (e) {
                console.log(`[ERROR] Ошибка при очистке Temp/Кэша: ${e.message}`);
            }
        } else if (cmd === 'clear-logs') {
            console.log('[SYSTEM] Запрос на очистку лог-файлов...');
            try {
                const historyLogPath = path.join(__dirname, 'history.log');
                if (fs.existsSync(historyLogPath)) {
                    fs.writeFileSync(historyLogPath, '', 'utf8');
                }
                logHistory = [];
                io.emit('admin_init', { server: [], bot: [] });
                console.log('[SYSTEM] Файлы логов очищены.');
            } catch (e) {
                console.log(`[ERROR] Ошибка при очистке логов: ${e.message}`);
            }
        }
    });

    socket.on('add_to_queue', (data) => {
        const tasksList = Array.isArray(data) ? data : [data];

        tasksList.forEach(item => {
            const taskId = item.taskId || Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            const newTask = {
                taskId,
                url: item.url,
                data: item.data || { title: item.title || 'video' },
                quality: item.quality,
                cpack: !!item.cpack,
                sblock: !!item.sblock,
                asZip: !!item.asZip,
                isLastInBatch: !!item.isLastInBatch,
                status: 'pending',
                percent: '0',
                retryCount: 0,
                source: item.source || 'web',
                chatId: null,
                botClientRes: null,
                hasMerged: false,
                isHighQuality: false
            };
            tasksQueue.push(newTask);
        });
        broadcastQueue();
        processQueue();
    });

    // ИСПРАВЛЕНО: добавлены нативные слушатели ручной очистки очереди («Готовые» и «Всё»)
    socket.on('clear_success', () => {
        tasksQueue = tasksQueue.filter(t => t.status !== 'success');
        broadcastQueue();
    });

    socket.on('clear_all', () => {
        tasksQueue.forEach(t => {
            if (t.status === 'active' && activeProcess) {
                try { activeProcess.kill(); } catch(e){}
            }
        });
        tasksQueue = [];
        isDownloading = false;
        broadcastQueue();
        processQueue();
    });

    socket.on('pause_all', () => {
        isQueuePaused = true;
        if (activeProcess) {
            const aTask = tasksQueue.find(t => t.status === 'active');
            if (aTask) aTask.isKilled = true;
            try { activeProcess.kill(); } catch (e) {}
        }
        broadcastQueue();
    });

    socket.on('resume_all', () => {
        isQueuePaused = false;
        tasksQueue.forEach(t => { if (t.status === 'paused') t.status = 'pending'; });
        broadcastQueue();
        processQueue();
    });

    socket.on('pause_task', (id) => {
        const task = tasksQueue.find(t => t.taskId === id);
        if (task) {
            if (task.status === 'active' && activeProcess) {
                task.isKilled = true;
                try { activeProcess.kill(); } catch(e){}
            }
            task.status = 'paused';
            broadcastQueue();
            processQueue();
        }
    });

    socket.on('resume_task', (id) => {
        const task = tasksQueue.find(t => t.taskId === id);
        if (task) {
            if (task.status === 'paused') {
                task.status = 'pending';
                broadcastQueue();
                processQueue();
            }
        }
    });

    socket.on('retry_task', (id) => {
        const task = tasksQueue.find(t => t.taskId === id);
        if (task) {
            task.status = 'pending';
            task.retryCount = 0;
            broadcastQueue();
            processQueue();
        }
    });

    socket.on('queue_action', (data) => {
        const { action, taskId } = data;
        if (action === 'pause_all') {
            isQueuePaused = true;
            if (activeProcess) {
                const aTask = tasksQueue.find(t => t.status === 'active');
                if (aTask) aTask.isKilled = true;
                try { activeProcess.kill(); } catch (e) {}
            }
            broadcastQueue();
        }
        if (action === 'resume_all') {
            isQueuePaused = false;
            tasksQueue.forEach(t => {
                if (t.status === 'paused') t.status = 'pending'; });
            broadcastQueue();
            processQueue();
        }
        if (action === 'remove_task') {
            const tIndex = tasksQueue.findIndex(t => t.taskId === taskId);
            if (tIndex > -1) {
                const t = tasksQueue[tIndex];
                if (t.status === 'active' && activeProcess) {
                    t.isKilled = true;
                    try { activeProcess.kill();
                } catch(e) {}
                }
                tasksQueue.splice(tIndex, 1);
                broadcastQueue();
            }
        }
        if (action === 'clear_finished') {
            tasksQueue = tasksQueue.filter(t =>
                t.status !== 'success' && t.status !== 'error' && t.status !== 'paused'
            );
            broadcastQueue();
        }
    });

    socket.on('check_history', (urls) => {
        let downloadHistory = [];
        try { downloadHistory = JSON.parse(fs.readFileSync(historyPathJSON, 'utf8')); } catch(e){}
        const result = {};
        urls.forEach(u => { result[u] = downloadHistory.includes(u); });
        socket.emit('history_response', result);
    });

    socket.on('start_search', async (data) => {
        try {
            let ctx;
            const inputUrl = String(data.q || '').trim();
            console.log(`[PARSER] Получен запрос на обработку URL: ${inputUrl}`);

            if (marketplaceParser.isMarketplaceUrl(inputUrl)) {
                console.log(`[PARSER] Обнаружена ссылка маркетплейса. Запуск прямого экстрактора...`);
                const mpData = await marketplaceParser.extractMarketplaceVideo(inputUrl);

                if (mpData.directVideoUrl) {
                    console.log(`[PARSER] Прямой видео-поток успешно извлечен: ${mpData.directVideoUrl}`);
                    const mockItem = {
                        id: 'mp_' + Date.now(),
                        title: `Видео с ${mpData.platform}`,
                        uploader: mpData.platform,
                        webpage_url: mpData.directVideoUrl,
                        thumbnail: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=300',
                        duration: 0,
                        playlist_index: 1
                    };
                    socket.emit('search_result', mockItem);
                } else {
                    console.log(`[ERROR] Не удалось вытащить mp4 со страницы товара маркетплейса.`);
                    socket.emit('server_log', `[ERROR] Видео не найдено на странице маркетплейса`);
                }
                socket.emit('search_end');
                return;
            }

            if (socialParser.isSocialUrl(inputUrl)) {
                console.log(`[PARSER] Перенаправление ссылки в socialParser.js`);
                ctx = socialParser.parse(inputUrl, data);
            } else {
                console.log(`[PARSER] Перенаправление запроса в стабильный youtube/queryParser.js`);
                ctx = youtubeParser.parse(data);
            }

            const yt = spawn(process.platform === 'win32' ? '.\\yt-dlp.exe' : 'yt-dlp', ctx.ytDlpArgs, { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
            yt.stdout.setEncoding('utf8');

            // ИСПРАВЛЕНО: Буферизация потока для бесконфликтной обработки длинных JSON-выгрузок длинных видео
            let searchBuffer = '';
            yt.stdout.on('data', (chunk) => {
                searchBuffer += chunk;
                const lines = searchBuffer.split('\n');
                searchBuffer = lines.pop();
                for (let line of lines) {
                    try {
                        if (line.trim().startsWith('{')) {
                            const parsed = JSON.parse(line);
                            socket.emit('search_result', parsed);
                        }
                    } catch(e) {}
                }
            });
            yt.on('close', () => {
                if (searchBuffer.trim().startsWith('{')) {
                    try {
                        const parsed = JSON.parse(searchBuffer);
                        socket.emit('search_result', parsed);
                    } catch(e) {}
                }
                socket.emit('search_end');
            });
        } catch (e) {
            console.error('[Socket start_search Error]:', e.message);
            socket.emit('search_end');
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`[SYSTEM] Сервер запущен на http://localhost:${PORT}`);
});
