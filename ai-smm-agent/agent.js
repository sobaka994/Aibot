const axios = require('axios');

class AIAgent {
  constructor(settings) {
    this.settings = settings || {};
    // Base universal prompt instructions
    this.basePrompt = `Ты профессиональный SMM-менеджер и маркетолог. Твоя задача создавать качественный, интересный, человечный контент, адаптированный под аудиторию. Пиши живо, без шаблонных фраз ИИ. Соблюдай требования к формату, вовлеченности и стилистике. Учитывай специфику соцсетей (Telegram, VK, Instagram).`;
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
  }

  async callAI(provider, prompt, systemPrompt = '') {
    const apiKey = this.settings[`api-${provider}`];
    if (!apiKey) {
      throw new Error(`API ключ для ${provider} не настроен.`);
    }

    try {
      switch (provider) {
        case 'chatgpt':
          return await this.callOpenAI(apiKey, prompt, systemPrompt, 'gpt-4o-mini');
        case 'claude':
          return await this.callAnthropic(apiKey, prompt, systemPrompt);
        case 'gemini':
          return await this.callGemini(apiKey, prompt, systemPrompt);
        case 'deepseek':
          return await this.callDeepSeek(apiKey, prompt, systemPrompt);
        case 'qwen':
          return await this.callQwen(apiKey, prompt, systemPrompt);
        case 'perplexity':
          return await this.callPerplexity(apiKey, prompt, systemPrompt);
        default:
          throw new Error(`Провайдер ${provider} не поддерживается.`);
      }
    } catch (error) {
      console.error(`Ошибка при вызове ${provider}:`, error.message);
      throw error;
    }
  }

