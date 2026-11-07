/**
 * 引擎适配层调度
 * 统一入口：缓存命中 → 主引擎 → 降级链 → 结果回填与统计。
 * 新增引擎只需实现 { id, translate(texts, ctx) } 并调用 register。
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});

  const registry = {};

  function register(id, impl) {
    if (!id || !impl || typeof impl.translate !== 'function') return;
    registry[id] = impl;
  }

  function get(id) {
    return registry[id] || null;
  }

  function has(id) {
    return !!registry[id];
  }

  function list() {
    return WUKU.constants.ENGINE_META
      ? Object.keys(registry).map((id) => Object.assign({ id }, WUKU.constants.engineMeta(id)))
      : Object.keys(registry).map((id) => ({ id }));
  }

  function fallbackChain(primary, settings) {
    if (!settings || settings.fallback === false) return [];
    const map = {
      ai: ['google', 'mymemory'],
      custom: ['google', 'mymemory'],
      google: ['mymemory'],
      mymemory: ['google']
    };
    return (map[primary] || []).filter((id) => has(id) && id !== primary);
  }

  /**
   * @param {object} options
   * @param {string[]} options.texts
   * @param {string} options.engineId
   * @param {string} options.source
   * @param {string} options.target
   * @param {object} [options.settings]
   * @param {boolean} [options.bypassCache]
   * @returns {Promise<{results:string[], engineUsed:string, degraded:boolean, degradedReason:string|null}>}
   */
  async function translateBatch(options) {
    const opts = options || {};
    const cfg = opts.settings || (await WUKU.settings.get());
    const requestedId = opts.engineId || cfg.engine || 'google';
    const engine = get(requestedId);
    if (!engine) {
      throw WUKU.net.makeError('CONFIG', '未知翻译引擎：' + requestedId);
    }

    const source = opts.source || 'auto';
    const target = opts.target || cfg.targetLang || 'zh-CN';
    const texts = (opts.texts || []).map((text) => String(text == null ? '' : text));
    const results = new Array(texts.length).fill(null);

    const cacheEnabled = !opts.bypassCache && cfg.cache && cfg.cache.enabled !== false;
    const keys = texts.map((text) => WUKU.cache.makeKey(requestedId, source, target, text));

    const pending = [];
    if (cacheEnabled) {
      const cached = await WUKU.cache.getMany(keys);
      texts.forEach((text, index) => {
        if (!text) {
          results[index] = '';
          return;
        }
        if (cached[index] !== null && cached[index] !== undefined) {
          results[index] = cached[index];
        } else {
          pending.push(index);
        }
      });
    } else {
      texts.forEach((text, index) => {
        if (!text) results[index] = '';
        else pending.push(index);
      });
    }

    let engineUsed = requestedId;
    let degraded = false;
    let degradedReason = null;

    if (pending.length > 0) {
      const pendingTexts = pending.map((index) => texts[index]);
      let outcome = null;
      let primaryError = null;

      try {
        outcome = await engine.translate(pendingTexts, {
          source,
          target,
          settings: cfg,
          requestedId
        });
      } catch (e) {
        primaryError = e;
      }

      const usable = (result) =>
        result && Array.isArray(result.results) && result.results.some((item) => item && String(item).trim());

      if (!usable(outcome)) {
        for (const fallbackId of fallbackChain(requestedId, cfg)) {
          try {
            const fallbackOutcome = await get(fallbackId).translate(pendingTexts, {
              source,
              target,
              settings: cfg,
              requestedId: fallbackId
            });
            if (usable(fallbackOutcome)) {
              outcome = fallbackOutcome;
              engineUsed = fallbackId;
              degraded = true;
              degradedReason = primaryError ? primaryError.message || String(primaryError) : '主引擎未返回有效结果';
              break;
            }
          } catch (e) {
            if (!primaryError) primaryError = e;
          }
        }
      }

      if (!usable(outcome)) {
        throw primaryError || WUKU.net.makeError('EMPTY', '翻译引擎未返回有效结果');
      }

      const cacheRecords = [];
      pending.forEach((textIndex, offset) => {
        const raw = outcome.results[offset];
        const value = raw && String(raw).trim() ? String(raw).trim() : texts[textIndex];
        results[textIndex] = value;
        if (cacheEnabled && value && value !== texts[textIndex]) {
          cacheRecords.push({ key: keys[textIndex], value });
        }
      });

      if (cacheRecords.length) {
        await WUKU.cache.putMany(cacheRecords, { maxEntries: cfg.cache && cfg.cache.maxEntries });
      }
    }

    return {
      results,
      engineUsed,
      degraded,
      degradedReason
    };
  }

  async function translateText(text, options) {
    const opts = Object.assign({}, options, { texts: [String(text == null ? '' : text)] });
    const outcome = await translateBatch(opts);
    return {
      text: outcome.results[0],
      engineUsed: outcome.engineUsed,
      degraded: outcome.degraded,
      degradedReason: outcome.degradedReason
    };
  }

  WUKU.engines = {
    register,
    get,
    has,
    list,
    fallbackChain,
    translateBatch,
    translateText
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
