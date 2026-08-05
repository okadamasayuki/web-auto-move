/* ══════════════════════════════════════════════════════════
   flow.js — ノードと矢印のキャンバス（Dify風オーケストレータ）
   ══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const U = global.U;
  const NODES = global.NODES;
  const ANNO = global.ANNO;

  const NODE_W = 232;
  const GRID = 20;

  /* ---------- 状態 ---------- */
  const F = {
    graph: { version: 2, name: '新しいフロー', nodes: [], edges: [], view: { x: 60, y: 60, scale: 1 } },
    selected: null,          // ノードID
    selectedEdge: null,      // エッジID
    listeners: { change: [], select: [] }
  };

  let dom = null;
  const portCache = new Map();   // nodeId -> {in:{dx,dy}, out:{portId:{dx,dy}}}
  const nodeEls = new Map();

  /* ---------- イベント ---------- */
  function on(ev, cb) { (F.listeners[ev] || (F.listeners[ev] = [])).push(cb); }
  function emit(ev, arg) { (F.listeners[ev] || []).forEach(cb => cb(arg)); }
  const emitChange = () => emit('change', F.graph);

  /* ══════════════ 初期化 ══════════════ */
  function init() {
    dom = {
      viewport: U.$('#viewport'),
      world: U.$('#world'),
      nodeLayer: U.$('#nodeLayer'),
      edgeGroup: U.$('#edgeGroup'),
      ghost: U.$('#ghostEdge'),
      empty: U.$('#canvasEmpty'),
      zoomLabel: U.$('#zoomLabel'),
      minimap: U.$('#minimap'),
      minimapCanvas: U.$('#minimapCanvas'),
      minimapView: U.$('#minimapView'),
      ctx: U.$('#ctxMenu')
    };
    bindViewport();
    bindKeys();
    applyView();
  }

  /* ══════════════ 画面変換 ══════════════ */
  function applyView() {
    const v = F.graph.view;
    dom.world.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.scale + ')';
    if (dom.zoomLabel) dom.zoomLabel.textContent = Math.round(v.scale * 100) + '%';
    drawMinimap();
  }

  function screenToWorld(clientX, clientY) {
    const r = dom.viewport.getBoundingClientRect();
    const v = F.graph.view;
    return { x: (clientX - r.left - v.x) / v.scale, y: (clientY - r.top - v.y) / v.scale };
  }

  function zoomAt(factor, clientX, clientY) {
    const v = F.graph.view;
    const old = v.scale;
    const next = U.clamp(old * factor, 0.25, 2.2);
    if (Math.abs(next - old) < 1e-6) return;
    const r = dom.viewport.getBoundingClientRect();
    const cx = (clientX === undefined ? r.width / 2 + r.left : clientX) - r.left;
    const cy = (clientY === undefined ? r.height / 2 + r.top : clientY) - r.top;
    v.x = cx - (cx - v.x) * (next / old);
    v.y = cy - (cy - v.y) * (next / old);
    v.scale = next;
    applyView();
  }

  function zoom(dir) {
    zoomAt(dir > 0 ? 1.18 : 1 / 1.18);
  }

  function zoomReset() {
    F.graph.view.scale = 1;
    applyView();
  }

  function fit() {
    const ns = F.graph.nodes;
    if (!ns.length) { F.graph.view = { x: 60, y: 60, scale: 1 }; applyView(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ns.forEach(n => {
      const el = nodeEls.get(n.id);
      const h = el ? el.offsetHeight : 120;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + h);
    });
    const pad = 70;
    const r = dom.viewport.getBoundingClientRect();
    const sx = (r.width - pad * 2) / Math.max(1, maxX - minX);
    const sy = (r.height - pad * 2) / Math.max(1, maxY - minY);
    const s = U.clamp(Math.min(sx, sy), 0.25, 1.15);
    F.graph.view.scale = s;
    F.graph.view.x = pad - minX * s + (r.width - pad * 2 - (maxX - minX) * s) / 2;
    F.graph.view.y = pad - minY * s + (r.height - pad * 2 - (maxY - minY) * s) / 2;
    applyView();
  }

  function centerOn(nodeId) {
    const n = getNode(nodeId);
    if (!n) return;
    const r = dom.viewport.getBoundingClientRect();
    const v = F.graph.view;
    v.x = r.width / 2 - (n.x + NODE_W / 2) * v.scale;
    v.y = r.height / 3 - n.y * v.scale;
    applyView();
  }

  /* ══════════════ グラフ操作 ══════════════ */
  function getNode(id) { return F.graph.nodes.find(n => n.id === id) || null; }

  function nextTitle(type) {
    const def = NODES.getType(type);
    return def ? def.label : type;
  }

  function addNode(type, x, y, opts) {
    const def = NODES.getType(type);
    if (!def) return null;
    if (def.single && F.graph.nodes.some(n => n.type === type)) {
      U.toast('「' + def.label + '」ノードは1つだけです', 'warn');
      return null;
    }
    const node = {
      id: U.uid('n'),
      type: type,
      title: (opts && opts.title) || nextTitle(type),
      x: Math.round((x === undefined ? 120 : x) / GRID) * GRID,
      y: Math.round((y === undefined ? 120 : y) / GRID) * GRID,
      data: (opts && opts.data) ? NODES.migrateData(type, opts.data) : NODES.defaultData(type)
    };
    F.graph.nodes.push(node);
    render();
    select(node.id);
    emitChange();
    return node;
  }

  function deleteNode(id) {
    const i = F.graph.nodes.findIndex(n => n.id === id);
    if (i < 0) return;
    // 消すノードの前後をつなぎ直す（線形につながっている場合のみ）
    const incoming = F.graph.edges.filter(e => e.to === id);
    const outgoing = F.graph.edges.filter(e => e.from === id);
    F.graph.nodes.splice(i, 1);
    F.graph.edges = F.graph.edges.filter(e => e.from !== id && e.to !== id);
    if (incoming.length === 1 && outgoing.length === 1) {
      const a = incoming[0], b = outgoing[0];
      if (!F.graph.edges.some(e => e.from === a.from && e.port === a.port)) {
        F.graph.edges.push({ id: U.uid('e'), from: a.from, port: a.port, to: b.to });
      }
    }
    if (F.selected === id) select(null);
    render();
    emitChange();
  }

  function duplicateNode(id) {
    const n = getNode(id);
    if (!n) return;
    const def = NODES.getType(n.type);
    if (def && def.single) { U.toast('このノードは複製できません', 'warn'); return; }
    const copy = {
      id: U.uid('n'), type: n.type, title: n.title,
      x: n.x + 40, y: n.y + 40, data: U.deepClone(n.data)
    };
    F.graph.nodes.push(copy);
    render();
    select(copy.id);
    emitChange();
  }

  function updateNode(id, patch) {
    const n = getNode(id);
    if (!n) return;
    Object.assign(n, patch);
    renderNode(n);
    scheduleEdgeRedraw();
    emitChange();
  }

  /* --- エッジ --- */
  function canConnect(fromId, port, toId) {
    if (fromId === toId) return { ok: false, msg: '自分自身にはつなげません' };
    const target = getNode(toId);
    if (target && NODES.getType(target.type) && NODES.getType(target.type).noInput) {
      return { ok: false, msg: '「開始」ノードには線を入れられません' };
    }
    // 循環を防ぐ（toId から fromId へたどり着けるならループになる）
    if (reaches(toId, fromId)) {
      return { ok: false, msg: 'ぐるぐる回る形にはできません。繰り返しは「繰り返し」ノードを使ってください' };
    }
    return { ok: true };
  }

  function reaches(fromId, targetId) {
    const seen = new Set();
    const stack = [fromId];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === targetId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      F.graph.edges.forEach(e => { if (e.from === cur) stack.push(e.to); });
    }
    return false;
  }

  function connect(fromId, port, toId) {
    const chk = canConnect(fromId, port, toId);
    if (!chk.ok) { U.toast(chk.msg, 'warn'); return false; }
    // 同じ出口からは1本だけ（差し替え）
    F.graph.edges = F.graph.edges.filter(e => !(e.from === fromId && e.port === port));
    F.graph.edges.push({ id: U.uid('e'), from: fromId, port: port, to: toId });
    drawEdges();
    emitChange();
    return true;
  }

  function deleteEdge(id) {
    F.graph.edges = F.graph.edges.filter(e => e.id !== id);
    if (F.selectedEdge === id) F.selectedEdge = null;
    drawEdges();
    emitChange();
  }

  /* --- 選択 --- */
  function select(id) {
    F.selected = id;
    F.selectedEdge = null;
    nodeEls.forEach((el, nid) => el.classList.toggle('selected', nid === id));
    U.$$('.edge-g', dom.edgeGroup).forEach(g => g.classList.remove('sel'));
    emit('select', id ? getNode(id) : null);
  }

  function selectEdge(id) {
    F.selectedEdge = id;
    F.selected = null;
    nodeEls.forEach(el => el.classList.remove('selected'));
    U.$$('.edge-g', dom.edgeGroup).forEach(g => g.classList.toggle('sel', g.dataset.id === id));
    emit('select', null);
  }

  /* ══════════════ 描画 ══════════════ */
  function render() {
    // 不要になったノード要素を削除
    const ids = new Set(F.graph.nodes.map(n => n.id));
    nodeEls.forEach((el, id) => {
      if (!ids.has(id)) { el.remove(); nodeEls.delete(id); portCache.delete(id); }
    });
    F.graph.nodes.forEach(renderNode);
    if (dom.empty) dom.empty.hidden = F.graph.nodes.length > 0;
    scheduleEdgeRedraw();
  }

  function orderIndex(node) {
    return F.graph.nodes.indexOf(node) + 1;
  }

  function renderNode(node) {
    const def = NODES.getType(node.type);
    if (!def) return;
    let el = nodeEls.get(node.id);
    if (!el) {
      el = U.el('div', { class: 'node', 'data-id': node.id });
      dom.nodeLayer.appendChild(el);
      nodeEls.set(node.id, el);
      bindNode(el, node.id);
    }
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    el.classList.toggle('selected', F.selected === node.id);

    const outs = NODES.outputsOf(node.type);
    el.classList.toggle('multi-out', outs.length > 1);

    const chips = def.chips ? def.chips(node.data) : [];
    const summary = def.summary ? def.summary(node.data) : '';

    const issues = validateNode(node);
    el.classList.toggle('has-error', issues.some(i => i.level === 'err'));

    let html = '';
    if (!def.noInput) html += '<div class="port port-in" data-role="in" title="ここに矢印を受ける"></div>';
    html += '<div class="node-head" style="--nc:' + (def.color || '#e2e8f0') + '">' +
      '<span class="node-ico">' + def.icon + '</span>' +
      '<span class="node-title">' + U.escapeHtml(node.title || def.label) + '</span>' +
      '<span class="node-num">' + orderIndex(node) + '</span>' +
      '</div>';
    html += '<div class="node-body">';
    html += '<div class="node-summary">' + (summary || '<i>未設定</i>') + '</div>';
    if (chips.length) {
      html += '<div class="node-chips">' + chips.map(c =>
        '<span class="node-chip ' + (c.cls || '') + '">' + U.escapeHtml(c.text) + '</span>').join('') + '</div>';
    }
    html += '<div class="node-thumb-slot"></div>';
    html += '</div>';

    if (outs.length > 1) {
      html += '<div class="out-rail">';
      outs.forEach(o => {
        html += '<div class="out-row ' + (o.cls || '') + '">' +
          '<span>' + U.escapeHtml(o.label) + '</span>' +
          '<div class="port port-out" data-role="out" data-port="' + o.id + '"></div>' +
          '</div>';
      });
      html += '</div>';
    } else if (outs.length === 1) {
      html += '<div class="port port-out" data-role="out" data-port="' + outs[0].id +
        '" style="top:50%;transform:translateY(-50%)" title="ここから次のノードへ線を引く"></div>';
    }

    el.innerHTML = html;

    // スクショのサムネイル（非同期）
    const shot = firstShot(node.data);
    const slot = U.$('.node-thumb-slot', el);
    if (shot && slot) {
      ANNO.renderThumb(shot, 220).then(url => {
        if (!url || !slot.isConnected) return;
        slot.outerHTML = '<div class="node-thumb"><img src="' + url + '" alt=""></div>';
        cachePorts(node.id);
        scheduleEdgeRedraw();
      });
    }
    cachePorts(node.id);
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

  /* ポート位置をノード内ローカル座標でキャッシュ */
  function cachePorts(nodeId) {
    const el = nodeEls.get(nodeId);
    if (!el) return;
    const scale = F.graph.view.scale || 1;
    const nr = el.getBoundingClientRect();
    const rec = { in: null, out: {} };
    U.$$('.port', el).forEach(p => {
      const pr = p.getBoundingClientRect();
      const dx = (pr.left + pr.width / 2 - nr.left) / scale;
      const dy = (pr.top + pr.height / 2 - nr.top) / scale;
      if (p.dataset.role === 'in') rec.in = { dx, dy };
      else rec.out[p.dataset.port] = { dx, dy };
    });
    portCache.set(nodeId, rec);
  }

  function portPos(nodeId, kind, portId) {
    const n = getNode(nodeId);
    if (!n) return null;
    let rec = portCache.get(nodeId);
    if (!rec) { cachePorts(nodeId); rec = portCache.get(nodeId); }
    if (!rec) return null;
    if (kind === 'in') {
      return rec.in ? { x: n.x + rec.in.dx, y: n.y + rec.in.dy } : { x: n.x, y: n.y + 24 };
    }
    const o = rec.out[portId] || rec.out[Object.keys(rec.out)[0]];
    return o ? { x: n.x + o.dx, y: n.y + o.dy } : { x: n.x + NODE_W, y: n.y + 40 };
  }

  /* --- エッジ描画 --- */
  let edgeRaf = null;
  function scheduleEdgeRedraw() {
    if (edgeRaf) return;
    edgeRaf = requestAnimationFrame(() => { edgeRaf = null; drawEdges(); });
  }

  function bezier(a, b) {
    const dx = Math.max(46, Math.abs(b.x - a.x) * 0.55);
    return 'M ' + a.x + ' ' + a.y +
      ' C ' + (a.x + dx) + ' ' + a.y + ', ' + (b.x - dx) + ' ' + b.y + ', ' + b.x + ' ' + b.y;
  }

  const PORT_CLASS = { body: 'branch-body', done: 'branch-done', true: 'branch-true', false: 'branch-false' };
  const PORT_LABEL = { body: 'くり返す', done: '終わったら', true: 'はい', false: 'いいえ' };

  function drawEdges() {
    const g = dom.edgeGroup;
    g.textContent = '';
    F.graph.edges.forEach(e => {
      const a = portPos(e.from, 'out', e.port);
      const b = portPos(e.to, 'in');
      if (!a || !b) return;
      const d = bezier(a, b);
      const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      grp.setAttribute('class', 'edge-g' + (F.selectedEdge === e.id ? ' sel' : ''));
      grp.dataset.id = e.id;

      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hit.setAttribute('class', 'edge-hit');
      hit.setAttribute('d', d);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'edge ' + (PORT_CLASS[e.port] || ''));
      path.setAttribute('d', d);
      grp.appendChild(hit);
      grp.appendChild(path);

      if (PORT_LABEL[e.port]) {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('class', 'edge-label');
        t.setAttribute('x', (a.x + b.x) / 2);
        t.setAttribute('y', (a.y + b.y) / 2 - 5);
        t.setAttribute('text-anchor', 'middle');
        t.textContent = PORT_LABEL[e.port];
        grp.appendChild(t);
      }

      hit.addEventListener('click', ev => { ev.stopPropagation(); selectEdge(e.id); });
      hit.addEventListener('dblclick', ev => { ev.stopPropagation(); deleteEdge(e.id); U.toast('矢印を削除しました'); });
      hit.addEventListener('contextmenu', ev => {
        ev.preventDefault(); ev.stopPropagation();
        showCtxMenu(ev.clientX, ev.clientY, [
          { icon: '✂️', label: 'この矢印を削除', danger: true, run: () => deleteEdge(e.id) }
        ]);
      });
      g.appendChild(grp);
    });
    drawMinimap();
  }

  /* ══════════════ ノードの操作（ドラッグ・接続） ══════════════ */
  function bindNode(el, nodeId) {
    el.addEventListener('pointerdown', ev => {
      const port = ev.target.closest('.port');
      if (port) {
        if (port.dataset.role === 'out') startLink(ev, nodeId, port.dataset.port);
        return;
      }
      startDrag(ev, nodeId);
    });
    el.addEventListener('click', ev => { ev.stopPropagation(); select(nodeId); });
    el.addEventListener('dblclick', ev => {
      ev.stopPropagation();
      select(nodeId);
      const inspEl = U.$('.insp-titles input');
      if (inspEl) { inspEl.focus(); inspEl.select(); }
    });
    el.addEventListener('contextmenu', ev => {
      ev.preventDefault(); ev.stopPropagation();
      select(nodeId);
      const n = getNode(nodeId);
      const def = n && NODES.getType(n.type);
      showCtxMenu(ev.clientX, ev.clientY, [
        { icon: '📋', label: '複製 (Ctrl+D)', run: () => duplicateNode(nodeId), disabled: !!(def && def.single) },
        { icon: '🔗', label: 'つながっている矢印を外す', run: () => {
            F.graph.edges = F.graph.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
            drawEdges(); emitChange();
          } },
        { sep: true },
        { icon: '🗑', label: '削除 (Delete)', danger: true, run: () => deleteNode(nodeId) }
      ]);
    });
  }

  function startDrag(ev, nodeId) {
    if (ev.button !== 0) return;
    const node = getNode(nodeId);
    if (!node) return;
    const el = nodeEls.get(nodeId);
    ev.stopPropagation();
    select(nodeId);
    el.classList.add('dragging');
    el.setPointerCapture(ev.pointerId);

    const start = screenToWorld(ev.clientX, ev.clientY);
    const ox = node.x, oy = node.y;
    let moved = false;

    function move(e) {
      const p = screenToWorld(e.clientX, e.clientY);
      let nx = ox + (p.x - start.x);
      let ny = oy + (p.y - start.y);
      if (!e.altKey) { nx = Math.round(nx / GRID) * GRID; ny = Math.round(ny / GRID) * GRID; }
      if (nx !== node.x || ny !== node.y) moved = true;
      node.x = nx; node.y = ny;
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
      scheduleEdgeRedraw();
    }
    function up() {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (moved) emitChange();
    }
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function startLink(ev, fromId, portId) {
    ev.stopPropagation();
    ev.preventDefault();
    const a = portPos(fromId, 'out', portId);
    dom.ghost.setAttribute('d', bezier(a, a));
    dom.viewport.setPointerCapture(ev.pointerId);

    let hoverNode = null;

    function move(e) {
      const p = screenToWorld(e.clientX, e.clientY);
      dom.ghost.setAttribute('d', bezier(a, p));
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const nEl = el && el.closest ? el.closest('.node') : null;
      const id = nEl ? nEl.dataset.id : null;
      if (id !== hoverNode) {
        if (hoverNode && nodeEls.get(hoverNode)) nodeEls.get(hoverNode).classList.remove('link-target');
        hoverNode = id && id !== fromId ? id : null;
        if (hoverNode && nodeEls.get(hoverNode)) nodeEls.get(hoverNode).classList.add('link-target');
      }
    }

    function up(e) {
      dom.viewport.removeEventListener('pointermove', move);
      dom.viewport.removeEventListener('pointerup', up);
      dom.ghost.setAttribute('d', '');
      if (hoverNode && nodeEls.get(hoverNode)) nodeEls.get(hoverNode).classList.remove('link-target');

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const nEl = el && el.closest ? el.closest('.node') : null;
      if (nEl && nEl.dataset.id !== fromId) {
        connect(fromId, portId, nEl.dataset.id);
      } else if (!nEl) {
        // 何もない所で離したら、その場に新しいノードを作るメニューを出す
        const p = screenToWorld(e.clientX, e.clientY);
        showAddMenu(e.clientX, e.clientY, type => {
          const n = addNode(type, p.x, p.y - 30);
          if (n) connect(fromId, portId, n.id);
        });
      }
      hoverNode = null;
    }

    dom.viewport.addEventListener('pointermove', move);
    dom.viewport.addEventListener('pointerup', up);
  }

  /* ══════════════ ビューポート操作 ══════════════ */
  function bindViewport() {
    const vp = dom.viewport;

    vp.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || !e.shiftKey) {
        zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
      } else {
        F.graph.view.x -= e.deltaX;
        F.graph.view.y -= e.deltaY;
        applyView();
      }
    }, { passive: false });

    let spaceDown = false;
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        spaceDown = true; vp.classList.add('space-ready'); e.preventDefault();
      }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'Space') { spaceDown = false; vp.classList.remove('space-ready'); }
    });

    vp.addEventListener('pointerdown', e => {
      const onNode = e.target.closest && e.target.closest('.node');
      const onEdge = e.target.closest && e.target.closest('.edge-g');
      if (onNode || onEdge) return;
      if (e.button === 1 || spaceDown || e.button === 0) {
        if (e.button === 0 && !spaceDown) { select(null); F.selectedEdge = null; drawEdges(); }
        if (e.button === 1 || spaceDown) e.preventDefault();
        startPan(e);
      }
    });

    vp.addEventListener('contextmenu', e => {
      if (e.target.closest('.node') || e.target.closest('.edge-g')) return;
      e.preventDefault();
      const p = screenToWorld(e.clientX, e.clientY);
      showAddMenu(e.clientX, e.clientY, type => addNode(type, p.x, p.y));
    });

    /* パレットからのドラッグ＆ドロップ */
    vp.addEventListener('dragover', e => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).indexOf('text/node-type') >= 0) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        vp.classList.add('drop-target');
      }
    });
    vp.addEventListener('dragleave', e => {
      if (e.target === vp) vp.classList.remove('drop-target');
    });
    vp.addEventListener('drop', e => {
      vp.classList.remove('drop-target');
      const type = e.dataTransfer && e.dataTransfer.getData('text/node-type');
      if (!type) return;
      e.preventDefault();
      const p = screenToWorld(e.clientX, e.clientY);
      addNode(type, p.x - NODE_W / 2, p.y - 30);
    });
  }

  function startPan(ev) {
    const vp = dom.viewport;
    const v = F.graph.view;
    const sx = ev.clientX, sy = ev.clientY;
    const ox = v.x, oy = v.y;
    let moved = false;
    vp.classList.add('panning');
    function move(e) {
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 3) moved = true;
      v.x = ox + (e.clientX - sx);
      v.y = oy + (e.clientY - sy);
      applyView();
    }
    function up() {
      vp.classList.remove('panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) emitChange();
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ══════════════ キーボード ══════════════ */
  function isTyping(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' || t.isContentEditable);
  }

  function bindKeys() {
    window.addEventListener('keydown', e => {
      if (isTyping(e.target)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (F.selectedEdge) { deleteEdge(F.selectedEdge); e.preventDefault(); }
        else if (F.selected) { deleteNode(F.selected); e.preventDefault(); }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (F.selected) { duplicateNode(F.selected); e.preventDefault(); }
      } else if (e.key === 'Escape') {
        select(null); F.selectedEdge = null; drawEdges(); hideCtxMenu();
      }
    });
  }

  /* ══════════════ コンテキストメニュー ══════════════ */
  function showCtxMenu(x, y, items) {
    const m = dom.ctx;
    m.textContent = '';
    items.forEach(it => {
      if (it.sep) { m.appendChild(U.el('div', { class: 'ctx-sep' })); return; }
      const b = U.el('button', {
        class: 'ctx-item' + (it.danger ? ' danger' : ''),
        onclick: () => { hideCtxMenu(); if (!it.disabled) it.run(); }
      }, [U.el('span', { text: it.icon || '' }), U.el('span', { text: it.label })]);
      if (it.disabled) b.style.opacity = .4;
      m.appendChild(b);
    });
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', hideCtxMenuOnce, { once: true }), 0);
  }
  function hideCtxMenuOnce() { hideCtxMenu(); }
  function hideCtxMenu() { if (dom.ctx) dom.ctx.hidden = true; }

  function showAddMenu(x, y, cb) {
    const items = [];
    NODES.CATEGORIES.forEach(cat => {
      const types = Object.keys(NODES.TYPES).filter(t => NODES.TYPES[t].category === cat);
      if (!types.length) return;
      if (items.length) items.push({ sep: true });
      types.forEach(t => {
        const def = NODES.TYPES[t];
        if (def.single && F.graph.nodes.some(n => n.type === t)) return;
        items.push({ icon: def.icon, label: def.label, run: () => cb(t) });
      });
    });
    showCtxMenu(x, y, items);
  }

  /* ══════════════ 自動整列 ══════════════ */
  function autoLayout() {
    const nodes = F.graph.nodes;
    if (!nodes.length) return;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const indeg = new Map(nodes.map(n => [n.id, 0]));
    F.graph.edges.forEach(e => {
      if (indeg.has(e.to)) indeg.set(e.to, indeg.get(e.to) + 1);
    });

    // 開始ノード（入次数0）から幅優先で階層を決める
    const level = new Map();
    const roots = nodes.filter(n => indeg.get(n.id) === 0);
    const queue = roots.length ? roots.map(n => n.id) : [nodes[0].id];
    queue.forEach(id => level.set(id, 0));
    const seen = new Set(queue);
    while (queue.length) {
      const id = queue.shift();
      const lv = level.get(id) || 0;
      F.graph.edges.filter(e => e.from === id).forEach(e => {
        const nl = lv + 1;
        if (!level.has(e.to) || level.get(e.to) < nl) level.set(e.to, nl);
        if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
      });
    }
    nodes.forEach(n => { if (!level.has(n.id)) level.set(n.id, 0); });

    // 階層ごとに縦に並べる
    const cols = new Map();
    nodes.forEach(n => {
      const lv = level.get(n.id);
      if (!cols.has(lv)) cols.set(lv, []);
      cols.get(lv).push(n);
    });

    const COL_W = 330, ROW_H = 190;
    const sortedLv = Array.from(cols.keys()).sort((a, b) => a - b);
    sortedLv.forEach(lv => {
      const list = cols.get(lv);
      // 親の位置に近い順に並べると線が交差しにくい
      list.sort((a, b) => parentY(a) - parentY(b));
      list.forEach((n, i) => {
        n.x = 80 + lv * COL_W;
        n.y = 80 + i * ROW_H;
      });
    });

    function parentY(n) {
      const inc = F.graph.edges.filter(e => e.to === n.id);
      if (!inc.length) return n.y;
      const ys = inc.map(e => { const p = byId.get(e.from); return p ? p.y : 0; });
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    }

    render();
    setTimeout(fit, 30);
    emitChange();
    U.toast('自動整列しました', 'ok');
  }

  /* ══════════════ ミニマップ ══════════════ */
  const drawMinimap = U.throttle(function () {
    if (!dom.minimapCanvas || !dom.minimap.offsetWidth) return;
    const cv = dom.minimapCanvas;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const ns = F.graph.nodes;
    if (!ns.length) { dom.minimapView.style.display = 'none'; return; }
    dom.minimapView.style.display = '';

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ns.forEach(n => {
      const el = nodeEls.get(n.id);
      const h = el ? el.offsetHeight : 120;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + h);
    });
    // 表示中の範囲も含める
    const vr = dom.viewport.getBoundingClientRect();
    const v = F.graph.view;
    const vx0 = -v.x / v.scale, vy0 = -v.y / v.scale;
    const vx1 = vx0 + vr.width / v.scale, vy1 = vy0 + vr.height / v.scale;
    minX = Math.min(minX, vx0); minY = Math.min(minY, vy0);
    maxX = Math.max(maxX, vx1); maxY = Math.max(maxY, vy1);

    const pad = 40;
    const s = Math.min(W / (maxX - minX + pad * 2), H / (maxY - minY + pad * 2));
    const ox = -(minX - pad) * s, oy = -(minY - pad) * s;

    ctx.strokeStyle = 'rgba(120,130,160,.45)';
    ctx.lineWidth = 1;
    F.graph.edges.forEach(e => {
      const a = portPos(e.from, 'out', e.port), b = portPos(e.to, 'in');
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x * s + ox, a.y * s + oy);
      ctx.lineTo(b.x * s + ox, b.y * s + oy);
      ctx.stroke();
    });
    ns.forEach(n => {
      const def = NODES.getType(n.type);
      const el = nodeEls.get(n.id);
      const h = el ? el.offsetHeight : 120;
      ctx.fillStyle = (def && def.color) || '#cbd5e1';
      ctx.fillRect(n.x * s + ox, n.y * s + oy, NODE_W * s, h * s);
      if (F.selected === n.id) {
        ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 1.5;
        ctx.strokeRect(n.x * s + ox, n.y * s + oy, NODE_W * s, h * s);
      }
    });

    dom.minimapView.style.left = (vx0 * s + ox) + 'px';
    dom.minimapView.style.top = (vy0 * s + oy) + 'px';
    dom.minimapView.style.width = ((vx1 - vx0) * s) + 'px';
    dom.minimapView.style.height = ((vy1 - vy0) * s) + 'px';
  }, 60);

  /* ══════════════ 検証 ══════════════ */
  function validateNode(node) {
    const def = NODES.getType(node.type);
    if (!def || !def.validate) return [];
    try { return def.validate(node.data, node, F.graph) || []; }
    catch (e) { return []; }
  }

  /** フロー全体をチェックして問題点を返す */
  function validateGraph() {
    const issues = [];
    const g = F.graph;

    const startNodes = g.nodes.filter(n => n.type === 'start');
    if (!startNodes.length) {
      issues.push({ level: 'err', title: '開始ノードがありません',
        msg: '「開始」ノードを置いて、最初に開くURLを設定してください。' });
    }

    g.nodes.forEach(n => {
      const def = NODES.getType(n.type);
      validateNode(n).forEach(i => {
        issues.push({ level: i.level, nodeId: n.id,
          title: (def ? def.icon + ' ' + (n.title || def.label) : n.type), msg: i.msg });
      });
    });

    // つながっていないノード
    if (startNodes.length) {
      const reachable = new Set();
      const stack = [startNodes[0].id];
      while (stack.length) {
        const id = stack.pop();
        if (reachable.has(id)) continue;
        reachable.add(id);
        g.edges.forEach(e => { if (e.from === id) stack.push(e.to); });
      }
      g.nodes.forEach(n => {
        if (!reachable.has(n.id)) {
          const def = NODES.getType(n.type);
          issues.push({ level: 'warn', nodeId: n.id,
            title: (def ? def.icon + ' ' + (n.title || def.label) : n.type),
            msg: '開始ノードからたどり着けません。矢印がつながっていない可能性があります（このノードはコードに出力されません）。' });
        }
      });
    }

    // 変数の使用チェック
    const provided = new Set(['index', 'page_no', 'today', 'now', 'timestamp', 'page_title',
      'page_url', 'base_dir', 'last_download', 'last_file', 'item', 'loop_count']);
    g.nodes.forEach(n => {
      const def = NODES.getType(n.type);
      if (def && def.provides) (def.provides(n.data) || []).forEach(v => provided.add(v));
      if (n.type === 'loop' && n.data.mode === 'csv') provided.add('__csv__');
    });
    const csvLoop = g.nodes.some(n => n.type === 'loop' && n.data.mode === 'csv');
    g.nodes.forEach(n => {
      const def = NODES.getType(n.type);
      if (!def) return;
      (def.fields || []).forEach(f => {
        if (!f.vars) return;
        const val = n.data[f.key];
        if (!val) return;
        U.extractVars(val).forEach(v => {
          const root = String(v).split('.')[0].trim();
          if (!provided.has(root) && !csvLoop) {
            issues.push({ level: 'warn', nodeId: n.id,
              title: def.icon + ' ' + (n.title || def.label),
              msg: '変数 {{' + v + '}} を使っていますが、どのノードでも作られていません。名前の打ち間違いがないか確認してください。' });
          }
        });
      });
    });

    return issues;
  }

  /* ══════════════ 保存・読み込み ══════════════ */
  function serialize() {
    return {
      app: 'web-auto-move',
      version: 2,
      name: F.graph.name,
      savedAt: new Date().toISOString(),
      nodes: U.deepClone(F.graph.nodes),
      edges: U.deepClone(F.graph.edges),
      view: U.deepClone(F.graph.view)
    };
  }

  function load(data, opts) {
    if (!data) return false;
    const g = {
      version: 2,
      name: data.name || '読み込んだフロー',
      nodes: (data.nodes || []).map(n => ({
        id: n.id || U.uid('n'),
        type: n.type,
        title: n.title || (NODES.getType(n.type) ? NODES.getType(n.type).label : n.type),
        x: Number(n.x) || 0,
        y: Number(n.y) || 0,
        data: NODES.migrateData(n.type, n.data || {})
      })).filter(n => NODES.getType(n.type)),
      edges: (data.edges || []).map(e => ({
        id: e.id || U.uid('e'), from: e.from, port: e.port || 'out', to: e.to
      })),
      view: data.view || { x: 60, y: 60, scale: 1 }
    };
    // 存在しないノードを指すエッジを捨てる
    const ids = new Set(g.nodes.map(n => n.id));
    g.edges = g.edges.filter(e => ids.has(e.from) && ids.has(e.to));

    F.graph = g;
    F.selected = null;
    F.selectedEdge = null;
    nodeEls.forEach(el => el.remove());
    nodeEls.clear();
    portCache.clear();
    render();
    applyView();
    if (!opts || opts.fit !== false) setTimeout(fit, 40);
    emit('select', null);
    return true;
  }

  function clear() {
    load({ name: '新しいフロー', nodes: [], edges: [], view: { x: 60, y: 60, scale: 1 } }, { fit: false });
    emitChange();
  }

  global.FLOW = {
    init, get graph() { return F.graph; }, set graph(g) { F.graph = g; },
    get selected() { return F.selected; },
    on, emitChange,
    addNode, deleteNode, duplicateNode, updateNode, getNode,
    connect, deleteEdge, select, selectEdge, centerOn,
    render, renderNode, drawEdges: scheduleEdgeRedraw,
    zoom, zoomReset, fit, autoLayout,
    validateGraph, validateNode,
    serialize, load, clear,
    screenToWorld, showAddMenu, NODE_W
  };
})(window);
