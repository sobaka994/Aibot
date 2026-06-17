const socket = io('/direct');

socket.on('connect', () => {
    socket.emit('admin_join');
});

socket.on('admin_sessions_sync', (sessions) => {
    renderSessions(sessions);
});

socket.on('transfer_update', (data) => {
    // Оптимизация: обновляем только прогресс-бар, чтобы не перерисовывать весь DOM каждую секунду
    const progressEl = document.getElementById(`progress-${data.linkId}-${data.filename}`);
    const speedEl = document.getElementById(`speed-${data.linkId}-${data.filename}`);
    const statusEl = document.getElementById(`status-${data.linkId}-${data.filename}`);

    if (progressEl) progressEl.style.width = `${data.progress}%`;

    if (speedEl) {
        const mbps = (data.speed / 1024 / 1024).toFixed(2);
        speedEl.innerText = `${mbps} MB/s`;
    }

    if (statusEl) {
        statusEl.innerText = data.status === 'completed' ? 'Завершено' : 'Загрузка...';
        if (data.status === 'completed') statusEl.style.color = 'green';
    }
});

function createLink() {
    let linkId = document.getElementById('linkId').value.trim();
    const password = document.getElementById('password').value.trim();
    const savePath = document.getElementById('savePath').value.trim();

    if (!password) {
        alert('Пароль обязателен!');
        return;
    }

    if (!linkId) {
        linkId = Math.random().toString(36).substring(2, 8);
    }

    socket.emit('create_link', { linkId, password, savePath }, (response) => {
        if (response.error) {
            alert(response.error);
        } else {
            alert(`Ссылка создана!\nURL: ${window.location.origin}/direct/${response.linkId}`);
            document.getElementById('linkId').value = '';
            document.getElementById('password').value = '';
        }
    });
}

function deleteLink(linkId) {
    if (confirm('Вы уверены, что хотите удалить эту сессию?')) {
        socket.emit('delete_link', linkId);
    }
}

function sendAction(action, linkId, filename) {
    socket.emit('admin_action', { action, linkId, filename });
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function renderSessions(sessions) {
    const container = document.getElementById('sessionsList');
    container.innerHTML = '';

    const linkIds = Object.keys(sessions);
    if (linkIds.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted)">Нет активных сессий</p>';
        return;
    }

    linkIds.forEach(linkId => {
        const session = sessions[linkId];
        const linkUrl = `${window.location.origin}/direct/${linkId}`;

        let filesHtml = '';
        const filenames = Object.keys(session.files || {});

        if (filenames.length === 0) {
            filesHtml = '<p style="color: #666; font-size: 13px; margin-top: 10px;">Файлы пока не загружаются</p>';
        } else {
            filenames.forEach(filename => {
                const file = session.files[filename];
                const progress = (file.offset / file.size) * 100 || 0;

                filesHtml += `
                    <div class="file-item">
                        <div class="flex-between">
                            <strong>${filename}</strong>
                            <span id="status-${linkId}-${filename}" style="font-size: 12px; font-weight: bold; color: ${file.status === 'completed' ? 'green' : (file.status === 'paused' ? 'orange' : 'var(--text)')}">${file.status}</span>
                        </div>
                        <div style="font-size: 12px; margin-top: 5px; display: flex; justify-content: space-between;">
                            <span>${formatBytes(file.size)}</span>
                            <span id="speed-${linkId}-${filename}">0 MB/s</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" id="progress-${linkId}-${filename}" style="width: ${progress}%"></div>
                        </div>
                        <div class="controls">
                            ${file.status !== 'completed' ? `
                                ${file.status === 'paused' ?
                                    `<button class="btn btn-primary" style="padding: 5px 10px; font-size: 12px;" onclick="sendAction('resume', '${linkId}', '${filename}')">Возобновить</button>` :
                                    `<button class="btn btn-warning" style="padding: 5px 10px; font-size: 12px;" onclick="sendAction('pause', '${linkId}', '${filename}')">Пауза</button>`
                                }
                                <button class="btn btn-danger" style="padding: 5px 10px; font-size: 12px;" onclick="sendAction('cancel', '${linkId}', '${filename}')">Отмена</button>
                            ` : ''}
                        </div>
                    </div>
                `;
            });
        }

        const sessionEl = document.createElement('div');
        sessionEl.className = 'session-item';
        sessionEl.innerHTML = `
            <div class="flex-between">
                <div>
                    <h3 style="margin: 0;">ID: ${linkId}</h3>
                    <a href="${linkUrl}" target="_blank" style="font-size: 12px; color: var(--primary); text-decoration: none;">${linkUrl}</a><br>
                    <span style="font-size: 12px; color: var(--text-muted);">Пароль: ${session.password} | Путь: ${session.savePath}</span>
                </div>
                <button class="btn btn-danger" onclick="deleteLink('${linkId}')">Удалить</button>
            </div>
            ${filesHtml}
        `;
        container.appendChild(sessionEl);
    });
}
