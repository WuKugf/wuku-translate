/**
 * Google 免费翻译接口适配器
 * 使用 translate_a/single（公开接口，无需密钥），POST 避免 URL 长度限制。
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});

  const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
  const MAX_LEN = 4500;

  function normalizeSource(source) {
    const src = String(source || 'auto');
    if (!src || src === 'auto' || src === 'unknown') return 'auto';
    if (src === 'zh') return 'zh-CN';
    if (src === 'cs') return 'cs';
    return src;
  }

  async function requestOne(text, ctx) {
    const body = new URLSearchParams();
    body.set('client', 'gtx');
    body.set('sl', normalizeSource(ctx.source));
    body.set('tl', ctx.target || 'zh-CN');
    body.set('dt', 't');
    body.set('dj', '1');
    body.set('q', text);

    const data = await WUKU.net.request(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
      timeout: 20000,
      retries: 1
    });

    if (!data || typeof data !== 'object') {
      throw WUKU.net.makeError('PARSE', 'Google 翻译返回格式异常');
    }
    const sentences = Array.isArray(data.sentences) ? data.sentences : [];
    const translated = sentences
      .map((item) => (item && typeof item.trans === 'string' ? item.trans : ''))
      .join('')
      .trim();

    if (!translated) throw WUKU.net.makeError('EMPTY', 'Google 翻译未返回内容');
    return { text: translated, source: data.src || '' };
  }

  async function translate(texts, ctx) {
    let detectedSource = '';
    let firstError = null;
    let failed = 0;

    const results = await WUKU.util.mapLimit(texts, 6, async (text) => {
      if (!text) return '';
      if (text.length > MAX_LEN) {
        // 超长文本切句后逐段翻译再拼接
        const parts = WUKU.util.splitSentences(text);
        const chunks = [];
        let buffer = '';
        for (const part of parts) {
          if ((buffer + part).length > MAX_LEN) {
            if (buffer) chunks.push(buffer);
            buffer = part;
          } else {
            buffer += part;
          }
        }
        if (buffer) chunks.push(buffer);
        try {
          const pieces = await WUKU.util.mapLimit(chunks, 3, (chunk) => requestOne(chunk, ctx));
          return pieces.map((p) => p.text).join(' ');
        } catch (e) {
          failed += 1;
          firstError = firstError || e;
          return null;
        }
      }
      try {
        const result = await requestOne(text, ctx);
        if (!detectedSource && result.source) detectedSource = result.source;
        return result.text;
      } catch (e) {
        failed += 1;
        firstError = firstError || e;
        return null;
      }
    });

    if (failed === results.length && firstError) throw firstError;
    return { results, detectedSource };
  }

  WUKU.engines = WUKU.engines || {};
  WUKU.engines.register('google', {
    id: 'google',
    translate
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
