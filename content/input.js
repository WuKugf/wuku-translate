/**
 * 输入框翻译：在输入框连按三次空格，把已输入内容翻译成目标语言
 * 也可通过快捷键（默认 Alt+Shift+I，消息 translate-input）触发
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});
  if (WUKU.inputTranslate) return;

  let settings = null;
  let busy = new WeakSet();

  function cfg() {
    const c = (settings && settings.input) || {};
    return {
      enabled: c.enabled !== false,
      tripleSpace: c.tripleSpace !== false,
      targetLang: c.targetLang || 'en',
      mode: c.mode === 'append' ? 'append' : 'replace'
    };
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
    if (el.tagName === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      const okTypes = ['text', 'search', 'url', 'email', 'password', 'tel', 'number'];
      return okTypes.includes(type) && !el.disabled && !el.readOnly;
    }
    return el.isContentEditable === true;
  }

  function readText(el) {
    if (el.isContentEditable) return el.innerText || '';
    return el.value || '';
  }

  function writeText(el, text) {
    if (el.isContentEditable) {
      el.innerText = text;
    } else {
      el.value = text;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function translateElement(el) {
    const conf = cfg();
    if (!conf.enabled || !isEditable(el) || busy.has(el)) return;
    const original = readText(el).replace(/\s+$/, '');
    if (!original.trim()) return;

    busy.add(el);
    const toastEl = WUKU.ui.toast('正在翻译输入内容…', { duration: 0 });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'translate',
        texts: [original],
        source: 'auto',
        target: conf.targetLang
      });
      if (!response || !response.ok) {
        throw (response && response.error) || { message: '翻译失败' };
      }
      const translated = (response.data.results && response.data.results[0]) || '';
      if (!translated.trim()) throw { message: '未获得译文' };

      if (conf.mode === 'append') {
        writeText(el, original + '\n' + translated);
      } else {
        writeText(el, translated);
      }
      WUKU.ui.toast('已翻译为 ' + WUKU.constants.langName(conf.targetLang), { duration: 2200 });
    } catch (error) {
      WUKU.ui.toast('输入框翻译失败：' + ((error && error.message) || '未知错误'), { duration: 4000 });
    } finally {
      if (toastEl && toastEl.remove) toastEl.remove();
      busy.delete(el);
    }
  }

  function onKeyup(e) {
    if (e.key !== ' ' && e.code !== 'Space') return;
    const conf = cfg();
    if (!conf.enabled || !conf.tripleSpace) return;
    const el = e.target;
    if (!isEditable(el)) return;
    const text = readText(el);
    // 结尾连续三个空格视为触发
    if (/ {3}$/.test(text) && !/ {4}$/.test(text)) {
      e.preventDefault();
      translateElement(el);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'translate-input') return false;
    const el = document.activeElement;
    if (isEditable(el)) {
      translateElement(el).then(() => sendResponse({ ok: true }));
    } else {
      WUKU.ui.toast('请先点击一个输入框');
      sendResponse({ ok: false });
    }
    return true;
  });

  async function init() {
    try {
      settings = await WUKU.settings.get();
    } catch (e) {
      return;
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[WUKU.constants.STORAGE_SETTINGS]) {
        WUKU.settings.get().then((next) => { settings = next; }).catch(() => {});
      }
    });
    document.addEventListener('keyup', onKeyup, true);
  }

  WUKU.inputTranslate = { trigger: translateElement };

  init();
})(typeof globalThis !== 'undefined' ? globalThis : self);
