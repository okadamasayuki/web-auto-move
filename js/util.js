/* ══════════════════════════════════════════════════════════
   util.js — 共通ユーティリティ
   ══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const U = {};

  /* ---------- DOM ---------- */
  U.$  = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  U.el = function (tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (v === true) n.setAttribute(k, '');
        else n.setAttribute(k, v);
      }
    }
    (Array.isArray(children) ? children : children ? [children] : []).forEach(c => {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number'
        ? document.createTextNode(String(c)) : c);
    });
    return n;
  };

  U.escapeHtml = s => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ---------- ID ---------- */
  let idSeq = 0;
  U.uid = function (prefix) {
    idSeq += 1;
    return (prefix || 'id') + '_' +
      Date.now().toString(36) + '_' + idSeq.toString(36) +
      Math.random().toString(36).slice(2, 6);
  };

  /* ---------- 汎用 ---------- */
  U.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  U.deepClone = o => (typeof structuredClone === 'function'
    ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

  U.debounce = function (fn, ms) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), ms);
    };
  };

  U.throttle = function (fn, ms) {
    let last = 0, pending = null;
    return function () {
      const args = arguments, self = this, now = Date.now();
      if (now - last >= ms) { last = now; fn.apply(self, args); }
      else {
        clearTimeout(pending);
        pending = setTimeout(() => { last = Date.now(); fn.apply(self, args); }, ms - (now - last));
      }
    };
  };

  /* ---------- Python 文字列リテラル ---------- */
  U.pyStr = function (s) {
    if (s === null || s === undefined) return '""';
    // 常に1行のリテラルにする。三重引用符は、生成側でインデントを付ける際に
    // 文字列の中身まで字下げされてしまうため使わない。
    const t = String(s).replace(/\r\n?/g, '\n');
    return '"' + t
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t') + '"';
  };

  U.pyBool = v => (v ? 'True' : 'False');

  U.pyNum = function (v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : String(fallback === undefined ? 0 : fallback);
  };

  /* Python の識別子として使える名前に整える */
  U.pyIdent = function (s, fallback) {
    let t = String(s || '').trim().replace(/[^\w぀-ヿ一-龯]/g, '_');
    if (!t || /^\d/.test(t)) t = '_' + t;
    return t || (fallback || 'value');
  };

  /* ---------- テンプレート変数 {{ }} ---------- */
  U.VAR_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
  U.extractVars = function (tpl) {
    const out = [];
    if (!tpl) return out;
    String(tpl).replace(U.VAR_RE, (_, name) => { out.push(name.trim()); return ''; });
    return out;
  };
  U.hasVars = tpl => !!tpl && U.VAR_RE.test(String(tpl).replace(U.VAR_RE, m => m));

  /* ---------- トースト ---------- */
  U.toast = function (msg, kind, ms) {
    const wrap = U.$('#toastWrap');
    if (!wrap) return;
    const icons = { ok: '✅', err: '⛔', warn: '⚠️', info: 'ℹ️' };
    const t = U.el('div', { class: 'toast t-' + (kind || 'info') }, [
      U.el('span', { text: icons[kind || 'info'] || 'ℹ️' }),
      U.el('span', { text: msg })
    ]);
    wrap.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 260);
    }, ms || 2600);
  };

  /* ---------- ファイル ---------- */
  U.downloadFile = function (filename, content, mime) {
    const blob = content instanceof Blob
      ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = U.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  U.readFileAsText = function (file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsText(file, 'utf-8');
    });
  };

  /**
   * 画像ファイル/Blob を、長辺 maxDim px 以内の JPEG dataURL に圧縮する。
   * スクショをそのまま持つとプロジェクトJSONが肥大化するため。
   */
  U.compressImage = function (fileOrBlob, maxDim, quality) {
    maxDim = maxDim || 1500;
    quality = quality === undefined ? 0.82 : quality;
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(fileOrBlob);
      const img = new Image();
      img.onload = function () {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const out = cv.toDataURL('image/jpeg', quality);
          URL.revokeObjectURL(url);
          res({ dataUrl: out, width: w, height: h,
                origWidth: img.naturalWidth, origHeight: img.naturalHeight });
        } catch (e) { URL.revokeObjectURL(url); rej(e); }
      };
      img.onerror = function (e) { URL.revokeObjectURL(url); rej(e); };
      img.src = url;
    });
  };

  U.formatBytes = function (n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
  };

  /* ---------- IndexedDB（自動保存用） ---------- */
  const DB_NAME = 'web-auto-move';
  const STORE = 'projects';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((res, rej) => {
      if (!global.indexedDB) { rej(new Error('IndexedDB 未対応')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbPromise;
  }

  U.idbSet = function (key, value) {
    return openDB().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    }));
  };

  U.idbGet = function (key) {
    return openDB().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(key);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    }));
  };

  U.idbDel = function (key) {
    return openDB().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    }));
  };

  /* localStorage は小さな設定のみに使う */
  U.lsGet = function (k, dflt) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? dflt : JSON.parse(v);
    } catch (e) { return dflt; }
  };
  U.lsSet = function (k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 容量超過は無視 */ }
  };

  /* ---------- Python シンタックスハイライト（簡易・外部依存なし） ---------- */
  U.highlightPython = function (src) {
    const KW = new Set(('False None True and as assert async await break class continue def del elif ' +
      'else except finally for from global if import in is lambda nonlocal not or pass raise return ' +
      'try while with yield').split(' '));
    const BUILT = new Set(('print len range str int float bool list dict set tuple open enumerate zip ' +
      'sorted min max sum abs any all round type isinstance getattr Exception ValueError ' +
      'RuntimeError TimeoutError KeyboardInterrupt').split(' '));

    let out = '';
    let i = 0;
    const n = src.length;
    const esc = U.escapeHtml;

    while (i < n) {
      const ch = src[i];

      // コメント
      if (ch === '#') {
        let j = src.indexOf('\n', i);
        if (j < 0) j = n;
        out += '<span class="c">' + esc(src.slice(i, j)) + '</span>';
        i = j;
        continue;
      }
      // 三重引用符
      if (src.startsWith('"""', i) || src.startsWith("'''", i)) {
        const q = src.substr(i, 3);
        let j = src.indexOf(q, i + 3);
        j = j < 0 ? n : j + 3;
        out += '<span class="s">' + esc(src.slice(i, j)) + '</span>';
        i = j;
        continue;
      }
      // 文字列（f/r/b プレフィックス対応）
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === ch) { j++; break; }
          if (src[j] === '\n') break;
          j++;
        }
        out += '<span class="s">' + esc(src.slice(i, j)) + '</span>';
        i = j;
        continue;
      }
      // デコレータ
      if (ch === '@' && (i === 0 || src[i - 1] === '\n')) {
        let j = i;
        while (j < n && /[\w.@]/.test(src[j])) j++;
        out += '<span class="d">' + esc(src.slice(i, j)) + '</span>';
        i = j;
        continue;
      }
      // 数値
      if (/\d/.test(ch) && (i === 0 || !/[\w.]/.test(src[i - 1]))) {
        let j = i;
        while (j < n && /[\d._xXa-fA-F]/.test(src[j])) j++;
        out += '<span class="n">' + esc(src.slice(i, j)) + '</span>';
        i = j;
        continue;
      }
      // 識別子
      if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (j < n && /[\w]/.test(src[j])) j++;
        const w = src.slice(i, j);
        if (KW.has(w)) out += '<span class="k">' + esc(w) + '</span>';
        else if (BUILT.has(w)) out += '<span class="f">' + esc(w) + '</span>';
        else if (src[j] === '(') out += '<span class="f">' + esc(w) + '</span>';
        else out += esc(w);
        i = j;
        continue;
      }
      out += esc(ch);
      i++;
    }
    return out;
  };

  /* ---------- Markdown 用の素通しハイライト ---------- */
  U.highlightPlain = src => U.escapeHtml(src);

  global.U = U;
})(window);
