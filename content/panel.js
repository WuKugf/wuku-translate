/**
 * 页面内翻译面板：右侧抽屉，输入即译
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});
  if (WUKU.panel) return;

  const HOST_ID = 'wuku-panel-host';
  let host = null;
  let shadow = null;
  let drawer = null;
  let inputEl = null;
  let outputEl = null;
  let engineSel = null;
  let targetSel = null;
  let statusEl = null;
  let debounceTimer = null;
  let lastRequest = 0;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    .wuku-drawer {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483647;
      width: min(400px, 92vw);
      background: #ffffff; color: #1b1d24;
      border-left: 1px solid rgba(20,24,40,0.1);
      box-shadow: -12px 0 40px rgba(16,24,60,0.18);
      display: flex; flex-direction: column;
      pointer-events: auto;
      animation: wuku-drawer-in 200ms cubic-bezier(0.2,0.8,0.3,1);
    }
    @keyframes wuku-drawer-in { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
    .head {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px;
      background: linear-gradient(180deg, rgba(79,124,255,0.09), rgba(79,124,255,0.02));
      border-bottom: 1px solid rgba(20,24,40,0.07);
    }
    .brand { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; color: #2a3550; }
    .brand-dot { width: 18px; height: 18px; border-radius: 5px; background: linear-gradient(135deg, #4f7cff, #8a4fff); }
    .spacer { flex: 1; }
    .x { border: 0; background: transparent; font-size: 16px; color: #7a8299; cursor: pointer; width: 26px; height: 26px; border-radius: 7px; }
    .x:hover { background: rgba(20,24,40,0.07); color: #2a3550; }
    .toolbar { display: flex; gap: 8px; padding: 10px 14px 0; }
    select {
      flex: 1; font: inherit; font-size: 12.5px; color: #3b4560;
      border: 1px solid rgba(20,24,40,0.14); border-radius: 8px;
      padding: 5px 8px; background: #fff; cursor: pointer; outline: none;
    }
    textarea {
      margin: 10px 14px 0; padding: 10px 12px;
      border: 1px solid rgba(20,24,40,0.14); border-radius: 10px;
      font: inherit; font-size: 13.5px; line-height: 1.6;
      min-height: 110px; resize: vertical; outline: none; color: #1b1d24;
    }
    textarea:focus { border-color: #4f7cff; box-shadow: 0 0 0 3px rgba(79,124,255,0.15); }
    .status { margin: 6px 14px 0; font-size: 11.5px; color: #8b93a8; min-height: 16px; }
    .status.err { color: #c0392b; }
    .result {
      margin: 6px 14px 12px; padding: 10px 12px;
      background: rgba(79,124,255,0.05);
      border: 1px solid rgba(79,124,255,0.16); border-radius: 10px;
      font-size: 13.5px; line-height: 1.7; white-space: pre-wrap; word-break: break-word;
      flex: 1; overflow: auto; min-height: 90px;
    }
    .result:empty::before { content: '译文将显示在这里'; color: #a6adbf; }
    .foot { display: flex; gap: 8px; padding: 0 14px 14px; }
    .foot button {
      flex: 1; font: inherit; font-size: 12.5px; cursor: pointer;
      border: 1px solid rgba(20,24,40,0.14); border-radius: 8px;
      background: #fff; color: #2f3a52; padding: 6px 0;
    }
    .foot button:hover { background: #f0f4ff; border-color: rgba(79,124,255,0.45); }
    .foot button.primary { background: linear-gradient(135deg, #4f7cff, #8a4fff); color: #fff; border: 0; }
    .foot button.primary:hover { filter: brightness(1.06); }
    @media (prefers-color-scheme: dark) {
      .wuku-drawer { background: #1d2029; color: #eef1f9; border-left-color: rgba(255,255,255,0.09); }
      .brand { color: #dfe4f3; }
      select, textarea, .foot button { background: rgba(255,255,255,0.06); color: #e6eaf5; border-color: rgba(255,255,255,0.14); }
      .result { background: rgba(79,124,255,0.09); border-color: rgba(79,124,255,0.28); }
      .result:empty::before { color: #6d7590; }
      .x { color: #97a0b8; }
      .status { color: #8d95ab; }
      .foot button.primary { background: linear-gradient(135deg, #4f7cff, #8a4fff); color: #fff; }
      .head { background: linear-gradient(180deg, rgba(79,124,255,0.16), rgba(79,124,255,0.03)); border-bottom-color: rgba(255,255,255,0.07); }
    }
  `;

  function ensure() {
    if (host && host.isConnected) return shadow;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: block;';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    (document.documentElement || document.body).appendChild(host);
    return shadow;
  }

  function fillEngines(select, current) {
    select.innerHTML = '';
    Object.keys(WUKU.constants.ENGINE_META).forEach((id) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = WUKU.constants.ENGINE_META[id].label;
      select.appendChild(opt);
    });
    if (current) select.value = current;
  }

  function fillTargets(select, current) {
    select.innerHTML = '';
    ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'].forEach((code) => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = WUKU.constants.langName(code);
      select.appendChild(opt);
    });
    if (current) select.value = current;
  }

  async function build(settings) {
    ensure();
    close();

    drawer = document.createElement('div');
    drawer.className = 'wuku-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'WUKU 翻译面板');

    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = '<span class="brand"><span class="brand-dot"></span>WUKU 翻译面板</span><span class="spacer"></span>';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'x';
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', close);
    head.appendChild(closeBtn);
    drawer.appendChild(head);

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    engineSel = document.createElement('select');
    fillEngines(engineSel, settings.engine);
    targetSel = document.createElement('select');
    fillTargets(targetSel, settings.targetLang);
    toolbar.appendChild(engineSel);
    toolbar.appendChild(targetSel);
    drawer.appendChild(toolbar);

    inputEl = document.createElement('textarea');
    inputEl.placeholder = '输入要翻译的内容，停顿片刻自动翻译…';
    drawer.appendChild(inputEl);

    statusEl = document.createElement('div');
    statusEl.className = 'status';
    drawer.appendChild(statusEl);

    outputEl = document.createElement('div');
    outputEl.className = 'result';
    drawer.appendChild(outputEl);

    const foot = document.createElement('div');
    foot.className = 'foot';
    const translateBtn = document.createElement('button');
    translateBtn.className = 'primary';
    translateBtn.type = 'button';
    translateBtn.textContent = '立即翻译';
    translateBtn.addEventListener('click', () => runTranslate(true));
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '复制译文';
    copyBtn.addEventListener('click', () => {
      if (outputEl.textContent) WUKU.ui.copyText(outputEl.textContent);
    });
    const speakBtn = document.createElement('button');
    speakBtn.type = 'button';
    speakBtn.textContent = '朗读';
    speakBtn.addEventListener('click', () => {
      if (outputEl.textContent) WUKU.ui.speak(outputEl.textContent, targetSel.value);
    });
    foot.appendChild(translateBtn);
    foot.appendChild(copyBtn);
    foot.appendChild(speakBtn);
    drawer.appendChild(foot);

    inputEl.addEventListener('input', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runTranslate(false), 650);
    });
    engineSel.addEventListener('change', () => runTranslate(true));
    targetSel.addEventListener('change', () => runTranslate(true));

    shadow.appendChild(drawer);
    setTimeout(() => inputEl.focus(), 60);

    document.addEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  async function runTranslate(manual) {
    const text = (inputEl.value || '').trim();
    if (!text) {
      outputEl.textContent = '';
      statusEl.textContent = '';
      statusEl.className = 'status';
      return;
    }
    const requestId = ++lastRequest;
    statusEl.className = 'status';
    statusEl.textContent = '翻译中…';
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'translate',
        texts: [text],
        engineId: engineSel.value,
        source: 'auto',
        target: targetSel.value
      });
      if (requestId !== lastRequest) return; // 已有更新的输入
      if (!response || !response.ok) {
        throw (response && response.error) || { message: '翻译失败' };
      }
      const result = (response.data.results && response.data.results[0]) || '';
      outputEl.textContent = result || '（无译文）';
      const meta = WUKU.constants.engineMeta(response.data.engineUsed || engineSel.value);
      statusEl.textContent = meta.label + (response.data.degraded ? '（已降级）' : '');
    } catch (error) {
      if (requestId !== lastRequest) return;
      statusEl.className = 'status err';
      statusEl.textContent = (error && error.message) || '翻译失败';
    }
  }

  let prefill = '';
  function open() {
    WUKU.settings.get()
      .then((settings) => build(settings))
      .then(() => {
        const text = prefill;
        prefill = '';
        if (text) {
          inputEl.value = text;
          runTranslate(true);
        }
      })
      .catch(() => {});
  }

  function close() {
    if (drawer) drawer.remove();
    drawer = null;
    document.removeEventListener('keydown', onKey, true);
  }

  function toggle() {
    if (drawer) close();
    else open();
  }

  function isOpen() {
    return !!drawer;
  }

  WUKU.panel = {
    open(prefillText) {
      prefill = prefillText || '';
      open();
    },
    close,
    toggle,
    isOpen
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
