// marketplaceParser.js - Узел извлечения прямых ссылок на видео с маркетплейсов
const axios = require('axios');

async function extractMarketplaceVideo(url) {
    let directVideoUrl = null;
    let platform = 'UNKNOWN_MARKETPLACE';

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };

    try {
        if (url.includes('ozon.ru')) {
            platform = 'OZON';
            console.log(`[Marketplace Parser] Анализ структуры Ozon URL...`);

            // Выдергиваем ID товара из ссылки регулярным выражением
            const idMatch = url.match(/product\/[^/]+-(\d+)/) || url.match(/product\/(\d+)/);
            if (idMatch && idMatch[1]) {
                const productId = idMatch[1];
                console.log(`[Marketplace Parser] Найден ID товара Ozon: ${productId}. Запрос через публичный API шлюз...`);

                // Делаем запрос к мобильному/публичному API Ozon, который отдает характеристики товара в JSON
                const apiUrl = `https://www.ozon.ru/api/composer-api.bx/v1/page/json?url=%2Fproduct%2F${productId}%2F`;
                const apiResponse = await axios.get(apiUrl, { headers, timeout: 5000 });

                if (apiResponse.data && typeof apiResponse.data === 'object') {
                    const stringifiedData = JSON.stringify(apiResponse.data);
                    // Ищем первую попавшуюся валидную ссылку на mp4 внутри JSON структуры
                    const videoMatch = stringifiedData.match(/https:\/\/[^"']+\.mp4/i);
                    if (videoMatch) {
                        directVideoUrl = videoMatch[0];
                        console.log(`[Marketplace Parser] Видео успешно найдено через API Ozon.`);
                    }
                }
            }

            // Резервный вариант, если через API получить не удалось (прямой скрейпинг HTML)
            if (!directVideoUrl) {
                const { data } = await axios.get(url, { headers, timeout: 5000, maxRedirects: 2 });
                const ozonMatch = data.match(/https:\/\/[^"']+\.mp4/i);
                if (ozonMatch) directVideoUrl = ozonMatch[0];
            }

        } else if (url.includes('wildberries.ru')) {
            platform = 'WILDBERRIES';
            const { data } = await axios.get(url, { headers, timeout: 5000 });
            const wbMatch = data.match(/"video"\s*:\s*"(https:\/\/[^"]+\.mp4)"/i) || data.match(/src\s*=\s*"(https:\/\/[^"]+\.mp4)"/i);
            if (wbMatch) directVideoUrl = wbMatch[1];

        } else if (url.includes('aliexpress.')) {
            platform = 'ALIEXPRESS';
            const { data } = await axios.get(url, { headers, timeout: 5000 });
            const aliMatch = data.match(/"videoUrl"\s*:\s*"([^"]+)"/i) || data.match(/src\s*=\s*"([^"]+\.mp4[^"]*)"/i);
            if (aliMatch) directVideoUrl = aliMatch[1];
        }

    } catch (error) {
        // Финальный перехват: если все методы упали, но в объекте ошибки Ozon вернул HTML-текст
        if (error.response && typeof error.response.data === 'string') {
            const rescueMatch = error.response.data.match(/https:\/\/[^"']+\.mp4/i);
            if (rescueMatch) {
                directVideoUrl = rescueMatch[0];
            }
        }
        if (!directVideoUrl) {
            console.error(`[Marketplace Parser] Не удалось извлечь медиа с ${url}:`, error.message);
        }
    }

    return { platform, directVideoUrl };
}

function isMarketplaceUrl(url) {
    const lowerUrl = url.toLowerCase();
    return lowerUrl.includes('wildberries.ru') || lowerUrl.includes('ozon.ru') || lowerUrl.includes('aliexpress.');
}

module.exports = { extractMarketplaceVideo, isMarketplaceUrl };