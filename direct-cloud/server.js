const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { maxHttpBufferSize: 1e8 }); // 100MB buffer for large chunks

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const PUBLIC_PORT = 4000; // Port for clients and tunneling
const ADMIN_PORT = 4001; // Local-only port for admin interface

// Create a separate express app and server for the admin interface
const adminApp = express();
const adminServer = http.createServer(adminApp);
adminApp.use(express.static(path.join(__dirname, 'public')));
adminApp.use(express.json());

adminApp.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Client routes for links will just serve the index.html and JS will handle the rest
app.get('/t/:linkId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// We need to attach socket.io to both servers so admin and clients can communicate.
// However, to prevent external clients from accessing admin socket endpoints,
// we will verify the origin or use a simple auth token. A simpler approach is to
// attach socket.io to the main server, but strictly validate admin connections.
// For true isolation, we can use an Admin API token.
const ADMIN_TOKEN = Math.random().toString(36).substring(2, 15);
console.log(`[SECURITY] Admin Token generated: ${ADMIN_TOKEN}`);

// Inject token into admin html delivery
adminApp.get('/admin', (req, res) => {
    let html = fs.readFileSync(path.join(__dirname, 'public', 'admin.html'), 'utf8');
    html = html.replace('</head>', `<script>window.ADMIN_TOKEN = "${ADMIN_TOKEN}";</script></head>`);
    res.send(html);
});


server.listen(PUBLIC_PORT, () => {
    console.log(`[Direct Cloud] Публичный сервер (для загрузок) запущен на http://localhost:${PUBLIC_PORT}`);
});

adminServer.listen(ADMIN_PORT, '127.0.0.1', () => {
    console.log(`[Direct Cloud] Панель Хоста (локальная) запущена на http://127.0.0.1:${ADMIN_PORT}/admin`);
    console.log(`[ВАЖНО] Никогда не открывайте порт ${ADMIN_PORT} для интернета!`);
});

const localtunnel = require('localtunnel');

// Sessions store: { linkId: { password, savePath, files: {} } }
const sessions = {};
let currentTunnelUrl = null;

async function startTunnel(subdomain) {
    try {
        const tunnel = await localtunnel({ port: PUBLIC_PORT, subdomain: subdomain });
        currentTunnelUrl = tunnel.url;
        console.log(`[Direct Cloud] Туннель открыт: ${tunnel.url}`);

        tunnel.on('close', () => {
            console.log('[Direct Cloud] Туннель закрыт');
            currentTunnelUrl = null;
        });

        tunnel.on('error', (err) => {
            console.error('[Direct Cloud] Ошибка туннеля:', err);
        });
    } catch (err) {
        console.error('[Direct Cloud] Ошибка запуска туннеля:', err);
    }
}

io.on('connection', (socket) => {

    // --- ADMIN SECURITY WRAPPER ---
    const requireAdmin = (token, callback, action) => {
        if (token !== ADMIN_TOKEN) {
            console.warn(`[SECURITY] Неавторизованная попытка доступа к админ-функции от ${socket.id}`);
            if (callback) callback({ error: 'Unauthorized' });
            return false;
        }
        action();
        return true;
    };

    socket.on('admin_join', (data) => {
        requireAdmin(data?.token, null, () => {
            socket.join('admin');
            socket.emit('admin_sync', { sessions, tunnelUrl: currentTunnelUrl || `http://localhost:${PUBLIC_PORT}` });
        });
    });

    socket.on('start_tunnel', async (data) => {
        requireAdmin(data?.token, null, async () => {
            await startTunnel(data.subdomain);
            io.to('admin').emit('admin_sync', { sessions, tunnelUrl: currentTunnelUrl || `http://localhost:${PUBLIC_PORT}` });
        });
    });

    socket.on('create_link', (data, callback) => {
        requireAdmin(data?.token, callback, () => {
            const { linkId, password, savePath } = data;

            if (sessions[linkId]) {
                return callback({ error: 'Ссылка с таким ID уже существует' });
            }

            sessions[linkId] = {
                password: password,
                savePath: savePath || path.join(__dirname, 'downloads'),
                files: {}
            };

            callback({ success: true, linkId });
            io.to('admin').emit('admin_sync', { sessions, tunnelUrl: currentTunnelUrl || `http://localhost:${PUBLIC_PORT}` });
        });
    });

    socket.on('delete_link', (data) => {
        requireAdmin(data?.token, null, () => {
            const linkId = data.linkId;
            if (sessions[linkId]) {
                Object.values(sessions[linkId].files).forEach(file => {
                    if (file.fd && file.status !== 'completed') {
                        try { fs.closeSync(file.fd); } catch(e){}
                    }
                });
                delete sessions[linkId];
                io.to('admin').emit('admin_sync', { sessions, tunnelUrl: currentTunnelUrl || `http://localhost:${PUBLIC_PORT}` });
            }
        });
    });

    socket.on('admin_action', (data) => {
        requireAdmin(data?.token, null, () => {
            const { action, linkId, filename } = data;
            const session = sessions[linkId];
            if (session && session.files && session.files[filename]) {
                const fileData = session.files[filename];
                if (action === 'pause') fileData.status = 'paused';
                else if (action === 'resume') fileData.status = 'uploading';
                else if (action === 'cancel') {
                    if (fileData.fd) { try { fs.closeSync(fileData.fd); } catch(e){} }
                    delete session.files[filename];
                }
                io.to('admin').emit('admin_sync', { sessions, tunnelUrl: currentTunnelUrl || `http://localhost:${PUBLIC_PORT}` });
            }
        });
    });

    // --- CLIENT ENDPOINTS (No token required, but requires linkId and password) ---
    socket.on('verify_link', (data, callback) => {
        const { linkId, password } = data;
        const session = sessions[linkId];
        if (!session) {
            return callback({ error: 'Ссылка не найдена' });
        }
        if (session.password !== password) {
            return callback({ error: 'Неверный пароль' });
        }
        callback({ success: true });
    });

    socket.on('get_offset', (data, callback) => {
        const { linkId, password, filename } = data;
        const session = sessions[linkId];
        if (!session || session.password !== password) return callback({ error: 'Неверная ссылка или пароль' });

        if (session.files && session.files[filename]) {
            callback({ success: true, offset: session.files[filename].offset, status: session.files[filename].status });
        } else {
            callback({ success: true, offset: 0, status: 'new' });
        }
    });

    socket.on('client_action', (data, callback) => {
        const { action, linkId, password, filename } = data;
        const session = sessions[linkId];
        if (!session || session.password !== password) return callback({ error: 'Неверная ссылка или пароль' });

        if (session.files && session.files[filename]) {
            const fileData = session.files[filename];
            if (action === 'pause') fileData.status = 'paused';
            else if (action === 'resume') fileData.status = 'uploading';
            else if (action === 'cancel') {
                if (fileData.fd) { try { fs.closeSync(fileData.fd); } catch(e){} }
                delete session.files[filename];
            }
            callback({ success: true });
            io.to('admin').emit('admin_sync', { sessions, tunnelUrl: currentTunnelUrl || `http://localhost:${PUBLIC_PORT}` });
        } else if (action === 'cancel') { // already deleted or doesn't exist
            callback({ success: true });
        }
    });

    socket.on('upload_chunk', (data, callback) => {
        const { linkId, password, filename, chunk, offset, totalSize } = data;

        const session = sessions[linkId];
        if (!session || session.password !== password) return callback({ error: 'Неверная ссылка или пароль' });

        if (!session.files) session.files = {};
        if (!session.files[filename]) {
            const savePath = session.savePath || path.join(__dirname, 'downloads');
            if (!fs.existsSync(savePath)) {
                fs.mkdirSync(savePath, { recursive: true });
            }
            const safeFilename = path.basename(filename);
            const filePath = path.join(savePath, safeFilename);

            try {
                const fd = fs.openSync(filePath, 'a');
                session.files[filename] = {
                    offset: fs.statSync(filePath).size,
                    size: totalSize,
                    status: 'uploading',
                    fd: fd,
                    filePath: filePath,
                    startTime: Date.now(),
                    transferred: fs.statSync(filePath).size
                };
            } catch (e) {
                console.error('[Direct Cloud] Ошибка создания файла:', e);
                return callback({ error: 'Не удалось создать файл на сервере' });
            }
        }

        const fileData = session.files[filename];

        if (fileData.status === 'paused') return callback({ error: 'Загрузка на паузе' });

        if (offset !== fileData.offset) {
            return callback({ error: 'Смещение не совпадает', expectedOffset: fileData.offset });
        }

        try {
            fs.writeSync(fileData.fd, chunk, 0, chunk.length, fileData.offset);
            fileData.offset += chunk.length;
            fileData.transferred = fileData.offset;

            if (fileData.offset >= totalSize) {
                fileData.status = 'completed';
                fs.closeSync(fileData.fd);

                io.to('admin').emit('transfer_update', { linkId, filename, progress: 100, speed: 0, status: 'completed' });
                return callback({ success: true, completed: true });
            }

            const now = Date.now();
            const elapsed = (now - fileData.startTime) / 1000;
            let speed = elapsed > 0 ? fileData.transferred / elapsed : 0;
            const progress = (fileData.offset / totalSize) * 100;

            io.to('admin').emit('transfer_update', { linkId, filename, progress, speed, transferred: fileData.offset, totalSize, status: 'uploading' });

            callback({ success: true, nextOffset: fileData.offset });

        } catch (e) {
            console.error('[Direct Cloud] Ошибка записи чанка:', e);
            callback({ error: 'Ошибка записи на диск' });
        }
    });
});
