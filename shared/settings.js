/**
 * 配置读写与站点规则解析
 * 所有页面（content / popup / options / service worker）共享同一份 chrome.storage.local。
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});

  const STORAGE_KEY = WUKU.constants.STORAGE_SETTINGS;

  async function get() {
    let stored = {};
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      stored = result[STORAGE_KEY] || {};
    } catch (e) {
      stored = {};
    }
    return WUKU.util.deepMerge(WUKU.constants.DEFAULT_SETTINGS, stored);
  }

  async function set(settings) {
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
    return settings;
  }

  async function patch(partial) {
    const current = await get();
    const next = WUKU.util.deepMerge(current, partial);
    await set(next);
    return next;
  }

  async function reset() {
    const defaults = WUKU.util.clone(WUKU.constants.DEFAULT_SETTINGS);
    await set(defaults);
    return defaults;
  }

  function onChange(callback) {
    const handler = (changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEY]) return;
      const next = WUKU.util.deepMerge(
        WUKU.constants.DEFAULT_SETTINGS,
        changes[STORAGE_KEY].newValue || {}
      );
      callback(next);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  function patternToRegExp(pattern) {
    const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$', 'i');
  }

  function matchRule(rule, url) {
    if (!rule || !rule.pattern) return false;
    let pattern = String(rule.pattern).trim().toLowerCase();
    if (!pattern) return false;
    if (/^https?:\/\//.test(pattern)) {
      try {
        const parsed = new URL(pattern);
        pattern = parsed.hostname.toLowerCase() + (parsed.pathname === '/' ? '' : parsed.pathname);
      } catch (e) {
        pattern = pattern.replace(/^https?:\/\//, '');
      }
    }

    let hostPattern = pattern;
    let pathPattern = '';
    const slashIndex = pattern.indexOf('/');
    if (slashIndex > -1) {
      hostPattern = pattern.slice(0, slashIndex);
      pathPattern = pattern.slice(slashIndex);
    }

    let target;
    try {
      target = new URL(url);
    } catch (e) {
      return false;
    }
    const host = target.hostname.toLowerCase();

    if (hostPattern) {
      if (hostPattern.startsWith('*.')) {
        const base = hostPattern.slice(2);
        if (!(host === base || host.endsWith('.' + base))) return false;
      } else if (hostPattern.startsWith('.')) {
        const base = hostPattern.slice(1);
        if (!(host === base || host.endsWith('.' + base))) return false;
      } else if (hostPattern.includes('*')) {
        if (!patternToRegExp(hostPattern).test(host)) return false;
      } else if (host !== hostPattern && !host.endsWith('.' + hostPattern)) {
        return false;
      }
    }

    if (pathPattern) {
      if (!patternToRegExp(pathPattern).test(target.pathname)) return false;
    }

    return true;
  }

  /**
   * 计算当前页面实际生效的配置（站点规则优先于全局）
   */
  function resolve(settings, url) {
    const rules = Array.isArray(settings.siteRules) ? settings.siteRules : [];
    const matched = rules.filter((item) => matchRule(item, url));
    matched.sort((a, b) => String(b.pattern || '').length - String(a.pattern || '').length);
    const rule = matched[0] || null;
    return {
      rule,
      engine: (rule && rule.engine) || settings.engine,
      mode: (rule && rule.mode) || settings.mode,
      skipChinesePage:
        rule && typeof rule.skipChinesePage === 'boolean' ? rule.skipChinesePage : settings.skipChinesePage,
      targetLang: (rule && rule.targetLang) || settings.targetLang
    };
  }

  WUKU.settings = {
    get,
    set,
    patch,
    reset,
    onChange,
    matchRule,
    resolve
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
