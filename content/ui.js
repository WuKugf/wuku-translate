/**
 * 页面内 UI（Shadow DOM 隔离，避免与站点样式互相污染）
 * 提供：划词翻译气泡、顶部提示、翻译进度胶囊、剪贴板/朗读能力
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});

  const HOST_ID = 'wuku-ui-host';
  let host = null;
  let shadow = null;
  let toastTimer = null;
  let bubble = null; // { root, callbacks, engineId }
  let progress = null; // { root, textEl, barEl, btn, onCancel }
  let cleanup = [];

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wuku-surface {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      font-size: 13px;
      line-height: 1.55;
      color: #1b1d24;
      color-scheme: light dark;
    }
    .bubble {
      position: fixed;
      width: 360px;
      max-width: calc(100vw - 24px);
      background: #ffffff;
      border: 1px solid rgba(20, 24, 40, 0.08);
      border-radius: 14px;
      box-shadow: 0 14px 40px rgba(16, 24, 60, 0.18), 0 2px 6px rgba(16, 24, 60, 0.08);
      overflow: hidden;
      pointer-events: auto;
      animation: wuku-in 180ms cubic-bezier(0.2, 0.8, 0.3, 1);
    }
    @keyframes wuku-in {
      from { opacity: 0; transform: translateY(6px) scale(0.985); }
      to { opacity: 1; transform: none; }
    }
    .head {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 10px 9px 12px;
      background: linear-gradient(180deg, rgba(79, 124, 255, 0.09), rgba(79, 124, 255, 0.02));
      border-bottom: 1px solid rgba(20, 24, 40, 0.06);
    }
    .brand { display: flex; align-items: center; gap: 6px; font-weight: 600; letter-spacing: 0.2px; color: #2a3550; }
    .brand-dot {
      width: 16px; height: 16px; border-radius: 5px;
      background: linear-gradient(135deg, #4f7cff, #8a4fff);
      box-shadow: 0 1px 4px rgba(79, 124, 255, 0.4);
    }
    .spacer { flex: 1; }
    select.engine {
      appearance: none;
      font: inherit; font-size: 12px;
      color: #3b4560;
      background: rgba(255,255,255,0.9);
      border: 1px solid rgba(20,24,40,0.12);
      border-radius: 7px; padding: 3px 20px 3px 7px;
      cursor: pointer;
      background-image: linear-gradient(45deg, transparent 50%, #6b7590 50%),
                        linear-gradient(135deg, #6b7590 50%, transparent 50%);
      background-position: calc(100% - 11px) 10px, calc(100% - 7px) 10px;
      background-size: 4px 4px, 4px 4px;
      background-repeat: no-repeat;
      outline: none;
    }
    .icon-btn {
      border: 0; background: transparent; color: #7a8299;
      width: 22px; height: 22px; border-radius: 6px; cursor: pointer;
      font-size: 15px; line-height: 1; padding: 0;
    }
    .icon-btn:hover { background: rgba(20,24,40,0.07); color: #2a3550; }
    .origin {
      padding: 10px 12px 2px;
      color: #6b7590; font-size: 12px;
      max-height: 68px; overflow: hidden;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    }
    .body { padding: 6px 12px 12px; }
    .translation { font-size: 14px; line-height: 1.65; color: #14161d; white-space: pre-wrap; word-break: break-word; }
    .note { margin-top: 6px; font-size: 11.5px; color: #b26a00; }
    .note.err { color: #c0392b; }
    .loading { display: flex; gap: 4px; align-items: center; padding: 6px 0 4px; }
    .loading span {
      width: 6px; height: 6px; border-radius: 50%; background: #4f7cff;
      animation: wuku-bounce 1s infinite ease-in-out;
    }
    .loading span:nth-child(2) { animation-delay: 0.15s; }
    .loading span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes wuku-bounce {
      0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-3px); }
    }
    .foot {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 10px;
      border-top: 1px solid rgba(20,24,40,0.06);
      background: rgba(248, 249, 252, 0.75);
    }
    .meta { flex: 1; font-size: 11px; color: #8b93a8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .act {
      font: inherit; font-size: 12px; cursor: pointer;
      color: #2f3a52; background: #fff;
      border: 1px solid rgba(20,24,40,0.12); border-radius: 7px;
      padding: 3px 9px; transition: background 120ms;
    }
    .act:hover { background: #f0f4ff; border-color: rgba(79,124,255,0.4); }
    .act.on { background: #eaf0ff; border-color: #4f7cff; color: #2b4fd8; }

    .toast {
      position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
      max-width: min(560px, calc(100vw - 32px));
      display: flex; align-items: center; gap: 10px;
      padding: 9px 12px;
      background: #1f2430; color: #f4f6fb;
      border-radius: 10px; box-shadow: 0 10px 30px rgba(10, 15, 30, 0.3);
      pointer-events: auto;
      font-size: 12.5px;
      animation: wuku-toast-in 200ms ease-out;
    }
    @keyframes wuku-toast-in { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
    .toast .msg { flex: 1; }
    .toast .toast-act {
      border: 1px solid rgba(255,255,255,0.28); background: rgba(255,255,255,0.12);
      color: #fff; border-radius: 6px; padding: 3px 9px; font: inherit; font-size: 12px; cursor: pointer;
    }
    .toast .toast-act:hover { background: rgba(255,255,255,0.2); }

    .pill {
      position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px 8px 14px;
      background: rgba(24, 29, 42, 0.92);
      color: #f2f5ff; border-radius: 999px;
      box-shadow: 0 10px 26px rgba(10, 15, 30, 0.28);
      pointer-events: auto;
      backdrop-filter: blur(6px);
      font-size: 12.5px;
      overflow: hidden;
    }
    .spinner {
      width: 13px; height: 13px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.25); border-top-color: #8fb0ff;
      animation: wuku-spin 0.8s linear infinite;
    }
    @keyframes wuku-spin { to { transform: rotate(360deg); } }
    .pill .txt { white-space: nowrap; }
    .pill .cancel {
      border: 0; background: rgba(255,255,255,0.14); color: #fff; font: inherit;
      border-radius: 999px; padding: 3px 10px; cursor: pointer;
    }
    .pill .cancel:hover { background: rgba(255,255,255,0.24); }
    .bar { position: absolute; left: 0; bottom: 0; height: 2px; background: #7aa0ff; width: 0%; transition: width 200ms; }

    @media (prefers-color-scheme: dark) {
      .bubble { background: #1d2029; border-color: rgba(255,255,255,0.09); box-shadow: 0 14px 40px rgba(0,0,0,0.5); }
      .head { background: linear-gradient(180deg, rgba(79,124,255,0.16), rgba(79,124,255,0.03)); border-bottom-color: rgba(255,255,255,0.07); }
      .brand { color: #dfe4f3; }
      select.engine { background-color: rgba(255,255,255,0.06); color: #dfe4f3; border-color: rgba(255,255,255,0.14); }
      .origin { color: #97a0b8; }
      .translation { color: #f1f3fa; }
      .foot { background: rgba(255,255,255,0.03); border-top-color: rgba(255,255,255,0.07); }
      .meta { color: #8d95ab; }
      .act { background: rgba(255,255,255,0.06); color: #e3e7f4; border-color: rgba(255,255,255,0.12); }
      .act:hover { background: rgba(79,124,255,0.18); }
      .icon-btn { color: #97a0b8; }
      .icon-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
      .note { color: #f0b95a; }
      .note.err { color: #ff8b7d; }
    }
  `;

  function ensureHost() {
    if (host && host.isConnected) return shadow;
    host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      (document.documentElement || document.body).appendChild(host);
    }
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: block;';
    if (!host.shadowRoot) {
      shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);
      const surface = document.createElement('div');
      surface.className = 'wuku-surface';
      shadow.appendChild(surface);
    } else {
      shadow = host.shadowRoot;
    }
    return shadow;
  }

  function surface() {
    ensureHost();
    return shadow.querySelector('.wuku-surface');
  }

  function addCleanup(fn) {
    cleanup.push(fn);
  }

  function runCleanup() {
    cleanup.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        /* 忽略 */
      }
    });
    cleanup = [];
  }

  /** 顶部提示 */
  function toast(message, options) {
    const opts = options || {};
    const layer = surface();
    const old = layer.querySelector('.toast');
    if (old) old.remove();
    if (toastTimer) clearTimeout(toastTimer);

    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = message;
    el.appendChild(msg);

    let actionHandler = null;
    if (opts.actionLabel && typeof opts.onAction === 'function') {
      actionHandler = opts.onAction;
      const btn = document.createElement('button');
      btn.className = 'toast-act';
      btn.type = 'button';
      btn.textContent = opts.actionLabel;
      btn.addEventListener('click', () => {
        el.remove();
        actionHandler();
      });
      el.appendChild(btn);
    }

    layer.appendChild(el);
    const duration = opts.duration === undefined ? 4200 : opts.duration;
    if (duration > 0) {
      toastTimer = setTimeout(() => {
        el.remove();
      }, duration);
    }
    return el;
  }

  /** 进度胶囊 */
  function showProgress(text, onCancel) {
    const layer = surface();
    hideProgress();
    const el = document.createElement('div');
    el.className = 'pill';
    el.innerHTML =
      '<span class="spinner"></span><span class="txt"></span>' +
      '<button class="cancel" type="button">停止</button><span class="bar"></span>';
    layer.appendChild(el);
    progress = {
      root: el,
      textEl: el.querySelector('.txt'),
      barEl: el.querySelector('.bar'),
      onCancel: typeof onCancel === 'function' ? onCancel : null
    };
    progress.textEl.textContent = text || '翻译中…';
    const btn = el.querySelector('.cancel');
    btn.addEventListener('click', () => {
      if (progress && progress.onCancel) progress.onCancel();
    });
    return progress;
  }

  function updateProgress(done, total, label) {
    if (!progress) return;
    const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    progress.textEl.textContent = label || '翻译中 ' + done + '/' + total;
    progress.barEl.style.width = percent + '%';
  }

  function hideProgress() {
    if (progress && progress.root && progress.root.parentNode) progress.root.remove();
    progress = null;
  }

  const SPEECH_SUPPORTED = typeof window !== 'undefined' && 'speechSynthesis' in window;

  function speak(text, lang) {
    if (!SPEECH_SUPPORTED) {
      toast('当前浏览器不支持语音朗读');
      return false;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new window.SpeechSynthesisUtterance(String(text || ''));
      utterance.lang = lang || 'zh-CN';
      utterance.rate = 1;
      const voices = window.speechSynthesis.getVoices();
      const matched = voices.find((voice) => voice.lang && voice.lang.toLowerCase().startsWith('zh'));
      if (matched) utterance.voice = matched;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function copyText(text) {
    const value = String(text || '');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (e) {
      /* 回退 */
    }
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(area);
      area.focus();
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function closeBubble() {
    if (bubble && bubble.root && bubble.root.parentNode) bubble.root.remove();
    bubble = null;
    runCleanup();
  }

  function placeBubble(root, rect) {
    const margin = 10;
    const width = root.offsetWidth || 360;
    const height = root.offsetHeight || 160;
    let left = (rect ? rect.left : window.innerWidth / 2) + (rect ? rect.width / 2 : 0) - width / 2;
    left = WUKU.util.clamp(left, 12, window.innerWidth - width - 12);
    let top = rect ? rect.bottom + margin : 80;
    if (top + height > window.innerHeight - 12) {
      top = rect ? rect.top - height - margin : 80;
    }
    if (top < 12) top = 12;
    root.style.left = Math.round(left) + 'px';
    root.style.top = Math.round(top) + 'px';
  }

  function onOutside(event) {
    if (!bubble) return;
    const path = event.composedPath ? event.composedPath() : [];
    if (path.indexOf(bubble.root) !== -1) return;
    closeBubble();
  }

  function attachBubbleDismiss() {
    const handler = (event) => onOutside(event);
    const key = (event) => {
      if (event.key === 'Escape') closeBubble();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', handler, true);
      document.addEventListener('keydown', key, true);
      addCleanup(() => {
        document.removeEventListener('mousedown', handler, true);
        document.removeEventListener('keydown', key, true);
      });
    }, 0);
  }

  /**
   * 展示划词气泡
   * @param {object} options
   * @param {string} options.text 原文
   * @param {DOMRect} options.rect 定位矩形
   * @param {string} options.engineId 当前引擎
   * @param {Array<{id,label}>} options.engines 可切换引擎
   * @param {(engineId:string)=>Promise<{text,engineUsed,degraded,degradedReason}>} options.request 翻译函数
   * @param {(engineId:string)=>void} [options.onEngineChange]
   */
  function showBubble(options) {
    const opts = options || {};
    closeBubble();
    const layer = surface();
    const root = document.createElement('div');
    root.className = 'bubble';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'WUKU 划词翻译');

    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML =
      '<span class="brand"><span class="brand-dot"></span>WUKU 翻译</span>' +
      '<span class="spacer"></span>' +
      '<select class="engine" aria-label="翻译引擎"></select>' +
      '<button class="icon-btn close" type="button" aria-label="关闭">×</button>';

    const origin = document.createElement('div');
    origin.className = 'origin';
    origin.textContent = opts.text;

    const body = document.createElement('div');
    body.className = 'body';
    const translation = document.createElement('div');
    translation.className = 'translation';
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(loading);

    const note = document.createElement('div');
    note.className = 'note';
    note.style.display = 'none';
    body.appendChild(note);

    const foot = document.createElement('div');
    foot.className = 'foot';
    foot.innerHTML =
      '<span class="meta"></span>' +
      '<button class="act copy" type="button">复制</button>' +
      '<button class="act speak" type="button">朗读</button>' +
      '<button class="act retry" type="button">重试</button>';

    root.appendChild(head);
    root.appendChild(origin);
    root.appendChild(body);
    root.appendChild(foot);
    layer.appendChild(root);

    const select = head.querySelector('select');
    const engines = (opts.engines || []).slice();
    const current = opts.engineId || (engines[0] && engines[0].id) || 'google';
    if (!engines.some((item) => item.id === current)) {
      engines.unshift({ id: current, label: WUKU.constants.engineMeta(current).label });
    }
    engines.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      select.appendChild(option);
    });
    select.value = current;

    bubble = {
      root,
      engineId: current,
      text: opts.text,
      translated: '',
      busy: false,
      request: opts.request,
      onEngineChange: opts.onEngineChange || null
    };

    const meta = foot.querySelector('.meta');
    const copyBtn = foot.querySelector('.copy');
    const speakBtn = foot.querySelector('.speak');
    const retryBtn = foot.querySelector('.retry');

    function setBusy(busy) {
      bubble.busy = busy;
      loading.style.display = busy ? 'flex' : 'none';
      if (busy) {
        if (translation.parentNode) translation.remove();
      }
      copyBtn.disabled = busy;
      speakBtn.disabled = busy;
      retryBtn.disabled = busy;
      [copyBtn, speakBtn, retryBtn].forEach((btn) => {
        btn.style.opacity = busy ? '0.5' : '1';
      });
    }

    function renderResult(result) {
      translation.textContent = result.text || '';
      if (!translation.parentNode) body.insertBefore(translation, note);
      bubble.translated = result.text || '';
      const engineLabel = WUKU.constants.engineMeta(result.engineUsed || bubble.engineId).label;
      meta.textContent = engineLabel + (result.degraded ? ' · 已降级' : '');
      if (result.degraded && result.degradedReason) {
        note.className = 'note';
        note.textContent = '主引擎不可用，已降级：' + result.degradedReason;
        note.style.display = 'block';
      } else {
        note.style.display = 'none';
      }
      placeBubble(root, opts.rect);
    }

    function renderError(error) {
      translation.textContent = '';
      if (!translation.parentNode) body.insertBefore(translation, note);
      note.className = 'note err';
      let message = (error && error.message) || '翻译失败';
      if (error && error.code === 'NEED_PERMISSION') {
        message = '需要授权访问 AI 接口域名，请到插件设置页保存配置并授权';
      }
      note.textContent = message;
      note.style.display = 'block';
      meta.textContent = '失败';
      placeBubble(root, opts.rect);
    }

    async function run() {
      if (bubble.busy) return;
      setBusy(true);
      meta.textContent = '翻译中…';
      note.style.display = 'none';
      try {
        const result = await bubble.request(bubble.engineId);
        if (bubble && bubble.root === root) renderResult(result);
      } catch (error) {
        if (bubble && bubble.root === root) renderError(error);
      } finally {
        if (bubble && bubble.root === root) setBusy(false);
      }
    }

    select.addEventListener('change', () => {
      bubble.engineId = select.value;
      if (bubble.onEngineChange) bubble.onEngineChange(select.value);
      run();
    });

    head.querySelector('.close').addEventListener('click', closeBubble);
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(bubble.translated || '');
      copyBtn.textContent = ok ? '已复制' : '复制失败';
      copyBtn.classList.toggle('on', ok);
      setTimeout(() => {
        copyBtn.textContent = '复制';
        copyBtn.classList.remove('on');
      }, 1500);
    });
    speakBtn.addEventListener('click', () => {
      const ok = speak(bubble.translated || '', 'zh-CN');
      speakBtn.textContent = ok ? '朗读中' : '朗读';
      setTimeout(() => {
        speakBtn.textContent = '朗读';
      }, 1500);
    });
    retryBtn.addEventListener('click', run);

    placeBubble(root, opts.rect);
    attachBubbleDismiss();

    if (opts.initialText) {
      translation.textContent = opts.initialText;
      body.insertBefore(translation, note);
      bubble.translated = opts.initialText;
      meta.textContent = opts.initialMeta || '原文已是中文';
      if (opts.initialNotice) {
        note.className = 'note';
        note.textContent = opts.initialNotice;
        note.style.display = 'block';
      }
      loading.style.display = 'none';
      placeBubble(root, opts.rect);
      return;
    }

    run();
  }

  function isInsideUi(event) {
    if (!host) return false;
    const path = event.composedPath ? event.composedPath() : [];
    return path.indexOf(host) !== -1 || (event.target && event.target.id === HOST_ID);
  }

  function destroy() {
    closeBubble();
    hideProgress();
    if (toastTimer) clearTimeout(toastTimer);
    const layer = surface();
    const el = layer && layer.querySelector('.toast');
    if (el) el.remove();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    shadow = null;
  }

  WUKU.ui = {
    ensureHost,
    toast,
    showProgress,
    updateProgress,
    hideProgress,
    showBubble,
    closeBubble,
    speak,
    copyText,
    isInsideUi,
    destroy
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
