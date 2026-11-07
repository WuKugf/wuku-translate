/**
 * 内容脚本编排层
 * 负责：语言检测 → 收集段落 → 去重 → 分批请求 → 渐进渲染 → 进度/错误提示
 */
(function (root) {
  'use strict';

  if (root.__wukuContentLoaded) return;
  root.__wukuContentLoaded = true;

  const WUKU = root.WUKU;

  const runtime = {
    running: false,
    aborted: false,
    mode: null,
    total: 0,
    done: 0,
    translated: 0,
    failed: 0,
    detected: null,
    pageIsChinese: false,
    engine: '',
    degraded: false,
    lastError: null,
    startedAt: 0,
    finishedAt: 0
  };

  function resetRuntime() {
    runtime.running = false;
    runtime.aborted = false;
    runtime.mode = null;
    runtime.total = 0;
    runtime.done = 0;
    runtime.translated = 0;
    runtime.failed = 0;
    runtime.degraded = false;
    runtime.lastError = null;
    runtime.startedAt = 0;
    runtime.finishedAt = 0;
  }

  /** 轻量采样页面语言（不触发 DOM 遍历） */
  function detectPageInfo() {
    let sample = '';
    try {
      sample = (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 6000);
    } catch (e) {
      sample = '';
    }
    if (!sample) {
      sample = Array.from(document.querySelectorAll('p,li,h1,h2,h3'))
        .slice(0, 40)
        .map((el) => el.textContent || '')
        .join('\n')
        .slice(0, 6000);
    }
    const info = WUKU.langDetect.detectPage([sample], document.documentElement.lang);
    return info;
  }

  function getStatus() {
    const pageInfo = runtime.detected || null;
    return {
      ok: true,
      active: WUKU.dom.isActive(),
      mode: WUKU.dom.activeMode(),
      running: runtime.running,
      total: runtime.total,
      done: runtime.done,
      translated: runtime.translated,
      failed: runtime.failed,
      engine: runtime.engine,
      degraded: runtime.degraded,
      detected: pageInfo,
      url: location.href,
      title: document.title
    };
  }

  function chunkSizeFor(settings) {
    const size = Number(settings.chunkSize) || 12;
    return WUKU.util.clamp(size, 4, 30);
  }

  function openOptions() {
    chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {});
  }

  function handleChunkError(error) {
    runtime.lastError = error || { message: '未知错误' };
    const message = runtime.lastError.message || '翻译失败';
    if (error && error.code === 'NEED_PERMISSION') {
      WUKU.ui.toast('需要授权访问 AI 接口域名：' + (error.origin || ''), {
        actionLabel: '去设置',
        onAction: openOptions,
        duration: 8000
      });
    } else if (error && error.code === 'CONFIG') {
      WUKU.ui.toast(message, { actionLabel: '打开设置', onAction: openOptions, duration: 8000 });
    } else {
      WUKU.ui.toast('翻译失败：' + message, {
        actionLabel: '设置',
        onAction: openOptions,
        duration: 6000
      });
    }
  }

  async function requestTexts(texts, engineId, source, target) {
    const response = await chrome.runtime.sendMessage({
      type: 'translate',
      texts,
      engineId,
      source,
      target
    });
    if (!response || !response.ok) {
      throw (response && response.error) || { code: 'UNKNOWN', message: '后台未返回结果' };
    }
    return response.data;
  }

  async function translatePage(requestedMode, options) {
    const opts = options || {};
    if (runtime.running) {
      runtime.aborted = true;
      WUKU.ui.toast('已停止上一轮翻译');
    }

    WUKU.dom.restore();

    const settings = await WUKU.settings.get();
    const resolved = WUKU.settings.resolve(settings, location.href);
    const mode = requestedMode === 'bilingual' ? 'bilingual' : 'immersive';
    const target = resolved.targetLang || 'zh-CN';

    const collected = await WUKU.dom.collect(mode);
    const segments = collected.segments || [];
    if (!segments.length) {
      WUKU.ui.toast('没有找到可翻译的文本（可能是图片、画布或受限页面）');
      return getStatus();
    }

    const pageInfo = WUKU.langDetect.detectPage(
      segments.slice(0, 120).map((segment) => segment.text),
      document.documentElement.lang
    );
    runtime.detected = pageInfo;

    if (!opts.force && resolved.skipChinesePage && pageInfo.isChinese) {
      WUKU.ui.toast('当前页面已是中文，已跳过翻译（可在设置中关闭此判断）', {
        actionLabel: '仍然翻译',
        onAction: () => translatePage(mode, { force: true })
      });
      return getStatus();
    }

    // 相同文本只请求一次
    const uniqueMap = new Map();
    segments.forEach((segment, index) => {
      if (!segment.text) return;
      let entry = uniqueMap.get(segment.text);
      if (!entry) {
        entry = { text: segment.text, indices: [] };
        uniqueMap.set(segment.text, entry);
      }
      entry.indices.push(index);
    });
    const uniqueEntries = Array.from(uniqueMap.values());

    runtime.running = true;
    runtime.aborted = false;
    runtime.mode = mode;
    runtime.total = uniqueEntries.length;
    runtime.done = 0;
    runtime.translated = 0;
    runtime.failed = 0;
    runtime.degraded = false;
    runtime.engine = resolved.engine;
    runtime.lastError = null;
    runtime.startedAt = Date.now();
    runtime.finishedAt = 0;

    const source = pageInfo.lang && pageInfo.lang !== 'zh' && pageInfo.lang !== 'unknown'
      ? pageInfo.lang
      : 'auto';
    const chunkSize = chunkSizeFor(settings);

    WUKU.ui.showProgress('翻译中 0/' + runtime.total, () => {
      runtime.aborted = true;
    });

    let degradedNotified = false;

    for (let cursor = 0; cursor < uniqueEntries.length; cursor += chunkSize) {
      if (runtime.aborted) break;
      const chunk = uniqueEntries.slice(cursor, cursor + chunkSize);
      let data;
      try {
        data = await requestTexts(
          chunk.map((entry) => entry.text),
          resolved.engine,
          source,
          target
        );
      } catch (error) {
        runtime.lastError = error;
        runtime.running = false;
        WUKU.ui.hideProgress();
        if (runtime.translated === 0) {
          handleChunkError(error);
        } else {
          WUKU.ui.toast('翻译中断：' + ((error && error.message) || '请求失败') + '（已保留已完成部分）');
        }
        runtime.finishedAt = Date.now();
        return getStatus();
      }

      const chunkSegments = [];
      const chunkResults = [];
      let chunkTranslated = 0;
      chunk.forEach((entry, offset) => {
        const value = data.results[offset];
        const valid = value && String(value).trim();
        if (valid) chunkTranslated += 1;
        entry.indices.forEach((index) => {
          chunkSegments.push(segments[index]);
          chunkResults.push(valid ? String(value).trim() : null);
        });
      });

      WUKU.dom.apply(mode, chunkSegments, chunkResults);

      runtime.done += chunk.length;
      runtime.translated += chunkTranslated;
      runtime.failed += chunk.length - chunkTranslated;

      if (data.degraded && !runtime.degraded) {
        runtime.degraded = true;
        runtime.engine = data.engineUsed || runtime.engine;
        if (!degradedNotified && settings.fallback !== false) {
          degradedNotified = true;
          WUKU.ui.toast(
            WUKU.constants.engineMeta(resolved.engine).label + ' 不可用，已自动降级为 ' +
            WUKU.constants.engineMeta(data.engineUsed).label +
            (data.degradedReason ? '（' + data.degradedReason + '）' : ''),
            { actionLabel: '设置', onAction: openOptions, duration: 6000 }
          );
        }
      }

      WUKU.ui.updateProgress(runtime.done, runtime.total, '翻译中 ' + runtime.done + '/' + runtime.total);
    }

    runtime.running = false;
    runtime.finishedAt = Date.now();
    WUKU.ui.hideProgress();

    if (runtime.aborted) {
      WUKU.ui.toast(runtime.translated > 0 ? '已停止翻译，保留已完成部分' : '已取消翻译');
    } else if (runtime.translated === 0) {
      WUKU.ui.toast('没有获取到译文，请检查网络或切换翻译引擎');
    } else {
      WUKU.ui.toast(
        '翻译完成：' + runtime.translated + '/' + runtime.total + ' 段' +
        (runtime.failed > 0 ? '，' + runtime.failed + ' 段失败' : '')
      );
    }

    return getStatus();
  }

  async function toggleTranslate() {
    if (WUKU.dom.isActive()) {
      WUKU.dom.restore();
      WUKU.ui.hideProgress();
      resetRuntime();
      WUKU.ui.toast('已恢复原文');
      return getStatus();
    }
    const settings = await WUKU.settings.get();
    const resolved = WUKU.settings.resolve(settings, location.href);
    return translatePage(resolved.mode);
  }

  function restorePage() {
    WUKU.dom.restore();
    WUKU.ui.hideProgress();
    resetRuntime();
    WUKU.ui.toast('已恢复原文');
    return getStatus();
  }

  // 暴露给悬浮球等模块调用的页面级动作
  WUKU.pageActions = {
    translate: (mode) => translatePage(mode),
    toggle: () => toggleTranslate(),
    restore: () => restorePage(),
    isActive: () => WUKU.dom.isActive()
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;

    switch (message.type) {
      case 'ping':
        sendResponse({ ok: true, ready: true, version: WUKU.version });
        return false;
      case 'status':
        sendResponse(getStatus());
        return false;
      case 'translate-page':
        translatePage(message.mode)
          .then((status) => sendResponse(Object.assign({ ok: true }, status)))
          .catch((error) => sendResponse({ ok: false, error: { code: error.code, message: error.message } }));
        return true;
      case 'toggle-translate':
        toggleTranslate()
          .then((status) => sendResponse(Object.assign({ ok: true }, status)))
          .catch((error) => sendResponse({ ok: false, error: { code: error.code, message: error.message } }));
        return true;
      case 'restore':
        sendResponse(restorePage());
        return false;
      case 'stop':
        runtime.aborted = true;
        sendResponse({ ok: true });
        return false;
      case 'translate-selection':
        WUKU.selection
          .translateCurrentSelection(message.text)
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, error: { message: error.message } }));
        return true;
      case 'detect':
        sendResponse({ ok: true, detected: detectPageInfo() });
        return false;
      default:
        return false;
    }
  });

  // 首次可用时清理历史插入节点（例如页面从往返缓存恢复）
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) return;
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
