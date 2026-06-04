// queryParser.js - Узел анализа и формирования запросов для платформы YOUTUBE
const fs = require('fs');
const path = require('path');

function buildQueryContext(params) {
    let { q = '', limit = 50, start = 1, sort = 'newest', duration = 'all', vFormat = 'all' } = params;
    q = q.trim();

    const numStart = parseInt(start) || 1;
    const numLimit = parseInt(limit) || 50;

    let isUrl = q.startsWith('http');
    let searchQuery = q;
    let queryType = 'TEXT_SEARCH';
    let platform = 'YOUTUBE';

    // Разбор поисковых URL YouTube
    if (isUrl && q.includes('youtube.com/results')) {
        try {
            const urlObj = new URL(q);
            const extracted = urlObj.searchParams.get('search_query');
            if (extracted) {
                searchQuery = extracted;
                isUrl = false;
            }
        } catch (e) {}
    }

    // Классификация запроса
    if (isUrl) {
        const isMulti = searchQuery.includes('/playlist') ||
            searchQuery.includes('/c/') || searchQuery.includes('/channel/') || searchQuery.includes('/user/') || searchQuery.includes('@');
        queryType = isMulti ? 'CHANNEL_PLAYLIST' : 'SINGLE_VIDEO';
    } else if (searchQuery.startsWith('#')) {
        queryType = 'HASHTAG';
    }

    // Базовые аргументы анти-бана
    let args = [
        '--dump-json',
        '--ignore-errors',
        '--no-check-certificate',
        '--force-ipv4'
    ];

    // Работа с куками аккаунта YouTube
    if (fs.existsSync(path.join(__dirname, 'youtube_cookies.txt'))) {
        args.push('--cookies', 'youtube_cookies.txt');
    }
    args.push('--extractor-args', 'youtube:player_client=android,mweb');

    // Управление флагами плейлистов и пагинацией
    if (queryType !== 'SINGLE_VIDEO') {
        args.push('--flat-playlist');
        const scanLimit = 2000;
        const numEnd = numStart + scanLimit - 1;
        args.push('--playlist-start', numStart.toString(), '--playlist-end', numEnd.toString());
        if (sort === 'newest' && isUrl) {
            args.push('--playlist-reverse');
        }
    }

    // Фильтры длительности
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

    // Формирование финального Target URL
    let targetUrl = searchQuery;
    if (!isUrl) {
        if (queryType === 'HASHTAG' && vFormat === 'vert') {
            const cleanTag = searchQuery.substring(1);
            targetUrl = `https://www.youtube.com/hashtag/${encodeURIComponent(cleanTag)}/shorts`;
        } else {
            let finalQuery = searchQuery;
            if (vFormat === 'vert' && !finalQuery.toLowerCase().includes('short')) {
                finalQuery += ' #shorts';
            }
            targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(finalQuery)}${sort === 'newest' ?
                '&sp=CAI%3D' : ''}`;
        }
    }

    args.push(targetUrl);
    return {
        type: queryType,
        platform: platform,
        target: targetUrl,
        ytDlpArgs: args,
        limit: numLimit,
        vFormat: vFormat
    };
}

module.exports = { parse: buildQueryContext };