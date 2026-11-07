/**
 * MyMemory 免费接口适配器（备用线路）
 * 特点：限流严格、单次约 500 字符，需要源语言；作为 Google 失败后的兜底。
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});

  const ENDPOINT = 'https://api.mymemory.translated.net/get';
  const MAX_LEN = 450;

  function sourceFor(text, ctx) {
    if (ctx.source && ctx.source !== 'auto' && ctx.source !== 'unknown') {
      return ctx.source === 'zh' ? 'zh-CN' : ctx.source;
    }
    const guessed = WUKU.langDetect.guessSourceLang(text, 'en');
    return guessed === 'zh' ? 'zh-CN' : guessed;
  }

  function splitChunks(text) {
    if (text.length <= MAX_LEN) return [text];
    const parts = WUKU.util.splitSentences(text);
    const chunks = [];
    let buffer = '';
    for (const part of parts) {
      if ((buffer + part).length > MAX_LEN) {
        if (buffer) chunks.push(buffer);
        buffer = part.slice(0, MAX_LEN);
      } else {
        buffer += part;
      }
    }
    if (buffer) chunks.push(buffer);
    return chunks;
  }

  async function requestOne(text, ctx) {
    const source = sourceFor(text, ctx);
    const target = ctx.target || 'zh-CN';
    const url =
      ENDPOINT +
      '?q=' + encodeURIComponent(text) +
      '&langpair=' + encodeURIComponent(source + '|' + target);

    const data = await WUKU.net.request(url, { method: 'GET', timeout: 20000, retries: 1 });
    if (!data || typeof data !== 'object') {
      throw WUKU.net.makeError('PARSE', 'MyMemory 返回格式异常');
    }
    const status = Number(data.responseStatus);
    const translated = data.responseData && data.responseData.translatedText;
    if (status && status !== 200) {
      throw WUKU.net.makeError(
        status === 429 ? 'RATE_LIMIT' : 'HTTP_' + status,
        'MyMemory 返回错误（' + status + '）'
      );
    }
    if (!translated) throw WUKU.net.makeError('EMPTY', 'MyMemory 未返回译文');
    if (/MYMEMORY WARNING/i.test(translated)) {
      throw WUKU.net.makeError('RATE_LIMIT', 'MyMemory 免费额度已用尽');
    }
    return String(translated).trim();
  }

  async function translate(texts, ctx) {
    let firstError = null;
    let failed = 0;

    const results = await WUKU.util.mapLimit(texts, 4, async (text) => {
      if (!text) return '';
      try {
        const chunks = splitChunks(text);
        if (chunks.length <= 1) return await requestOne(chunks[0] || text, ctx);
        const pieces = await WUKU.util.mapLimit(chunks, 2, (chunk) => requestOne(chunk, ctx));
        return pieces.join(' ');
      } catch (e) {
        failed += 1;
        firstError = firstError || e;
        return null;
      }
    });

    if (failed === results.length && firstError) throw firstError;
    return { results };
  }

  WUKU.engines.register('mymemory', {
    id: 'mymemory',
    translate
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
