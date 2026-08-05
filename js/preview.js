/* ══════════════════════════════════════════════════════════
   preview.js — 実行前の「紙芝居プレビュー」
   ──────────────────────────────────────────────────────────
   フローを開始ノードからたどり、実行される順番どおりに
   「どの画面（スクショ）で・何をするか」を一覧表示する。
   実際の実行時の画面は、生成コードが output/run_report.html に記録する。
   ══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const U = global.U;
  const NODES = global.NODES;
  const FLOW = global.FLOW;
  const ANNO = global.ANNO;

  let modal = null;
  let listEl = null;

  /* ---------- ヘルパー ---------- */
  function stripHtml(h) {
    const d = document.createElement('div');
    d.innerHTML = String(h || '').replace(/<br\s*\/?>/gi, ' → ');
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function firstShot(data) {
    if (!data) return null;
    for (const k in data) {
      const v = data[k];
      if (v && typeof v === 'object' && Array.isArray(v.shots) && v.shots.length) {
        const withAnno = v.shots.find(s => s.annos && s.annos.length);
        return withAnno || v.shots[0];
      }
    }
    return null;
  }

  /* ---------- フローを実行順に並べる ---------- */
  function buildSteps(graph) {
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    const outMap = new Map();
    graph.edges.forEach(e => {
      const k = e.from + ' ' + (e.port || 'out');
      if (!outMap.has(k)) outMap.set(k, e.to);
    });
    const next = (id, p) => outMap.get(id + ' ' + (p || 'out')) || null;

    const start = graph.nodes.find(n => n.type === 'start');
    const steps = [];
    if (!start) return steps;

    let no = 1;
    steps.push({ depth: 0, no: no, node: start });

    const listed = new Set();
    (function walk(id, depth) {
      while (id && !listed.has(id)) {
        listed.add(id);
        const n = byId.get(id);
        if (!n) return;
        no++;
        if (n.type === 'loop') {
          steps.push({ depth: depth, no: no, node: n, tag: '🔁 ここから繰り返し' });
          walk(next(id, 'body'), depth + 1);
          steps.push({ depth: depth, divider: '↩ 繰り返しここまで（次の1件へ戻る）' });
          id = next(id, 'done');
        } else if (n.type === 'condition') {
          steps.push({ depth: depth, no: no, node: n, tag: '🔀 分岐' });
          steps.push({ depth: depth + 1, divider: '✔ 「はい」のとき' });
          walk(next(id, 'true'), depth + 1);
          steps.push({ depth: depth + 1, divider: '✘ 「いいえ」のとき' });
          walk(next(id, 'false'), depth + 1);
          return;
        } else {
          steps.push({ depth: depth, no: no, node: n });
          id = next(id, 'out');
        }
      }
    })(next(start.id, 'out'), 0);

    return steps;
  }

  /* ---------- モーダル ---------- */
  function ensureModal() {
    if (modal) return;
    listEl = U.el('div', { class: 'pv-list' });
    modal = U.el('div', { class: 'modal', id: 'previewModal' }, [
      U.el('div', { class: 'modal-box modal-lg' }, [
        U.el('div', { class: 'modal-head' }, [
          U.el('h3', { text: '▶ 実行プレビュー（紙芝居）' }),
          U.el('button', { class: 'btn btn-icon', html: '✕', onclick: close })
        ]),
        U.el('div', { class: 'modal-content' }, [
          U.el('p', { class: 'modal-lead',
            html: '実行される順番どおりに並べています。画像は各ノードに付けたスクショ（赤枠つき）です。<br>' +
                  '<b>実際に実行したときの本物の画面</b>は、生成コードが <code>output/run_report.html</code> に自動で記録します' +
                  '（実行中に開くと5秒ごとに更新されます）。' }),
          listEl
        ])
      ])
    ]);
    modal.hidden = true;
    modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
    document.body.appendChild(modal);
  }

  function close() { if (modal) modal.hidden = true; }

  function jumpTo(nodeId) {
    close();
    FLOW.select(nodeId);
    FLOW.centerOn(nodeId);
  }

  function open() {
    const graph = FLOW.graph;
    if (!graph.nodes.length || !graph.nodes.some(n => n.type === 'start')) {
      U.toast('まず「開始」ノードを置いてフローを作ってください', 'warn');
      return;
    }
    ensureModal();
    listEl.textContent = '';

    const steps = buildSteps(graph);
    if (steps.length <= 1) {
      listEl.appendChild(U.el('p', { class: 'modal-lead',
        text: '開始ノードの先に何もつながっていません。矢印で次のノードにつなぐと、ここに流れが表示されます。' }));
    }

    steps.forEach(s => {
      if (s.divider) {
        listEl.appendChild(U.el('div', {
          class: 'pv-divider',
          style: { marginLeft: (s.depth * 26) + 'px' },
          text: s.divider
        }));
        return;
      }

      const node = s.node;
      const def = NODES.getType(node.type);
      if (!def) return;

      const action = node.type === 'start'
        ? 'ブラウザで ' + (node.data.url || '（URL未設定）') + ' を開く'
        : stripHtml(def.summary ? def.summary(node.data) : '');

      const item = U.el('div', {
        class: 'pv-item',
        style: { marginLeft: (s.depth * 26) + 'px' },
        title: 'クリックでこのノードを開く',
        onclick: () => jumpTo(node.id)
      }, [
        U.el('div', { class: 'pv-no', text: s.no }),
        U.el('div', { class: 'pv-main' }, [
          U.el('div', { class: 'pv-title' }, [
            U.el('span', { class: 'pv-ico', style: { '--nc': def.color }, text: def.icon }),
            U.el('b', { text: node.title || def.label }),
            s.tag ? U.el('span', { class: 'pv-tag', text: s.tag }) : null
          ]),
          U.el('div', { class: 'pv-action', text: action || '（内容未設定）' })
        ])
      ]);

      const shot = firstShot(node.data);
      if (shot) {
        const img = U.el('img', { alt: '', loading: 'lazy' });
        ANNO.renderThumb(shot, 340).then(url => { if (url) img.src = url; });
        item.appendChild(U.el('div', { class: 'pv-thumb' }, [img]));
      } else if (node.type !== 'start') {
        item.appendChild(U.el('div', { class: 'pv-thumb pv-thumb-empty',
          text: 'スクショ未登録' }));
      }

      listEl.appendChild(item);
    });

    modal.hidden = false;
  }

  global.PREVIEW = { open, close };
})(window);
