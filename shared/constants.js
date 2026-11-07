/**
 * 常量与默认配置
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});
  WUKU.version = '1.1.0';

  const LANG_NAMES = {
    'zh-CN': '简体中文',
    'zh-TW': '繁体中文',
    en: 'English',
    ja: '日本語',
    ko: '한국어',
    ru: 'Русский',
    fr: 'Français',
    de: 'Deutsch',
    es: 'Español',
    pt: 'Português',
    it: 'Italiano',
    ar: 'العربية',
    th: 'ไทย',
    vi: 'Tiếng Việt',
    id: 'Bahasa Indonesia',
    tr: 'Türkçe',
    nl: 'Nederlands',
    pl: 'Polski',
    hi: 'हिन्दी'
  };

  const ENGINE_META = {
    google: {
      label: 'Google 翻译',
      short: '机器',
      kind: 'machine',
      description: '免费公开接口，无需配置，速度快，适合日常浏览。',
      requiresConfig: false
    },
    mymemory: {
      label: 'MyMemory',
      short: '机器',
      kind: 'machine',
      description: '免费翻译记忆库接口，作为 Google 接口失败时的备用线路。',
      requiresConfig: false
    },
    ai: {
      label: 'AI 大模型（OpenAI 兼容）',
      short: 'AI',
      kind: 'ai',
      description: '调用兼容 OpenAI Chat Completions 的接口，译文更自然，支持批量。',
      requiresConfig: true
    },
    custom: {
      label: '自定义请求模板',
      short: '自定义',
      kind: 'custom',
      description: '完全自定义 URL、请求头、请求体与响应解析路径，适配任意翻译服务。',
      requiresConfig: true
    }
  };

  const DEFAULT_AI_PROMPT = [
    '你是专业的网页翻译引擎。请把用户提供的内容翻译成{{targetLangName}}。',
    '要求：',
    '1. 只输出译文，不要解释、不要加引号、不要复述原文；',
    '2. 保持原文语气、术语与标点风格，专有名词使用通行译名，代码/变量名保留原文；',
    '3. 保留原文中的 HTML 标签、占位符与链接结构；',
    '4. 如果用户输入是 JSON 字符串数组，必须返回等长、同序的 JSON 字符串数组，不要包裹额外字段；',
    '5. 若某段内容无需翻译（如纯数字、品牌名），原样返回该段。'
  ].join('\n');

  const DEFAULT_CUSTOM_BODY = [
    '{',
    '  "model": "{{model}}",',
    '  "q": "{{text}}",',
    '  "source": "{{sourceLang}}",',
    '  "target": "{{targetLang}}"',
    '}'
  ].join('\n');

  const DEFAULT_SETTINGS = {
    version: 1,
    /** 默认渲染模式：immersive（纯译文） | bilingual（双语对照） */
    mode: 'immersive',
    /** 全局默认引擎 */
    engine: 'google',
    /** 目标语言 */
    targetLang: 'zh-CN',
    /** 仅翻译非中文页面 */
    skipChinesePage: true,
    /** 主引擎失败时自动降级 */
    fallback: true,
    /** 单次请求的段落数（机器引擎并发、AI 批量） */
    chunkSize: 12,
    ai: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      temperature: 0.2,
      /** 批量条数上限 */
      batchSize: 12,
      /** 额外请求头，JSON 字符串 */
      extraHeaders: '',
      systemPrompt: DEFAULT_AI_PROMPT,
      /** 是否让模型返回 JSON 数组（批量），关闭则按行返回 */
      jsonMode: true
    },
    custom: {
      url: '',
      method: 'POST',
      headers: '{\n  "Content-Type": "application/json"\n}',
      body: DEFAULT_CUSTOM_BODY,
      responsePath: 'translation',
      /** 单次请求多段文本 */
      batch: false,
      sourceLangField: true
    },
    /** 站点规则：[{ pattern: "www.zhihu.com", engine: "ai", mode?: "bilingual", skipChinesePage?: true }] */
    siteRules: [],
    /** 划词气泡偏好 */
    bubble: {
      enabled: true,
      engine: '' /** 空表示跟随站点/全局 */
    },
    /** 悬浮球 */
    floatBall: {
      enabled: true,
      /** 半透明胶囊外观 */
      translucent: true,
      /** 始终置顶于页面元素之上 */
      pinned: true,
      /** 贴边：right | left */
      side: 'right',
      /** 距顶部偏移 px */
      top: 140
    },
    /** 视频双语字幕 */
    subtitle: {
      enabled: false,
      /** 原文 + 译文双语显示 */
      bilingual: true,
      /** 自定义字幕容器选择器：[{ pattern: "www.example.com", selector: ".caption" }] */
      customSelectors: []
    },
    /** 输入框翻译 */
    input: {
      enabled: true,
      /** 三连空格触发 */
      tripleSpace: true,
      targetLang: 'en',
      /** replace 替换原文 | append 追加到末尾 */
      mode: 'replace'
    },
    /** 漫画 / 图片翻译（依赖 AI 视觉模型） */
    imageTranslate: {
      enabled: true,
      /** 可选：覆盖默认 AI 模型，留空则用 ai.model */
      model: '',
      targetLang: 'zh-CN'
    },
    cache: {
      enabled: true,
      maxEntries: 3000
    },
    /** 首次安装是否已打开欢迎页 */
    onboarded: false
  };

  const CONTENT_FILES = [
    'shared/core.js',
    'shared/constants.js',
    'shared/lang-detect.js',
    'shared/settings.js',
    'content/dom.js',
    'content/ui.js',
    'content/selection.js',
    'content/ball.js',
    'content/panel.js',
    'content/subtitle.js',
    'content/input.js',
    'content/image.js',
    'content/content.js'
  ];

  const MACHINE_ENGINES = ['google', 'mymemory'];
  const AI_ENGINES = ['ai', 'custom'];

  WUKU.constants = {
    LANG_NAMES,
    ENGINE_META,
    DEFAULT_SETTINGS,
    DEFAULT_AI_PROMPT,
    CONTENT_FILES,
    MACHINE_ENGINES,
    AI_ENGINES,
    CACHE_KEY: 'wuku.settings',
    CACHE_STORE_KEY: 'wuku.cache',
    STORAGE_SETTINGS: 'wuku.settings',
    STORAGE_BUBBLE: 'wuku.bubble',
    langName(code) {
      return LANG_NAMES[code] || code || '';
    },
    engineMeta(id) {
      return ENGINE_META[id] || { label: id, short: id, kind: 'unknown', description: '', requiresConfig: false };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
