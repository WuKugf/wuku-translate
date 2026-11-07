/**
 * 划词翻译
 * 监听选区 → 在选区附近弹出气泡；支持引擎切换、复制、朗读。
 */
(function (root) {
  'use strict';

  if (root.__wukuSelectionLoaded) return;
  root.__wukuSelectionLoaded = true;

  const WUKU = (root.WUKU = root.WUKU || {});

  const MAX_SELECTION = 2000;
  let cachedSettings = null;
  let lastRect = null;

  function getSettings() {
    if (cachedSettings) return Promise.resolve(cachedSettings);
    return WUKU.settings.get().then((settings) => {
      cachedSettings = settings;
      return settings;
    });
  }

  WUKU.settings.onChange((settings) => {
    cachedSettings = settings;
  });

  function engineOptions(settings) {
    const meta = WUKU.constants.ENGINE_META;
    return Object.keys(meta).map((id) => ({ id, label: meta[id].label }));
  }

  async function requestTranslation(text, engineId) {
    const settings = await getSettings();
    const info = WUKU.langDetect.detect(text);
    const source = info.lang && info.lang !== 'unknown' ? info.lang : 'auto';
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'translate',
        texts: [text],
        engineId,
        source,
        target: settings.targetLang || 'zh-CN'
      });
    } catch (e) {
      throw { code: 'TAB_UNREACHABLE', message: '扩展后台未响应，请刷新页面后重试' };
    }
    if (!response || !response.ok) {
      throw (response && response.error) || { code: 'UNKNOWN', message: '翻译失败' };
    }
    const data = response.data;
    return {
      text: data.results[0],
      engineUsed: data.engineUsed,
      degraded: data.degraded,
      degradedReason: data.degradedReason
    };
  }

  function rememberEngine(engineId) {
    WUKU.settings.patch({ bubble: { engine: engineId } }).catch(() => {});
    if (cachedSettings) cachedSettings.bubble.engine = engineId;
  }

  async function presentSelection(text, rect) {
    const settings = await getSettings();
    if (!settings.bubble || settings.bubble.enabled === false) return;
    if (!text) return;
    if (text.length > MAX_SELECTION) {
      WUKU.ui.toast('选中文本过长（超过 ' + MAX_SELECTION + ' 字），请分段翻译');
      return;
    }

    const resolved = WUKU.settings.resolve(settings, location.href);
    const preferred = (settings.bubble && settings.bubble.engine) || resolved.engine;

    // 中文内容不必调用接口
    const info = WUKU.langDetect.detect(text);
    if (info.lang === 'zh' && info.cjkRatio >= 0.5 && (settings.targetLang || 'zh-CN').startsWith('zh')) {
      WUKU.ui.showBubble({
        text,
        rect: rect || lastRect,
        engineId: preferred,
        engines: engineOptions(settings),
        initialText: text,
        initialMeta: '中文',
        initialNotice: '选中内容已经是中文，无需翻译',
        request: (engineId) => requestTranslation(text, engineId),
        onEngineChange: rememberEngine
      });
      return;
    }

    WUKU.ui.showBubble({
      text,
      rect: rect || lastRect,
      engineId: preferred,
      engines: engineOptions(settings),
      request: (engineId) => requestTranslation(text, engineId),
      onEngineChange: rememberEngine
    });
  }

  function selectionText() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = String(selection.toString() || '').trim();
    if (!text) return null;
    let rect = null;
    try {
      rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect && rect.width === 0 && rect.height === 0) rect = null;
    } catch (e) {
      rect = null;
    }
    if (rect) lastRect = rect;
    return { text, rect };
  }

  function maybePresent(event) {
    if (WUKU.ui.isInsideUi(event)) return;
    // 鼠标在扩展 UI 上按下后拖动不应触发
    const selection = selectionText();
    if (!selection) return;
    presentSelection(selection.text, selection.rect);
  }

  document.addEventListener('mouseup', (event) => {
    if (event.button !== 0) return;
    setTimeout(() => maybePresent(event), 60);
  }, true);

  document.addEventListener('keyup', (event) => {
    const key = event.key;
    const withModifier = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!withModifier && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
      return;
    }
    setTimeout(() => maybePresent(event), 60);
  }, true);

  /** 来自右键菜单 / 快捷键的显式请求 */
  async function translateCurrentSelection(forcedText) {
    const settings = await getSettings();
    const selection = selectionText();
    const text = String(forcedText || (selection && selection.text) || '').trim();
    if (!text) {
      WUKU.ui.toast('请先选中需要翻译的文本');
      return;
    }
    presentSelection(text, selection ? selection.rect : lastRect);
    if (!settings.bubble || settings.bubble.enabled === false) {
      WUKU.ui.toast('划词气泡已关闭，可在设置页开启');
    }
  }

  WUKU.selection = {
    translateCurrentSelection,
    presentSelection
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
