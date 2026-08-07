/* ══════════════════════════════════════════════════════════
   app.js — 画面全体の配線（パレット / 保存 / 書き出し / コード表示）
   ══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const U = global.U;
  const NODES = global.NODES;
  const FLOW = global.FLOW;
  const INSPECTOR = global.INSPECTOR;
  const CODEGEN = global.CODEGEN;
  const SAMPLES = global.SAMPLES;

  const AUTOSAVE_KEY = 'current';
  const LS_THEME = 'wam.theme';
  const LS_FIRST = 'wam.visited';

  let lastGenerated = null;   // { files, issues }
  let activeFile = 'scraper.py';

  /* ══════════════ 起動 ══════════════ */
  function boot() {
    applyTheme(U.lsGet(LS_THEME, prefersDark() ? 'dark' : 'light'));
    FLOW.init();
    INSPECTOR.init();
    if (global.LAB) LAB.init();
    buildPalette();
    bindTopbar();
    bindModals();
    bindShortcuts();
    buildSamplesGrid();

    FLOW.on('change', () => {
      markDirty();
      scheduleAutosave();
      INSPECTOR.refresh();
    });

    showBuildVersion();
    restore();

    // 実行環境が開いたリンクなら、コード入力なしで自動接続する
    setTimeout(() => {
      try { global.RUNNER.autoConnectFromHash(); } catch (e) { /* 無視 */ }
    }, 400);
  }

  function prefersDark() {
    return global.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /**
   * 今読み込まれている版を表示する。
   * 「更新したのに変わらない」ときに、キャッシュか否かをここで判別できる。
   */
  function showBuildVersion() {
    const el = U.$('#buildVer');
    if (!el) return;
    let ver = 'dev';
    const tag = document.querySelector('script[src*="app.js"]');
    if (tag) {
      const m = String(tag.getAttribute('src') || '').match(/[?&]v=([^&]+)/);
      if (m) ver = m[1];
    }
    el.textContent = 'v' + ver;
    el.title = 'この画面の版。更新しても変わらないときは Ctrl+F5（Macは ⌘+Shift+R）で読み込み直してください。';
  }

  /* ══════════════ テーマ ══════════════ */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    U.lsSet(LS_THEME, theme);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
    FLOW.drawEdges();
  }

  /* ══════════════ パレット ══════════════ */
  function buildPalette() {
    const list = U.$('#paletteList');
    list.textContent = '';

    NODES.CATEGORIES.forEach(cat => {
      const types = Object.keys(NODES.TYPES).filter(t => NODES.TYPES[t].category === cat);
      if (!types.length) return;
      list.appendChild(U.el('div', { class: 'pal-group-title', text: cat, 'data-cat': cat }));
      types.forEach(type => {
        const def = NODES.TYPES[type];
        const item = U.el('div', {
          class: 'pal-item', draggable: 'true', 'data-type': type,
          'data-search': (def.label + ' ' + (def.desc || '') + ' ' + type).toLowerCase(),
          title: def.desc || def.label
        }, [
          U.el('div', { class: 'pal-ico', style: { '--nc': def.color }, text: def.icon }),
          U.el('div', { class: 'pal-txt' }, [
            U.el('b', { text: def.label }),
            U.el('small', { text: shortDesc(def.desc) })
          ])
        ]);

        item.addEventListener('dragstart', ev => {
          ev.dataTransfer.setData('text/node-type', type);
          ev.dataTransfer.effectAllowed = 'copy';
        });
        item.addEventListener('click', () => addNodeSmart(type));
        list.appendChild(item);
      });
    });

    U.$('#paletteSearch').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      U.$$('.pal-item', list).forEach(it => {
        it.style.display = !q || it.dataset.search.indexOf(q) >= 0 ? '' : 'none';
      });
      U.$$('.pal-group-title', list).forEach(g => {
        let n = g.nextElementSibling;
        let any = false;
        while (n && n.classList.contains('pal-item')) {
          if (n.style.display !== 'none') any = true;
          n = n.nextElementSibling;
        }
        g.style.display = any ? '' : 'none';
      });
    });
  }

  function shortDesc(d) {
    if (!d) return '';
    const s = String(d).split('。')[0];
    return s.length > 26 ? s.slice(0, 26) + '…' : s;
  }

  /**
   * パレットのクリックでノードを追加する。
   * 選択中ノードがあればその右隣に置き、自動でつなぐ（連続で組み立てやすくするため）。
   */
  function addNodeSmart(type) {
    const g = FLOW.graph;
    const sel = FLOW.selected ? FLOW.getNode(FLOW.selected) : null;
    let x = 140, y = 140;

    if (sel) {
      x = sel.x + 300;
      y = sel.y;
      // 同じ場所に重ならないよう、空いている高さを探す
      while (g.nodes.some(n => Math.abs(n.x - x) < 60 && Math.abs(n.y - y) < 110)) y += 170;
    } else if (g.nodes.length) {
      const last = g.nodes[g.nodes.length - 1];
      x = last.x + 300; y = last.y;
    } else {
      const r = U.$('#viewport').getBoundingClientRect();
      const p = FLOW.screenToWorld(r.left + r.width / 2 - FLOW.NODE_W / 2, r.top + 120);
      x = p.x; y = p.y;
    }

    const node = FLOW.addNode(type, x, y);
    if (!node) return;

    if (sel) {
      const outs = NODES.outputsOf(sel.type);
      // すでに使われていない出口を探してつなぐ
      const free = outs.find(o => !g.edges.some(e => e.from === sel.id && e.port === o.id));
      if (free) FLOW.connect(sel.id, free.id, node.id);
    }
    FLOW.centerOn(node.id);
  }

  /* ══════════════ ヘッダのボタン ══════════════ */
  function bindTopbar() {
    U.$('#btnTheme').addEventListener('click', toggleTheme);
    U.$('#btnHelp').addEventListener('click', () => openModal('helpModal'));
    U.$('#btnSamples').addEventListener('click', () => openModal('samplesModal'));

    U.$('#btnNew').addEventListener('click', () => {
      if (FLOW.graph.nodes.length && !confirm('現在のフローを破棄して新規作成します。よろしいですか？\n（先に「エクスポート」で保存しておけば復元できます）')) return;
      FLOW.clear();
      FLOW.graph.name = '新しいフロー';
      U.$('#projectName').value = FLOW.graph.name;
      FLOW.addNode('start', 160, 160);
      U.toast('新しいフローを作りました', 'ok');
    });

    U.$('#btnExport').addEventListener('click', exportProject);
    U.$('#btnImport').addEventListener('click', () => U.$('#fileImport').click());
    U.$('#fileImport').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) importProject(f);
      e.target.value = '';
    });

    U.$('#btnGenerate').addEventListener('click', generateCode);
    U.$('#btnRun').addEventListener('click', () => global.RUNNER.openModal());

    U.$('#btnPreview').addEventListener('click', () => global.PREVIEW.open());
    U.$('#btnZoomIn').addEventListener('click', () => FLOW.zoom(1));
    U.$('#btnZoomOut').addEventListener('click', () => FLOW.zoom(-1));
    U.$('#btnZoomReset').addEventListener('click', () => FLOW.zoomReset());
    U.$('#btnFit').addEventListener('click', () => FLOW.fit());
    U.$('#btnAutoLayout').addEventListener('click', () => FLOW.autoLayout());
    U.$('#btnValidate').addEventListener('click', () => { generateCode(); showFile('__issues__'); });
    U.$('#btnDeleteSel').addEventListener('click', () => {
      if (FLOW.selected) FLOW.deleteNode(FLOW.selected);
      else U.toast('削除したいノードを選んでください', 'warn');
    });

    U.$('#btnQuickStart').addEventListener('click', () => {
      FLOW.addNode('start', 160, 160);
      U.toast('開始ノードを置きました。URLを入れてください', 'ok');
    });

    const nameInput = U.$('#projectName');
    nameInput.addEventListener('input', () => {
      FLOW.graph.name = nameInput.value;
      markDirty();
      scheduleAutosave();
    });

    /* コード表示まわり */
    U.$('#btnCopyCode').addEventListener('click', copyCode);
    U.$('#btnDownloadCode').addEventListener('click', downloadActiveFile);
    U.$('#btnDownloadAll').addEventListener('click', downloadAll);
    U.$$('.code-tab').forEach(tab => {
      tab.addEventListener('click', () => showFile(tab.dataset.file));
    });
  }

  /* ══════════════ モーダル ══════════════ */
  function openModal(id) { U.$('#' + id).hidden = false; }
  function closeModal(id) { U.$('#' + id).hidden = true; }

  function bindModals() {
    U.$$('[data-close]').forEach(b => {
      b.addEventListener('click', () => closeModal(b.dataset.close));
    });
    U.$$('.modal').forEach(m => {
      m.addEventListener('mousedown', e => { if (e.target === m) m.hidden = true; });
    });
    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const open = U.$$('.modal').filter(m => !m.hidden);
      if (open.length) { open[open.length - 1].hidden = true; e.stopPropagation(); }
    });
  }

  /* ══════════════ ショートカット ══════════════ */
  function bindShortcuts() {
    window.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); exportProject(); }
      else if (mod && e.key === 'Enter') { e.preventDefault(); generateCode(); }
    });
    window.addEventListener('beforeunload', e => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ══════════════ 自動保存 ══════════════ */
  let dirty = false;
  function markDirty() {
    dirty = true;
    const s = U.$('#saveState');
    s.textContent = '未保存の変更';
    s.classList.add('dirty');
  }
  function markSaved() {
    dirty = false;
    const s = U.$('#saveState');
    s.textContent = '自動保存済み ' + new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    s.classList.remove('dirty');
  }

  const scheduleAutosave = U.debounce(() => {
    const data = FLOW.serialize();
    U.idbSet(AUTOSAVE_KEY, data)
      .then(markSaved)
      .catch(err => {
        console.warn('自動保存に失敗:', err);
        const s = U.$('#saveState');
        s.textContent = '自動保存できません（エクスポートしてください）';
        s.classList.add('dirty');
      });
  }, 700);

  function restore() {
    U.idbGet(AUTOSAVE_KEY).then(data => {
      if (data && data.nodes && data.nodes.length) {
        FLOW.load(data);
        U.$('#projectName').value = data.name || 'フロー';
        markSaved();
        U.toast('前回の続きを読み込みました', 'ok');
        return;
      }
      firstRun();
    }).catch(() => firstRun());
  }

  function firstRun() {
    // 初回は「ログイン不要ですぐ動く」サンプルを開いて、雰囲気をつかんでもらう
    if (!U.lsGet(LS_FIRST, false) && SAMPLES && SAMPLES.length) {
      U.lsSet(LS_FIRST, true);
      loadSample(SAMPLES.find(s => s.key === 'list-to-excel') || SAMPLES[0], true);
      setTimeout(() => openModal('helpModal'), 700);
    } else {
      FLOW.addNode('start', 160, 160);
      markSaved();
    }
  }

  /* ══════════════ 書き出し / 読み込み ══════════════ */
  function exportProject() {
    const data = FLOW.serialize();
    const json = JSON.stringify(data, null, 2);
    const name = (data.name || 'flow').replace(/[\\/:*?"<>|]/g, '_');
    U.downloadFile(name + '.json', json, 'application/json;charset=utf-8');
    markSaved();
    U.toast('エクスポートしました（' + U.formatBytes(new Blob([json]).size) + '）', 'ok');
  }

  function importProject(file) {
    U.readFileAsText(file).then(text => {
      let data;
      try { data = JSON.parse(text); }
      catch (err) { U.toast('JSONとして読み込めませんでした', 'err'); return; }

      if (!data || !Array.isArray(data.nodes)) {
        U.toast('このファイルは Web Auto Move のフローではないようです', 'err');
        return;
      }
      if (FLOW.graph.nodes.length &&
          !confirm('現在のフローを置き換えます。よろしいですか？')) return;

      FLOW.load(data);
      FLOW.graph.name = data.name || file.name.replace(/\.json$/i, '');
      U.$('#projectName').value = FLOW.graph.name;
      markDirty();
      scheduleAutosave();
      U.toast('インポートしました（ノード ' + data.nodes.length + ' 個）', 'ok');
    }).catch(() => U.toast('ファイルを読み込めませんでした', 'err'));
  }

  /* ══════════════ サンプル ══════════════ */
  function buildSamplesGrid() {
    const grid = U.$('#sampleGrid');
    grid.textContent = '';
    (SAMPLES || []).forEach(s => {
      grid.appendChild(U.el('div', {
        class: 'sample-card', onclick: () => loadSample(s)
      }, [
        U.el('div', { class: 'sm-ico', text: s.icon }),
        U.el('b', { text: s.title }),
        U.el('p', { text: s.desc }),
        U.el('div', { class: 'sm-meta', text: s.meta || '' })
      ]));
    });
  }

  function loadSample(sample, silent) {
    if (!silent && FLOW.graph.nodes.length &&
        !confirm('現在のフローを置き換えます。よろしいですか？')) return;
    FLOW.load(U.deepClone(sample.graph));
    U.$('#projectName').value = FLOW.graph.name;
    closeModal('samplesModal');
    markDirty();
    scheduleAutosave();
    if (!silent) U.toast('サンプルを読み込みました', 'ok');
    else U.toast('サンプルを開きました。自由に書き換えてください', 'ok', 4000);
  }

  /* ══════════════ コード生成 ══════════════ */
  function generateCode() {
    let result;
    try {
      result = CODEGEN.generate(FLOW.graph);
    } catch (err) {
      console.error(err);
      U.toast('コード生成でエラーが起きました: ' + err.message, 'err', 5000);
      return;
    }

    // フロー全体の検証結果もマージする
    const graphIssues = FLOW.validateGraph();
    const seen = new Set();
    const issues = [];
    graphIssues.concat(result.issues || []).forEach(i => {
      const key = (i.nodeId || '') + '|' + i.msg;
      if (seen.has(key)) return;
      seen.add(key);
      issues.push(i);
    });

    lastGenerated = { files: result.files, issues: issues, stats: result.stats };
    renderIssues(issues);

    const errCount = issues.filter(i => i.level === 'err').length;
    const badge = U.$('#issueBadge');
    badge.hidden = false;
    badge.textContent = issues.length;
    badge.classList.toggle('zero', issues.length === 0);

    openModal('codeModal');
    showFile(errCount ? '__issues__' : 'scraper.py');

    if (errCount) {
      U.toast(errCount + ' 件の要修正があります。チェック結果を確認してください', 'warn', 4200);
    } else {
      U.toast('コードを生成しました（約' + (result.stats.lines || 0) + '行）', 'ok');
    }
  }

  function showFile(name) {
    if (!lastGenerated) return;
    activeFile = name;
    U.$$('.code-tab').forEach(t => t.classList.toggle('active', t.dataset.file === name));
    const pre = U.$('#codeOut');
    const issuesBox = U.$('#issuesOut');

    if (name === '__issues__') {
      pre.hidden = true;
      issuesBox.hidden = false;
      return;
    }
    pre.hidden = false;
    issuesBox.hidden = true;
    const src = lastGenerated.files[name] || '';
    U.$('#codeCode').innerHTML = name.endsWith('.py')
      ? U.highlightPython(src) : U.escapeHtml(src);
    U.$('.code-view').scrollTop = 0;
  }

  function renderIssues(issues) {
    const box = U.$('#issuesOut');
    box.textContent = '';
    if (!issues.length) {
      box.appendChild(U.el('div', { class: 'issues-ok' }, [
        U.el('div', { class: 'io-icon', text: '✅' }),
        U.el('h3', { text: '問題は見つかりませんでした' }),
        U.el('p', { text: 'このままコードをコピーして実行できます。', style: { color: 'var(--fg-muted)' } })
      ]));
      return;
    }
    const order = { err: 0, warn: 1, info: 2 };
    issues.slice().sort((a, b) => (order[a.level] || 9) - (order[b.level] || 9)).forEach(i => {
      const row = U.el('div', { class: 'issue ' + (i.level === 'err' ? 'err' : i.level === 'warn' ? 'warn' : 'info') }, [
        U.el('span', { class: 'issue-ico', text: i.level === 'err' ? '⛔' : i.level === 'warn' ? '⚠️' : 'ℹ️' }),
        U.el('div', { class: 'issue-body' }, [
          U.el('b', { text: i.title || '（フロー全体）' }),
          U.el('span', { text: i.msg }),
          i.nodeId ? U.el('button', {
            class: 'jump', text: 'このノードを開く →',
            onclick: () => {
              closeModal('codeModal');
              FLOW.select(i.nodeId);
              FLOW.centerOn(i.nodeId);
            }
          }) : null
        ])
      ]);
      box.appendChild(row);
    });
  }

  function copyCode() {
    if (!lastGenerated) return;
    if (activeFile === '__issues__') { U.toast('コードのタブを選んでください', 'warn'); return; }
    const src = lastGenerated.files[activeFile] || '';
    const done = () => U.toast(activeFile + ' をコピーしました', 'ok');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(src).then(done).catch(() => fallbackCopy(src, done));
    } else fallbackCopy(src, done);
  }

  function fallbackCopy(text, done) {
    const ta = U.el('textarea', { style: { position: 'fixed', left: '-9999px' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { U.toast('コピーできませんでした。手動で選択してください', 'err'); }
    ta.remove();
  }

  function downloadActiveFile() {
    if (!lastGenerated) return;
    const name = activeFile === '__issues__' ? 'scraper.py' : activeFile;
    U.downloadFile(name, lastGenerated.files[name] || '', 'text/plain;charset=utf-8');
  }

  function downloadAll() {
    if (!lastGenerated) return;
    const files = Object.assign({}, lastGenerated.files);
    // フロー定義そのものも同梱しておくと、後から編集を再開できる
    files['flow.json'] = JSON.stringify(FLOW.serialize(), null, 2);
    const blob = makeZip(files);
    const name = (FLOW.graph.name || 'scraper').replace(/[\\/:*?"<>|]/g, '_');
    U.downloadFile(name + '.zip', blob, 'application/zip');
    U.toast('一式をZIPでダウンロードしました', 'ok');
  }

  /* ══════════════ 最小限の ZIP 生成（無圧縮 / 外部ライブラリなし） ══════════════ */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function makeZip(files) {
    const enc = new TextEncoder();
    const entries = [];
    const chunks = [];
    let offset = 0;

    const dosTime = (() => {
      const d = new Date();
      const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
      const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
      return { time, date };
    })();

    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }

    Object.keys(files).forEach(name => {
      const nameBytes = enc.encode(name);
      const data = enc.encode(String(files[name]));
      const crc = crc32(data);

      const local = new Uint8Array([].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0),      // 0x0800 = UTF-8 フラグ
        u16(dosTime.time), u16(dosTime.date),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0)
      ));
      chunks.push(local, nameBytes, data);
      entries.push({ name: nameBytes, crc, size: data.length, offset });
      offset += local.length + nameBytes.length + data.length;
    });

    const centralStart = offset;
    entries.forEach(en => {
      const central = new Uint8Array([].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
        u16(dosTime.time), u16(dosTime.date),
        u32(en.crc), u32(en.size), u32(en.size),
        u16(en.name.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(en.offset)
      ));
      chunks.push(central, en.name);
      offset += central.length + en.name.length;
    });

    const end = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0),
      u16(entries.length), u16(entries.length),
      u32(offset - centralStart), u32(centralStart), u16(0)
    ));
    chunks.push(end);

    return new Blob(chunks, { type: 'application/zip' });
  }

  /* ══════════════ 起動 ══════════════ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.APP = { generateCode, exportProject, loadSample, makeZip };
})(window);
