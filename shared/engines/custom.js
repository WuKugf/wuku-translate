/**
 * 自定义请求模板引擎
 * 用户可完全定义 URL / Method / Headers / Body 与响应解析路径，
 * 从而接入任意翻译服务（如 LibreTranslate、自建代理、第三方聚合平台）。
 *
 * 可用占位符：
 *   {{text}}        当前单段文本（已做 JSON 字符串转义，不含外层引号）
 *   {{texts}}       批量文本的 JSON 数组
 *   {{textsPlain}}  批量文本按换行拼接
 *   {{sourceLang}} / {{targetLang}} / {{targetLangName}}
 *   {{model}} / {{apiKey}} / {{temperature}} / {{systemPrompt}}
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});

  function escapeForJson(value) {
    return JSON.stringify(String(value == null ? '' : value)).slice(1, -1);
  }

  function buildContext(items, ctx, single) {
    const settings = ctx.settings || {};
    const ai = settings.ai || {};
    return {
      text: escapeForJson(single || items[0] || ''),
      texts: JSON.stringify(items),
      textsPlain: items.join('\n'),
      sourceLang: ctx.source || 'auto',
      targetLang: ctx.target || 'zh-CN',
      targetLangName: WUKU.constants.langName(ctx.target),
      model: ai.model || '',
      apiKey: ai.apiKey || '',
      temperature: String(typeof ai.temperature === 'number' ? ai.temperature : 0.2),
      systemPrompt: escapeForJson(ai.systemPrompt || WUKU.constants.DEFAULT_AI_PROMPT),
      prompt: escapeForJson(ai.systemPrompt || WUKU.constants.DEFAULT_AI_PROMPT)
    };
  }

  function render(template, context) {
    return String(template == null ? '' : template).replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = context[key];
      return value === undefined || value === null ? '' : String(value);
    });
  }

  function normalizeOutput(value, expectedCount) {
    if (typeof value === 'string') {
      if (expectedCount === 1) return [value.trim()];
      const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length === expectedCount) return lines;
      return [value.trim()];
    }
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          for (const key of ['text', 'translation', 'translatedText', 'target', 'content']) {
            if (typeof item[key] === 'string') return item[key];
          }
        }
        return '';
      });
    }
    if (value && typeof value === 'object') {
      for (const key of ['text', 'translation', 'translatedText', 'result']) {
        if (typeof value[key] === 'string') return [value[key]];
      }
    }
    return [];
  }

  async function requestOnce(items, ctx, single) {
    const custom = (ctx.settings && ctx.settings.custom) || {};
    if (!custom.url) throw WUKU.net.makeError('CONFIG', '尚未配置自定义接口地址');

    const context = buildContext(items, ctx, single);
    const url = render(custom.url, context);
    if (!/^https?:\/\//i.test(url)) {
      throw WUKU.net.makeError('CONFIG', '自定义接口地址必须以 http(s):// 开头');
    }
    const allowed = await WUKU.net.hasHostPermission(url);
    if (!allowed) {
      throw WUKU.net.makeError('NEED_PERMISSION', '缺少接口域名访问权限', {
        origin: WUKU.net.originPatternFor(url)
      });
    }

    const method = (custom.method || 'POST').toUpperCase();
    let headers = { 'Content-Type': 'application/json' };
    if (custom.headers && String(custom.headers).trim()) {
      const rendered = render(custom.headers, context);
      let parsed;
      try {
        parsed = JSON.parse(rendered);
      } catch (e) {
        throw WUKU.net.makeError('CONFIG', '自定义请求头不是合法 JSON');
      }
      if (parsed && typeof parsed === 'object') {
        Object.keys(parsed).forEach((key) => {
          headers[key] = String(parsed[key]);
        });
      }
    }

    const bodyText = custom.body ? render(custom.body, context) : '';
    const data = await WUKU.net.request(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : bodyText,
      timeout: 45000,
      retries: 1
    });

    let value = data;
    const path = String(custom.responsePath || '').trim();
    if (path) {
      value = WUKU.util.getByPath(data, path);
    }
    if (value === undefined || value === null || value === '') {
      throw WUKU.net.makeError('CUSTOM_PARSE', '未能按响应路径取到译文', {
        detail: WUKU.util.truncate(JSON.stringify(data || {}), 200)
      });
    }

    const outputs = normalizeOutput(value, items.length);
    if (!outputs.length) {
      throw WUKU.net.makeError('CUSTOM_PARSE', '响应内容无法解析为译文');
    }
    return outputs;
  }

  async function translate(texts, ctx) {
    const custom = (ctx.settings && ctx.settings.custom) || {};

    if (custom.batch) {
      try {
        const outputs = await requestOnce(texts, ctx);
        const results = texts.map((text, index) => outputs[index] || null);
        return { results };
      } catch (e) {
        if (e.code !== 'CONFIG' && e.code !== 'NEED_PERMISSION') {
          // 批量失败时退回逐段，尽量拿到部分结果
          const fallback = await WUKU.util.mapLimit(texts, 3, async (text) => {
            try {
              const outputs = await requestOnce([text], ctx, text);
              return outputs[0] || null;
            } catch (err) {
              return null;
            }
          });
          if (fallback.some((item) => item)) return { results: fallback };
        }
        throw e;
      }
    }

    let firstError = null;
    let failed = 0;
    const results = await WUKU.util.mapLimit(texts, 3, async (text) => {
      if (!text) return '';
      try {
        const outputs = await requestOnce([text], ctx, text);
        return outputs[0] || null;
      } catch (e) {
        failed += 1;
        firstError = firstError || e;
        return null;
      }
    });

    if (failed === results.length && firstError) throw firstError;
    return { results };
  }

  WUKU.engines.register('custom', {
    id: 'custom',
    translate
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
