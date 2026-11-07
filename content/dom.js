/**
 * DOM 遍历与渲染
 * - 纯译文（immersive）：逐个文本节点替换，保留段落内的行内标签与空白节奏
 * - 双语对照（bilingual）：按「块级元素的自身文本」翻译，把译文插入块内（或其后），不改动原文
 * - 支持随时还原，页面动态变化时不会误伤已被改写的节点
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'CODE', 'PRE', 'KBD', 'SAMP',
    'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED',
    'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'OPTGROUP', 'HEAD', 'META',
    'LINK', 'TITLE', 'BR', 'WBR', 'HR'
  ]);

  const BLOCK_DISPLAYS = new Set([
    'block', 'flow-root', 'list-item', 'table', 'table-row-group', 'table-header-group',
    'table-footer-group', 'table-row', 'table-cell', 'flex', 'grid',
    'inline-block', 'inline-flex', 'inline-grid'
  ]);

  const FLEX_DISPLAYS = new Set(['flex', 'inline-flex', 'grid', 'inline-grid']);

  const MAX_TEXT_LEN = 6000;

  const state = {
    mode: null,
    active: false,
    running: false,
    records: [],
    inserted: []
  };

  const styleCache = new WeakMap();
  const blockCache = new WeakMap();

  function getStyle(el) {
    let cached = styleCache.get(el);
    if (!cached) {
      const cs = getComputedStyle(el);
      cached = { display: cs.display, visibility: cs.visibility, fontSize: cs.fontSize, lineHeight: cs.lineHeight, color: cs.color, fontFamily: cs.fontFamily, textAlign: cs.textAlign, fontWeight: cs.fontWeight };
      styleCache.set(el, cached);
    }
    return cached;
  }

  function isBlockLevel(el) {
    let cached = blockCache.get(el);
    if (cached === undefined) {
      cached = BLOCK_DISPLAYS.has(getStyle(el).display);
      blockCache.set(el, cached);
    }
    return cached;
  }

  function isSkippedElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.getAttribute('translate') === 'no') return true;
    if (el.classList && (el.classList.contains('notranslate') || el.classList.contains('wuku-bi'))) return true;
    if (el.hasAttribute('data-wuku')) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function isVisibleElement(el) {
    const cs = getStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (!el.getClientRects().length) return false;
    return true;
  }

  function isTranslatable(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return false;
    if (trimmed.length > MAX_TEXT_LEN) return false;
    if (!/\p{L}/u.test(trimmed)) return false;
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(trimmed)) return false;
    if (/^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(trimmed)) return false;
    if (/^[A-Z][A-Z0-9&+.\-/]{1,5}$/.test(trimmed)) return false; // 纯缩写：HTML / API / CPU
    if (trimmed.length <= 1 && !WUKU.langDetect.isChineseText(trimmed)) return false;
    return true;
  }

  function textNodeOk(node) {
    const parent = node.parentElement;
    if (!parent) return false;
    if (isSkippedElement(parent)) return false;
    if (!isTranslatable(node.nodeValue)) return false;
    if (!isVisibleElement(parent)) return false;
    return true;
  }

  /**
   * 纯译文模式：收集所有可翻译的文本节点
   */
  function collectTextNodes() {
    const segments = [];
    if (!document.body) return segments;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (isSkippedElement(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_SKIP; // 跳过元素本身，继续遍历子节点
          }
          return textNodeOk(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const original = node.nodeValue;
        const lead = (original.match(/^\s*/) || [''])[0];
        const trail = (original.match(/\s*$/) || [''])[0];
        segments.push({
          id: segments.length,
          text: original.trim(),
          node,
          original,
          lead,
          trail
        });
      }
      node = walker.nextNode();
    }
    return segments;
  }

  /**
   * 双语模式：收集「块级元素自身文本」
   */
  function collectBlocks() {
    const segments = [];
    if (!document.body) return segments;

    function directOwnText(el) {
      let text = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          text += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (isSkippedElement(child) || isBlockLevel(child)) continue;
          text += child.textContent;
        }
      }
      return text;
    }

    function blockChildrenOf(el) {
      return Array.from(el.children).filter(
        (child) => isBlockLevel(child) && !isSkippedElement(child) && isVisibleElement(child)
      );
    }

    function visit(el, depth) {
      if (depth > 40) return;
      if (isSkippedElement(el)) return;
      if (!isVisibleElement(el)) return;

      const blockChildren = blockChildrenOf(el);
      const own = directOwnText(el);
      if (isTranslatable(own)) {
        segments.push({
          id: segments.length,
          text: WUKU.util.normalizeSpace(own),
          el,
          flex: FLEX_DISPLAYS.has(getStyle(el).display),
          firstBlockChild: blockChildren[0] || null
        });
      }

      for (const child of blockChildren) visit(child, depth + 1);
    }

    visit(document.body, 0);
    return segments;
  }

  function wrapTranslation(text) {
    const wrap = document.createElement('div');
    wrap.className = 'wuku-bi';
    wrap.setAttribute('data-wuku', 'bi');
    wrap.textContent = text;
    return wrap;
  }

  function styleAsSibling(node, sourceEl) {
    const cs = getStyle(sourceEl);
    node.style.fontSize = cs.fontSize;
    node.style.lineHeight = cs.lineHeight;
    node.style.fontFamily = cs.fontFamily;
    node.style.color = cs.color;
    node.style.fontWeight = cs.fontWeight;
    node.style.textAlign = cs.textAlign;
    node.style.marginTop = '0.35em';
    node.style.display = 'block';
  }

  function applyImmersive(segments, results) {
    segments.forEach((segment, index) => {
      const translated = results[index];
      if (!translated || typeof translated !== 'string') return;
      const node = segment.node;
      if (!node || !node.isConnected) return;
      if (node.nodeValue !== segment.original) return; // 页面内容已更新，跳过避免破坏
      state.records.push({ node, original: segment.original });
      node.nodeValue = segment.lead + translated + segment.trail;
    });
  }

  function applyBilingual(segments, results) {
    segments.forEach((segment, index) => {
      const translated = results[index];
      if (!translated || typeof translated !== 'string') return;
      const el = segment.el;
      if (!el || !el.isConnected) return;
      if (el.querySelector(':scope > .wuku-bi')) return; // 已插入过

      const node = wrapTranslation(translated);
      if (segment.flex) {
        if (el.parentElement) {
          styleAsSibling(node, el);
          el.parentElement.insertBefore(node, el.nextSibling);
          state.inserted.push(node);
        }
      } else if (segment.firstBlockChild) {
        el.insertBefore(node, segment.firstBlockChild);
        state.inserted.push(node);
      } else {
        el.appendChild(node);
        state.inserted.push(node);
      }
    });
  }

  async function collect(mode) {
    const segments = mode === 'bilingual' ? collectBlocks() : collectTextNodes();
    return { segments, mode };
  }

  function apply(mode, segments, results) {
    if (!segments || !results) return 0;
    if (mode === 'bilingual') applyBilingual(segments, results);
    else applyImmersive(segments, results);
    state.mode = mode;
    state.active = true;
    let applied = 0;
    for (let i = 0; i < results.length; i += 1) {
      if (results[i]) applied += 1;
    }
    return applied;
  }

  function restore() {
    for (const record of state.records) {
      try {
        if (record.node && record.node.isConnected) record.node.nodeValue = record.original;
      } catch (e) {
        /* 忽略游离节点 */
      }
    }
    state.records = [];

    for (const node of state.inserted) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
    state.inserted = [];

    // 兜底：清理可能残留的插入节点
    const leftovers = document.querySelectorAll('[data-wuku="bi"]');
    leftovers.forEach((node) => node.parentNode && node.parentNode.removeChild(node));

    state.mode = null;
    state.active = false;
  }

  function isActive() {
    return state.active && (state.records.length > 0 || state.inserted.length > 0);
  }

  function activeMode() {
    return state.mode;
  }

  WUKU.dom = {
    collect,
    apply,
    restore,
    isActive,
    activeMode,
    isTranslatable,
    state
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
