/* ══════════════════════════════════════════════════════════
   selector.js — 貼り付けたHTMLから「壊れにくいセレクタ」を推定する
   ──────────────────────────────────────────────────────────
   考え方:
     プログラムがページ内の要素を指し示すには「セレクタ」が要る。
     ただし class="css-1x2y3z" のような自動生成された名前は、
     サイトを作り直すたびに変わってしまい、翌週には動かなくなる。
     そこで「変わりにくさ（安定度）」と「一意に決まるか（一意性）」の
     2軸で候補を採点し、良い順に並べて提案する。
   ══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const U = global.U;

  /* ---------- CSS 識別子のエスケープ ---------- */
  function cssEsc(s) {
    if (global.CSS && typeof CSS.escape === 'function') return CSS.escape(s);
    return String(s).replace(/([^\w-])/g, '\\$1');
  }
  function attrVal(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  /* ---------- 「自動生成っぽい名前」の判定 ---------- */

  // css-1x2y3z / sc-bdVaJa / jsx-1234567 / _3xKp9 / MuiButton-root-123 など
  const HASHY = /^(css|sc|jsx|emotion|styled|chakra|mui|ant|_)?[-_]?[a-z0-9]*\d[a-z0-9]*$/i;

  function looksHashed(token) {
    const t = String(token);
    if (t.length < 4) return false;
    // 連続する英数字の中に数字が混ざり、母音が極端に少ない → ハッシュらしい
    if (/^[a-z]+-[a-z0-9]{5,}$/i.test(t) && /\d/.test(t)) return true;
    if (/^[a-zA-Z0-9_-]{6,}$/.test(t) && /\d/.test(t) && !/^[a-z]+-[a-z]+$/i.test(t)) {
      const letters = t.replace(/[^a-z]/gi, '');
      const vowels = (t.match(/[aeiou]/gi) || []).length;
      if (letters.length >= 4 && vowels / letters.length < 0.22) return true;
    }
    if (/^:r[0-9a-z]+:$/.test(t)) return true;             // React useId
    if (/^(ember|radix|headlessui|react-aria)[-_]?\d+/i.test(t)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t)) return true; // UUID
    return false;
  }

  // Tailwind などのユーティリティクラス（意味はあるが一意性が無い）
  const UTIL_PREFIX = /^(sm|md|lg|xl|2xl|hover|focus|active|group|dark|first|last|odd|even|disabled|peer)[:-]/;
  const UTIL_EXACT = new Set(('flex block inline inline-block grid hidden relative absolute fixed sticky ' +
    'container mx-auto my-auto w-full h-full items-center justify-center justify-between text-center ' +
    'font-bold font-medium font-semibold rounded rounded-md rounded-lg border shadow uppercase truncate ' +
    'clearfix btn active show open is-active selected disabled ' +
    'ng-star-inserted ng-tns ng-untouched ng-pristine ng-valid ng-scope ng-binding v-enter').split(' '));

  function isUtilityClass(c) {
    const t = String(c);
    if (UTIL_EXACT.has(t)) return true;
    if (UTIL_PREFIX.test(t)) return true;
    // px-4 / mt-2 / text-sm / bg-white / w-1/2 / gap-x-3 など
    if (/^-?(p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|w|h|min-w|max-w|min-h|max-h|gap|gap-x|gap-y|space-x|space-y|top|left|right|bottom|inset|z|order|basis|grow|shrink|col|row)-/.test(t)) return true;
    if (/^(text|bg|border|ring|fill|stroke|from|via|to|shadow|opacity|rounded|font|leading|tracking|divide|placeholder|outline|decoration|accent)-/.test(t)) return true;
    if (/^(grid|flex|items|justify|self|content|place|align|object|overflow|whitespace|break|cursor|select|pointer|transition|duration|delay|ease|animate|transform|translate|scale|rotate|skew|origin|backdrop|blur|filter|aspect|columns|table|list|underline|line)-/.test(t)) return true;
    return false;
  }

  function isStableClass(c) {
    return !!c && !looksHashed(c) && !isUtilityClass(c) && c.length <= 40;
  }

  function isStableId(id) {
    return !!id && !looksHashed(id) && !/^\d/.test(id) && id.length <= 60;
  }

  /* ---------- 可視テキストの取り出し ---------- */
  function visibleText(el) {
    if (!el) return '';
    let t = '';
    // script / style の中身は除く
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (p && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) t += n.nodeValue;
    return t.replace(/\s+/g, ' ').trim();
  }

  /* ---------- ARIA role の推定 ---------- */
  const IMPLICIT_ROLE = {
    A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox',
    IMG: 'img', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading',
    H5: 'heading', H6: 'heading', LI: 'listitem', TR: 'row', TD: 'cell',
    TH: 'columnheader', TABLE: 'table', NAV: 'navigation', FORM: 'form'
  };
  const INPUT_ROLE = {
    submit: 'button', button: 'button', reset: 'button', image: 'button',
    checkbox: 'checkbox', radio: 'radio', range: 'slider',
    text: 'textbox', email: 'textbox', tel: 'textbox', url: 'textbox',
    search: 'searchbox', password: 'textbox', number: 'spinbutton'
  };

  function roleOf(el) {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    const tag = el.tagName;
    if (tag === 'A' && !el.hasAttribute('href')) return null;
    if (tag === 'INPUT') return INPUT_ROLE[(el.getAttribute('type') || 'text').toLowerCase()] || 'textbox';
    return IMPLICIT_ROLE[tag] || null;
  }

  /* アクセシブルネーム（読み上げ名）の推定 */
  function accessibleName(el, doc) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();

    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby && doc) {
      const names = labelledby.split(/\s+/)
        .map(id => { const t = doc.getElementById(id); return t ? visibleText(t) : ''; })
        .filter(Boolean);
      if (names.length) return names.join(' ');
    }

    const tag = el.tagName;
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset') {
        const v = el.getAttribute('value');
        if (v && v.trim()) return v.trim();
      }
      if (type === 'image') {
        const a = el.getAttribute('alt');
        if (a && a.trim()) return a.trim();
      }
    }
    if (tag === 'IMG') {
      const a = el.getAttribute('alt');
      if (a && a.trim()) return a.trim();
    }

    // <label for="id"> または <label> の中に入っている
    const id = el.getAttribute('id');
    if (id && doc) {
      const lb = doc.querySelector('label[for=' + JSON.stringify(id).replace(/^"|"$/g, '"') + ']');
      if (lb) { const t = visibleText(lb); if (t) return t; }
    }
    let p = el.parentElement;
    while (p) {
      if (p.tagName === 'LABEL') { const t = visibleText(p); if (t) return t; }
      p = p.parentElement;
    }

    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();

    const txt = visibleText(el);
    if (txt && txt.length <= 80) return txt;
    return '';
  }

  /* ---------- 一意性チェック ---------- */
  function countMatches(doc, selector) {
    if (!doc) return -1;
    try { return doc.querySelectorAll(selector).length; }
    catch (e) { return -1; }
  }

  /* ---------- 構造パス（最後の手段） ---------- */
  function structuralPath(el, root, maxDepth) {
    maxDepth = maxDepth || 6;
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && cur !== root && depth < maxDepth) {
      let part = cur.tagName.toLowerCase();
      const id = cur.getAttribute('id');
      if (isStableId(id)) { parts.unshift('#' + cssEsc(id)); break; }
      const stable = classList(cur).filter(isStableClass);
      if (stable.length) {
        part += '.' + cssEsc(stable[0]);
      } else {
        const parent = cur.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
          if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
        }
      }
      parts.unshift(part);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  function classList(el) {
    const c = el.getAttribute && el.getAttribute('class');
    return c ? c.split(/\s+/).filter(Boolean) : [];
  }

  /* ══════════════════════════════════════════════════════════
     候補の生成
     ══════════════════════════════════════════════════════════ */
  const TESTID_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa',
    'data-automation-id', 'data-e2e', 'data-tracking-id'];

  function buildCandidates(el, doc, purpose) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    const push = c => { if (c && c.selector !== '' ) out.push(c); };

    /* 1) テスト用ID — 最も壊れにくい */
    for (const a of TESTID_ATTRS) {
      const v = el.getAttribute(a);
      if (v && v.trim()) {
        push({ strategy: 'css', selector: '[' + a + '=' + attrVal(v) + ']', base: 100,
               why: 'テスト用の属性 ' + a + ' は開発者が意図して付けた識別子で、最も変わりにくい指定です。' });
      }
    }

    /* 2) id */
    const id = el.getAttribute('id');
    if (id) {
      if (isStableId(id)) {
        push({ strategy: 'css', selector: '#' + cssEsc(id), base: 93,
               why: 'id は原則ページ内で一意です。意味のある名前なので安定しています。' });
      } else {
        push({ strategy: 'css', selector: '#' + cssEsc(id), base: 42,
               why: '⚠ id が自動生成された値のようです。ページを開き直すと変わる可能性があります。' });
      }
    }

    /* 3) name 属性（フォーム部品） */
    const nameAttr = el.getAttribute('name');
    if (nameAttr && nameAttr.trim()) {
      push({ strategy: 'css', selector: tag + '[name=' + attrVal(nameAttr) + ']', base: 88,
             why: 'フォームの name 属性はサーバー側と対応しているため、めったに変わりません。' });
    }

    /* 4) aria-label */
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) {
      push({ strategy: 'css', selector: '[aria-label=' + attrVal(ariaLabel.trim()) + ']', base: 85,
             why: 'aria-label はアクセシビリティ用の名前で、見た目の変更では変わりません。' });
    }

    /* 5) role + アクセシブルネーム（Playwright の推奨方法） */
    const role = roleOf(el);
    const accName = accessibleName(el, doc);
    if (role && accName && accName.length <= 60) {
      push({ strategy: 'role', role: role, name: accName, selector: role + ' / ' + accName, base: 90,
             why: 'Playwright 推奨の指定方法です。人間が見ている「役割と名前」で探すので、HTML構造が変わっても追従しやすいです。' });
    }

    /* 6) placeholder（入力欄向け） */
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) {
      push({ strategy: 'placeholder', selector: ph.trim(), base: purpose === 'input' ? 84 : 76,
             why: '入力欄のプレースホルダ文字で探します。分かりやすく、まあまあ安定しています。' });
    }

    /* 7) label（入力欄向け） */
    if (purpose === 'input' || role === 'textbox' || role === 'checkbox' || role === 'combobox') {
      const lblText = labelTextFor(el, doc);
      if (lblText) {
        push({ strategy: 'label', selector: lblText, base: 86,
               why: '入力欄に付いているラベル文字で探します。画面上の見た目そのままなので分かりやすい指定です。' });
      }
    }

    /* 8) 表示テキスト */
    const txt = visibleText(el);
    if (txt && txt.length <= 40 && (purpose === 'click' || role === 'button' || role === 'link')) {
      push({ strategy: 'text', selector: txt, base: 74,
             why: '画面に見えている文字で探します。文言が変わると動かなくなる点に注意。' });
    }

    /* 9) リンク先 href */
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href && href !== '#' && href.length <= 120) {
        const dynamic = /[?&=]|\d{3,}/.test(href);
        if (!dynamic) {
          push({ strategy: 'css', selector: 'a[href=' + attrVal(href) + ']', base: 72,
                 why: 'リンク先URLで探します。行き先が固定のリンクに向いています。' });
        } else {
          const tail = href.split('/').filter(Boolean).slice(-1)[0] || '';
          if (tail && tail.length >= 3 && !/^\d+$/.test(tail)) {
            push({ strategy: 'css', selector: 'a[href$=' + attrVal('/' + tail) + ']', base: 58,
                   why: 'リンク先の末尾で部分一致させます。URLに可変部分がある場合の折衷案です。' });
          }
        }
      }
    }

    /* 10) type / value の組み合わせ */
    if (tag === 'input' || tag === 'button') {
      const type = el.getAttribute('type');
      const val = el.getAttribute('value');
      if (type && val) {
        push({ strategy: 'css', selector: tag + '[type=' + attrVal(type) + '][value=' + attrVal(val) + ']', base: 70,
               why: 'ボタンの種類と表示文字の組み合わせで探します。' });
      } else if (type === 'submit') {
        push({ strategy: 'css', selector: tag + '[type="submit"]', base: 55,
               why: '送信ボタンを型で探します。フォームが1つだけのページなら確実です。' });
      }
    }

    /* 11) 安定していそうな class */
    const classes = classList(el);
    const stable = classes.filter(isStableClass);
    if (stable.length) {
      push({ strategy: 'css', selector: tag + '.' + stable.slice(0, 2).map(cssEsc).join('.'), base: 64,
             why: '意味のありそうな class 名で探します。デザイン変更で変わる可能性はあります。' });
      if (stable.length > 2) {
        push({ strategy: 'css', selector: '.' + stable.map(cssEsc).join('.'), base: 56,
               why: 'class をすべて重ねて絞り込みます。一意性は上がりますが、1つでも変わると動かなくなります。' });
      }
    } else if (classes.length) {
      const any = classes.filter(c => !looksHashed(c)).slice(0, 2);
      if (any.length) {
        push({ strategy: 'css', selector: tag + '.' + any.map(cssEsc).join('.'), base: 34,
               why: '⚠ 汎用的な class しかありません。他の要素にも当たりやすいので、順番指定との併用を検討してください。' });
      }
    }

    /* 11.5) 一覧の「枠」向け: 並び順の指定を外して、同じ形すべてに当たる指定を作る
            （表の行のように、class も id も無い要素で効く） */
    if (purpose === 'list') {
      const p2 = structuralPath(el, doc && doc.body, 5);
      const deIndexed = p2.replace(/:nth-(?:of-type|child)\(\d+\)/g, '');
      if (deIndexed && deIndexed !== p2) {
        push({ strategy: 'css', selector: deIndexed, base: 46,
               why: '並び順の指定を外して、同じ形の要素すべてに当たるようにしました。一覧の繰り返しに向いています。' });
      }
    }

    /* 12) 構造パス（最後の手段） */
    const path = structuralPath(el, doc && doc.body, 6);
    if (path && path.indexOf('>') > 0) {
      push({ strategy: 'css', selector: path, base: 26,
             why: '⚠ HTMLの並び順に頼る指定です。今は動きますが、ページの構造が少しでも変わると壊れます。' });
    }

    /* 13) 何も作れなかったときの保険 */
    if (!out.length) {
      const type = el.getAttribute('type');
      push({ strategy: 'css', selector: tag + (type ? '[type="' + type + '"]' : ''), base: 20,
             why: '⚠ この要素には手がかりになる属性がありません。ページ内に同じタグが複数あると当たってしまいます。' +
                  'もう少し外側の要素も含めて「Copy outerHTML」し直すか、手で調整してください。' });
    }

    return out;
  }

  function labelTextFor(el, doc) {
    const id = el.getAttribute('id');
    if (id && doc) {
      try {
        const lb = doc.querySelector('label[for="' + id.replace(/"/g, '\\"') + '"]');
        if (lb) { const t = visibleText(lb); if (t && t.length <= 60) return t; }
      } catch (e) { /* 無効なidは無視 */ }
    }
    let p = el.parentElement;
    while (p) {
      if (p.tagName === 'LABEL') {
        const t = visibleText(p);
        if (t && t.length <= 60) return t;
      }
      p = p.parentElement;
    }
    return '';
  }

  /* ---------- 採点 ----------
     opts.multi = true のときは「複数ヒットして当たり前」（一覧の枠を探す場合）。 */
  function scoreCandidates(cands, doc, el, opts) {
    const multi = !!(opts && opts.multi);
    const seen = new Set();
    const out = [];

    cands.forEach(c => {
      const key = c.strategy + '|' + c.selector + '|' + (c.role || '');
      if (seen.has(key)) return;
      seen.add(key);

      let score = c.base;
      let matches = -1;
      let hitsTarget = null;

      // 一覧（順番にクリックする用途）では、その1件の文字に結びつく指定は使えない。
      // 「ログイン」ボタンのような一点狙いと違い、同じ形すべてに当たる必要がある。
      if (multi && ['text', 'role', 'label', 'placeholder'].indexOf(c.strategy) >= 0) {
        score -= 45;
        c.why = '⚠ この指定は特定の1件の文字に結びつくため、一覧の繰り返しには向きません。';
      }

      if (c.strategy === 'css' && doc) {
        matches = countMatches(doc, c.selector);
        if (matches === 1) {
          score += multi ? -6 : 8;   // 一覧なら1件しか取れない指定はむしろ狭すぎる
          hitsTarget = doc.querySelector(c.selector) === el;
        } else if (matches === 0) {
          score -= 45;
        } else if (matches > 1) {
          score += multi ? 10 : -Math.min(28, 6 + matches * 2);
          try {
            const all = Array.from(doc.querySelectorAll(c.selector));
            const idx = all.indexOf(el);
            if (idx >= 0) { hitsTarget = true; if (!multi) c.suggestIndex = idx; }
          } catch (e) { /* ignore */ }
        }
        if (hitsTarget === false) score -= 30;
      }

      // 長すぎるセレクタは扱いづらい
      if (c.selector.length > 90) score -= 8;

      c.score = U.clamp(Math.round(score), 1, 100);
      c.matches = matches;
      out.push(c);
    });

    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /* ══════════════════════════════════════════════════════════
     入力のパース
     ══════════════════════════════════════════════════════════ */

  /** 貼り付け内容が HTML なのか、セレクタ文字列なのかを判定する */
  function classifyInput(raw) {
    const s = String(raw || '').trim();
    if (!s) return { kind: 'empty' };
    if (/^document\.querySelector(All)?\s*\(/.test(s)) {
      const m = s.match(/\(\s*['"`]([\s\S]*?)['"`]\s*\)/);
      if (m) return { kind: 'selector', value: m[1] };
    }
    if (/^\/\//.test(s) || /^\/html/i.test(s)) return { kind: 'xpath', value: s };
    if (s.indexOf('<') >= 0 && /<[a-zA-Z!/]/.test(s)) return { kind: 'html', value: s };
    if (s.length < 250 && !/\s{2,}/.test(s) && /^[#.\[\]a-zA-Z0-9_\-\s>+~:="'(),*^$|]+$/.test(s)) {
      return { kind: 'selector', value: s };
    }
    return { kind: 'html', value: s };
  }

  /** HTML文字列を DOM にする。断片なら body 直下に入る。 */
  function parseHtml(html) {
    const parser = new DOMParser();
    const trimmed = String(html).trim();
    const isFullDoc = /^<!doctype/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
    let doc;
    if (isFullDoc) {
      doc = parser.parseFromString(trimmed, 'text/html');
    } else {
      // <tr> や <td> 断片は body 直下に置けないため table で包む
      let wrapped = trimmed;
      if (/^<(tr|td|th)[\s>]/i.test(trimmed)) wrapped = '<table><tbody>' + trimmed + '</tbody></table>';
      else if (/^<(option)[\s>]/i.test(trimmed)) wrapped = '<select>' + trimmed + '</select>';
      else if (/^<(li)[\s>]/i.test(trimmed)) wrapped = '<ul>' + trimmed + '</ul>';
      doc = parser.parseFromString('<body>' + wrapped + '</body>', 'text/html');
    }
    return { doc: doc, isFullDoc: isFullDoc };
  }

  /** 断片HTMLから「対象要素」を1つ選ぶ */
  function pickFragmentRoot(doc) {
    const body = doc.body;
    if (!body) return null;
    const kids = Array.from(body.children).filter(e => !/^(SCRIPT|STYLE|LINK|META)$/.test(e.tagName));
    if (!kids.length) return null;
    // table/select/ul で包んだ場合は中身を掘る
    let root = kids[0];
    while (root && /^(TABLE|TBODY|SELECT|UL)$/.test(root.tagName) && root.children.length === 1) {
      root = root.children[0];
    }
    return root;
  }

  const CLICKABLE = 'a,button,input[type=submit],input[type=button],input[type=image],[role=button],[role=link],[role=tab],[role=menuitem],[onclick],summary,label';
  const INPUTABLE = 'input:not([type=submit]):not([type=button]):not([type=hidden]),textarea,select,[contenteditable]';

  /** 全体HTML + キーワード から候補要素を探す */
  function findByKeyword(doc, keyword, purpose) {
    const kw = String(keyword || '').trim();
    let pool;
    if (purpose === 'click') pool = Array.from(doc.querySelectorAll(CLICKABLE));
    else if (purpose === 'input') pool = Array.from(doc.querySelectorAll(INPUTABLE));
    else pool = Array.from(doc.querySelectorAll('body *'));

    if (!kw) return pool.slice(0, 30);

    const lower = kw.toLowerCase();
    const scored = [];
    pool.forEach(el => {
      const txt = visibleText(el);
      const acc = accessibleName(el, doc);
      const ph = el.getAttribute('placeholder') || '';
      const val = el.getAttribute('value') || '';
      const hay = [txt, acc, ph, val].filter(Boolean);
      let s = 0;
      hay.forEach(h => {
        const hl = h.toLowerCase();
        if (hl === lower) s = Math.max(s, 100);
        else if (hl.indexOf(lower) >= 0) s = Math.max(s, 100 - Math.min(50, hl.length - lower.length));
      });
      if (s > 0) {
        // テキストが短い＝その要素そのものである可能性が高い
        s -= Math.min(30, Math.floor(txt.length / 10));
        scored.push({ el: el, s: s });
      }
    });
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, 12).map(x => x.el);
  }

  /**
   * 断片HTMLの外側が単なる入れ物だったときに、中の本命の要素まで掘り下げる。
   * 例）<div><label>メール</label><input id="email"></div> を貼られたら input を狙う。
   */
  function refineFragmentTarget(root, purpose) {
    if (!root || !root.matches) return root;
    const pick = (sel) => {
      const found = Array.from(root.querySelectorAll(sel));
      return found.length === 1 ? found[0] : null;
    };
    if (purpose === 'input' && !root.matches(INPUTABLE)) {
      const one = pick(INPUTABLE);
      if (one) return one;
      const many = root.querySelector(INPUTABLE);
      if (many) return many;
    }
    if (purpose === 'click' && !root.matches(CLICKABLE)) {
      const one = pick(CLICKABLE);
      if (one) return one;
    }
    return root;
  }

  /**
   * 一覧の入れ物（ul / tbody / div.grid など）を貼られたときに、
   * 「1件分の枠」に当たる子要素を見つける。
   */
  function pickRepeatingChild(el, depth) {
    depth = depth || 0;
    if (!el || depth > 4) return null;
    const kids = Array.from(el.children)
      .filter(c => !/^(SCRIPT|STYLE|THEAD|TFOOT|CAPTION|COLGROUP|TEMPLATE)$/.test(c.tagName));
    if (kids.length >= 2) {
      const counts = {};
      kids.forEach(k => { const s = signature(k); counts[s] = (counts[s] || 0) + 1; });
      let bestSig = null, best = 0;
      for (const s in counts) if (counts[s] > best) { best = counts[s]; bestSig = s; }
      if (best >= 2) {
        const hit = kids.find(k => signature(k) === bestSig);
        return { el: hit, count: best };
      }
    }
    if (kids.length === 1) return pickRepeatingChild(kids[0], depth + 1);
    return null;
  }

  /* ---------- 一覧（繰り返し）向け: 同じ形の兄弟を探す ---------- */
  function detectRepeating(el) {
    let cur = el;
    let best = null;
    let depth = 0;
    while (cur && cur.parentElement && depth < 8) {
      const parent = cur.parentElement;
      const sig = signature(cur);
      const siblings = Array.from(parent.children).filter(c => signature(c) === sig);
      if (siblings.length >= 2) {
        best = { el: cur, count: siblings.length, depth: depth };
        // より外側で、より件数の多い繰り返しがあればそちらを優先
      }
      cur = parent;
      depth++;
    }
    return best;
  }

  function signature(el) {
    const cls = classList(el).filter(c => !looksHashed(c)).sort().slice(0, 3).join('.');
    return el.tagName + '|' + cls;
  }

  /** container を起点にした相対セレクタ */
  function relativeSelector(container, el) {
    if (container === el) return '';
    const parts = [];
    let cur = el;
    while (cur && cur !== container && cur.nodeType === 1) {
      let part = cur.tagName.toLowerCase();
      const stable = classList(cur).filter(isStableClass);
      if (stable.length) part += '.' + cssEsc(stable[0]);
      else {
        const p = cur.parentElement;
        if (p) {
          const same = Array.from(p.children).filter(c => c.tagName === cur.tagName);
          if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
        }
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  /* ══════════════════════════════════════════════════════════
     公開API: analyze()
     ══════════════════════════════════════════════════════════ */
  /**
   * purpose の種類
   *   click : 1つのボタン／リンクを押す
   *   many  : 並んでいる同じ要素すべて（順番にクリックする用途）
   *   input : 文字を入れる欄
   *   text  : 文字を取り出す
   *   list  : 一覧の「1件分の枠」（表として取り出す用途）
   */
  function analyze(rawInput, keyword, purpose) {
    purpose = purpose || 'click';
    // many は「探し方は click と同じ、採点だけ“すべてに当たるか”で見る」
    const findAs = purpose === 'many' ? 'click' : purpose;
    const wantMany = purpose === 'many' || purpose === 'list';
    const cls = classifyInput(rawInput);

    if (cls.kind === 'empty') {
      return { ok: false, message: 'HTML を貼り付けてください。' };
    }

    if (cls.kind === 'xpath') {
      return {
        ok: true, mode: 'xpath', candidates: [{
          strategy: 'xpath', selector: cls.value, score: 30, matches: -1,
          why: '⚠ XPath は動きますが、HTMLの並び順に依存するため壊れやすい指定です。可能なら「Copy outerHTML」を貼って推定し直すことをおすすめします。'
        }]
      };
    }

    if (cls.kind === 'selector') {
      const looksStructural = /nth-child|nth-of-type|>\s*\w+\s*>/.test(cls.value);
      return {
        ok: true, mode: 'selector', candidates: [{
          strategy: 'css', selector: cls.value, score: looksStructural ? 30 : 62, matches: -1,
          why: looksStructural
            ? '⚠ 「Copy selector」で得られる並び順ベースの指定です。動きますが壊れやすいので、「Copy outerHTML」から推定し直すのを推奨します。'
            : 'そのままセレクタとして使えます。'
        }]
      };
    }

    /* --- HTML の場合 --- */
    let parsed;
    try { parsed = parseHtml(cls.value); }
    catch (e) { return { ok: false, message: 'HTML を解析できませんでした。' }; }

    const doc = parsed.doc;
    const bodyChildren = doc.body ? Array.from(doc.body.children).filter(e => !/^(SCRIPT|STYLE|LINK|META)$/.test(e.tagName)) : [];
    const elementCount = doc.body ? doc.body.querySelectorAll('*').length : 0;
    const kw = String(keyword || '').trim();

    // 「要素1つを貼った」のか「ページ全体を貼った」のかを判定
    const isFragment = !parsed.isFullDoc && bodyChildren.length === 1 && elementCount < 400 && !kw;

    let target = null;
    let alternatives = [];

    if (isFragment) {
      target = refineFragmentTarget(pickFragmentRoot(doc), findAs);
    } else {
      const found = findByKeyword(doc, kw, findAs);
      if (!found.length) {
        return {
          ok: false,
          message: kw
            ? '「' + kw + '」に一致する要素が見つかりませんでした。キーワードを変えるか、押したいボタンだけを「Copy outerHTML」で貼ってみてください。'
            : 'ページ全体のHTMLのようです。「絞り込みキーワード」に、ボタンに表示されている文字を入れてください。'
        };
      }
      target = found[0];
      alternatives = found.slice(1, 6);
    }

    if (!target) return { ok: false, message: '対象の要素を特定できませんでした。' };

    const scopeDoc = doc;
    // 一覧用途では「同じ形すべてに当たるか」を基準に採点する
    const cands = scoreCandidates(buildCandidates(target, scopeDoc, findAs), scopeDoc, target,
                                  wantMany ? { multi: true } : null);

    /* 一覧用途なら、繰り返しの枠と列候補も返す */
    let listInfo = null;
    if (purpose === 'list') {
      // 入れ物（ul/tbody/…）を貼られた場合はその中の1件へ、
      // すでに1件分を貼られた場合はそのまま使う
      const rep = pickRepeatingChild(target) || detectRepeating(target) || { el: target, count: 1 };
      const containerCands = scoreCandidates(
        buildCandidates(rep.el, scopeDoc, 'list'), scopeDoc, rep.el, { multi: true }
      ).filter(c => c.strategy === 'css');

      const columns = [];
      const seenKey = new Set();
      const addCol = (name, rel, attr, sample) => {
        const k = rel + '|' + attr;
        if (seenKey.has(k)) return;
        seenKey.add(k);
        columns.push({ name: name, selector: rel, attr: attr, sample: sample || '' });
      };

      Array.from(rep.el.querySelectorAll('a,h1,h2,h3,h4,h5,h6,p,span,td,th,img,time,strong,b,li,div'))
        .slice(0, 80)
        .forEach(child => {
          const t = visibleText(child);
          const href = child.tagName === 'A' ? child.getAttribute('href') : null;
          const isImg = child.tagName === 'IMG';
          if (!t && !href && !isImg) return;
          if (t && t.length > 200) return;
          const rel = relativeSelector(rep.el, child);
          if (!rel) return;

          if (isImg) {
            addCol('画像', rel, 'src', child.getAttribute('src') || '');
            return;
          }
          if (href) {
            // リンクは「見えている文字」と「リンク先」の両方が欲しいことが多い
            if (t) addCol(guessColumnName(child.parentElement || child, t), rel, 'text', t);
            addCol('リンク', rel, 'href', href);
            return;
          }
          // 中の子がまったく同じ文字なら、より内側の要素に任せる
          if (child.children.length && t && visibleText(child.children[0]) === t) return;
          addCol(guessColumnName(child, t), rel, 'text', t);
        });

      // 名前の重複に連番を振る
      const usedName = {};
      columns.forEach(c => {
        if (usedName[c.name]) { usedName[c.name]++; c.name = c.name + usedName[c.name]; }
        else usedName[c.name] = 1;
      });

      listInfo = {
        containerSelector: containerCands.length ? containerCands[0].selector : structuralPath(rep.el, doc.body),
        containerCandidates: containerCands.slice(0, 4),
        count: rep.count,
        columns: columns.slice(0, 12)
      };
    }

    return {
      ok: true,
      mode: isFragment ? 'fragment' : 'page',
      target: target,
      targetHtml: outerHtmlSnippet(target),
      targetText: visibleText(target).slice(0, 120),
      candidates: cands.slice(0, 8),
      alternatives: alternatives.map(a => ({
        text: visibleText(a).slice(0, 60) || accessibleName(a, doc).slice(0, 60) || '(テキストなし)',
        tag: a.tagName.toLowerCase(),
        el: a
      })),
      listInfo: listInfo,
      elementCount: elementCount,
      analyzedIn: isFragment ? '貼り付けた要素' : 'ページ全体（' + elementCount + '要素）'
    };
  }

  function guessColumnName(el, text) {
    if (el.tagName === 'IMG') return '画像';
    if (el.tagName === 'A') return 'リンク';
    if (el.tagName === 'TIME') return '日付';
    if (/^H[1-6]$/.test(el.tagName)) return 'タイトル';
    const cls = classList(el).filter(isStableClass)[0];
    if (cls) {
      const map = { title: 'タイトル', name: '名前', price: '価格', date: '日付', desc: '説明',
                    description: '説明', author: '著者', category: 'カテゴリ', tag: 'タグ',
                    status: '状態', id: 'ID', count: '件数', label: 'ラベル' };
      for (const k in map) if (cls.toLowerCase().indexOf(k) >= 0) return map[k];
      return cls;
    }
    if (/^[¥$€]?[\d,]+円?$/.test(String(text || '').trim())) return '価格';
    if (/\d{4}[-/年]\d{1,2}/.test(String(text || ''))) return '日付';
    return '項目';
  }

  function outerHtmlSnippet(el, max) {
    max = max || 400;
    let h = '';
    try { h = el.outerHTML || ''; } catch (e) { h = ''; }
    h = h.replace(/\s+/g, ' ');
    return h.length > max ? h.slice(0, max) + ' …' : h;
  }

  /* ---------- ターゲット→Playwright ロケータ式 ----------
     opts.bare = true なら .first / .nth() を付けない（.all() や .count() 用） */
  function locatorExpr(target, scopeVar, opts) {
    const scope = scopeVar || 'page';
    if (!target) return scope + '.locator("")';
    const s = target.strategy || 'css';
    const q = U.pyStr;
    let base;
    switch (s) {
      case 'role':
        base = scope + '.get_by_role(' + q(target.role || 'button') +
               (target.name ? ', name=' + q(target.name) + ', exact=False' : '') + ')';
        break;
      case 'text':
        base = scope + '.get_by_text(' + q(target.selector) + ', exact=False)';
        break;
      case 'label':
        base = scope + '.get_by_label(' + q(target.selector) + ', exact=False)';
        break;
      case 'placeholder':
        base = scope + '.get_by_placeholder(' + q(target.selector) + ')';
        break;
      case 'testid':
        base = scope + '.get_by_test_id(' + q(target.selector) + ')';
        break;
      case 'xpath':
        base = scope + '.locator(' + q('xpath=' + target.selector) + ')';
        break;
      default:
        base = scope + '.locator(' + q(target.selector) + ')';
    }
    if (opts && opts.bare) return base;
    // 'loop' = 繰り返しの何件目かに合わせる（1回目→1番目、2回目→2番目…）
    if (target.index === 'loop') {
      return base + '.nth(int(ctx.get("index", 1)) - 1)';
    }
    const idx = Number(target.index || 0);
    return idx > 0 ? base + '.nth(' + idx + ')' : base + '.first';
  }

  global.SEL = {
    analyze, locatorExpr, relativeSelector, classifyInput,
    isStableClass, isStableId, looksHashed, isUtilityClass,
    visibleText, accessibleName, roleOf, cssEsc
  };
})(window);
