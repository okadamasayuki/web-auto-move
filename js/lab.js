/* ══════════════════════════════════════════════════════════
   lab.js — セレクタ抽出タブ
   ──────────────────────────────────────────────────────────
   フロー編集とは独立に、HTMLを貼るだけで
   「スクレイピングに使えるセレクタ」を棚卸しする道具。
   解析本体は selector.js の SEL.catalog()。
   ══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const U = global.U;
  const SEL = global.SEL;

  let lastResult = null;
  let frameDoc = null;      // プレビューiframeのdocument
  let pinned = -1;          // クリックで固定した行の番号（-1=なし）

  function $(sel) { return U.$(sel); }

  /* ══════════ プレビュー（貼ったHTMLの簡易表示に赤枠を出す） ══════════ */

  const PREVIEW_CSS = [
    ':not(:defined){display:block}',                       // 未定義のカスタム要素も縦に並べる
    'body{font:13px/1.7 -apple-system,"Hiragino Sans","Yu Gothic",Meiryo,sans-serif;',
    '  margin:12px;word-break:break-word;background:#fff;color:#1c2230}',
    'img{max-width:120px;max-height:80px}',
    'a{color:#2563eb}',
    'script,style,link,noscript,template{display:none!important}',
    '.wam-hit{outline:3px solid #ef4444!important;outline-offset:2px;',
    '  background:rgba(239,68,68,.10)!important;position:relative}',
    '.wam-hit::after{content:attr(data-wam-n);position:absolute;top:-9px;left:-9px;z-index:9;',
    '  min-width:16px;height:16px;line-height:16px;text-align:center;padding:0 3px;',
    '  background:#ef4444;color:#fff;font-size:10px;font-weight:700;border-radius:9px;',
    '  font-family:-apple-system,sans-serif}'
  ].join('\n');

  function stripScripts(html) {
    return String(html)
      .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }

  function buildPreview(raw) {
    const pv = $('#labPreview');
    const fr = $('#labFrame');
    frameDoc = null;
    pinned = -1;
    pv.hidden = false;
    fr.onload = () => {
      const d = fr.contentDocument;
      if (!d) return;
      frameDoc = d;
      const st = d.createElement('style');
      st.textContent = PREVIEW_CSS;
      (d.head || d.documentElement).appendChild(st);
      d.addEventListener('click', onFrameClick, true);
    };
    fr.srcdoc = stripScripts(raw);
  }

  function hidePreview() {
    $('#labPreview').hidden = true;
    $('#labFrame').srcdoc = '';
    frameDoc = null;
    pinned = -1;
  }

  /** 行の指定が、プレビュー内のどの要素に当たるかを求める */
  function resolveEls(row) {
    if (!frameDoc || !frameDoc.body) return [];
    try {
      if (row.strategy === 'css') return Array.from(frameDoc.querySelectorAll(row.selector)).slice(0, 150);
      if (row.strategy === 'xpath') {
        const it = frameDoc.evaluate(row.selector, frameDoc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        const out = [];
        for (let i = 0; i < Math.min(it.snapshotLength, 150); i++) out.push(it.snapshotItem(i));
        return out;
      }
    } catch (e) { return []; }
    // role / text / label / placeholder は内容で照合する
    const name = String(row.name || row.selector || '').toLowerCase();
    const all = Array.from(frameDoc.body.querySelectorAll('*')).slice(0, 5000);
    return all.filter(el => {
      if (row.strategy === 'role') {
        return SEL.roleOf(el) === row.role &&
               SEL.accessibleName(el, frameDoc).toLowerCase().indexOf(name) >= 0;
      }
      if (row.strategy === 'text') return SEL.visibleText(el).toLowerCase() === name;
      if (row.strategy === 'placeholder') return (el.getAttribute('placeholder') || '').toLowerCase() === name;
      if (row.strategy === 'label') return SEL.accessibleName(el, frameDoc).toLowerCase() === name;
      return false;
    }).slice(0, 150);
  }

  function clearHighlight() {
    if (!frameDoc) return;
    Array.from(frameDoc.querySelectorAll('.wam-hit')).forEach(el => {
      el.classList.remove('wam-hit');
      el.removeAttribute('data-wam-n');
    });
  }

  function highlightEls(els) {
    if (!frameDoc) return 0;
    clearHighlight();
    els.forEach((el, i) => {
      el.classList.add('wam-hit');
      el.setAttribute('data-wam-n', i + 1);
    });
    // scrollIntoView だと親ページまで一緒にスクロールしてしまうので、iframeの中だけ動かす
    const first = els[0];
    const win = frameDoc.defaultView;
    if (first && win) {
      const r = first.getBoundingClientRect();
      win.scrollTo(0, Math.max(0, win.scrollY + r.top - win.innerHeight / 2 + r.height / 2));
    }
    return els.length;
  }

  function highlightRowIndex(i) {
    const flat = $('#labResults')._flat || [];
    const item = flat[i];
    if (!item) return;
    highlightEls(resolveEls(item.row));
  }

  function setPinned(i) {
    pinned = i;
    U.$$('#labResults .lab-row').forEach(r =>
      r.classList.toggle('pinned', Number(r.dataset.i) === i));
    if (i >= 0) highlightRowIndex(i); else clearHighlight();
  }

  /** プレビュー内の要素をクリック → 該当する行へ飛ぶ */
  function onFrameClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const flat = $('#labResults')._flat || [];
    let hitIndex = -1;
    for (let i = 0; i < flat.length && hitIndex < 0; i++) {
      const row = flat[i].row;
      if (row.strategy === 'css') {
        try { if (e.target.closest(row.selector)) hitIndex = i; } catch (er) { /* 無効セレクタは無視 */ }
      } else if (resolveEls(row).some(el => el === e.target || el.contains(e.target))) {
        hitIndex = i;
      }
    }
    if (hitIndex < 0) { U.toast('この場所に当たる行は見つかりませんでした', 'info'); return; }
    setPinned(hitIndex);
    const rowEl = U.$('#labResults .lab-row[data-i="' + hitIndex + '"]');
    if (rowEl) {
      rowEl.scrollIntoView({ block: 'center' });
      rowEl.classList.remove('flash');
      void rowEl.offsetWidth;              // アニメーションを再発火させる
      rowEl.classList.add('flash');
    }
  }

  /* ---------- 表示切替（フロー ⇔ セレクタ抽出） ---------- */
  function show(on) {
    $('#labView').hidden = !on;
    U.$('.workspace').style.display = on ? 'none' : '';
    $('#tabLab').classList.toggle('active', on);
    $('#tabFlow').classList.toggle('active', !on);
    if (on) setTimeout(() => $('#labHtml').focus(), 50);
  }

  /* ---------- コピー ---------- */
  function copyText(text, doneMsg) {
    const done = () => U.toast(doneMsg || 'コピーしました', 'ok');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    } else fallback();
    function fallback() {
      const ta = U.el('textarea', { style: { position: 'fixed', left: '-9999px' } });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { U.toast('コピーできませんでした', 'err'); }
      ta.remove();
    }
  }

  /* ---------- 行 → Pythonコード ---------- */
  function rowLocator(row, bare) {
    return SEL.locatorExpr(
      { strategy: row.strategy, selector: row.selector, role: row.role, name: row.name },
      'page', bare ? { bare: true } : null
    );
  }

  function pythonSnippet(row, repeated) {
    const bare = rowLocator(row, true);
    if (repeated) {
      return 'items = ' + bare + '\n' +
             'for i in range(items.count()):\n' +
             '    item = items.nth(i)\n' +
             (row.kind === 'text'
               ? '    print(item.inner_text())'
               : '    item.click()\n    page.go_back()');
    }
    const one = rowLocator(row, false);   // .first 付き
    if (row.kind === 'input') return one + '.fill("入れたい文字")';
    if (row.kind === 'text') return 'print(' + one + '.inner_text())';
    return one + '.click()';
  }

  /* ---------- 描画 ---------- */
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function scoreClass(score) {
    return score >= 78 ? 'b-ok' : score >= 50 ? 'b-info' : 'b-warn';
  }
  function scoreWord(score) {
    return score >= 78 ? '安定' : score >= 50 ? 'まずまず' : '壊れやすい';
  }

  function rowHtml(row, i, repeated) {
    const hay = (row.selector + ' ' + (row.name || '') + ' ' + row.samples.join(' ')).toLowerCase();
    const sample = row.samples.length
      ? '例: ' + row.samples.map(esc).join(' ／ ')
      : '';
    const hits = repeated
      ? '<span class="lab-hits">🔁 ' + row.hits + '件に当たる</span>'
      : (row.matches > 1 ? '<span class="lab-hits lab-hits-warn">' + row.matches + '件に一致</span>'
         : row.matches === 1 ? '<span class="lab-hits lab-hits-ok">1件に特定 ✓</span>' : '');
    const shown = row.strategy === 'role'
      ? 'role: ' + esc(row.role) + ' ／ 名前: ' + esc(row.name)
      : esc(row.selector);
    const altNote = row.alt
      ? '<div class="lab-alt">別案: <code>' + (row.alt.strategy === 'role'
          ? 'role:' + esc(row.alt.role) + '/' + esc(row.alt.name)
          : esc(row.alt.selector)) + '</code></div>'
      : '';
    return '<div class="sel-card lab-row" data-hay="' + esc(hay) + '" data-i="' + i + '">' +
      '<div class="sc-score"><b>' + row.score + '</b><small>安定度</small></div>' +
      '<div class="sc-main">' +
        '<div class="sc-sel">' +
          '<span class="sc-badge ' + scoreClass(row.score) + '">' + scoreWord(row.score) + '</span>' +
          '<code>' + shown + '</code></div>' +
        '<div class="sc-why">' + hits + (sample ? ' <span class="lab-sample">' + sample + '</span>' : '') + '</div>' +
        altNote +
      '</div>' +
      '<div class="lab-btns">' +
        '<button class="btn btn-sm" data-copy="sel" title="セレクタ（またはPlaywright指定）をコピー">📋 セレクタ</button>' +
        '<button class="btn btn-sm" data-copy="py" title="そのまま使えるPythonコードをコピー">🐍 Python</button>' +
      '</div></div>';
  }

  function sectionHtml(icon, title, note, rowsHtml) {
    if (!rowsHtml) return '';
    return '<section class="lab-sec">' +
      '<h3>' + icon + ' ' + title + ' <small>' + esc(note || '') + '</small></h3>' +
      rowsHtml + '</section>';
  }

  function render(res) {
    lastResult = res;
    const box = $('#labResults');
    $('#labScope').textContent = res && res.ok ? '解析対象: ' + res.analyzedIn : '';

    if (!res.ok) {
      box.innerHTML = '<div class="lab-empty"><div class="le-icon">🤔</div><p>' + esc(res.message) + '</p></div>';
      return;
    }

    const g = res.groups;
    const flat = [];
    const collect = (rows, repeated) => rows.map(r => {
      flat.push({ row: r, repeated: repeated });
      return rowHtml(r, flat.length - 1, repeated);
    }).join('');

    let html = '';
    html += sectionHtml('🔁', '並んでいる要素', '一覧・「順番にクリック」の主役。繰り返しノードの「数える要素」にも使えます',
      collect(g.repeat.slice(0, 12), true));
    html += sectionHtml('🖱', 'クリックできるもの', 'ボタン・リンクなど1件狙い',
      collect(g.click.slice(0, 14), false));
    html += sectionHtml('⌨️', '入力欄', '文字入力ノードの対象に',
      collect(g.input.slice(0, 10), false));
    html += sectionHtml('📰', '見出し', '情報取得（文字の取り出し）の対象に',
      collect(g.text.slice(0, 8), false));

    /* id / class の在庫 */
    if (res.ids.length || res.classes.length) {
      let chips = '';
      if (res.ids.length) {
        chips += '<div class="lab-chip-row"><b>id</b>' +
          res.ids.map(r => '<button class="lab-chip" data-chip="#' + esc(SEL.cssEsc(r.name)) + '" ' +
            'title="' + esc(r.tag + (r.text ? '： ' + r.text : '')) + '">#' + esc(r.name) + '</button>').join('') +
          '</div>';
      }
      if (res.classes.length) {
        chips += '<div class="lab-chip-row"><b>class</b>' +
          res.classes.map(r => '<button class="lab-chip" data-chip=".' + esc(SEL.cssEsc(r.name)) + '" ' +
            'title="' + r.count + '回使われています">.' + esc(r.name) +
            (r.count > 1 ? '<i>×' + r.count + '</i>' : '') + '</button>').join('') +
          '</div>';
      }
      html += '<section class="lab-sec"><h3>🏷 id / class の在庫 <small>クリックでセレクタとしてコピー。手で組み合わせたい人向け</small></h3>' +
        '<div class="lab-chips">' + chips + '</div></section>';
    }

    if (!html) {
      html = '<div class="lab-empty"><div class="le-icon">🤔</div>' +
        '<p>ボタン・リンク・入力欄・見出しが見つかりませんでした。<br>もう少し外側の要素から「Copy outerHTML」してみてください。</p></div>';
    }
    box.innerHTML = html;
    box._flat = flat;
    pinned = -1;
    applyFilter();
  }

  /* ---------- 絞り込み ---------- */
  function applyFilter() {
    const q = $('#labFilter').value.trim().toLowerCase();
    U.$$('#labResults .lab-row').forEach(row => {
      row.style.display = !q || row.dataset.hay.indexOf(q) >= 0 ? '' : 'none';
    });
    U.$$('#labResults .lab-chip').forEach(chip => {
      chip.style.display = !q || chip.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
    });
  }

  /* ---------- 解析 ---------- */
  function analyze() {
    const raw = $('#labHtml').value;
    if (!raw.trim()) { U.toast('HTML を貼り付けてください', 'warn'); return; }
    const res = SEL.catalog(raw);
    render(res);
    if (res.ok) {
      buildPreview(raw);
      const total = res.groups.repeat.length + res.groups.click.length +
                    res.groups.input.length + res.groups.text.length;
      U.toast(total + '種類のセレクタを抽出しました', 'ok');
    } else {
      hidePreview();
    }
  }

  const SAMPLE_HTML = [
    '<div id="store">',
    '  <h1>お知らせ一覧</h1>',
    '  <input type="search" id="q" placeholder="キーワードで探す">',
    '  <ul class="news-list">',
    '    <li class="news-item"><a class="news-link" href="/news/101">春の新商品のご案内</a><time class="news-date">2026-03-01</time></li>',
    '    <li class="news-item"><a class="news-link" href="/news/102">営業時間変更のお知らせ</a><time class="news-date">2026-03-08</time></li>',
    '    <li class="news-item"><a class="news-link" href="/news/103">会員セールのご招待</a><time class="news-date">2026-03-15</time></li>',
    '  </ul>',
    '  <button class="btn-more" type="button">もっと見る</button>',
    '</div>'
  ].join('\n');

  /* ---------- 初期化 ---------- */
  function init() {
    $('#tabFlow').addEventListener('click', () => show(false));
    $('#tabLab').addEventListener('click', () => show(true));

    $('#labAnalyze').addEventListener('click', analyze);
    $('#labHtml').addEventListener('paste', () => setTimeout(analyze, 60));
    $('#labHtml').addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') analyze();
    });
    $('#labClear').addEventListener('click', () => {
      $('#labHtml').value = '';
      $('#labFilter').value = '';
      $('#labScope').textContent = '';
      hidePreview();
      $('#labResults').innerHTML = '<div class="lab-empty"><div class="le-icon">🎯</div>' +
        '<p>左にHTMLを貼って「🔎 抽出する」を押すと、<br>使えるセレクタと簡易プレビューがここに出ます。</p></div>';
    });
    $('#labSample').addEventListener('click', () => {
      $('#labHtml').value = SAMPLE_HTML;
      analyze();
    });
    $('#labFilter').addEventListener('input', U.debounce(applyFilter, 120));

    /* 行内のコピーボタン／行クリックで赤枠を固定 */
    $('#labResults').addEventListener('click', e => {
      const chip = e.target.closest('.lab-chip');
      if (chip) { copyText(chip.dataset.chip, '「' + chip.dataset.chip + '」をコピーしました'); return; }
      const btn = e.target.closest('[data-copy]');
      const rowEl = e.target.closest('.lab-row');
      const flat = $('#labResults')._flat || [];
      if (!btn) {
        if (rowEl) {                       // 行そのものをクリック → 赤枠を固定/解除
          const i = Number(rowEl.dataset.i);
          setPinned(pinned === i ? -1 : i);
        }
        return;
      }
      const item = flat[Number(rowEl.dataset.i)];
      if (!item) return;
      if (btn.dataset.copy === 'sel') {
        const text = item.row.strategy === 'css' || item.row.strategy === 'xpath'
          ? item.row.selector
          : rowLocator(item.row, true);
        copyText(text, 'セレクタをコピーしました');
      } else {
        copyText(pythonSnippet(item.row, item.repeated), 'Pythonコードをコピーしました');
      }
    });

    /* 行やチップにマウスを乗せると、プレビューに赤枠が出る（固定中は固定を優先） */
    $('#labResults').addEventListener('mouseover', e => {
      if (pinned >= 0 || !frameDoc) return;
      const chip = e.target.closest('.lab-chip');
      if (chip) {
        try { highlightEls(Array.from(frameDoc.querySelectorAll(chip.dataset.chip)).slice(0, 150)); }
        catch (er) { /* 無効セレクタは無視 */ }
        return;
      }
      const rowEl = e.target.closest('.lab-row');
      if (rowEl) highlightRowIndex(Number(rowEl.dataset.i));
    });
    $('#labResults').addEventListener('mouseleave', () => {
      if (pinned < 0) clearHighlight();
    });

    /* ブックマークレット（フロー側と同じもの） */
    const bm = $('#bmLinkLab');
    if (bm && global.INSPECTOR && INSPECTOR.SelModal) {
      bm.setAttribute('href', INSPECTOR.SelModal.bookmarkletCode());
      bm.addEventListener('click', e => {
        e.preventDefault();
        U.toast('クリックではなく、このボタンをブックマークバーへドラッグして登録してください', 'info', 4000);
      });
    }
  }

  global.LAB = { init, show };
})(window);
