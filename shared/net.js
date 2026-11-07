/**
 * 网络层：统一超时、重试与错误码，便于上层做降级与用户提示。
 * 所有请求均在 service worker 中发出（借助 host 权限避开页面 CORS 限制）。
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});

  function makeError(code, message, extra) {
    const error = new Error(message || code);
    error.code = code;
    if (extra) Object.assign(error, extra);
    return error;
  }

  function describeStatus(status) {
    if (status === 401 || status === 403) return '鉴权失败（API Key 或权限不足）';
    if (status === 404) return '接口地址不存在（请检查 Base URL）';
    if (status === 429) return '请求过于频繁（429），可能触发限流';
    if (status >= 500) return '服务端错误（' + status + '）';
    return '请求失败（HTTP ' + status + '）';
  }

  /**
   * @param {string} url
   * @param {{method?:string, headers?:object, body?:any, timeout?:number, retries?:number}} options
   * @returns {Promise<any>} 解析后的 JSON 或文本
   */
  async function request(url, options) {
    const opts = options || {};
    const method = (opts.method || 'GET').toUpperCase();
    const timeout = opts.timeout || 25000;
    const retries = typeof opts.retries === 'number' ? opts.retries : 1;
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(url, {
          method,
          headers: opts.headers || {},
          body: opts.body === undefined || opts.body === null ? undefined : opts.body,
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store'
        });
        clearTimeout(timer);

        if (!response.ok) {
          let detail = '';
          try {
            detail = await response.text();
          } catch (e) {
            detail = '';
          }
          const error = makeError('HTTP_' + response.status, describeStatus(response.status), {
            status: response.status,
            detail: String(detail || '').slice(0, 400)
          });
          // 429 / 5xx 可重试一次
          if (attempt < retries && (response.status === 429 || response.status >= 500)) {
            lastError = error;
            await WUKU.util.sleep(500 + attempt * 500);
            continue;
          }
          throw error;
        }

        const text = await response.text();
        if (!text) return '';
        try {
          return JSON.parse(text);
        } catch (e) {
          return text;
        }
      } catch (e) {
        clearTimeout(timer);
        if (e && e.code) {
          if (e.code === 'HTTP_429' || e.code === 'HTTP_5xx') lastError = e;
          throw e;
        }
        const aborted = e && e.name === 'AbortError';
        const error = makeError(
          aborted ? 'TIMEOUT' : 'NETWORK',
          aborted ? '请求超时（' + Math.round(timeout / 1000) + ' 秒）' : '网络请求失败，请检查网络或接口地址'
        );
        error.raw = e && e.message;
        lastError = error;
        if (attempt < retries) {
          await WUKU.util.sleep(600);
          continue;
        }
        throw error;
      }
    }

    throw lastError || makeError('NETWORK', '网络请求失败');
  }

  function originPatternFor(url) {
    const origin = WUKU.util.originOf(url);
    return origin ? origin + '/*' : '';
  }

  async function hasHostPermission(url) {
    const pattern = originPatternFor(url);
    if (!pattern) return false;
    try {
      return await chrome.permissions.contains({ origins: [pattern] });
    } catch (e) {
      return false;
    }
  }

  /** 必须在用户手势的页面上下文（options / popup）中调用 */
  async function requestHostPermission(url) {
    const pattern = originPatternFor(url);
    if (!pattern) return false;
    try {
      return await chrome.permissions.request({ origins: [pattern] });
    } catch (e) {
      return false;
    }
  }

  WUKU.net = {
    request,
    makeError,
    originPatternFor,
    hasHostPermission,
    requestHostPermission
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