  async callOpenAI(apiKey, prompt, systemPrompt, model) {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt || this.basePrompt },
          { role: 'user', content: prompt }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content;
  }

  async callAnthropic(apiKey, prompt, systemPrompt) {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        system: systemPrompt || this.basePrompt,
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );
    return response.data.content[0].text;
  }

  async callGemini(apiKey, prompt, systemPrompt) {
    const fullPrompt = `${systemPrompt || this.basePrompt}\n\n${prompt}`;
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: fullPrompt }] }]
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    return response.data.candidates[0].content.parts[0].text;
  }

  async callDeepSeek(apiKey, prompt, systemPrompt) {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt || this.basePrompt },
          { role: 'user', content: prompt }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content;
  }

  async callQwen(apiKey, prompt, systemPrompt) {
    const response = await axios.post(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      {
        model: 'qwen-turbo',
        input: {
          messages: [
            { role: 'system', content: systemPrompt || this.basePrompt },
            { role: 'user', content: prompt }
          ]
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.output.text;
  }

  async callPerplexity(apiKey, prompt, systemPrompt) {
    const response = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model: 'sonar-small-online',
        messages: [
          { role: 'system', content: systemPrompt || this.basePrompt },
          { role: 'user', content: prompt }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content;
  }

  // --- Модуль 1: Поиск новостей ---
  async searchNews(query, provider) {
    const prompt = `Найди самые свежие и актуальные новости по запросу: "${query}". Верни список из 3-5 самых важных новостей с кратким описанием. Не придумывай, используй только реальные факты.`;
    const systemPrompt = `Ты - поисковый агент. Твоя задача находить актуальные и достоверные новости.`;
    return await this.callAI(provider, prompt, systemPrompt);
  }

  // --- Модуль 2: Фильтрация новостей ---
  async filterNews(newsList, tags, provider) {
    const tagsString = tags && tags.length > 0 ? tags.join(', ') : 'актуальность, достоверность, простота, интерес аудитории';
    const prompt = `Вот список новостей:\n${newsList}\n\nВыбери из них ОДНУ самую подходящую новость, опираясь на следующие критерии (теги): ${tagsString}. Объясни почему выбрана именно она, и верни только текст этой новости для дальнейшей работы.`;
    const systemPrompt = `Ты - аналитик и редактор. Твоя задача выбрать самую резонансную и интересную новость из списка по заданным критериям.`;
    return await this.callAI(provider, prompt, systemPrompt);
  }

  // --- Модуль 3: Копирайтер (Создание статьи) ---
  async generatePost(newsText, additionalPrompt, provider) {
    let systemPrompt = this.basePrompt;
    if (additionalPrompt) {
      systemPrompt += `\nДополнительные инструкции: ${additionalPrompt}`;
    }
    const prompt = `На основе следующей новости напиши короткую статью для соцсетей (Telegram, VK, Instagram).\n\nНовость:\n${newsText}\n\nПост должен быть живым, вовлекающим, без подчерка ИИ. Сделай его интересным для читателя, задай вопрос в конце или призови к обсуждению. Форматирование должно быть удобным для чтения (абзацы, эмодзи).`;
    return await this.callAI(provider, prompt, systemPrompt);
  }

  // --- Модуль 4: Генерация изображений ---
  async createImagePrompt(postText, provider) {
    const prompt = `Прочитай следующий пост для соцсетей и напиши ОДИН детальный промпт на английском языке для нейросети (например, Midjourney или DALL-E) для генерации идеальной картинки к этому посту.\n\nПост:\n${postText}\n\nВерни ТОЛЬКО текст промпта на английском языке.`;
    const systemPrompt = `Ты - специалист по генерации промптов для создания изображений.`;
    return await this.callAI(provider, prompt, systemPrompt);
  }

  async createImage(imagePrompt, providerApiKey) {
    // В реальном приложении здесь будет вызов DALL-E 3 или другого API
    // Пока сделаем заглушку через OpenAI (DALL-E 3), если есть ключ chatgpt
    if (!providerApiKey) throw new Error("Ключ для генерации изображений не найден.");

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/images/generations',
        {
          model: "dall-e-3",
          prompt: imagePrompt,
          n: 1,
          size: "1024x1024"
        },
        {
          headers: {
            'Authorization': `Bearer ${providerApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data.data[0].url;
    } catch (e) {
      console.warn("Не удалось сгенерировать изображение (возможно нет доступа к DALL-E).", e.message);
      return null;
    }
  }

  // --- Модуль 5: Оценка качества ---
  async evaluateContent(postText, imageUrl, provider) {
    const prompt = `Оцени следующий пост для соцсетей на готовность к публикации.
Критерии:
1. Вовлеченность и человечность (не звучит как ИИ).
2. Соответствие формату соцсетей.
3. Отсутствие фактических ошибок.

Пост:
${postText}

Есть ли картинка: ${imageUrl ? 'Да' : 'Нет'}

Если пост отличный и готов к публикации, напиши первым словом "ОДОБРЕНО" и дай короткий комментарий.
Если пост требует переделки, напиши "ОТКЛОНЕНО" и укажи причины.`;

    const systemPrompt = `Ты - строгий главный редактор. Твоя задача не пропускать плохой, сухой или шаблонный контент.`;
    const evaluation = await this.callAI(provider, prompt, systemPrompt);

    const isApproved = evaluation.toUpperCase().includes('ОДОБРЕНО');
    return { isApproved, evaluation };
  }

  // --- Модуль 6: Автопубликация ---
  async publishToTelegram(text, imageUrl, token, channelId) {
    if (!token || !channelId) throw new Error("Настройки Telegram не заданы.");

    let url;
    let payload = { chat_id: channelId };

    if (imageUrl) {
      url = `https://api.telegram.org/bot${token}/sendPhoto`;
      payload.photo = imageUrl;
      payload.caption = text;
      payload.parse_mode = 'HTML';
    } else {
      url = `https://api.telegram.org/bot${token}/sendMessage`;
      payload.text = text;
      payload.parse_mode = 'HTML';
    }

    const response = await axios.post(url, payload);
    return response.data;
  }

  async publishToVK(text, imageUrl, token, groupId) {
    if (!token || !groupId) throw new Error("Настройки VK не заданы.");

    // В реальности для фото нужно: getWallUploadServer -> upload -> saveWallPhoto
    // Для упрощения примера публикуем только текст или ссылку на картинку
    const message = imageUrl ? `${text}\n\n${imageUrl}` : text;

    const url = `https://api.vk.com/method/wall.post`;
    const response = await axios.post(url, null, {
      params: {
        owner_id: groupId, // должен быть отрицательным для групп
        message: message,
        access_token: token,
        v: '5.131'
      }
    });

    if (response.data.error) {
      throw new Error(response.data.error.error_msg);
    }
    return response.data.response;
  }

  async publishToInstagram(text, imageUrl, cookies) {
    if (!cookies || cookies.length === 0) {
      throw new Error("Нет сохраненной сессии Instagram. Пожалуйста, авторизуйтесь.");
    }
    // Автопубликация в Instagram через веб-версию (эмуляция браузера)
    // требует сложных библиотек типа puppeteer/playwright, так как API закрыто.
    // В рамках агента мы просто логируем попытку, если есть куки.
    console.log("Cookies найдены:", cookies.length);
    return { success: true, message: "Эмуляция публикации в Instagram (заглушка)." };
  }
}

module.exports = AIAgent;
