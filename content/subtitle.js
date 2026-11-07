/**
 * 视频双语字幕：监听站点字幕容器，原文下方追加译文
 * 内置常见站点选择器，支持设置页自定义选择器（按域名匹配）
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});
  if (WUKU.subtitleCtl) return;

  const OWN_ATTR = 'data-wuku-sub';
  const BUILTIN_SELECTORS = [
    { pattern: 'youtube.com', selector: '.ytp-caption-window-container' },
    { pattern: 'netflix.com', selector: '.player-timedtext' },
    { pattern: 'bilibili.com', selector: '.bpx-player-subtitle-panel' },
    { pattern: 'youtu.be', selector: '.ytp-caption-window-container' },
    { pattern: 'disneyplus.com', selector: '.dss-subtitle-renderer-canvas, .TimedTextOverlay' },
    { pattern: 'primevideo.com', selector: '.atvwebplayersdk-captions-overlay' }
  ];

  let enabled = false;
  let bilingual = true;
  let settings = null;
  let rootObserver = null;
  let textObservers = new Map(); // container -> observer
  let lastText = new Map(); // container -> 原文
  let pending = new Map(); // container -> timer
  const cache = new Map(); // text -> translation
  let toastShown = false;

  function selectorsForPage() {
    const list = [];
    const href = location.href;
    BUILTIN_SELECTORS.forEach((item) => {
      if (href.includes(item.pattern)) list.push(item.selector);
    });
    const custom = (settings.subtitle && settings.subtitle.customSelectors) || [];
    custom.forEach((item) => {
      if (item && item.pattern && item.selector && href.includes(item.pattern)) {
        list.push(item.selector);
      }
    });
    return list;
  }

  function captionText(container) {
    // 只取站点原文，忽略我们注入的译文节点
    let text = '';
    container.childNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute(OWN_ATTR)) return;
      text += (node.textContent || '') + ' ';
    });
    return text.replace(/\s+/g, ' ').trim();
  }

  function ownNode(container) {
    return container.querySelector('[' + OWN_ATTR + ']');
  }

  function renderTranslation(container, original, translation) {
    let node = ownNode(container);
    if (!node) {
      node = document.createElement('div');
      node.setAttribute(OWN_ATTR, '1');
      node.style.cssText =
        'margin-top:2px;font-size:0.92em;font-weight:600;color:#ffd76a;' +
        'text-shadow:0 1px 3px rgba(0,0,0,0.85);text-align:center;line-height:1.35;' +
        'font-family:inherit;background:transparent;';
      container.appendChild(node);
    }
    node.textContent = translation;
    if (!bilingual) {
      // 纯译文模式：隐藏站点原文字幕节点（保留结构，便于恢复）
      container.childNodes.forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE && child !== node && !child.hasAttribute(OWN_ATTR)) {
          child.style.setProperty('visibility', 'hidden', 'important');
        }
      });
    }
  }

  async function translateCaption(container, text) {
    if (cache.has(text)) {
      renderTranslation(container, text, cache.get(text));
      return;
    }
    let response;
    try {
      const resolved = WUKU.settings.resolve(settings, location.href);
      response = await chrome.runtime.sendMessage({
        type: 'translate',
        texts: [text],
        engineId: resolved.engine,
        source: 'auto',
        target: resolved.targetLang || 'zh-CN'
      });
    } catch (e) {
      return; // 字幕静默失败，避免打断观影
    }
    if (!response || !response.ok || !response.data) return;
    const translation = (response.data.results && response.data.results[0]) || '';
    if (!translation) return;
    if (cache.size > 400) cache.clear();
    cache.set(text, translation);
    // 字幕可能已切换，翻译结果只在原文仍显示时渲染
    if (captionText(container) === text) {
      renderTranslation(container, text, translation);
    }
  }

  function onCaptionChange(container) {
    const text = captionText(container);
    if (!text) {
      const node = ownNode(container);
      if (node) node.textContent = '';
      lastText.set(container, '');
      return;
    }
    if (text === lastText.get(container)) return;
    lastText.set(container, text);
    if (pending.has(container)) clearTimeout(pending.get(container));
    pending.set(
      container,
      setTimeout(() => {
        translateCaption(container, text);
      }, 160)
    );
  }

  function observeContainer(container) {
    if (textObservers.has(container)) return;
    const observer = new MutationObserver(() => onCaptionChange(container));
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    textObservers.set(container, observer);
    onCaptionChange(container);
    if (!toastShown) {
      toastShown = true;
      WUKU.ui.toast('视频双语字幕已生效');
    }
  }

  function scan() {
    if (!enabled) return;
    selectorsForPage().forEach((selector) => {
      let nodes;
      try {
        nodes = document.querySelectorAll(selector);
      } catch (e) {
        return;
      }
      nodes.forEach(observeContainer);
    });
  }

  function startRootObserver() {
    if (rootObserver) return;
    const schedule = WUKU.util.debounce(scan, 400);
    rootObserver = new MutationObserver(() => schedule());
    rootObserver.observe(document.documentElement, { childList: true, subtree: true });
    scan();
  }

  function stopAll() {
    if (rootObserver) {
      rootObserver.disconnect();
      rootObserver = null;
    }
    textObservers.forEach((observer) => observer.disconnect());
    textObservers.clear();
    lastText.clear();
    pending.forEach((timer) => clearTimeout(timer));
    pending.clear();
    document.querySelectorAll('[' + OWN_ATTR + ']').forEach((node) => node.remove());
  }

  async function setEnabled(next) {
    if (!settings) settings = await WUKU.settings.get();
    enabled = !!next;
    bilingual = !settings.subtitle || settings.subtitle.bilingual !== false;
    if (enabled) startRootObserver();
    else stopAll();
  }

  async function init() {
    try {
      settings = await WUKU.settings.get();
    } catch (e) {
      return;
    }
    await setEnabled(!!(settings.subtitle && settings.subtitle.enabled));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[WUKU.constants.STORAGE_SETTINGS]) {
        WUKU.settings.get()
          .then((next) => {
            settings = next;
            setEnabled(!!(next.subtitle && next.subtitle.enabled));
          })
          .catch(() => {});
      }
    });
  }

  WUKU.subtitleCtl = { setEnabled, stopAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
