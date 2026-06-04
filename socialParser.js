// socialParser.js - Изолированный узел формирования аргументов для социальных сетей (TikTok, VK, RuTube, Vimeo)
const fs = require('fs');
const path = require('path');

function buildSocialContext(url, params) {
    let { limit = 50, duration = 'all', vFormat = 'all' } = params;
    const numLimit = parseInt(limit) || 50;

    let platform = 'UNKNOWN_SOCIAL';
    const lowerUrl = url.toLowerCase();

    // Детектор платформ
    if (lowerUrl.includes('tiktok.com')) platform = 'TIKTOK';
    else if (lowerUrl.includes('vk.com/video')) platform = 'VK';
    else if (lowerUrl.includes('rutube.ru')) platform = 'RUTUBE';
    else if (lowerUrl.includes('vimeo.com')) platform = 'VIMEO';

    // Базовые аргументы анти-бана
    let args = [
        '--dump-json',
        '--ignore-errors',
        '--no-check-certificate',
        '--force-ipv4'
    ];

    // Специфичные настройки платформ и авторизации
    if (platform === 'TIKTOK') {
        if (fs.existsSync(path.join(__dirname, 'tiktok_cookies.txt'))) {
            args.push('--cookies', 'tiktok_cookies.txt');
        }
        args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    }

    // Блокировка флагов плейлиста для одиночных видео соцсетей
    // (Защита соединения / Обход ошибки 10054)

    // Фильтры длительности и ориентации кадра
    let matchFilters = [];
    if (duration !== 'all') {
        if (duration === 'shorts') matchFilters.push('duration <= 65');
        else if (duration === '3m') matchFilters.push('duration <= 180');
        else if (duration === '5m') matchFilters.push('duration <= 300');
        else if (duration === '10m') matchFilters.push('duration <= 600');
        else if (duration === 'long') matchFilters.push('duration > 65');
    } else {
        if (vFormat === 'vert') matchFilters.push('duration <= 66');
        if (vFormat === 'horz') matchFilters.push('duration > 65');
    }

    matchFilters = [...new Set(matchFilters)];
    if (matchFilters.length > 0) {
        args.push('--match-filter', matchFilters.join(' & '));
    }

    args.push(url);

    return {
        type: 'SINGLE_VIDEO',
        platform: platform,
        target: url,
        ytDlpArgs: args,
        limit: numLimit,
        vFormat: vFormat
    };
}

function isSocialUrl(url) {
    const lowerUrl = url.toLowerCase();
    return lowerUrl.includes('tiktok.com') || lowerUrl.includes('vk.com/video') || lowerUrl.includes('rutube.ru') || lowerUrl.includes('vimeo.com');
}

module.exports = { parse: buildSocialContext, isSocialUrl };