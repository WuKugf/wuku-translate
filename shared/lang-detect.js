/**
 * 语言检测
 * 策略：先按 Unicode 区块统计文字体系（Han/Kana/Hangul/Cyrillic/Arabic…），
 * 拉丁字母体系再用高频停用词打分，避免引入大型语言模型或词典依赖。
 */
(function (root) {
  'use strict';

  const WUKU = (root.WUKU = root.WUKU || {});

  const RE = {
    cjk: /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g,
    kana: /[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff]/g,
    hangul: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g,
    cyrillic: /[\u0400-\u04ff]/g,
    arabic: /[\u0600-\u06ff\u0750-\u077f]/g,
    thai: /[\u0e00-\u0e7f]/g,
    devanagari: /[\u0900-\u097f]/g,
    latin: /[A-Za-z\u00c0-\u024f\u1e00-\u1eff]/g
  };

  const STOPWORDS = {
    en: 'the and of to in is that for with as on this are be it by from you your has have will can not at or we they their was were which but all more about when there been would should'.split(' '),
    es: 'el la los las de que en y es con para por un una del se su al como más pero este esta entre cuando muy sin sobre también puede todo hay donde'.split(' '),
    fr: 'le la les des de et est un une en du que qui pour dans avec sur pas au ce il elle plus par son sa mais comme nous vous ils sont ont être cette'.split(' '),
    de: 'der die das und ist in zu von mit dem den ein eine auf nicht sich im es an als auch wie aber für aus oder bei hat sind war wird werden noch nach kann'.split(' '),
    pt: 'o a os as de que e do da em um uma para com não por mais se na no como dos das ao aos é são foi ser tem estão muito também'.split(' '),
    it: 'il la i le di che e un una in per con non da del al alla è sono come più questo questa anche ha hanno essere si ma quando molto'.split(' '),
    nl: 'de het een en van in is dat op te met niet voor zijn aan er als bij om uit kan wordt was waren ook meer dan maar door'.split(' '),
    id: 'yang dan di ini itu dengan untuk dari tidak akan adalah pada juga bisa dalam ke oleh karena sebagai saya kami mereka ada lebih sudah atau'.split(' '),
    tr: 've bir bu için ile da de olarak çok daha gibi kadar sonra ama her ne o var yok değil olan olduğu'.split(' '),
    vi: 'và của là có trong cho không được người một những các để với khi đã này đó như từ về sẽ ra đến trên'.split(' ')
  };

  const STOPWORD_SETS = {};
  Object.keys(STOPWORDS).forEach((lang) => {
    STOPWORD_SETS[lang] = new Set(STOPWORDS[lang]);
  });

  const VI_CHARS = /[ơưđạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
  const PL_CHARS = /[ąćęłńóśźż]/i;
  const CS_CHARS = /[ěščřžůňťď]/i;

  function countMatches(text, re) {
    const found = text.match(re);
    return found ? found.length : 0;
  }

  function countScripts(text) {
    return {
      cjk: countMatches(text, RE.cjk),
      kana: countMatches(text, RE.kana),
      hangul: countMatches(text, RE.hangul),
      cyrillic: countMatches(text, RE.cyrillic),
      arabic: countMatches(text, RE.arabic),
      thai: countMatches(text, RE.thai),
      devanagari: countMatches(text, RE.devanagari),
      latin: countMatches(text, RE.latin)
    };
  }

  function latinLanguage(text) {
    const words = String(text || '').toLowerCase().match(/[\p{L}']+/gu) || [];
    if (words.length === 0) return { lang: 'auto', confidence: 0 };
    let best = 'auto';
    let bestScore = 0;
    Object.keys(STOPWORD_SETS).forEach((lang) => {
      const set = STOPWORD_SETS[lang];
      let hits = 0;
      for (const word of words) {
        if (set.has(word)) hits += 1;
      }
      const score = hits / words.length;
      if (score > bestScore) {
        bestScore = score;
        best = lang;
      }
    });

    // 特殊字符辅助判断
    const raw = String(text || '');
    if (VI_CHARS.test(raw)) bestScore += 0.25;
    if (VI_CHARS.test(raw)) best = 'vi';
    else if (PL_CHARS.test(raw) && best !== 'en') best = 'pl';
    else if (CS_CHARS.test(raw) && best !== 'en') best = 'cs';

    if (bestScore < 0.12 && words.length >= 6) return { lang: 'auto', confidence: bestScore };
    if (bestScore < 0.06) return { lang: 'auto', confidence: bestScore };
    return { lang: best === 'auto' ? 'auto' : best, confidence: Math.min(1, bestScore) };
  }

  /**
   * 检测单段文本
   * @returns {{lang:string, script:string, confidence:number, cjkRatio:number}}
   */
  function detect(text) {
    const raw = String(text == null ? '' : text);
    if (!raw) return { lang: '', script: 'unknown', confidence: 0, cjkRatio: 0 };

    const counts = countScripts(raw);
    const total =
      counts.cjk + counts.kana + counts.hangul + counts.cyrillic + counts.arabic +
      counts.thai + counts.devanagari + counts.latin;

    if (total === 0) return { lang: 'unknown', script: 'other', confidence: 0, cjkRatio: 0 };

    const cjkRatio = (counts.cjk + counts.kana + counts.hangul) / total;

    // 日文：含假名；韩文：含谚文
    if (counts.kana >= 1 && counts.kana / total >= 0.02) {
      return { lang: 'ja', script: 'kana', confidence: 0.95, cjkRatio };
    }
    if (counts.hangul >= 1 && counts.hangul / total >= 0.02) {
      return { lang: 'ko', script: 'hangul', confidence: 0.95, cjkRatio };
    }
    if (counts.cyrillic >= 1 && counts.cyrillic / total >= 0.15) {
      return { lang: 'ru', script: 'cyrillic', confidence: 0.9, cjkRatio };
    }
    if (counts.arabic >= 1 && counts.arabic / total >= 0.15) {
      return { lang: 'ar', script: 'arabic', confidence: 0.9, cjkRatio };
    }
    if (counts.thai >= 1 && counts.thai / total >= 0.15) {
      return { lang: 'th', script: 'thai', confidence: 0.9, cjkRatio };
    }
    if (counts.devanagari >= 1 && counts.devanagari / total >= 0.15) {
      return { lang: 'hi', script: 'devanagari', confidence: 0.9, cjkRatio };
    }
    if (counts.cjk >= 1 && counts.cjk / total >= 0.25) {
      return { lang: 'zh', script: 'han', confidence: 0.85, cjkRatio };
    }

    const latin = latinLanguage(raw);
    return {
      lang: latin.lang,
      script: 'latin',
      confidence: latin.confidence,
      cjkRatio
    };
  }

  /**
   * 汇总多段文本（页面级）
   * @param {string[]} samples
   * @param {string} htmlLang <html lang> 提示
   */
  function detectPage(samples, htmlLang) {
    const text = (samples || []).join('\n').slice(0, 20000);
    const result = detect(text);
    const counts = countScripts(text);
    const total =
      counts.cjk + counts.kana + counts.hangul + counts.cyrillic + counts.arabic +
      counts.thai + counts.devanagari + counts.latin || 1;

    const hint = String(htmlLang || '').toLowerCase();
    let lang = result.lang;
    let isChinese = false;

    const hanRatio = counts.cjk / total;
    const kanaRatio = counts.kana / total;

    if (kanaRatio >= 0.05) {
      lang = 'ja';
    } else if (counts.hangul / total >= 0.05) {
      lang = 'ko';
    } else if (hanRatio >= 0.12) {
      lang = 'zh';
      isChinese = hanRatio >= 0.5 || (hint.startsWith('zh') && hanRatio >= 0.25);
    } else if (hint.startsWith('zh') && hanRatio >= 0.08) {
      lang = 'zh';
      isChinese = true;
    }

    return {
      lang,
      script: result.script,
      confidence: result.confidence,
      cjkRatio: (counts.cjk + counts.kana + counts.hangul) / total,
      hanRatio,
      isChinese,
      htmlLang: hint,
      counts
    };
  }

  /** 文本是否属于中文（用于单段跳过） */
  function isChineseText(text) {
    const info = detect(text);
    return info.lang === 'zh' && info.cjkRatio >= 0.5;
  }

  /** 英文等拉丁语言判断，用于给机器翻译提供 source 提示 */
  function guessSourceLang(text, fallback) {
    const info = detect(text);
    if (!info.lang || info.lang === 'auto' || info.lang === 'unknown') {
      return fallback || 'auto';
    }
    return info.lang;
  }

  WUKU.langDetect = {
    detect,
    detectPage,
    isChineseText,
    guessSourceLang,
    countScripts
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
