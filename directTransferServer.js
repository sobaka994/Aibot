const path = require('path');
const fs = require('fs');

// Basic in-memory store for transfer links
// Format: { [linkId]: { password, savePath, files: { [filename]: { offset, size, status, fd, startTime, transferred } } } }
const sessions = {};

function initDirectTransfer(app, io, express) {
    console.log('[SYSTEM] Инициализация модуля Direct Transfer...');

    const directIo = io.of('/direct');

    directIo.on('connection', (socket) => {
        // --- ADMIN ENDPOINTS ---
        socket.on('admin_join', () => {
            socket.join('admin');
            socket.emit('admin_sessions_sync', sessions);
        });

        socket.on('create_link', (data, callback) => {
            const { linkId, password, savePath } = data;

            if (sessions[linkId]) {
                return callback({ error: 'Ссылка с таким ID уже существует' });
            }

            sessions[linkId] = {
                password: password,
                savePath: savePath || path.join(__dirname, 'temp_downloads'),
                files: {}
            };

            callback({ success: true, linkId });
            directIo.to('admin').emit('admin_sessions_sync', sessions);
        });

        socket.on('delete_link', (linkId) => {
            if (sessions[linkId]) {
                // Закрываем открытые файлы
                Object.values(sessions[linkId].files).forEach(file => {
                    if (file.fd && file.status !== 'completed') {
                        try { fs.closeSync(file.fd); } catch(e){}
                    }
                });
                delete sessions[linkId];
                directIo.to('admin').emit('admin_sessions_sync', sessions);
            }
        });

        socket.on('admin_action', (data) => {
            const { action, linkId, filename } = data;
            const session = sessions[linkId];
            if (session && session.files && session.files[filename]) {
                const fileData = session.files[filename];
                if (action === 'pause') {
                    fileData.status = 'paused';
                } else if (action === 'resume') {
                    fileData.status = 'uploading';
                } else if (action === 'cancel') {
                    if (fileData.fd) {
                        try { fs.closeSync(fileData.fd); } catch(e){}
                    }
                    delete session.files[filename];
                }
                directIo.to('admin').emit('admin_sessions_sync', sessions);
            }
        });

        // --- CLIENT ENDPOINTS ---
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
            if (!session || session.password !== password) {
                return callback({ error: 'Неверная ссылка или пароль' });
            }

            if (session.files && session.files[filename]) {
                const fileData = session.files[filename];
                callback({ success: true, offset: fileData.offset, status: fileData.status });
            } else {
                callback({ success: true, offset: 0, status: 'new' });
            }
        });

        socket.on('client_action', (data, callback) => {
            const { action, linkId, password, filename } = data;
            const session = sessions[linkId];
            if (!session || session.password !== password) {
                return callback({ error: 'Неверная ссылка или пароль' });
            }
            if (session.files && session.files[filename]) {
                const fileData = session.files[filename];
                if (action === 'pause') {
                    fileData.status = 'paused';
                    callback({ success: true });
                } else if (action === 'resume') {
                    fileData.status = 'uploading';
                    callback({ success: true });
                }
                directIo.to('admin').emit('admin_sessions_sync', sessions);
            }
        });


        // --- UPLOAD LOGIC ---
        socket.on('upload_chunk', (data, callback) => {
            const { linkId, password, filename, chunk, offset, totalSize } = data;

            const session = sessions[linkId];
            if (!session || session.password !== password) {
                return callback({ error: 'Неверная ссылка или пароль' });
            }

            // Инициализация записи файла, если её ещё нет
            if (!session.files) session.files = {};
            if (!session.files[filename]) {
                const savePath = session.savePath || path.join(__dirname, 'temp_downloads');
                if (!fs.existsSync(savePath)) {
                    fs.mkdirSync(savePath, { recursive: true });
                }
                // Защита от Path Traversal
                const safeFilename = path.basename(filename);
                const filePath = path.join(savePath, safeFilename);

                try {
                    const fd = fs.openSync(filePath, 'a'); // Открываем файл для добавления
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
                    console.error('[Direct Transfer] Ошибка создания файла:', e);
                    return callback({ error: 'Не удалось создать файл на сервере' });
                }
            }

            const fileData = session.files[filename];

            if (fileData.status === 'paused') {
                return callback({ error: 'Загрузка на паузе' });
            }

            if (offset !== fileData.offset) {
                // Если клиент прислал не тот чанк, который мы ждем, просим его прислать с нужного места
                return callback({ error: 'Смещение не совпадает', expectedOffset: fileData.offset });
            }

            try {
                // Записываем чанк
                fs.writeSync(fileData.fd, chunk, 0, chunk.length, fileData.offset);
                fileData.offset += chunk.length;
                fileData.transferred = fileData.offset;

                // Если файл загружен полностью
                if (fileData.offset >= totalSize) {
                    fileData.status = 'completed';
                    fs.closeSync(fileData.fd);

                    // Обновляем админку
                    directIo.to('admin').emit('transfer_update', {
                        linkId,
                        filename,
                        progress: 100,
                        speed: 0,
                        status: 'completed'
                    });

                    return callback({ success: true, completed: true });
                }

                // Расчет скорости
                const now = Date.now();
                const elapsed = (now - fileData.startTime) / 1000;
                let speed = 0;
                if (elapsed > 0) {
                    speed = fileData.transferred / elapsed; // bytes per second
                }

                const progress = (fileData.offset / totalSize) * 100;

                // Обновляем админку (ограничиваем частоту обновлений, если нужно, но пока шлем каждый чанк)
                directIo.to('admin').emit('transfer_update', {
                    linkId,
                    filename,
                    progress: progress,
                    speed: speed,
                    transferred: fileData.offset,
                    totalSize: totalSize,
                    status: 'uploading'
                });

                callback({ success: true, nextOffset: fileData.offset });

            } catch (e) {
                console.error('[Direct Transfer] Ошибка записи чанка:', e);
                callback({ error: 'Ошибка записи на диск' });
            }
        });
    });
}

module.exports = { initDirectTransfer, sessions };
