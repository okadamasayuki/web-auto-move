/* ══════════════════════════════════════════════════════════
   annotator.js — スクリーンショットに赤枠 / 蛍光ペン / 矢印を描く
   ──────────────────────────────────────────────────────────
   注釈の座標は 0〜1 の相対値で保存する。
   こうすると画像を縮小しても、別の画面サイズで開いても位置がずれない。
   ══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const U = global.U;

  const state = {
    shot: null,        // {id, dataUrl, width, height, annos:[]}
    annos: [],
    tool: 'rect',
    color: '#ef4444',
    label: '',
    drawing: false,
    start: null,
    onSave: null,
    open: false
  };

  let dom = null;

  function init() {
    if (dom) return;
    dom = {
      modal: U.$('#annotatorModal'),
      stage: U.$('#annoStage'),
      drop: U.$('#annoDrop'),
      file: U.$('#annoFile'),
      wrap: U.$('#annoCanvasWrap'),
      img: U.$('#annoImg'),
      canvas: U.$('#annoCanvas'),
      label: U.$('#annoLabel'),
      hint: U.$('#annoHint'),
      undo: U.$('#annoUndo'),
      clear: U.$('#annoClear'),
      save: U.$('#annoSave')
    };

    /* --- ツール切替 --- */
    U.$$('.tool', dom.modal).forEach(b => {
      b.addEventListener('click', () => {
        U.$$('.tool', dom.modal).forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        state.tool = b.dataset.tool;
        updateHint();
      });
    });
    U.$$('.swatch', dom.modal).forEach(b => {
      b.addEventListener('click', () => {
        U.$$('.swatch', dom.modal).forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        state.color = b.dataset.color;
      });
    });

    dom.label.addEventListener('input', () => { state.label = dom.label.value; });

    /* --- 画像の読み込み --- */
    dom.drop.addEventListener('click', () => dom.file.click());
    dom.file.addEventListener('change', e => {
      if (e.target.files && e.target.files[0]) loadImageFile(e.target.files[0]);
      e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach(ev =>
      dom.drop.addEventListener(ev, e => { e.preventDefault(); dom.drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev =>
      dom.drop.addEventListener(ev, e => { e.preventDefault(); dom.drop.classList.remove('over'); }));
    dom.drop.addEventListener('drop', e => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadImageFile(f);
    });
    // ステージ全体でもドロップを受け付ける（差し替え用）
    dom.stage.addEventListener('dragover', e => e.preventDefault());
    dom.stage.addEventListener('drop', e => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && /^image\//.test(f.type)) loadImageFile(f);
    });

    /* --- クリップボードから貼り付け --- */
    document.addEventListener('paste', e => {
      if (!state.open) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          const blob = items[i].getAsFile();
          if (blob) { e.preventDefault(); loadImageFile(blob); }
          return;
        }
      }
    });

    /* --- 描画 --- */
    dom.canvas.addEventListener('pointerdown', onDown);
    dom.canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    dom.undo.addEventListener('click', () => { state.annos.pop(); redraw(); });
    dom.clear.addEventListener('click', () => {
      if (state.annos.length && !confirm('描いた印をすべて消します。よろしいですか？')) return;
      state.annos = [];
      redraw();
    });
    dom.save.addEventListener('click', save);

    window.addEventListener('resize', U.debounce(() => { if (state.open) fitCanvas(); }, 120));
  }

  function updateHint() {
    const hints = {
      rect: '押したい要素をドラッグで囲みます。目印なので、だいたいの位置で大丈夫です。',
      mark: '蛍光ペンで塗ります。範囲をドラッグしてください。',
      arrow: '指したい方向へドラッグすると矢印になります。',
      pick: 'クリックした位置にピンが立ちます。1点だけ示したいときに。'
    };
    dom.hint.textContent = state.shot ? (hints[state.tool] || '') :
      '画像を読み込むと描き込めます。押したい場所を囲んでください。';
  }

  /* ---------- 画像読み込み ---------- */
  function loadImageFile(file) {
    if (!/^image\//.test(file.type)) { U.toast('画像ファイルを選んでください', 'warn'); return; }
    dom.hint.textContent = '画像を読み込み中…';
    U.compressImage(file, 1500, 0.82).then(res => {
      state.shot = {
        id: (state.shot && state.shot.id) || U.uid('shot'),
        dataUrl: res.dataUrl,
        width: res.width,
        height: res.height,
        annos: []
      };
      state.annos = [];
      showImage();
      U.toast('画像を読み込みました（' + res.width + '×' + res.height + '）', 'ok');
    }).catch(() => U.toast('画像を読み込めませんでした', 'err'));
  }

  function showImage() {
    dom.drop.hidden = true;
    dom.wrap.hidden = false;
    dom.img.onload = () => { fitCanvas(); updateHint(); };
    dom.img.src = state.shot.dataUrl;
  }

  function fitCanvas() {
    if (!state.shot) return;
    const rect = dom.img.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, global.devicePixelRatio || 1);
    dom.canvas.width = Math.round(w * dpr);
    dom.canvas.height = Math.round(h * dpr);
    dom.canvas.style.width = w + 'px';
    dom.canvas.style.height = h + 'px';
    redraw();
  }

  /* ---------- ポインタ処理 ---------- */
  function relPos(e) {
    const r = dom.canvas.getBoundingClientRect();
    return {
      x: U.clamp((e.clientX - r.left) / r.width, 0, 1),
      y: U.clamp((e.clientY - r.top) / r.height, 0, 1)
    };
  }

  function onDown(e) {
    if (!state.shot) return;
    dom.canvas.setPointerCapture(e.pointerId);
    const p = relPos(e);

    if (state.tool === 'pick') {
      state.annos.push({ type: 'pick', x: p.x, y: p.y, w: 0, h: 0,
                         color: state.color, label: state.label });
      redraw();
      return;
    }
    state.drawing = true;
    state.start = p;
  }

  function onMove(e) {
    if (!state.drawing) return;
    const p = relPos(e);
    redraw(makeAnno(state.start, p));
  }

  function onUp(e) {
    if (!state.drawing) return;
    state.drawing = false;
    const p = relPos(e);
    const a = makeAnno(state.start, p);
    const minSize = state.tool === 'arrow' ? 0.01 : 0.004;
    if (Math.abs(a.w) > minSize || Math.abs(a.h) > minSize) state.annos.push(a);
    redraw();
  }

  function makeAnno(s, p) {
    if (state.tool === 'arrow') {
      return { type: 'arrow', x: s.x, y: s.y, w: p.x - s.x, h: p.y - s.y,
               color: state.color, label: state.label };
    }
    return {
      type: state.tool,
      x: Math.min(s.x, p.x), y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y),
      color: state.color, label: state.label
    };
  }

  /* ---------- 描画 ---------- */
  function redraw(preview) {
    if (!dom.canvas) return;
    const ctx = dom.canvas.getContext('2d');
    const W = dom.canvas.width, H = dom.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const list = state.annos.concat(preview ? [preview] : []);
    list.forEach(a => drawAnno(ctx, a, W, H));
  }

  /** 1つの注釈を描く（キャンバスサイズに合わせて相対座標を展開） */
  function drawAnno(ctx, a, W, H) {
    const x = a.x * W, y = a.y * H, w = a.w * W, h = a.h * H;
    const scale = Math.max(1, Math.min(W, H) / 600);
    const lw = Math.max(2, 3 * scale);
    ctx.save();

    if (a.type === 'mark') {
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = a.color;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = Math.max(1, lw * 0.5);
      ctx.strokeRect(x, y, w, h);
    } else if (a.type === 'rect') {
      ctx.strokeStyle = a.color;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      // 内側にうっすら色を敷いて見つけやすくする
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = a.color;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeRect(x, y, w, h);
    } else if (a.type === 'arrow') {
      const x2 = x + w, y2 = y + h;
      ctx.strokeStyle = a.color;
      ctx.fillStyle = a.color;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const ang = Math.atan2(y2 - y, x2 - x);
      const head = Math.max(9, 13 * scale);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 7), y2 - head * Math.sin(ang - Math.PI / 7));
      ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 7), y2 - head * Math.sin(ang + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
    } else if (a.type === 'pick') {
      const r = Math.max(7, 11 * scale);
      ctx.strokeStyle = a.color;
      ctx.fillStyle = a.color;
      ctx.lineWidth = lw;
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(x, y, r * 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r * 0.32, 0, Math.PI * 2); ctx.fill();
    }

    // ラベル
    if (a.label) {
      const fs = Math.max(11, 14 * scale);
      ctx.font = '700 ' + fs + 'px ' +
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif';
      const pad = fs * 0.38;
      const tw = ctx.measureText(a.label).width;
      let lx = x, ly = y - pad * 0.6;
      if (a.type === 'arrow') { lx = x + w; ly = y + h - pad; }
      if (a.type === 'pick') { lx = x + 14 * scale; ly = y - 4 * scale; }
      if (ly - fs - pad < 0) ly = y + (a.type === 'pick' ? 0 : h) + fs + pad;
      ctx.globalAlpha = 0.94;
      ctx.fillStyle = a.color;
      roundRect(ctx, lx, ly - fs - pad, tw + pad * 2, fs + pad * 1.5, pad);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.fillText(a.label, lx + pad, ly - pad * 0.25);
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- 保存 ---------- */
  function save() {
    if (!state.shot) { U.toast('先に画像を読み込んでください', 'warn'); return; }
    state.shot.annos = U.deepClone(state.annos);
    const result = U.deepClone(state.shot);
    close();
    if (state.onSave) state.onSave(result);
  }

  /* ---------- 開閉 ---------- */
  function open(shot, onSave) {
    init();
    state.onSave = onSave;
    state.open = true;
    state.shot = shot ? U.deepClone(shot) : null;
    state.annos = shot && shot.annos ? U.deepClone(shot.annos) : [];
    state.drawing = false;
    dom.label.value = '';
    state.label = '';
    dom.modal.hidden = false;

    if (state.shot && state.shot.dataUrl) {
      showImage();
    } else {
      dom.drop.hidden = false;
      dom.wrap.hidden = true;
    }
    updateHint();
  }

  function close() {
    state.open = false;
    if (dom) dom.modal.hidden = true;
  }

  /* ══════════════════════════════════════════════════════════
     注釈を焼き込んだサムネイルを作る（ノード上のプレビュー用）
     ══════════════════════════════════════════════════════════ */
  const thumbCache = new Map();

  function renderThumb(shot, maxW) {
    maxW = maxW || 220;
    if (!shot || !shot.dataUrl) return Promise.resolve('');
    const key = shot.id + '|' + maxW + '|' + (shot.annos ? shot.annos.length : 0) + '|' +
      JSON.stringify(shot.annos || []).length;
    if (thumbCache.has(key)) return Promise.resolve(thumbCache.get(key));

    return new Promise(res => {
      const img = new Image();
      img.onload = function () {
        const scale = Math.min(1, maxW / img.naturalWidth);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        (shot.annos || []).forEach(a => drawAnno(ctx, a, w, h));
        const url = cv.toDataURL('image/jpeg', 0.7);
        if (thumbCache.size > 120) thumbCache.clear();
        thumbCache.set(key, url);
        res(url);
      };
      img.onerror = () => res(shot.dataUrl);
      img.src = shot.dataUrl;
    });
  }

  /** 注釈のラベル一覧（コード内のコメントに使う） */
  function annoLabels(shot) {
    if (!shot || !shot.annos) return [];
    return shot.annos.map(a => a.label).filter(Boolean);
  }

  global.ANNO = { open, close, renderThumb, annoLabels, drawAnno };
})(window);
