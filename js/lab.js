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

  function $(sel) { return U.$(sel); }

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
      const total = res.groups.repeat.length + res.groups.click.length +
                    res.groups.input.length + res.groups.text.length;
      U.toast(total + '種類のセレクタを抽出しました', 'ok');
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
      $('#labResults').innerHTML = '<div class="lab-empty"><div class="le-icon">🎯</div>' +
        '<p>左にHTMLを貼って「🔎 抽出する」を押すと、<br>使えるセレクタがここに一覧で出ます。</p></div>';
    });
    $('#labSample').addEventListener('click', () => {
      $('#labHtml').value = SAMPLE_HTML;
      analyze();
    });
    $('#labFilter').addEventListener('input', U.debounce(applyFilter, 120));

    /* 行内のコピーボタン */
    $('#labResults').addEventListener('click', e => {
      const chip = e.target.closest('.lab-chip');
      if (chip) { copyText(chip.dataset.chip, '「' + chip.dataset.chip + '」をコピーしました'); return; }
      const btn = e.target.closest('[data-copy]');
      if (!btn) return;
      const rowEl = btn.closest('.lab-row');
      const flat = $('#labResults')._flat || [];
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
