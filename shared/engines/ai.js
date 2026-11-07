/**
 * AI 引擎：OpenAI Chat Completions 兼容接口
 * 支持自定义 Base URL、API Key、模型、温度、系统提示词、批量大小与额外请求头。
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});

  function buildEndpoint(baseUrl) {
    const raw = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!raw) {
      throw WUKU.net.makeError('CONFIG', '尚未配置 AI 接口地址（Base URL）');
    }
    if (/\/chat\/completions$/i.test(raw)) return raw;
    return raw + '/chat/completions';
  }

  function buildHeaders(ai) {
    const headers = { 'Content-Type': 'application/json' };
    if (ai.apiKey) headers.Authorization = 'Bearer ' + String(ai.apiKey).trim();
    if (ai.extraHeaders && String(ai.extraHeaders).trim()) {
      let extra;
      try {
        extra = JSON.parse(ai.extraHeaders);
      } catch (e) {
        throw WUKU.net.makeError('CONFIG', '额外请求头不是合法 JSON');
      }
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
        Object.keys(extra).forEach((key) => {
          headers[key] = String(extra[key]);
        });
      }
    }
    return headers;
  }

  function extractContent(data) {
    if (!data || typeof data !== 'object') return '';
    let content = null;
    const choice = Array.isArray(data.choices) ? data.choices[0] : null;
    if (choice) {
      if (choice.message && choice.message.content !== undefined) content = choice.message.content;
      else if (typeof choice.text === 'string') content = choice.text;
    }
    if (content === null && typeof data.output_text === 'string') content = data.output_text;
    if (content === null && Array.isArray(data.content)) content = data.content;
    if (Array.isArray(content)) {
      content = content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part.text === 'string') return part.text;
          return '';
        })
        .join('');
    }
    return typeof content === 'string' ? content : '';
  }

  function toStringItem(item) {
    if (typeof item === 'string') return item;
    if (item == null) return '';
    if (typeof item === 'number') return String(item);
    if (typeof item === 'object') {
      for (const key of ['text', 'translation', 'translated', 'target', 'content']) {
        if (typeof item[key] === 'string') return item[key];
      }
    }
    return '';
  }

  function splitNumberedLines(content) {
    return String(content || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.、)．])\s*/, '').trim())
      .filter((line) => line.length > 0);
  }

  function groupBatches(texts, maxItems, maxChars) {
    const batches = [];
    let start = 0;
    let chars = 0;
    for (let i = 0; i < texts.length; i += 1) {
      const len = texts[i].length;
      const count = i - start;
      if (count > 0 && (count + 1 > maxItems || chars + len > maxChars)) {
        batches.push({ start, items: texts.slice(start, i) });
        start = i;
        chars = 0;
      }
      chars += len;
    }
    if (start < texts.length) batches.push({ start, items: texts.slice(start) });
    return batches;
  }

  async function callBatch(items, ctx) {
    const ai = ctx.settings.ai || {};
    const endpoint = buildEndpoint(ai.baseUrl);
    const allowed = await WUKU.net.hasHostPermission(endpoint);
    if (!allowed) {
      throw WUKU.net.makeError('NEED_PERMISSION', '缺少接口域名访问权限', {
        origin: WUKU.net.originPatternFor(endpoint)
      });
    }

    const langName = WUKU.constants.langName(ctx.target);
    const systemPrompt = String(ai.systemPrompt || WUKU.constants.DEFAULT_AI_PROMPT).replace(
      /\{\{targetLangName\}\}/g,
      langName
    );

    const body = {
      model: ai.model || 'gpt-4o-mini',
      temperature: typeof ai.temperature === 'number' ? ai.temperature : 0.2,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(items, null, 0) }
      ]
    };

    const data = await WUKU.net.request(endpoint, {
      method: 'POST',
      headers: buildHeaders(ai),
      body: JSON.stringify(body),
      timeout: 60000,
      retries: 1
    });

    const content = extractContent(data);
    if (!content) throw WUKU.net.makeError('AI_EMPTY', 'AI 接口未返回内容');

    let items_out = null;
    if (ai.jsonMode !== false) {
      const parsed = WUKU.util.parseJsonArray(content);
      if (Array.isArray(parsed)) items_out = parsed.map(toStringItem);
    }
    if (!items_out) {
      const lines = splitNumberedLines(content);
      if (lines.length === items.length) items_out = lines;
    }
    if (!items_out) {
      throw WUKU.net.makeError('AI_PARSE', 'AI 返回内容无法解析为译文数组', {
        detail: WUKU.util.truncate(content, 200)
      });
    }

    if (items_out.length < items.length) {
      for (let i = items_out.length; i < items.length; i += 1) items_out.push('');
    }
    return items_out.slice(0, items.length);
  }

  async function translate(texts, ctx) {
    const ai = ctx.settings.ai || {};
    const maxItems = WUKU.util.clamp(Number(ai.batchSize) || 12, 1, 40);
    const batches = groupBatches(texts, maxItems, 2200);
    let firstError = null;
    let failureCount = 0;

    const batchResults = await WUKU.util.mapLimit(batches, 2, async (batch) => {
      try {
        return await callBatch(batch.items, ctx);
      } catch (e) {
        failureCount += 1;
        firstError = firstError || e;
        return null;
      }
    });

    const results = new Array(texts.length).fill(null);
    batchResults.forEach((items, index) => {
      if (!items) return;
      const batch = batches[index];
      items.forEach((value, offset) => {
        results[batch.start + offset] = value || null;
      });
    });

    if (failureCount === batches.length && firstError) throw firstError;
    return { results };
  }

  /**
   * 视觉翻译：识别图片中的文字并翻译（漫画 / 截图）。
   * @param {string} dataUrl 图片 data URL
   * @returns {Promise<{pairs: Array<{src:string,dst:string}>, raw: string}>}
   */
  async function translateImage(dataUrl, ctx) {
    const ai = (ctx.settings && ctx.settings.ai) || {};
    const imageCfg = (ctx.settings && ctx.settings.imageTranslate) || {};
    if (!ai.baseUrl) {
      throw WUKU.net.makeError('CONFIG', '图片翻译需要先在设置中配置 AI 接口（Base URL / API Key / 模型）');
    }
    const endpoint = buildEndpoint(ai.baseUrl);
    const headers = buildHeaders(ai);
    const model = String(imageCfg.model || ai.model || '').trim();
    if (!model) {
      throw WUKU.net.makeError('CONFIG', '尚未配置视觉模型，请在设置中填写 AI 模型');
    }
    const target = imageCfg.targetLang || ctx.settings.targetLang || 'zh-CN';
    const targetName = WUKU.constants.langName(target) || target;
    const system = [
      '你是漫画 / 图片翻译引擎。识别图片中的所有文字并翻译成' + targetName + '。',
      '严格按 JSON 返回：{"pairs":[{"src":"原文","dst":"译文"}]}，不要输出 JSON 以外的任何内容。',
      '按从上到下、从左到右的阅读顺序排列；保留原文换行；拟声词、语气词也要翻译；',
      '若图片中没有可识别的文字，返回 {"pairs":[]}。'
    ].join('');
    const payload = {
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请识别并翻译这张图片中的文字，目标语言：' + targetName + '。' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ]
    };
    const data = await WUKU.net.request(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      timeout: 90000,
      retries: 0
    });
    const content = extractContent(data);
    let pairs = [];
    if (content) {
      const cleaned = content.replace(/```(?:json)?/gi, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, end + 1));
          if (parsed && Array.isArray(parsed.pairs)) {
            pairs = parsed.pairs.filter(
              (p) => p && typeof p.src === 'string' && typeof p.dst === 'string' && p.src.trim()
            );
          }
        } catch (e) {
          pairs = [];
        }
      }
    }
    if (!pairs.length && content && content.trim()) {
      // 模型未按 JSON 返回时，把整段文本作为兜底结果
      pairs = [{ src: '', dst: content.trim() }];
    }
    return { pairs, raw: content };
  }

  WUKU.engines.translateImage = translateImage;

  WUKU.engines.register('ai', {
    id: 'ai',
    translate
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
