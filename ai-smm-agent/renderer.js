const { ipcRenderer } = require('electron');
const AIAgent = require('./agent');

let agent = new AIAgent();
let pipelineTimer = null;
let tags = [];

// DOM Elements
const logContainer = document.getElementById('app-logs');
const statusText = document.getElementById('pipeline-status');
const btnStart = document.getElementById('btn-start-pipeline');
const btnToggleTimer = document.getElementById('btn-toggle-timer');

// Utility to append logs
function log(msg, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${msg}\n`;
  logContainer.textContent += line;
  logContainer.scrollTop = logContainer.scrollHeight;
  if (type === 'error') {
    // Basic error notification
    new Notification('AI SMM Ошибка', { body: msg });
  }
}

// Tab Switching
document.querySelectorAll('.tab-link').forEach(link => {
  link.addEventListener('click', (e) => {
    document.querySelectorAll('.tab-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    e.target.classList.add('active');
    document.getElementById(e.target.dataset.tab).classList.add('active');
  });
});

// Load Settings on Start
async function loadSettings() {
  const settings = await ipcRenderer.invoke('get-settings');
  agent.updateSettings(settings);

  // Populate UI with settings
  if (settings.searchQuery) document.getElementById('search-query').value = settings.searchQuery;
  if (settings.timerInterval) document.getElementById('timer-interval').value = settings.timerInterval;

  if (settings.universalPrompt) document.getElementById('universal-prompt').value = settings.universalPrompt;
  if (settings.tags) {
    tags = settings.tags;
    renderTags();
  }

  // Load API keys
  const aiProviders = ['chatgpt', 'claude', 'gemini', 'deepseek', 'qwen', 'perplexity'];
  aiProviders.forEach(p => {
    if (settings[`api-${p}`]) document.getElementById(`api-${p}`).value = settings[`api-${p}`];
  });

  // Load Module selections
  if (settings.moduleSearch) document.getElementById('ai-module-search').value = settings.moduleSearch;
  if (settings.moduleWriter) document.getElementById('ai-module-writer').value = settings.moduleWriter;
  if (settings.moduleEvaluator) document.getElementById('ai-module-evaluator').value = settings.moduleEvaluator;

  // Load Social
  if (settings.tgToken) document.getElementById('tg-token').value = settings.tgToken;
  if (settings.tgChannel) document.getElementById('tg-channel').value = settings.tgChannel;
  if (settings.vkToken) document.getElementById('vk-token').value = settings.vkToken;
  if (settings.vkGroup) document.getElementById('vk-group').value = settings.vkGroup;

  if (settings['instagram-cookies']) {
    document.getElementById('insta-status').textContent = 'Авторизован (Cookies сохранены)';
    document.getElementById('insta-status').style.color = 'green';
  }

  log('Настройки загружены.');
}

// Save Settings Helpers
async function saveSetting(key, value) {
  await ipcRenderer.invoke('save-settings', key, value);
  agent.updateSettings({ [key]: value });
}

// Pipeline Settings
document.getElementById('btn-save-pipeline').addEventListener('click', async () => {
  await saveSetting('searchQuery', document.getElementById('search-query').value);
  await saveSetting('timerInterval', document.getElementById('timer-interval').value);
  log('Настройки конвейера сохранены.');
});

// AI Settings
document.getElementById('btn-save-ai').addEventListener('click', async () => {
  const p = ['chatgpt', 'claude', 'gemini', 'deepseek', 'qwen', 'perplexity'];
  for (let key of p) {
    await saveSetting(`api-${key}`, document.getElementById(`api-${key}`).value);
  }
  await saveSetting('moduleSearch', document.getElementById('ai-module-search').value);
  await saveSetting('moduleWriter', document.getElementById('ai-module-writer').value);
  await saveSetting('moduleEvaluator', document.getElementById('ai-module-evaluator').value);
  log('Настройки ИИ сохранены.');
});

// Social Settings
document.getElementById('btn-save-social').addEventListener('click', async () => {
  await saveSetting('tgToken', document.getElementById('tg-token').value);
  await saveSetting('tgChannel', document.getElementById('tg-channel').value);
  await saveSetting('vkToken', document.getElementById('vk-token').value);
  await saveSetting('vkGroup', document.getElementById('vk-group').value);
  log('Настройки соцсетей сохранены.');
});

// Instagram Auth
document.getElementById('btn-auth-instagram').addEventListener('click', async () => {
  log('Открытие окна авторизации Instagram...');
  const result = await ipcRenderer.invoke('open-auth-browser', 'instagram');
  if (result.success) {
    log('Instagram cookies сохранены!');
    document.getElementById('insta-status').textContent = 'Авторизован (Cookies сохранены)';
    document.getElementById('insta-status').style.color = 'green';
    // Обновляем настройки агента локально
    agent.updateSettings({ 'instagram-cookies': result.cookies });
  }
});

// Tags Logic
function renderTags() {
  const container = document.getElementById('tags-container');
  container.innerHTML = '';
  tags.forEach((tag, idx) => {
    const d = document.createElement('div');
    d.className = 'tag';
    d.innerHTML = `${tag} <span class="tag-remove" data-idx="${idx}">x</span>`;
    container.appendChild(d);
  });

  document.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = e.target.dataset.idx;
      tags.splice(idx, 1);
      renderTags();
    });
  });
}

document.getElementById('btn-add-tag').addEventListener('click', () => {
  const val = document.getElementById('new-tag').value.trim();
  if (val && !tags.includes(val)) {
    tags.push(val);
    document.getElementById('new-tag').value = '';
    renderTags();
  }
});

document.getElementById('btn-save-prompts').addEventListener('click', async () => {
  await saveSetting('tags', tags);
  await saveSetting('universalPrompt', document.getElementById('universal-prompt').value);
  log('Промпты и теги сохранены.');
});

// Pipeline Logic (Main SMM AI Chain)
async function runPipeline() {
  const settings = agent.settings;
  const query = settings.searchQuery;

  if (!query) {
    log('Ошибка: Запрос для поиска не задан!', 'error');
    return;
  }

  statusText.textContent = 'Работает (Поиск)...';
  log(`--- Запуск конвейера. Запрос: "${query}" ---`);

  try {
    const searchProvider = settings.moduleSearch || 'chatgpt';
    const writerProvider = settings.moduleWriter || 'chatgpt';
    const evalProvider = settings.moduleEvaluator || 'chatgpt';

    // 1. Поиск
    log(`Используем ${searchProvider} для поиска...`);
    const newsList = await agent.searchNews(query, searchProvider);
    log(`Найдено новостей:\n${newsList}`);

    // 2. Фильтрация
    statusText.textContent = 'Работает (Фильтрация)...';
    log(`Используем ${searchProvider} для фильтрации по тегам: ${tags.join(', ')}...`);
    const bestNews = await agent.filterNews(newsList, tags, searchProvider);
    log(`Выбранная новость:\n${bestNews}`);

    // 3. Копирайтер
    statusText.textContent = 'Работает (Написание поста)...';
    log(`Используем ${writerProvider} для написания статьи...`);
    const postText = await agent.generatePost(bestNews, settings.universalPrompt, writerProvider);
    log(`Сгенерированный пост:\n${postText}`);

    // 4. Генерация картинки (Промпт)
    statusText.textContent = 'Работает (Генерация промпта картинки)...';
    const imagePrompt = await agent.createImagePrompt(postText, searchProvider);
    log(`Промпт для изображения:\n${imagePrompt}`);

    // 4.1 Генерация самой картинки (Пока DALL-E, если есть chatgpt api)
    let imageUrl = null;
    if (settings['api-chatgpt']) {
       statusText.textContent = 'Работает (DALL-E 3)...';
       log(`Генерация изображения через DALL-E 3...`);
       imageUrl = await agent.createImage(imagePrompt, settings['api-chatgpt']);
       if (imageUrl) log(`Изображение готово: ${imageUrl}`);
    }

    // 5. Оценка
    statusText.textContent = 'Работает (Оценка качества)...';
    log(`Используем ${evalProvider} для оценки...`);
    const { isApproved, evaluation } = await agent.evaluateContent(postText, imageUrl, evalProvider);
    log(`Результат оценки:\n${evaluation}`);

    if (!isApproved) {
      log('Контент отклонен редактором. Требуется повторный запуск конвейера (здесь можно сделать рекурсию).', 'error');
      statusText.textContent = 'Завершено с ошибкой (Отклонено)';
      return;
    }

    // 6. Публикация
    statusText.textContent = 'Работает (Публикация)...';

    if (settings.tgToken && settings.tgChannel) {
      log('Публикация в Telegram...');
      await agent.publishToTelegram(postText, imageUrl, settings.tgToken, settings.tgChannel);
      log('Успешно опубликовано в Telegram!');
    }

    if (settings.vkToken && settings.vkGroup) {
      log('Публикация в VK...');
      await agent.publishToVK(postText, imageUrl, settings.vkToken, settings.vkGroup);
      log('Успешно опубликовано в VK!');
    }

    if (settings['instagram-cookies']) {
      log('Эмуляция публикации в Instagram...');
      await agent.publishToInstagram(postText, imageUrl, settings['instagram-cookies']);
      log('Эмуляция Instagram завершена.');
    }

    statusText.textContent = 'Ожидание...';
    log('--- Конвейер успешно завершен ---');

  } catch (err) {
    log(`Критическая ошибка в конвейере: ${err.message}`, 'error');
    statusText.textContent = 'Ошибка!';
  }
}

// Timer Controls
btnStart.addEventListener('click', runPipeline);

btnToggleTimer.addEventListener('click', () => {
  if (pipelineTimer) {
    clearInterval(pipelineTimer);
    pipelineTimer = null;
    btnToggleTimer.textContent = 'Включить автозапуск';
    log('Автозапуск отключен.');
  } else {
    const intervalMin = parseInt(document.getElementById('timer-interval').value) || 60;
    log(`Автозапуск включен. Интервал: ${intervalMin} минут.`);
    btnToggleTimer.textContent = 'Отключить автозапуск';
    pipelineTimer = setInterval(runPipeline, intervalMin * 60 * 1000);
    // Сразу запускаем первый раз
    runPipeline();
  }
});

// Init
loadSettings();
