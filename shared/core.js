/**
 * WUKU Translate - 共享工具层
 * 以经典脚本形式加载（content script 不能使用 ES Module），
 * 通过全局命名空间 WUKU 暴露，供 content / popup / options / service worker 复用。
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});

  WUKU.version = '1.0.0';
  WUKU.author = 'WUKU';

  const util = {
    clone(value) {
      if (value === undefined) return undefined;
      return JSON.parse(JSON.stringify(value));
    },

    isPlainObject(value) {
      return !!value && typeof value === 'object' && !Array.isArray(value);
    },

    /** 递归合并，patch 中的对象合并、数组整体替换 */
    deepMerge(base, patch) {
      const out = util.isPlainObject(base) ? Object.assign({}, base) : {};
      if (!util.isPlainObject(patch)) return out;
      for (const key of Object.keys(patch)) {
        const value = patch[key];
        if (util.isPlainObject(value) && util.isPlainObject(out[key])) {
          out[key] = util.deepMerge(out[key], value);
        } else if (Array.isArray(value)) {
          out[key] = util.clone(value);
        } else if (util.isPlainObject(value)) {
          out[key] = util.deepMerge({}, value);
        } else {
          out[key] = value;
        }
      }
      return out;
    },

    debounce(fn, wait) {
      let timer = null;
      const wrapped = function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          fn.apply(this, args);
        }, wait);
      };
      wrapped.cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };
      return wrapped;
    },

    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    /** 并发受限的 map，保持结果顺序 */
    async mapLimit(items, limit, worker) {
      const results = new Array(items.length);
      let cursor = 0;
      const size = Math.max(1, Math.min(limit || 1, items.length || 1));
      const runners = [];
      for (let i = 0; i < size; i += 1) {
        runners.push(
          (async () => {
            while (cursor < items.length) {
              const index = cursor;
              cursor += 1;
              results[index] = await worker(items[index], index);
            }
          })()
        );
      }
      await Promise.all(runners);
      return results;
    },

    escapeHtml(text) {
      return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    normalizeSpace(text) {
      return String(text == null ? '' : text)
        .replace(/\u00a0/g, ' ')
        .replace(/[\t\r\n]+/g, ' ')
        .replace(/ {2,}/g, ' ')
        .trim();
    },

    truncate(text, max) {
      const str = String(text == null ? '' : text);
      if (str.length <= max) return str;
      return str.slice(0, max - 1) + '…';
    },

    /** FNV-1a 32 位哈希，用于缓存键压缩 */
    hash(text) {
      let hash = 0x811c9dc5;
      const str = String(text == null ? '' : text);
      for (let i = 0; i < str.length; i += 1) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
      }
      return hash.toString(36);
    },

    /** 按标点切句，用于超长文本兜底分段 */
    splitSentences(text) {
      const parts = String(text || '').match(/[^。！？!?；;\n]+[。！？!?；;\n]*/g);
      if (!parts) return [String(text || '')];
      return parts.map((s) => s.trim()).filter(Boolean);
    },

    /** 从 URL 提取 origin，失败返回空字符串 */
    originOf(url) {
      try {
        return new URL(url).origin;
      } catch (e) {
        return '';
      }
    },

    hostOf(url) {
      try {
        return new URL(url).hostname;
      } catch (e) {
        return '';
      }
    },

    /** 把 "example.com/*" 之类的模式规范化为可请求的 origin 模式 */
    toOriginPattern(url) {
      const origin = util.originOf(url);
      return origin ? origin + '/*' : '';
    },

    uid(prefix) {
      return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 9);
    },

    clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    },

    formatMs(ms) {
      if (!ms && ms !== 0) return '-';
      if (ms < 1000) return ms + ' ms';
      return (ms / 1000).toFixed(1) + ' s';
    },

    /** 把模型返回的 JSON 文本尽量解析成数组 */
    parseJsonArray(raw) {
      if (Array.isArray(raw)) return raw;
      let text = String(raw == null ? '' : raw).trim();
      text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
        if (util.isPlainObject(parsed)) {
          for (const key of ['translations', 'result', 'data', 'items', 'output']) {
            if (Array.isArray(parsed[key])) return parsed[key];
          }
        }
      } catch (e) {
        /* 继续尝试截取 */
      }
      const start = text.indexOf('[');
      const end = text.lastIndexOf(']');
      if (start !== -1 && end > start) {
        try {
          const parsed = JSON.parse(text.slice(start, end + 1));
          if (Array.isArray(parsed)) return parsed;
        } catch (e) {
          /* 放弃 */
        }
      }
      return null;
    },

    /** 按 a.b[0].c 形式的路径取值 */
    getByPath(obj, path) {
      if (!path) return undefined;
      const tokens = String(path)
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter((t) => t !== '');
      let cur = obj;
      for (const token of tokens) {
        if (cur == null) return undefined;
        cur = cur[token];
      }
      return cur;
    }
  };

  WUKU.util = util;
})(typeof globalThis !== 'undefined' ? globalThis : self);
