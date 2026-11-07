/**
 * 悬浮球：半透明胶囊、贴边、置顶，点击展开功能菜单
 * 菜单：翻译页面 / 双语对照 / 显示原文 / 翻译面板 / 视频字幕开关 / 设置
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});
  if (WUKU.ball) return;

  const HOST_ID = 'wuku-ball-host';
  let host = null;
  let shadow = null;
  let ballEl = null;
  let menuEl = null;
  let cfg = null;
  let menuOpen = false;
  let dragState = null;
  let moved = false;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    .wuku-ball {
      position: fixed; z-index: 2147483647;
      width: 44px; height: 40px; border-radius: 20px;
      display: flex; align-items: center; justify-content: center; gap: 4px;
      cursor: pointer; user-select: none; -webkit-user-select: none;
      background: linear-gradient(135deg, #4f7cff, #8a4fff);
      color: #fff; box-shadow: 0 6px 18px rgba(79, 124, 255, 0.45);
      transition: box-shadow 160ms, opacity 160ms, border-radius 200ms;
      pointer-events: auto; touch-action: none;
      font-size: 13px; font-weight: 600;
    }
    .wuku-ball.translucent {
      background: linear-gradient(135deg, rgba(79,124,255,0.62), rgba(138,79,255,0.62));
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,0.35);
    }
    .wuku-ball:hover { box-shadow: 0 8px 24px rgba(79,124,255,0.6); }
    .wuku-ball .dot {
      width: 14px; height: 14px; border-radius: 4px;
      background: rgba(255,255,255,0.95);
      display: inline-block;
    }
    .wuku-ball.edge-right { border-top-right-radius: 0; border-bottom-right-radius: 0; }
    .wuku-ball.edge-left { border-top-left-radius: 0; border-bottom-left-radius: 0; }
    .wuku-ball.dragging { transition: none; opacity: 0.9; }
    .wuku-menu {
      position: fixed; z-index: 2147483647;
      min-width: 150px; padding: 6px;
      background: rgba(255,255,255,0.97);
      border: 1px solid rgba(20,24,40,0.1); border-radius: 12px;
      box-shadow: 0 12px 34px rgba(16,24,60,0.22);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      pointer-events: auto;
      animation: wuku-menu-in 150ms ease-out;
    }
    @keyframes wuku-menu-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .wuku-menu button {
      display: flex; align-items: center; gap: 8px;
      width: 100%; border: 0; background: transparent;
      padding: 8px 10px; border-radius: 8px; cursor: pointer;
      font-size: 13px; color: #242a3a; text-align: left;
    }
    .wuku-menu button:hover { background: rgba(79,124,255,0.1); }
    .wuku-menu button .ico { width: 16px; text-align: center; opacity: 0.75; }
    .wuku-menu .sep { height: 1px; background: rgba(20,24,40,0.08); margin: 4px 6px; }
    .wuku-menu .state { margin-left: auto; font-size: 11px; color: #8b93a8; }
    @media (prefers-color-scheme: dark) {
      .wuku-menu { background: rgba(28,31,40,0.96); border-color: rgba(255,255,255,0.1); }
      .wuku-menu button { color: #e6eaf5; }
      .wuku-menu button:hover { background: rgba(79,124,255,0.22); }
      .wuku-menu .sep { background: rgba(255,255,255,0.09); }
      .wuku-menu .state { color: #8d95ab; }
    }
  `;

  function ensure() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: block;';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    (document.documentElement || document.body).appendChild(host);
  }

  function positionBall(animate) {
    if (!ballEl || !cfg) return;
    const top = Math.max(8, Math.min(window.innerHeight - 48, cfg.top || 140));
    ballEl.style.top = top + 'px';
    ballEl.style.left = '';
    ballEl.style.right = '';
    if (cfg.side === 'left') {
      ballEl.style.left = '0px';
      ballEl.classList.add('edge-left');
      ballEl.classList.remove('edge-right');
    } else {
      ballEl.style.right = '0px';
      ballEl.classList.add('edge-right');
      ballEl.classList.remove('edge-left');
    }
  }

  function buildBall() {
    ensure();
    if (ballEl) ballEl.remove();
    ballEl = document.createElement('div');
    ballEl.className = 'wuku-ball' + (cfg.translucent !== false ? ' translucent' : '');
    ballEl.setAttribute('role', 'button');
    ballEl.setAttribute('title', 'WUKU 翻译');
    ballEl.innerHTML = '<span class="dot"></span><span>译</span>';
    shadow.appendChild(ballEl);
    positionBall();

    ballEl.addEventListener('pointerdown', onDown);
    ballEl.addEventListener('click', onClick);
  }

  function onDown(e) {
    moved = false;
    const rect = ballEl.getBoundingClientRect();
    dragState = { startY: e.clientY, origTop: rect.top, pointerId: e.pointerId };
    ballEl.setPointerCapture(e.pointerId);
    ballEl.classList.add('dragging');
    ballEl.addEventListener('pointermove', onMove);
    ballEl.addEventListener('pointerup', onUp, { once: true });
  }

  function onMove(e) {
    if (!dragState) return;
    const dy = e.clientY - dragState.startY;
    if (Math.abs(dy) > 4) {
      moved = true;
      closeMenu();
    }
    const top = Math.max(8, Math.min(window.innerHeight - 48, dragState.startY + dy));
    ballEl.style.top = top + 'px';
    // 横向超过一半时换边
    const x = e.clientX;
    const side = x < window.innerWidth / 2 ? 'left' : 'right';
    if (side !== cfg.side) {
      cfg.side = side;
      positionBall();
    }
  }

  async function onUp() {
    ballEl.classList.remove('dragging');
    ballEl.removeEventListener('pointermove', onMove);
    if (dragState) {
      const rect = ballEl.getBoundingClientRect();
      cfg.top = Math.round(rect.top);
      dragState = null;
      try {
        await WUKU.settings.patch({ floatBall: { side: cfg.side, top: cfg.top } });
      } catch (e) {
        /* 忽略持久化失败 */
      }
    }
  }

  function onClick() {
    if (moved) return; // 拖拽后的 click 不触发菜单
    if (menuOpen) closeMenu();
    else openMenu();
  }

  function menuButton(icon, label, state, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '<span class="ico">' + icon + '</span><span>' + label + '</span>' +
      (state ? '<span class="state">' + state + '</span>' : '');
    btn.addEventListener('click', () => {
      closeMenu();
      onClick();
    });
    return btn;
  }

  function openMenu() {
    if (menuEl) menuEl.remove();
    menuEl = document.createElement('div');
    menuEl.className = 'wuku-menu';

    menuEl.appendChild(menuButton('文', '翻译页面', '', () => {
      if (WUKU.pageActions) WUKU.pageActions.translate('immersive');
    }));
    menuEl.appendChild(menuButton('双', '双语对照', '', () => {
      if (WUKU.pageActions) WUKU.pageActions.translate('bilingual');
    }));
    menuEl.appendChild(menuButton('原', '显示原文', '', () => {
      if (WUKU.pageActions) WUKU.pageActions.restore();
    }));
    const sep1 = document.createElement('div');
    sep1.className = 'sep';
    menuEl.appendChild(sep1);
    menuEl.appendChild(menuButton('⌨', '翻译面板', '', () => {
      if (WUKU.panel) WUKU.panel.toggle();
    }));
    const subOn = !!(currentSubtitleEnabled());
    menuEl.appendChild(menuButton('字', '视频字幕', subOn ? '已开启' : '已关闭', async () => {
      const next = !subOn;
      await WUKU.settings.patch({ subtitle: { enabled: next } }).catch(() => {});
      if (WUKU.subtitleCtl) WUKU.subtitleCtl.setEnabled(next);
      if (WUKU.ui) WUKU.ui.toast(next ? '视频双语字幕已开启' : '视频双语字幕已关闭');
    }));
    const sep2 = document.createElement('div');
    sep2.className = 'sep';
    menuEl.appendChild(sep2);
    menuEl.appendChild(menuButton('⚙', '设置', '', () => {
      chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {});
    }));

    shadow.appendChild(menuEl);
    const rect = ballEl.getBoundingClientRect();
    const menuRect = menuEl.getBoundingClientRect();
    let top = rect.top;
    if (top + menuRect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - menuRect.height - 8);
    }
    menuEl.style.top = top + 'px';
    if (cfg.side === 'left') {
      menuEl.style.left = rect.width + 8 + 'px';
    } else {
      menuEl.style.right = rect.width + 8 + 'px';
    }
    menuOpen = true;

    setTimeout(() => {
      document.addEventListener('pointerdown', onOutside, true);
    }, 0);
  }

  function onOutside(e) {
    if (!menuOpen) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (path.includes(ballEl) || (menuEl && path.includes(menuEl))) return;
    closeMenu();
  }

  function closeMenu() {
    if (menuEl) menuEl.remove();
    menuEl = null;
    menuOpen = false;
    document.removeEventListener('pointerdown', onOutside, true);
  }

  function currentSubtitleEnabled() {
    return cfg && cfg.subtitleEnabled;
  }

  function teardown() {
    closeMenu();
    if (host) host.remove();
    host = null;
    shadow = null;
    ballEl = null;
  }

  function applyConfig(full) {
    cfg = Object.assign({}, (full && full.floatBall) || {});
    cfg.subtitleEnabled = !!(full && full.subtitle && full.subtitle.enabled);
    if (!cfg.enabled) {
      teardown();
      return;
    }
    buildBall();
  }

  async function init() {
    let settings;
    try {
      settings = await WUKU.settings.get();
    } catch (e) {
      return;
    }
    applyConfig(settings);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[WUKU.constants.STORAGE_SETTINGS]) {
        WUKU.settings.get().then(applyConfig).catch(() => {});
      }
    });

    window.addEventListener('resize', () => positionBall());
  }

  WUKU.ball = { refresh: init, teardown };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
