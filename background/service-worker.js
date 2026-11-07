/**
 * WUKU Translate - Service Worker
 * 职责：右键菜单 / 快捷键 / 网络请求 / 缓存 / 配置初始化
 * 页面脚本不直接跨域请求，统一通过 runtime message 委托到这里执行。
 */
'use strict';

importScripts(
  '../shared/core.js',
  '../shared/constants.js',
  '../shared/lang-detect.js',
  '../shared/settings.js',
  '../shared/cache.js',
  '../shared/net.js',
  '../shared/engines/index.js',
  '../shared/engines/google.js',
  '../shared/engines/mymemory.js',
  '../shared/engines/ai.js',
  '../shared/engines/custom.js'
);

const MENUS = [
  { id: 'wuku-page', title: '翻译当前页面（译文）', contexts: ['page'] },
  { id: 'wuku-page-bilingual', title: '双语对照显示当前页面', contexts: ['page'] },
  { id: 'wuku-selection', title: '翻译选中文本', contexts: ['selection'] },
  { id: 'wuku-image', title: '翻译图片文字（漫画 / 截图）', contexts: ['image'] },
  { id: 'wuku-restore', title: '恢复原文', contexts: ['page', 'selection'] }
];

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    for (const menu of MENUS) {
      chrome.contextMenus.create(menu, () => {
        // 重复创建或菜单已存在时忽略
        void chrome.runtime.lastError;
      });
    }
  });
}

async function ensureDefaults() {
  const current = await WUKU.settings.get();
  await WUKU.settings.set(current);
}

chrome.runtime.onInstalled.addListener((details) => {
  setupMenus();
  ensureDefaults().catch(() => {});
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage().catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  setupMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  const payload = { type: 'noop' };
  if (info.menuItemId === 'wuku-page') payload.type = 'translate-page';
  else if (info.menuItemId === 'wuku-page-bilingual') payload.type = 'translate-page';
  else if (info.menuItemId === 'wuku-selection') payload.type = 'translate-selection';
  else if (info.menuItemId === 'wuku-image') payload.type = 'translate-image';
  else if (info.menuItemId === 'wuku-restore') payload.type = 'restore';
  else return;

  if (info.menuItemId === 'wuku-page-bilingual') payload.mode = 'bilingual';
  if (info.menuItemId === 'wuku-page') payload.mode = 'immersive';
  if (info.menuItemId === 'wuku-selection' && info.selectionText) {
    payload.text = info.selectionText;
  }
  if (info.menuItemId === 'wuku-image' && info.srcUrl) {
    payload.srcUrl = info.srcUrl;
  }

  sendToTab(tab.id, payload).catch(() => {});
});

chrome.commands.onCommand.addListener((command, tab) => {
  const target = tab && tab.id ? tab.id : null;
  if (command === 'toggle-translate') {
    if (target) sendToTab(target, { type: 'toggle-translate' }).catch(() => {});
  } else if (command === 'translate-selection') {
    if (target) sendToTab(target, { type: 'translate-selection' }).catch(() => {});
  } else if (command === 'translate-input') {
    if (target) sendToTab(target, { type: 'translate-input' }).catch(() => {});
  }
});

/**
 * 向标签页发送消息；页面在扩展安装前已加载时，先注入内容脚本再重试。
 */
async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: WUKU.constants.CONTENT_FILES
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['styles/content.css']
      });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      throw WUKU.net.makeError('TAB_UNREACHABLE', '当前页面无法注入翻译脚本（chrome:// 页面或受限页面）');
    }
  }
}

function serializeError(error) {
  return {
    code: (error && error.code) || 'UNKNOWN',
    message: (error && error.message) || String(error),
    origin: (error && error.origin) || '',
    detail: (error && error.detail) || ''
  };
}

const handlers = {
  async ping() {
    return { pong: true, version: WUKU.version };
  },

  async translate(message) {
    const settings = await WUKU.settings.get();
    const outcome = await WUKU.engines.translateBatch({
      texts: message.texts || [],
      engineId: message.engineId,
      source: message.source || 'auto',
      target: message.target || settings.targetLang,
      settings,
      bypassCache: !!message.bypassCache
    });
    return outcome;
  },

  async 'test-engine'(message) {
    const settings = await WUKU.settings.get();
    const startedAt = Date.now();
    const outcome = await WUKU.engines.translateText(message.text || 'Hello, world.', {
      engineId: message.engineId,
      source: message.source || 'auto',
      target: message.target || settings.targetLang,
      settings,
      bypassCache: true
    });
    return {
      text: outcome.text,
      engineUsed: outcome.engineUsed,
      degraded: outcome.degraded,
      degradedReason: outcome.degradedReason,
      elapsed: Date.now() - startedAt
    };
  },

  async 'cache-stats'() {
    return WUKU.cache.stats();
  },

  async 'cache-clear'() {
    await WUKU.cache.clear();
    return { ok: true };
  },

  async 'open-options'() {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  },

  async 'permissions-check'(message) {
    const url = message.url || '';
    return { granted: await WUKU.net.hasHostPermission(url), origin: WUKU.net.originPatternFor(url) };
  },

  async 'translate-image'(message) {
    const settings = await WUKU.settings.get();
    const cfg = settings.imageTranslate || {};
    if (cfg.enabled === false) {
      throw WUKU.net.makeError('DISABLED', '图片翻译功能未启用，可在设置中开启');
    }
    const srcUrl = message.srcUrl || '';
    if (!srcUrl) throw WUKU.net.makeError('CONFIG', '缺少图片地址');

    let dataUrl = srcUrl;
    if (/^https?:\/\//i.test(srcUrl)) {
      const granted = await WUKU.net.hasHostPermission(srcUrl);
      if (!granted) {
        throw WUKU.net.makeError('NEED_PERMISSION', '需要授权访问图片域名', {
          origin: WUKU.net.originPatternFor(srcUrl)
        });
      }
      dataUrl = await fetchAsDataUrl(srcUrl);
    } else if (/^data:/i.test(srcUrl)) {
      if (srcUrl.length > 12 * 1024 * 1024) {
        throw WUKU.net.makeError('TOO_LARGE', '图片过大，无法处理');
      }
    } else {
      throw WUKU.net.makeError('CONFIG', '不支持的图片地址（仅支持 http/https）');
    }
    return WUKU.engines.translateImage(dataUrl, { settings });
  }
};

/** 下载图片并转为 data URL（SW 环境无 FileReader，手动 base64） */
async function fetchAsDataUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
    if (!resp.ok) {
      throw WUKU.net.makeError('HTTP_' + resp.status, '图片下载失败（HTTP ' + resp.status + '）');
    }
    const mime = (resp.headers.get('content-type') || 'image/png').split(';')[0];
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > 8 * 1024 * 1024) {
      throw WUKU.net.makeError('TOO_LARGE', '图片超过 8MB，无法处理');
    }
    const bytes = new Uint8Array(buf);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return 'data:' + mime + ';base64,' + btoa(binary);
  } catch (e) {
    if (e && e.code) throw e;
    throw WUKU.net.makeError(e && e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', '图片下载失败，请检查网络');
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;
  const handler = handlers[message.type];
  if (!handler) return false;

  Promise.resolve()
    .then(() => handler(message, sender))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));

  return true;
});
