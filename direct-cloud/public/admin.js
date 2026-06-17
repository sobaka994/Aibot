const socket = io();
let baseTunnelUrl = window.location.origin;

socket.on('connect', () => {
    socket.emit('admin_join', { token: window.ADMIN_TOKEN });
});

socket.on('admin_sync', (data) => {
    baseTunnelUrl = data.tunnelUrl;
    document.getElementById('currentUrlText').innerText = data.tunnelUrl;
    renderSessions(data.sessions);
});

socket.on('transfer_update', (data) => {
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

function startTunnel() {
    const sub = document.getElementById('subdomain').value.trim();
    socket.emit('start_tunnel', { subdomain: sub || undefined, token: window.ADMIN_TOKEN });
}

function createLink() {
    let linkId = document.getElementById('linkId').value.trim();
    const password = document.getElementById('password').value.trim();
    const savePath = document.getElementById('savePath').value.trim();

    if (!password) return alert('Пароль обязателен!');
    if (!linkId) linkId = Math.random().toString(36).substring(2, 8);

    socket.emit('create_link', { linkId, password, savePath, token: window.ADMIN_TOKEN }, (response) => {
        if (response.error) alert(response.error);
        else {
            alert(`Ссылка создана!\nURL: ${baseTunnelUrl}/t/${response.linkId}`);
            document.getElementById('linkId').value = '';
            document.getElementById('password').value = '';
        }
    });
}

function deleteLink(linkId) {
    if (confirm('Вы уверены, что хотите удалить эту сессию?')) {
        socket.emit('delete_link', { linkId, token: window.ADMIN_TOKEN });
    }
}

function sendAction(action, linkId, filename) {
    socket.emit('admin_action', { action, linkId, filename, token: window.ADMIN_TOKEN });
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
        const linkUrl = `${baseTunnelUrl}/t/${linkId}`;

        let filesHtml = '';
        const filenames = Object.keys(session.files || {});

        if (filenames.length === 0) {
            filesHtml = '<p style="color: #666; font-size: 13px; margin-top: 10px;">Ожидание загрузки файлов...</p>';
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
                    <h3 style="margin: 0; margin-bottom: 5px;">ID: ${linkId}</h3>
                    <a href="${linkUrl}" target="_blank" style="font-size: 14px; color: var(--primary); text-decoration: none;">${linkUrl}</a><br>
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 5px;">Пароль: <b>${session.password}</b> | Путь: ${session.savePath}</div>
                </div>
                <button class="btn btn-danger" onclick="deleteLink('${linkId}')">Удалить</button>
            </div>
            ${filesHtml}
        `;
        container.appendChild(sessionEl);
    });
}
