/**
 * 漫画 / 图片翻译：右键图片菜单触发，AI 视觉识别后在图片上叠加双语译文
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});
  if (WUKU.imageTranslate) return;

  const HOST_ID = 'wuku-image-host';
  const overlays = new Map(); // img -> overlay element

  function findImage(srcUrl) {
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      if (img.src === srcUrl || img.currentSrc === srcUrl || img.dataset.src === srcUrl) return img;
    }
    // 退化为同 origin+pathname 匹配（query 可能不同）
    try {
      const target = new URL(srcUrl);
      for (const img of imgs) {
        try {
          const u = new URL(img.currentSrc || img.src);
          if (u.origin === target.origin && u.pathname === target.pathname) return img;
        } catch (e) { /* 忽略 */ }
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  function ensureStyles() {
    if (document.getElementById('wuku-image-style')) return;
    const style = document.createElement('style');
    style.id = 'wuku-image-style';
    style.textContent = [
      '.wuku-img-overlay{position:absolute;z-index:2147483646;pointer-events:auto;',
      'background:rgba(20,22,30,0.86);color:#fff;border-radius:8px;padding:8px 10px;',
      'font:13px/1.6 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;',
      'overflow:auto;box-shadow:0 8px 28px rgba(0,0,0,0.4);backdrop-filter:blur(4px);}',
      '.wuku-img-overlay .wuku-img-pair{margin:0 0 6px;}',
      '.wuku-img-overlay .wuku-img-src{color:#9aa3b8;font-size:11px;display:block;}',
      '.wuku-img-overlay .wuku-img-dst{color:#ffd76a;font-weight:600;display:block;}',
      '.wuku-img-overlay .wuku-img-close{position:absolute;top:4px;right:6px;border:0;background:transparent;',
      'color:#aab;cursor:pointer;font-size:14px;padding:2px 6px;border-radius:6px;}',
      '.wuku-img-overlay .wuku-img-close:hover{background:rgba(255,255,255,0.14);color:#fff;}',
      '.wuku-img-overlay .wuku-img-loading{color:#cfd6e6;}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function positionOverlay(img, overlay) {
    const rect = img.getBoundingClientRect();
    overlay.style.left = rect.left + window.scrollX + 'px';
    overlay.style.top = rect.top + window.scrollY + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.maxHeight = rect.height + 'px';
  }

  function closeOverlay(img) {
    const overlay = overlays.get(img);
    if (overlay) overlay.remove();
    overlays.delete(img);
  }

  function renderPairs(img, overlay, pairs) {
    overlay.innerHTML = '';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'wuku-img-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => closeOverlay(img));
    overlay.appendChild(closeBtn);

    if (!pairs.length) {
      const empty = document.createElement('div');
      empty.className = 'wuku-img-loading';
      empty.textContent = '未识别到文字';
      overlay.appendChild(empty);
      return;
    }
    pairs.forEach((pair) => {
      const item = document.createElement('p');
      item.className = 'wuku-img-pair';
      if (pair.src) {
        const src = document.createElement('span');
        src.className = 'wuku-img-src';
        src.textContent = pair.src;
        item.appendChild(src);
      }
      const dst = document.createElement('span');
      dst.className = 'wuku-img-dst';
      dst.textContent = pair.dst;
      item.appendChild(dst);
      overlay.appendChild(item);
    });
  }

  function openOptions() {
    chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {});
  }

  async function translateImage(srcUrl) {
    let settings;
    try {
      settings = await WUKU.settings.get();
    } catch (e) {
      settings = null;
    }
    if (settings && settings.imageTranslate && settings.imageTranslate.enabled === false) {
      WUKU.ui.toast('图片翻译功能已在设置中关闭');
      return;
    }

    ensureStyles();
    const img = findImage(srcUrl);
    let overlay;
    if (img) {
      closeOverlay(img);
      overlay = document.createElement('div');
      overlay.className = 'wuku-img-overlay';
      overlay.innerHTML = '<div class="wuku-img-loading">识别翻译中…</div>';
      document.body.appendChild(overlay);
      overlays.set(img, overlay);
      positionOverlay(img, overlay);
    } else {
      WUKU.ui.toast('正在识别图片文字…');
    }

    let data;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'translate-image', srcUrl });
      if (!response || !response.ok) {
        throw (response && response.error) || { message: '识别失败' };
      }
      data = response.data;
    } catch (error) {
      if (img && overlay) closeOverlay(img);
      if (error && error.code === 'NEED_PERMISSION') {
        WUKU.ui.toast('需要授权访问图片域名 ' + (error.origin || '') + '，请到设置中授权', {
          actionLabel: '去设置',
          onAction: openOptions,
          duration: 8000
        });
      } else if (error && error.code === 'CONFIG') {
        WUKU.ui.toast((error.message || '图片翻译需要配置 AI 接口'), {
          actionLabel: '去设置',
          onAction: openOptions,
          duration: 8000
        });
      } else {
        WUKU.ui.toast('图片翻译失败：' + ((error && error.message) || '未知错误'), { duration: 5000 });
      }
      return;
    }

    const pairs = (data && data.pairs) || [];
    if (img && overlay) {
      renderPairs(img, overlay, pairs);
    } else {
      // 找不到对应 <img>（如背景图）：用翻译面板展示结果
      const text = pairs.map((p) => (p.src ? p.src + '\n' + p.dst : p.dst)).join('\n\n');
      if (WUKU.panel) WUKU.panel.open(text || '');
      WUKU.ui.toast('识别完成，结果已放入翻译面板');
    }
  }

  // 跟随页面滚动 / 缩放重新定位
  function repositionAll() {
    overlays.forEach((overlay, img) => {
      if (!img.isConnected) {
        closeOverlay(img);
        return;
      }
      positionOverlay(img, overlay);
    });
  }
  window.addEventListener('scroll', repositionAll, true);
  window.addEventListener('resize', repositionAll);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'translate-image') return false;
    translateImage(message.srcUrl).then(() => sendResponse({ ok: true }));
    return true;
  });

  WUKU.imageTranslate = { translate: translateImage };
})(typeof globalThis !== 'undefined' ? globalThis : self);
