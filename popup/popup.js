/**
 * 工具栏弹窗
 */
(function () {
  'use strict';

  const LANG_LABEL = {
    en: '英语', ja: '日语', ko: '韩语', ru: '俄语', fr: '法语', de: '德语',
    es: '西班牙语', pt: '葡萄牙语', it: '意大利语', nl: '荷兰语', ar: '阿拉伯语',
    th: '泰语', vi: '越南语', id: '印尼语', tr: '土耳其语', pl: '波兰语',
    hi: '印地语', zh: '中文', auto: '未知语言', unknown: '未知语言', '': ''
  };

  const els = {
    host: document.getElementById('host'),
    statusText: document.getElementById('statusText'),
    statusMeta: document.getElementById('statusMeta'),
    statusDot: document.getElementById('statusDot'),
    modeGroup: document.getElementById('modeGroup'),
    primary: document.getElementById('primary'),
    restore: document.getElementById('restore'),
    engine: document.getElementById('engine'),
    skipChinese: document.getElementById('skipChinese'),
    permissionNotice: document.getElementById('permissionNotice'),
    permissionText: document.getElementById('permissionText'),
    grantPermission: document.getElementById('grantPermission'),
    cacheInfo: document.getElementById('cacheInfo'),
    openOptions: document.getElementById('openOptions'),
    shortcuts: document.getElementById('shortcuts'),
    openPanel: document.getElementById('openPanel'),
    floatBall: document.getElementById('floatBall'),
    subtitle: document.getElementById('subtitle'),
    inputTrans: document.getElementById('inputTrans'),
    imageTrans: document.getElementById('imageTrans')
  };

  let settings = null;
  let tab = null;
  let status = null;
  let pageInfo = null;
  let permissionTarget = '';
  let polling = null;

  function langLabel(code) {
    return LANG_LABEL[code] || (code ? code.toUpperCase() : '');
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  async function loadSettings() {
    settings = await WUKU.settings.get();
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function ensureContent() {
    if (!tab || !tab.id) return false;
    try {
      const pong = await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
      if (pong && pong.ok) return true;
    } catch (e) {
      /* 未注入 */
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: WUKU.constants.CONTENT_FILES
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['styles/content.css']
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  async function message(type, payload) {
    const body = Object.assign({ type }, payload || {});
    return chrome.tabs.sendMessage(tab.id, body);
  }

  async function runtimeMessage(type, payload) {
    const response = await chrome.runtime.sendMessage(Object.assign({ type }, payload || {}));
    if (!response || !response.ok) {
      throw (response && response.error) || { message: '后台无响应' };
    }
    return response.data;
  }

  function renderMode() {
    const effective = (status && status.active && status.mode) || (status && status.mode) || settings.mode;
    const buttons = els.modeGroup.querySelectorAll('button');
    buttons.forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === effective);
      button.setAttribute('aria-selected', button.dataset.mode === effective ? 'true' : 'false');
    });
  }

  function renderStatus() {
    const busy = !!(status && status.running);
    els.primary.disabled = false;
    els.restore.disabled = !(status && (status.active || status.running));

    if (!tab || !tab.url || !/^http/.test(tab.url)) {
      els.statusDot.className = 'dot warn';
      els.statusText.textContent = '当前页面不支持翻译';
      els.statusMeta.textContent = '浏览器内置页面（chrome://）或扩展商店页面无法注入脚本';
      els.primary.disabled = true;
      els.primary.textContent = '翻译整页';
      els.restore.disabled = true;
      return;
    }

    if (busy) {
      els.statusDot.className = 'dot busy';
      els.statusText.textContent = '正在翻译…';
      els.statusMeta.textContent = (status.done || 0) + ' / ' + (status.total || 0) + ' 段 · 引擎 ' +
        WUKU.constants.engineMeta(status.engine).label;
      els.primary.textContent = '停止翻译';
      els.primary.disabled = false;
      els.restore.disabled = false;
      return;
    }

    els.primary.textContent = status && status.active ? '重新翻译' : '翻译整页';

    if (status && status.active) {
      els.statusDot.className = 'dot ok';
      els.statusText.textContent = status.mode === 'bilingual' ? '双语对照已开启' : '整页翻译已开启';
      const meta = ['已翻译 ' + (status.translated || 0) + ' 段'];
      if (status.degraded) meta.push('已降级为 ' + WUKU.constants.engineMeta(status.engine).label);
      els.statusMeta.textContent = meta.join(' · ');
      return;
    }

    const info = status && status.detected ? status.detected : pageInfo;
    if (info && info.isChinese) {
      els.statusDot.className = 'dot warn';
      els.statusText.textContent = '中文页面';
      els.statusMeta.textContent = '已按设置跳过（可关闭「仅翻译非中文页面」后强制翻译）';
    } else if (info) {
      els.statusDot.className = 'dot ok';
      els.statusText.textContent = '可翻译 · ' + langLabel(info.lang);
      els.statusMeta.textContent = '原文语言检测置信度 ' + Math.round((info.confidence || 0) * 100) + '%';
    } else {
      els.statusDot.className = 'dot';
      els.statusText.textContent = '待翻译';
      els.statusMeta.textContent = '点击下方按钮开始翻译当前页面';
    }
  }

  function currentEngineSelection() {
    const host = hostOf(tab && tab.url);
    const resolved = WUKU.settings.resolve(settings, tab ? tab.url : '');
    const exactRule = (settings.siteRules || []).find((rule) => rule.pattern === host);
    return exactRule ? exactRule.engine : '__default';
  }

  function renderEngine() {
    const meta = WUKU.constants.ENGINE_META;
    els.engine.innerHTML = '';
    const def = document.createElement('option');
    def.value = '__default';
    def.textContent = '跟随全局（' + meta[settings.engine].label + '）';
    els.engine.appendChild(def);
    Object.keys(meta).forEach((id) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = meta[id].label;
      els.engine.appendChild(option);
    });
    els.engine.value = currentEngineSelection();
  }

  async function refreshPermission() {
    const resolved = WUKU.settings.resolve(settings, tab ? tab.url : '');
    const engine = currentEngineSelection() === '__default' ? resolved.engine : els.engine.value;
    const target = engine === 'ai' ? settings.ai.baseUrl : engine === 'custom' ? settings.custom.url : '';
    permissionTarget = target || '';
    if (!target) {
      if (engine === 'ai' || engine === 'custom') {
        els.permissionNotice.hidden = false;
        els.permissionText.textContent = '尚未配置 ' + WUKU.constants.engineMeta(engine).label + '，无法使用。';
        els.grantPermission.textContent = '去设置';
        permissionTarget = '';
      } else {
        els.permissionNotice.hidden = true;
      }
      return;
    }
    const granted = await WUKU.net.hasHostPermission(target);
    if (granted) {
      els.permissionNotice.hidden = true;
      return;
    }
    els.permissionNotice.hidden = false;
    els.permissionText.textContent = '尚未授权访问 ' + WUKU.util.originOf(target) + '，请求会被浏览器拦截。';
    els.grantPermission.textContent = '授权访问';
  }

  async function refreshStatus() {
    const reachable = await ensureContent();
    if (!reachable) {
      status = null;
      pageInfo = null;
      renderStatus();
      return;
    }
    try {
      status = await message('status');
      if (!status.active && !status.running) {
        const detected = await message('detect');
        pageInfo = detected && detected.detected;
      }
    } catch (e) {
      status = null;
      pageInfo = null;
    }
    renderStatus();
    renderMode();
  }

  async function loadCacheInfo() {
    try {
      const stats = await runtimeMessage('cache-stats');
      const total = (stats.hits || 0) + (stats.misses || 0);
      const rate = total ? Math.round((stats.hits / total) * 100) : 0;
      els.cacheInfo.textContent = '缓存 ' + stats.entries + ' 条 · 命中率 ' + rate + '%';
    } catch (e) {
      els.cacheInfo.textContent = '缓存统计不可用';
    }
  }

  function startPolling() {
    stopPolling();
    polling = setInterval(async () => {
      if (!tab || !tab.id) return;
      try {
        const latest = await message('status');
        if (latest) {
          status = latest;
          renderStatus();
          renderMode();
        }
        if (!latest || (!latest.running && !latest.active)) {
          if (!latest || !latest.running) stopPolling();
        }
      } catch (e) {
        stopPolling();
      }
    }, 700);
  }

  function stopPolling() {
    if (polling) clearInterval(polling);
    polling = null;
  }

  function bindEvents() {
    els.primary.addEventListener('click', async () => {
      if (!tab) return;
      if (status && status.running) {
        await message('stop');
        els.primary.textContent = '翻译整页';
        setTimeout(refreshStatus, 400);
        return;
      }
      const mode = (status && status.mode) || settings.mode;
      els.primary.disabled = true;
      els.primary.textContent = '翻译中…';
      startPolling();
      message('translate-page', { mode })
        .catch(() => {})
        .then(() => setTimeout(refreshStatus, 250));
    });

    els.restore.addEventListener('click', async () => {
      if (!tab) return;
      await message('restore');
      setTimeout(refreshStatus, 150);
    });

    els.modeGroup.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-mode]');
      if (!button) return;
      const mode = button.dataset.mode;
      settings = await WUKU.settings.patch({ mode });
      renderMode();
      if (status && (status.active || status.running)) {
        message('translate-page', { mode }).catch(() => {});
        startPolling();
      }
    });

    els.engine.addEventListener('change', async () => {
      const value = els.engine.value;
      const host = hostOf(tab && tab.url);
      if (!host) return;
      const rules = (settings.siteRules || []).filter((rule) => rule.pattern !== host);
      if (value !== '__default') rules.push({ pattern: host, engine: value });
      settings = await WUKU.settings.patch({ siteRules: rules });
      await refreshPermission();
    });

    els.skipChinese.addEventListener('change', async () => {
      settings = await WUKU.settings.patch({ skipChinesePage: els.skipChinese.checked });
    });

    els.openPanel.addEventListener('click', async () => {
      if (!tab) return;
      const reachable = await ensureContent();
      if (!reachable) return;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => { if (window.WUKU && WUKU.panel) WUKU.panel.toggle(); }
        });
        window.close();
      } catch (e) {
        /* 页面受限 */
      }
    });

    els.floatBall.addEventListener('change', async () => {
      settings = await WUKU.settings.patch({ floatBall: { enabled: els.floatBall.checked } });
    });

    els.subtitle.addEventListener('change', async () => {
      settings = await WUKU.settings.patch({ subtitle: { enabled: els.subtitle.checked } });
    });

    els.inputTrans.addEventListener('change', async () => {
      settings = await WUKU.settings.patch({ input: { enabled: els.inputTrans.checked } });
    });

    els.imageTrans.addEventListener('change', async () => {
      settings = await WUKU.settings.patch({ imageTranslate: { enabled: els.imageTrans.checked } });
    });

    els.grantPermission.addEventListener('click', async () => {
      if (!permissionTarget) {
        chrome.runtime.openOptionsPage();
        return;
      }
      const granted = await WUKU.net.requestHostPermission(permissionTarget);
      if (!granted) {
        els.permissionText.textContent = '授权被取消，' + WUKU.util.originOf(permissionTarget) + ' 的请求仍会被拦截。';
        return;
      }
      await refreshPermission();
    });

    els.openOptions.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    els.shortcuts.addEventListener('click', (event) => {
      event.preventDefault();
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }

  async function init() {
    bindEvents();
    await loadSettings();
    tab = await getActiveTab();

    els.host.textContent = tab && tab.url ? (hostOf(tab.url) || tab.url) : '无法读取当前页面';
    els.skipChinese.checked = settings.skipChinesePage;
    els.floatBall.checked = !settings.floatBall || settings.floatBall.enabled !== false;
    els.subtitle.checked = !!(settings.subtitle && settings.subtitle.enabled);
    els.inputTrans.checked = !settings.input || settings.input.enabled !== false;
    els.imageTrans.checked = !settings.imageTranslate || settings.imageTranslate.enabled !== false;
    renderEngine();
    renderMode();
    renderStatus();

    await refreshStatus();
    await refreshPermission();
    await loadCacheInfo();

    window.addEventListener('unload', stopPolling);
  }

  init().catch((error) => {
    els.statusText.textContent = '弹窗初始化失败';
    els.statusMeta.textContent = (error && error.message) || String(error);
  });
})();
