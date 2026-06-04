const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const historyPath = path.join(__dirname, 'history.log');
const blTxtPath = path.join(__dirname, 'blacklist.txt');
const blJsonPath = path.join(__dirname, 'blacklist.json');

// --- АВТОМАТИЧЕСКАЯ УСТАНОВКА FFMPEG ---
function checkAndDownloadFFmpeg() {
    console.log('\n[SYSTEM] Проверка наличия FFmpeg и FFprobe...');
    const ffmpegExists = fs.existsSync(path.join(__dirname, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')) || fs.existsSync('/usr/bin/ffmpeg') || fs.existsSync('/usr/local/bin/ffmpeg');
    const ffprobeExists = fs.existsSync(path.join(__dirname, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')) || fs.existsSync('/usr/bin/ffprobe') || fs.existsSync('/usr/local/bin/ffprobe');

    if (ffmpegExists && ffprobeExists) {
        console.log('[SYSTEM] FFmpeg и FFprobe найдены. Модули Content Pack и SponsorBlock активны.\n');
        global.ffmpegAvailable = true;
        return;
    }

    console.log('[SYSTEM] Зависимости не найдены. Начинаю автоматическую загрузку FFmpeg (это займет время)...');
    try {
        const psScript = `
            $ErrorActionPreference = 'Stop'
            Write-Host "[DOWNLOAD] Скачивание архива FFmpeg с официального зеркала..."
            Invoke-WebRequest -Uri "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile "ffmpeg.zip" -UseBasicParsing
            Write-Host "[EXTRACT] Распаковка архива..."
            Expand-Archive -Path "ffmpeg.zip" -DestinationPath "ffmpeg_temp" -Force
            Write-Host "[INSTALL] Перемещение бинарных файлов в корень проекта..."
            Move-Item -Path "ffmpeg_temp\\*\\bin\\*.exe" -Destination ".\\" -Force
            Write-Host "[CLEANUP] Очистка временных файлов установки..."
            Remove-Item "ffmpeg.zip", "ffmpeg_temp" -Recurse -Force
        `;
        const output = execSync(`powershell -NoProfile -Command "${psScript}"`, { encoding: 'utf8' });
        if (output) {
            output.split('\n').forEach(line => {
                if(line.trim()) console.log(line.trim());
            });
        }
        console.log('[SYSTEM] FFmpeg успешно установлен! Расширенные функции активированы.\n');
        global.ffmpegAvailable = true;
    } catch (err) {
        console.log('[ERROR] Сбой при установке FFmpeg: ' + err.message);
        console.log('[SYSTEM] Инструменты сложной обработки видео (Content Pack, SponsorBlock) будут отключены. Сервер продолжает работу.\n');
        global.ffmpegAvailable = false;
    }
}

function writeToHistory(message) {
    const timestamp = new Date().toLocaleString('ru-RU');
    fs.appendFileSync(historyPath, `[${timestamp}] ${message}\n`, 'utf8');
}

function migrateOldBlacklist() {
    if (fs.existsSync(blTxtPath) && !fs.existsSync(blJsonPath)) {
        const lines = fs.readFileSync(blTxtPath, 'utf8').split('\n').map(l => l.trim()).filter(l => l);
        const arr = lines.map(line => {
            if (line.startsWith('@')) return { id: Date.now() + Math.random(), type: 'channel', value: line.substring(1), comment: 'Старый список' };
            if (line.startsWith('#')) return { id: Date.now() + Math.random(), type: 'tag', value: line.substring(1), comment: 'Старый список' };
            return { id: Date.now() + Math.random(), type: 'word', value: line, comment: 'Старый список' };
        });
        fs.writeFileSync(blJsonPath, JSON.stringify(arr, null, 2), 'utf8');
    }
}

function getBlacklist() {
    migrateOldBlacklist();
    if (!fs.existsSync(blJsonPath)) return [];
    try {
        return JSON.parse(fs.readFileSync(blJsonPath, 'utf8'));
    } catch (e) {
        return [];
    }
}

function saveBlacklist(arr) {
    fs.writeFileSync(blJsonPath, JSON.stringify(arr, null, 2), 'utf8');
}

function isBlacklisted(itemJson, blacklistArr) {
    if (!blacklistArr || !Array.isArray(blacklistArr) || blacklistArr.length === 0) return false;
    const title = String(itemJson.title || itemJson.fulltitle || '').toLowerCase();
    const uploader = String(itemJson.uploader || itemJson.channel || '').toLowerCase();
    for (const rule of blacklistArr) {
        let val = '';
        let type = 'word';

        if (typeof rule === 'string') {
            if (rule.startsWith('@')) { type = 'channel'; val = rule.substring(1).toLowerCase(); }
            else if (rule.startsWith('#')) { type = 'tag'; val = rule.substring(1).toLowerCase(); }
            else { type = 'word'; val = rule.toLowerCase(); }
        }
        else if (typeof rule === 'object' && rule !== null && rule.value) {
            val = String(rule.value).toLowerCase();
            type = rule.type;
        } else {
            continue;
        }

        val = val.trim();
        if (!val || val === '') continue;
        if (type === 'channel' && uploader.includes(val)) return true;
        if (type === 'tag' && title.includes('#' + val)) return true;
        if (type === 'word' && title.includes(val)) return true;
    }
    return false;
}

module.exports = { writeToHistory, getBlacklist, saveBlacklist, isBlacklisted, checkAndDownloadFFmpeg };