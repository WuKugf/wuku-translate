/**
 * 翻译缓存
 * 存储于 chrome.storage.local（跨 Service Worker 重启持久），内存内维护热数据。
 * 采用「引擎 + 源语言 + 目标语言 + 文本 hash」作为键，超过上限时按最近使用时间裁剪。
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});

  const STORE_KEY = WUKU.constants.CACHE_STORE_KEY;
  const MAX_CHARS = 3 * 1024 * 1024; // 约 3MB，避免撑爆 storage.local 配额

  let state = null; // { entries: {key:{v,t}}, meta:{hits,misses} }
  let loading = null;
  let dirty = false;

  async function load() {
    if (state) return state;
    if (loading) return loading;
    loading = (async () => {
      let stored = {};
      try {
        const result = await chrome.storage.local.get(STORE_KEY);
        stored = result[STORE_KEY] || {};
      } catch (e) {
        stored = {};
      }
      state = {
        entries: stored.entries || {},
        meta: stored.meta || { hits: 0, misses: 0 }
      };
      loading = null;
      return state;
    })();
    return loading;
  }

  function makeKey(engineId, source, target, text) {
    return [engineId, source || 'auto', target, text.length, WUKU.util.hash(text)].join('|');
  }

  /** 读取单条（命中返回字符串，否则 null） */
  async function get(key) {
    const data = await load();
    const item = data.entries[key];
    if (!item) {
      data.meta.misses += 1;
      return null;
    }
    item.t = Date.now();
    data.meta.hits += 1;
    dirty = true;
    return item.v;
  }

  /** 批量读取，返回与 keys 等长的数组（未命中为 null），只读一次存储 */
  async function getMany(keys) {
    const data = await load();
    return (keys || []).map((key) => {
      const item = data.entries[key];
      if (!item) {
        data.meta.misses += 1;
        return null;
      }
      item.t = Date.now();
      data.meta.hits += 1;
      dirty = true;
      return item.v;
    });
  }

  /** 批量写回；value 为空的记录不写入 */
  async function putMany(records, options) {
    const data = await load();
    const now = Date.now();
    let added = 0;
    for (const record of records || []) {
      if (!record || !record.key) continue;
      const value = typeof record.value === 'string' ? record.value : '';
      if (!value) continue;
      data.entries[record.key] = { v: value, t: now };
      added += 1;
    }
    dirty = true;
    if (added) await trim(options && options.maxEntries);
    await flush();
  }

  function approximateChars(entries) {
    let total = 0;
    for (const key of Object.keys(entries)) {
      total += (entries[key].v || '').length;
    }
    return total;
  }

  async function trim(maxEntries) {
    const data = await load();
    const limit = Math.max(200, Number(maxEntries) || 3000);
    const keys = Object.keys(data.entries);
    if (keys.length <= limit && approximateChars(data.entries) <= MAX_CHARS) return;

    keys.sort((a, b) => (data.entries[a].t || 0) - (data.entries[b].t || 0));
    const removable = [];
    let remaining = keys.length;
    let chars = approximateChars(data.entries);
    for (const key of keys) {
      if (remaining <= limit && chars <= MAX_CHARS) break;
      chars -= (data.entries[key].v || '').length;
      remaining -= 1;
      removable.push(key);
    }
    for (const key of removable) delete data.entries[key];
  }

  async function flush() {
    if (!dirty || !state) return;
    dirty = false;
    try {
      await chrome.storage.local.set({ [STORE_KEY]: state });
    } catch (e) {
      // 配额不足时清掉一半旧数据后重试一次
      try {
        await trim(500);
        await chrome.storage.local.set({ [STORE_KEY]: state });
      } catch (err) {
        console.warn('[WUKU] 缓存写入失败', err);
      }
    }
  }

  async function stats() {
    const data = await load();
    const keys = Object.keys(data.entries);
    return {
      entries: keys.length,
      chars: approximateChars(data.entries),
      hits: data.meta.hits || 0,
      misses: data.meta.misses || 0
    };
  }

  async function clear() {
    state = { entries: {}, meta: { hits: 0, misses: 0 } };
    dirty = false;
    await chrome.storage.local.set({ [STORE_KEY]: state });
  }

  WUKU.cache = {
    makeKey,
    get,
    getMany,
    putMany,
    flush,
    stats,
    clear
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
