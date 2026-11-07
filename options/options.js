/**
 * 设置页逻辑
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let settings = null;
  let hintTimers = {};

  const els = {
    nav: $('nav'),
    mode: $('mode'),
    engine: $('engine'),
    targetLang: $('targetLang'),
    chunkSize: $('chunkSize'),
    skipChinesePage: $('skipChinesePage'),
    fallback: $('fallback'),
    bubbleEnabled: $('bubbleEnabled'),
    bubbleEngine: $('bubbleEngine'),
    saveGeneral: $('saveGeneral'),
    generalHint: $('generalHint'),
    openShortcuts: $('openShortcuts'),

    aiBaseUrl: $('aiBaseUrl'),
    aiApiKey: $('aiApiKey'),
    aiModel: $('aiModel'),
    aiTemperature: $('aiTemperature'),
    aiTemperatureValue: $('aiTemperatureValue'),
    aiBatchSize: $('aiBatchSize'),
    aiExtraHeaders: $('aiExtraHeaders'),
    aiJsonMode: $('aiJsonMode'),
    aiPrompt: $('aiPrompt'),
    resetPrompt: $('resetPrompt'),
    saveAi: $('saveAi'),
    testAi: $('testAi'),
    aiHint: $('aiHint'),
    aiResult: $('aiResult'),

    customUrl: $('customUrl'),
    customMethod: $('customMethod'),
    customHeaders: $('customHeaders'),
    customBody: $('customBody'),
    customResponsePath: $('customResponsePath'),
    customBatch: $('customBatch'),
    saveCustom: $('saveCustom'),
    testCustom: $('testCustom'),
    customHint: $('customHint'),
    customResult: $('customResult'),

    rulePattern: $('rulePattern'),
    ruleEngine: $('ruleEngine'),
    ruleMode: $('ruleMode'),
    addRule: $('addRule'),
    ruleHint: $('ruleHint'),
    ruleList: $('ruleList'),

    cacheStats: $('cacheStats'),
    cacheEnabled: $('cacheEnabled'),
    cacheMaxEntries: $('cacheMaxEntries'),
    saveCache: $('saveCache'),
    clearCache: $('clearCache'),
    cacheHint: $('cacheHint'),
    resetAll: $('resetAll'),

    ballEnabled: $('ballEnabled'),
    ballTranslucent: $('ballTranslucent'),
    ballPinned: $('ballPinned'),
    ballSide: $('ballSide'),
    subtitleEnabled: $('subtitleEnabled'),
    subtitleBilingual: $('subtitleBilingual'),
    subtitleSelectors: $('subtitleSelectors'),
    inputEnabled: $('inputEnabled'),
    inputTargetLang: $('inputTargetLang'),
    inputMode: $('inputMode'),
    imageEnabled: $('imageEnabled'),
    imageModel: $('imageModel'),
    imageTargetLang: $('imageTargetLang'),
    imageOrigin: $('imageOrigin'),
    grantImageOrigin: $('grantImageOrigin'),
    saveFeatures: $('saveFeatures'),
    featuresHint: $('featuresHint')
  };

  function showHint(el, message, type) {
    const key = el.id;
    el.textContent = message;
    el.className = 'save-hint' + (type ? ' ' + type : '');
    if (hintTimers[key]) clearTimeout(hintTimers[key]);
    hintTimers[key] = setTimeout(() => {
      el.textContent = '';
      el.className = 'save-hint';
    }, 4200);
  }

  function selectOptions(select, items, current) {
    select.innerHTML = '';
    items.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });
    if (current !== undefined) select.value = current;
  }

  function engineItems(extraDefaultLabel) {
    const items = [];
    if (extraDefaultLabel) items.push({ value: '', label: extraDefaultLabel });
    Object.keys(WUKU.constants.ENGINE_META).forEach((id) => {
      items.push({ value: id, label: WUKU.constants.ENGINE_META[id].label });
    });
    return items;
  }

  async function runtimeMessage(type, payload) {
    const response = await chrome.runtime.sendMessage(Object.assign({ type }, payload || {}));
    if (!response || !response.ok) {
      throw (response && response.error) || { message: '后台服务无响应' };
    }
    return response.data;
  }

  async function ensurePermission(url) {
    const origin = WUKU.util.originOf(url);
    if (!origin) return { ok: false, message: '接口地址格式不正确，需要以 http(s):// 开头' };
    if (await WUKU.net.hasHostPermission(url)) return { ok: true, origin };
    const granted = await WUKU.net.requestHostPermission(url);
    if (!granted) {
      return { ok: false, message: '未授权访问 ' + origin + '，接口请求会被浏览器拦截' };
    }
    return { ok: true, origin };
  }

  /* ---------- 通用 ---------- */

  function fillGeneral() {
    selectOptions(els.mode, [
      { value: 'immersive', label: '纯译文（直接替换原文）' },
      { value: 'bilingual', label: '双语对照（原文 + 译文）' }
    ], settings.mode);

    selectOptions(els.engine, engineItems(), settings.engine);
    selectOptions(els.targetLang, [
      { value: 'zh-CN', label: '简体中文' },
      { value: 'zh-TW', label: '繁体中文' },
      { value: 'en', label: 'English' },
      { value: 'ja', label: '日本語' },
      { value: 'ko', label: '한국어' }
    ], settings.targetLang);

    els.chunkSize.value = settings.chunkSize;
    els.skipChinesePage.checked = !!settings.skipChinesePage;
    els.fallback.checked = settings.fallback !== false;
    els.bubbleEnabled.checked = !(settings.bubble && settings.bubble.enabled === false);

    const bubbleItems = engineItems('跟随站点 / 全局设置');
    selectOptions(els.bubbleEngine, bubbleItems, (settings.bubble && settings.bubble.engine) || '');
  }

  async function saveGeneral() {
    const chunkSize = Math.max(4, Math.min(30, Number(els.chunkSize.value) || 12));
    settings = await WUKU.settings.patch({
      mode: els.mode.value,
      engine: els.engine.value,
      targetLang: els.targetLang.value,
      chunkSize,
      skipChinesePage: els.skipChinesePage.checked,
      fallback: els.fallback.checked,
      bubble: {
        enabled: els.bubbleEnabled.checked,
        engine: els.bubbleEngine.value
      }
    });
    els.chunkSize.value = chunkSize;
    showHint(els.generalHint, '已保存', 'ok');
  }

  /* ---------- AI ---------- */

  function fillAi() {
    const ai = settings.ai || {};
    els.aiBaseUrl.value = ai.baseUrl || '';
    els.aiApiKey.value = ai.apiKey || '';
    els.aiModel.value = ai.model || '';
    els.aiTemperature.value = typeof ai.temperature === 'number' ? ai.temperature : 0.2;
    els.aiTemperatureValue.textContent = Number(els.aiTemperature.value).toFixed(2).replace(/0$/, '');
    els.aiBatchSize.value = ai.batchSize || 12;
    els.aiExtraHeaders.value = ai.extraHeaders || '';
    els.aiJsonMode.checked = ai.jsonMode !== false;
    els.aiPrompt.value = ai.systemPrompt || WUKU.constants.DEFAULT_AI_PROMPT;
  }

  function readAiForm() {
    return {
      baseUrl: els.aiBaseUrl.value.trim(),
      apiKey: els.aiApiKey.value.trim(),
      model: els.aiModel.value.trim(),
      temperature: Number(els.aiTemperature.value) || 0,
      batchSize: Math.max(1, Math.min(40, Number(els.aiBatchSize.value) || 12)),
      extraHeaders: els.aiExtraHeaders.value.trim(),
      jsonMode: els.aiJsonMode.checked,
      systemPrompt: els.aiPrompt.value
    };
  }

  async function persistAi() {
    const ai = readAiForm();
    if (!ai.baseUrl) {
      showHint(els.aiHint, '请先填写接口地址（Base URL）', 'err');
      return false;
    }
    if (!/^https?:\/\//i.test(ai.baseUrl)) {
      showHint(els.aiHint, '接口地址需要以 http:// 或 https:// 开头', 'err');
      return false;
    }
    if (ai.extraHeaders) {
      try {
        JSON.parse(ai.extraHeaders);
      } catch (e) {
        showHint(els.aiHint, '额外请求头不是合法 JSON', 'err');
        return false;
      }
    }
    const permission = await ensurePermission(ai.baseUrl);
    if (!permission.ok) {
      showHint(els.aiHint, permission.message, 'err');
      return false;
    }
    settings = await WUKU.settings.patch({ ai });
    showHint(els.aiHint, '已保存，并已授权 ' + permission.origin, 'ok');
    return true;
  }

  function renderResult(el, text, isError) {
    el.hidden = false;
    el.className = 'result' + (isError ? ' err' : '');
    el.textContent = text;
  }

  async function testEngine(engineId, resultEl, hintEl) {
    resultEl.hidden = false;
    resultEl.className = 'result';
    resultEl.textContent = '正在请求…';
    try {
      const data = await runtimeMessage('test-engine', {
        engineId,
        text: 'Hello, world. This is a translation test from WUKU.'
      });
      const lines = [
        '译文：' + data.text,
        '实际使用引擎：' + WUKU.constants.engineMeta(data.engineUsed).label,
        '耗时：' + WUKU.util.formatMs(data.elapsed)
      ];
      if (data.degraded) lines.push('已降级：' + (data.degradedReason || '主引擎不可用'));
      renderResult(resultEl, lines.join('\n'), false);
      showHint(hintEl, '连接正常', 'ok');
    } catch (error) {
      renderResult(resultEl, '测试失败：' + ((error && error.message) || '未知错误'), true);
    }
  }

  /* ---------- 自定义接口 ---------- */

  function fillCustom() {
    const custom = settings.custom || {};
    els.customUrl.value = custom.url || '';
    els.customMethod.value = custom.method || 'POST';
    els.customHeaders.value = custom.headers || '';
    els.customBody.value = custom.body || WUKU.constants.DEFAULT_SETTINGS.custom.body;
    els.customResponsePath.value = custom.responsePath || '';
    els.customBatch.checked = !!custom.batch;
  }

  function readCustomForm() {
    return {
      url: els.customUrl.value.trim(),
      method: els.customMethod.value,
      headers: els.customHeaders.value.trim(),
      body: els.customBody.value,
      responsePath: els.customResponsePath.value.trim(),
      batch: els.customBatch.checked
    };
  }

  async function persistCustom() {
    const custom = readCustomForm();
    if (!custom.url) {
      showHint(els.customHint, '请先填写请求地址', 'err');
      return false;
    }
    if (!/^https?:\/\//i.test(custom.url)) {
      showHint(els.customHint, '请求地址需要以 http:// 或 https:// 开头', 'err');
      return false;
    }
    if (custom.headers) {
      try {
        JSON.parse(custom.headers);
      } catch (e) {
        showHint(els.customHint, '请求头不是合法 JSON', 'err');
        return false;
      }
    }
    const permission = await ensurePermission(custom.url);
    if (!permission.ok) {
      showHint(els.customHint, permission.message, 'err');
      return false;
    }
    settings = await WUKU.settings.patch({ custom });
    showHint(els.customHint, '已保存，并已授权 ' + permission.origin, 'ok');
    return true;
  }

  /* ---------- 站点规则 ---------- */

  function fillSites() {
    selectOptions(els.ruleEngine, engineItems(), settings.engine);
    selectOptions(els.ruleMode, [
      { value: '', label: '跟随全局模式' },
      { value: 'immersive', label: '纯译文' },
      { value: 'bilingual', label: '双语对照' }
    ], '');
    renderRules();
  }

  function renderRules() {
    const rules = settings.siteRules || [];
    els.ruleList.innerHTML = '';
    if (!rules.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '还没有站点规则，所有网站都使用全局设置。';
      els.ruleList.appendChild(empty);
      return;
    }
    rules.forEach((rule, index) => {
      const row = document.createElement('div');
      row.className = 'rule-row';

      const pattern = document.createElement('span');
      pattern.className = 'pattern';
      pattern.textContent = rule.pattern;

      const engine = document.createElement('span');
      engine.className = 'tag';
      engine.textContent = WUKU.constants.engineMeta(rule.engine).label;

      const mode = document.createElement('span');
      mode.className = 'tag';
      mode.textContent = rule.mode === 'bilingual' ? '双语对照' : rule.mode === 'immersive' ? '纯译文' : '跟随全局模式';

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.title = '删除规则';
      del.textContent = '×';
      del.addEventListener('click', async () => {
        const next = (settings.siteRules || []).filter((item, i) => i !== index);
        settings = await WUKU.settings.patch({ siteRules: next });
        renderRules();
        showHint(els.ruleHint, '已删除规则', 'ok');
      });

      row.appendChild(pattern);
      row.appendChild(engine);
      row.appendChild(mode);
      row.appendChild(del);
      els.ruleList.appendChild(row);
    });
  }

  async function addRule() {
    let pattern = els.rulePattern.value.trim();
    if (!pattern) {
      showHint(els.ruleHint, '请输入域名或 URL 片段', 'err');
      return;
    }
    if (/^https?:\/\//i.test(pattern)) {
      try {
        const parsed = new URL(pattern);
        pattern = parsed.hostname + (parsed.pathname === '/' ? '' : parsed.pathname);
      } catch (e) {
        showHint(els.ruleHint, 'URL 格式不正确', 'err');
        return;
      }
    }
    const rules = (settings.siteRules || []).slice();
    if (rules.some((rule) => rule.pattern === pattern)) {
      showHint(els.ruleHint, '该规则已存在', 'err');
      return;
    }
    const rule = { pattern, engine: els.ruleEngine.value };
    if (els.ruleMode.value) rule.mode = els.ruleMode.value;
    rules.push(rule);
    settings = await WUKU.settings.patch({ siteRules: rules });
    els.rulePattern.value = '';
    renderRules();
    showHint(els.ruleHint, '已添加：' + pattern, 'ok');
  }

  /* ---------- 增强功能 ---------- */

  function fillFeatures() {
    const ball = settings.floatBall || {};
    els.ballEnabled.checked = ball.enabled !== false;
    els.ballTranslucent.checked = ball.translucent !== false;
    els.ballPinned.checked = ball.pinned !== false;
    els.ballSide.value = ball.side === 'left' ? 'left' : 'right';

    const subtitle = settings.subtitle || {};
    els.subtitleEnabled.checked = !!subtitle.enabled;
    els.subtitleBilingual.checked = subtitle.bilingual !== false;
    els.subtitleSelectors.value = (subtitle.customSelectors || [])
      .map((item) => item.pattern + ' | ' + item.selector)
      .join('\n');

    const input = settings.input || {};
    els.inputEnabled.checked = input.enabled !== false;
    els.inputTargetLang.value = input.targetLang || 'en';
    els.inputMode.value = input.mode === 'append' ? 'append' : 'replace';

    const image = settings.imageTranslate || {};
    els.imageEnabled.checked = image.enabled !== false;
    els.imageModel.value = image.model || '';
    els.imageTargetLang.value = image.targetLang || 'zh-CN';
  }

  function parseSubtitleSelectors(text) {
    const list = [];
    String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const idx = line.indexOf('|');
        if (idx < 0) return;
        const pattern = line.slice(0, idx).trim();
        const selector = line.slice(idx + 1).trim();
        if (pattern && selector) list.push({ pattern, selector });
      });
    return list;
  }

  async function saveFeatures() {
    settings = await WUKU.settings.patch({
      floatBall: {
        enabled: els.ballEnabled.checked,
        translucent: els.ballTranslucent.checked,
        pinned: els.ballPinned.checked,
        side: els.ballSide.value
      },
      subtitle: {
        enabled: els.subtitleEnabled.checked,
        bilingual: els.subtitleBilingual.checked,
        customSelectors: parseSubtitleSelectors(els.subtitleSelectors.value)
      },
      input: {
        enabled: els.inputEnabled.checked,
        targetLang: els.inputTargetLang.value,
        mode: els.inputMode.value
      },
      imageTranslate: {
        enabled: els.imageEnabled.checked,
        model: els.imageModel.value.trim(),
        targetLang: els.imageTargetLang.value
      }
    });
    showHint(els.featuresHint, '已保存，页面即时生效', 'ok');
  }

  async function grantImageOriginAccess() {
    const url = els.imageOrigin.value.trim();
    if (!url) {
      showHint(els.featuresHint, '请输入图片域名（https://…）', 'err');
      return;
    }
    const permission = await ensurePermission(url);
    if (!permission.ok) {
      showHint(els.featuresHint, permission.message, 'err');
      return;
    }
    els.imageOrigin.value = '';
    showHint(els.featuresHint, '已授权访问 ' + permission.origin, 'ok');
  }

  /* ---------- 缓存 ---------- */

  async function loadCacheStats() {
    try {
      const stats = await runtimeMessage('cache-stats');
      const values = els.cacheStats.querySelectorAll('.stat-value');
      values[0].textContent = stats.entries.toLocaleString();
      values[1].textContent = (stats.chars / 1024).toFixed(0) + ' KB';
      values[2].textContent = (stats.hits || 0).toLocaleString();
      values[3].textContent = (stats.misses || 0).toLocaleString();
    } catch (e) {
      /* 忽略 */
    }
  }

  function fillData() {
    els.cacheEnabled.checked = !(settings.cache && settings.cache.enabled === false);
    els.cacheMaxEntries.value = (settings.cache && settings.cache.maxEntries) || 3000;
    loadCacheStats();
  }

  async function saveCache() {
    const maxEntries = Math.max(200, Math.min(10000, Number(els.cacheMaxEntries.value) || 3000));
    settings = await WUKU.settings.patch({
      cache: { enabled: els.cacheEnabled.checked, maxEntries }
    });
    els.cacheMaxEntries.value = maxEntries;
    showHint(els.cacheHint, '已保存', 'ok');
  }

  /* ---------- 导航 ---------- */

  function bindNav() {
    els.nav.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-tab]');
      if (!button) return;
      const tab = button.dataset.tab;
      els.nav.querySelectorAll('button').forEach((item) => {
        item.setAttribute('aria-selected', item === button ? 'true' : 'false');
      });
      document.querySelectorAll('.panel').forEach((panel) => {
        panel.hidden = panel.dataset.panel !== tab;
      });
      if (tab === 'data') loadCacheStats();
    });
  }

  /* ---------- 事件 ---------- */

  function bindEvents() {
    els.saveGeneral.addEventListener('click', () => {
      saveGeneral().catch((error) => showHint(els.generalHint, error.message, 'err'));
    });

    els.aiTemperature.addEventListener('input', () => {
      els.aiTemperatureValue.textContent = Number(els.aiTemperature.value).toFixed(2).replace(/0$/, '');
    });
    els.resetPrompt.addEventListener('click', () => {
      els.aiPrompt.value = WUKU.constants.DEFAULT_AI_PROMPT;
    });
    els.saveAi.addEventListener('click', () => {
      persistAi().catch((error) => showHint(els.aiHint, error.message, 'err'));
    });
    els.testAi.addEventListener('click', async () => {
      const saved = await persistAi();
      if (!saved) return;
      await testEngine('ai', els.aiResult, els.aiHint);
    });

    els.saveCustom.addEventListener('click', () => {
      persistCustom().catch((error) => showHint(els.customHint, error.message, 'err'));
    });
    els.testCustom.addEventListener('click', async () => {
      const saved = await persistCustom();
      if (!saved) return;
      await testEngine('custom', els.customResult, els.customHint);
    });

    els.addRule.addEventListener('click', () => {
      addRule().catch((error) => showHint(els.ruleHint, error.message, 'err'));
    });

    els.saveCache.addEventListener('click', () => {
      saveCache().catch((error) => showHint(els.cacheHint, error.message, 'err'));
    });

    els.saveFeatures.addEventListener('click', () => {
      saveFeatures().catch((error) => showHint(els.featuresHint, error.message, 'err'));
    });
    els.grantImageOrigin.addEventListener('click', () => {
      grantImageOriginAccess().catch((error) => showHint(els.featuresHint, error.message, 'err'));
    });
    els.clearCache.addEventListener('click', async () => {
      if (!confirm('确定清空所有翻译缓存？')) return;
      try {
        await runtimeMessage('cache-clear');
        await loadCacheStats();
        showHint(els.cacheHint, '缓存已清空', 'ok');
      } catch (error) {
        showHint(els.cacheHint, '清空失败：' + error.message, 'err');
      }
    });
    els.resetAll.addEventListener('click', async () => {
      if (!confirm('确定恢复默认设置？所有配置（含 API Key、站点规则）将被清除。')) return;
      await WUKU.settings.reset();
      location.reload();
    });

    els.openShortcuts.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }

  async function init() {
    bindNav();
    bindEvents();
    settings = await WUKU.settings.get();
    fillGeneral();
    fillFeatures();
    fillAi();
    fillCustom();
    fillSites();
    fillData();
  }

  init().catch((error) => {
    console.error('[WUKU options]', error);
  });
})();
