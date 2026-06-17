const socket = io('/direct');
const linkId = window.location.pathname.split('/').pop();
let currentPassword = '';

function verifyPassword() {
    const pwd = document.getElementById('passwordInput').value.trim();
    if (!pwd) return;

    socket.emit('verify_link', { linkId, password: pwd }, (response) => {
        if (response.error) {
            document.getElementById('authError').innerText = response.error;
        } else {
            currentPassword = pwd;
            document.getElementById('authSection').classList.add('hidden');
            document.getElementById('uploadSection').classList.remove('hidden');
        }
    });
}

let selectedFile = null;
let uploadPaused = false;
let uploadCancelled = false;
let currentOffset = 0;
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
let startTime = 0;

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    selectedFile = file;
    document.getElementById('fileNameDisplay').innerText = file.name;
    document.getElementById('uploadControls').classList.remove('hidden');
    document.getElementById('uploadSize').innerText = `0 / ${formatBytes(file.size)}`;

    // Сброс состояния
    currentOffset = 0;
    uploadPaused = false;
    uploadCancelled = false;
    updateUI('ready');
}

function updateUI(state) {
    const btnStart = document.getElementById('btnStart');
    const btnPause = document.getElementById('btnPause');
    const btnCancel = document.getElementById('btnCancel');
    const statusText = document.getElementById('uploadStatus');

    if (state === 'ready') {
        btnStart.classList.remove('hidden');
        btnPause.classList.add('hidden');
        btnCancel.classList.add('hidden');
        statusText.innerText = 'Готов к загрузке';
        document.getElementById('uploadProgress').style.width = '0%';
        document.getElementById('uploadPercent').innerText = '0%';
    } else if (state === 'uploading') {
        btnStart.classList.add('hidden');
        btnPause.classList.remove('hidden');
        btnPause.innerText = 'Пауза';
        btnCancel.classList.remove('hidden');
        statusText.innerText = 'Идет загрузка...';
    } else if (state === 'paused') {
        btnPause.innerText = 'Возобновить';
        statusText.innerText = 'На паузе';
    } else if (state === 'completed') {
        btnStart.classList.add('hidden');
        btnPause.classList.add('hidden');
        btnCancel.classList.add('hidden');
        statusText.innerText = 'Загрузка завершена!';
        statusText.style.color = 'green';
        document.getElementById('uploadProgress').style.width = '100%';
        document.getElementById('uploadPercent').innerText = '100%';
    }
}

function readAndSendChunk() {
    if (uploadPaused || uploadCancelled || !selectedFile) return;

    if (currentOffset >= selectedFile.size) {
        updateUI('completed');
        return;
    }

    const reader = new FileReader();
    const chunk = selectedFile.slice(currentOffset, currentOffset + CHUNK_SIZE);

    reader.onload = function(e) {
        if (uploadPaused || uploadCancelled) return;

        socket.emit('upload_chunk', {
            linkId,
            password: currentPassword,
            filename: selectedFile.name,
            chunk: e.target.result,
            offset: currentOffset,
            totalSize: selectedFile.size
        }, (res) => {
            if (res.error) {
                if (res.expectedOffset !== undefined) {
                    currentOffset = res.expectedOffset;
                    readAndSendChunk();
                } else if (res.error === 'Загрузка на паузе') {
                    // Ждем
                } else {
                    alert('Ошибка: ' + res.error);
                }
                return;
            }

            if (res.completed) {
                updateUI('completed');
                return;
            }

            currentOffset = res.nextOffset;

            // Обновляем статистику
            const progress = (currentOffset / selectedFile.size) * 100;
            document.getElementById('uploadProgress').style.width = `${progress}%`;
            document.getElementById('uploadPercent').innerText = `${progress.toFixed(1)}%`;
            document.getElementById('uploadSize').innerText = `${formatBytes(currentOffset)} / ${formatBytes(selectedFile.size)}`;

            const elapsed = (Date.now() - startTime) / 1000;
            if (elapsed > 0) {
                const speed = currentOffset / elapsed;
                document.getElementById('uploadSpeed').innerText = `${formatBytes(speed)}/s`;
            }

            // Следующий чанк
            readAndSendChunk();
        });
    };
    reader.readAsArrayBuffer(chunk);
}

function startUpload() {
    if (!selectedFile) return;

    // Спрашиваем сервер, есть ли уже этот файл (чтобы продолжить)
    socket.emit('get_offset', { linkId, password: currentPassword, filename: selectedFile.name }, (res) => {
        if (res.error) {
            alert(res.error);
            return;
        }

        currentOffset = res.offset || 0;
        startTime = Date.now() - (currentOffset / (1024*1024)); // Приблизительная корректировка времени
        uploadPaused = false;
        uploadCancelled = false;

        socket.emit('client_action', { action: 'resume', linkId, password: currentPassword, filename: selectedFile.name }, () => {
            updateUI('uploading');
            readAndSendChunk();
        });
    });
}

function togglePause() {
    uploadPaused = !uploadPaused;
    if (uploadPaused) {
        socket.emit('client_action', { action: 'pause', linkId, password: currentPassword, filename: selectedFile.name }, () => {
            updateUI('paused');
        });
    } else {
        socket.emit('client_action', { action: 'resume', linkId, password: currentPassword, filename: selectedFile.name }, () => {
            updateUI('uploading');
            startTime = Date.now() - (currentOffset / (parseFloat(document.getElementById('uploadSpeed').innerText) || 1));
            readAndSendChunk();
        });
    }
}

function cancelUpload() {
    if (confirm('Отменить загрузку?')) {
        uploadCancelled = true;
        socket.emit('client_action', { action: 'cancel', linkId, password: currentPassword, filename: selectedFile.name }, () => {
            selectedFile = null;
            document.getElementById('fileInput').value = '';
            document.getElementById('uploadControls').classList.add('hidden');
            document.getElementById('fileNameDisplay').innerText = 'Нажмите или перетащите файл сюда';
        });
    }
}

// Drag and drop events
const dropZone = document.getElementById('fileDropZone');

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--primary)';
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border)';
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border)';

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        document.getElementById('fileInput').files = e.dataTransfer.files;
        handleFileSelect({ target: { files: e.dataTransfer.files } });
    }
});

// Auto-resume on reconnect
socket.on('connect', () => {
    if (selectedFile && currentPassword && !uploadPaused && !uploadCancelled) {
        console.log('Переподключение, попытка возобновить загрузку...');
        startUpload();
    }
});

socket.on('disconnect', () => {
    if (selectedFile && !uploadPaused && !uploadCancelled && currentOffset < selectedFile.size) {
        console.log('Соединение разорвано. Ожидание восстановления...');
        document.getElementById('uploadStatus').innerText = 'Переподключение...';
    }
});
