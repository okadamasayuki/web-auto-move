/* ══════════════════════════════════════════════════════════
   inspector.js — 右パネル：選択中ノードの設定エディタ
   ══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const U = global.U;
  const NODES = global.NODES;
  const FLOW = global.FLOW;
  const SEL = global.SEL;
  const ANNO = global.ANNO;

  let dom = null;
  let current = null;          // 現在編集中のノード
  let lastFocusedInput = null; // 変数チップの差し込み先

  /* ══════════════ セレクタ推定モーダル ══════════════ */
  const SelModal = {
    onPick: null,
    purpose: 'click',
    lastResult: null,

    init() {
      this.el = U.$('#selectorModal');
      U.$('#btnAnalyze').addEventListener('click', () => this.run());
      U.$('#selHtml').addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') this.run();
      });
      // 貼り付け直後に自動解析
      U.$('#selHtml').addEventListener('paste', () => setTimeout(() => this.run(), 60));

      /* --- URLから取得（公開ページ用・お試し） --- */
      U.$('#btnFetchUrl').addEventListener('click', () => this.fetchUrl());
      U.$('#selUrl').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); this.fetchUrl(); }
      });

      /* --- ブックマークレット「要素コピーくん」 --- */
      const bm = U.$('#bmLink');
      if (bm) {
        bm.setAttribute('href', this.bookmarkletCode());
        bm.addEventListener('click', e => {
          e.preventDefault();
          U.toast('クリックではなく、このボタンをブックマークバーへドラッグして登録してください', 'info', 4000);
        });
      }
    },

    /** 対象サイト上で押した要素の outerHTML をコピーするブックマークレット */
    bookmarkletCode() {
      const src = "(()=>{if(window.__wamPick)return;window.__wamPick=1;" +
        "var o=document.createElement('div');" +
        "o.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #ef4444;background:rgba(239,68,68,.12);border-radius:4px;left:0;top:0;width:0;height:0';" +
        "document.documentElement.appendChild(o);" +
        "var mv=function(e){var r=e.target.getBoundingClientRect();o.style.left=r.left+'px';o.style.top=r.top+'px';o.style.width=r.width+'px';o.style.height=r.height+'px'};" +
        "var end=function(){document.removeEventListener('mousemove',mv,true);document.removeEventListener('click',cl,true);document.removeEventListener('keydown',kd,true);o.remove();delete window.__wamPick};" +
        "var kd=function(e){if(e.key==='Escape')end()};" +
        "var cl=function(e){e.preventDefault();e.stopPropagation();var h=e.target.outerHTML;" +
        "var done=function(){end();alert('コピーしました。Web Auto Move の\\u300cHTMLを貼り付け\\u300d欄に Ctrl+V してください。')};" +
        "if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(h).then(done,function(){end();prompt('自動コピーできなかったので、全選択してコピーしてください',h)})}" +
        "else{end();prompt('全選択してコピーしてください',h)}};" +
        "document.addEventListener('mousemove',mv,true);document.addEventListener('click',cl,true);document.addEventListener('keydown',kd,true);" +
        "alert('コピーしたい要素をクリックしてください（Escで中止）')})()";
      return 'javascript:' + encodeURIComponent(src);
    },

    /** 公開CORS中継サービス経由でURLのHTMLを取ってみる（失敗も普通にある） */
    async fetchUrl() {
      const url = (U.$('#selUrl').value || '').trim();
      if (!/^https?:\/\//i.test(url)) {
        U.toast('http(s):// から始まるURLを入れてください', 'warn');
        return;
      }
      const btn = U.$('#btnFetchUrl');
      const oldLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = '取得中…';

      const proxies = [
        u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
        u => 'https://corsproxy.io/?url=' + encodeURIComponent(u)
      ];
      let ok = false;
      let lastErr = '';
      for (const p of proxies) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 15000);
          const res = await fetch(p(url), { signal: ctrl.signal });
          clearTimeout(timer);
          if (!res.ok) { lastErr = 'HTTP ' + res.status; continue; }
          let text = await res.text();
          if (!text || text.length < 50) { lastErr = '中身が空でした'; continue; }
          if (text.length > 3000000) text = text.slice(0, 3000000);
          U.$('#selHtml').value = text;
          U.toast('取得しました（' + U.formatBytes(text.length) + '）。キーワードで絞り込んで解析してください', 'ok', 4000);
          this.run();
          ok = true;
          break;
        } catch (err) {
          lastErr = err && err.name === 'AbortError' ? '時間切れ' : (err && err.message) || '通信エラー';
        }
      }
      if (!ok) {
        U.toast('取得できませんでした（' + lastErr + '）。ブックマークレットか手動コピーをお使いください', 'err', 5000);
      }
      btn.disabled = false;
      btn.textContent = oldLabel;
    },

    open(purpose, initialHtml, onPick) {
      this.purpose = purpose || 'click';
      this.onPick = onPick;
      U.$('#selPurpose').value = this.purpose;
      U.$('#selHtml').value = initialHtml || '';
      U.$('#selKeyword').value = '';
      U.$('#selResults').innerHTML = '';
      this.el.hidden = false;
      setTimeout(() => U.$('#selHtml').focus(), 40);
      if (initialHtml) this.run();
    },

    close() { this.el.hidden = true; },

    run() {
      const html = U.$('#selHtml').value;
      const kw = U.$('#selKeyword').value;
      const purpose = U.$('#selPurpose').value;
      const box = U.$('#selResults');
      if (!html.trim()) { box.innerHTML = '<div class="sel-empty">HTML を貼り付けて「解析する」を押してください。</div>'; return; }

      let res;
      try { res = SEL.analyze(html, kw, purpose); }
      catch (e) { box.innerHTML = '<div class="sel-empty">解析に失敗しました: ' + U.escapeHtml(e.message) + '</div>'; return; }

      this.lastResult = res;
      if (!res.ok) {
        box.innerHTML = '<div class="sel-empty">⚠ ' + U.escapeHtml(res.message) + '</div>';
        return;
      }
      this.renderResults(res, purpose);
    },

    renderResults(res, purpose) {
      const box = U.$('#selResults');
      box.textContent = '';

      if (res.analyzedIn) {
        box.appendChild(U.el('div', { class: 'sel-count',
          html: '解析対象: <b>' + U.escapeHtml(res.analyzedIn) + '</b>' +
                (res.targetText ? ' ／ 見つかった要素: 「' + U.escapeHtml(res.targetText) + '」' : '') }));
      }

      /* 一覧用途なら、まとめて反映するボタンを先頭に出す */
      if (purpose === 'list' && res.listInfo) {
        const li = res.listInfo;
        const card = U.el('div', { class: 'sel-card best' }, [
          U.el('div', { class: 'sc-main' }, [
            U.el('div', { class: 'sc-sel', text: li.containerSelector }),
            U.el('div', { class: 'sc-why',
              html: '<span class="sc-badge b-ok">おすすめ</span>同じ形の要素が <b>' + li.count +
                '件</b> 見つかりました。列も自動で ' + li.columns.length + ' 個検出しています。' })
          ]),
          U.el('button', { class: 'btn btn-primary', text: 'まとめて反映',
            onclick: () => { if (this.onPick) this.onPick({ kind: 'list', listInfo: li }); this.close(); } })
        ]);
        box.appendChild(card);

        if (li.columns.length) {
          const prev = U.el('div', { class: 'sel-preview' });
          prev.appendChild(U.el('b', { text: '検出した列' }));
          li.columns.slice(0, 8).forEach(c => {
            prev.appendChild(U.el('div', { class: 'sp-html',
              text: c.name + '  ←  ' + c.selector + ' (' + c.attr + ')' +
                    (c.sample ? '   例: ' + String(c.sample).slice(0, 40) : '') }));
          });
          box.appendChild(prev);
        }
        box.appendChild(U.el('div', { class: 'sel-count', text: '── 枠だけを個別に選ぶ場合は下から ──' }));
      }

      if (!res.candidates || !res.candidates.length) {
        box.appendChild(U.el('div', { class: 'sel-empty', text: '候補を作れませんでした。' }));
        return;
      }

      res.candidates.forEach((c, i) => {
        const badge = c.score >= 80 ? '<span class="sc-badge b-ok">安定</span>'
          : c.score >= 55 ? '<span class="sc-badge b-info">まずまず</span>'
          : '<span class="sc-badge b-warn">壊れやすい</span>';
        const matchTxt = c.matches === 1 ? '（ページ内で1つだけに一致 ✓）'
          : c.matches > 1 ? '（' + c.matches + '個に一致 — ' + ((c.suggestIndex || 0) + 1) + '番目が対象）'
          : c.matches === 0 ? '（一致なし）' : '';
        const label = c.strategy === 'role' ? 'get_by_role("' + c.role + '", name="' + c.name + '")'
          : c.strategy === 'text' ? 'get_by_text("' + c.selector + '")'
          : c.strategy === 'label' ? 'get_by_label("' + c.selector + '")'
          : c.strategy === 'placeholder' ? 'get_by_placeholder("' + c.selector + '")'
          : c.selector;

        const card = U.el('div', { class: 'sel-card' + (i === 0 ? ' best' : '') }, [
          U.el('div', { class: 'sc-score', html: '<b>' + c.score + '</b><small>安定度</small>' }),
          U.el('div', { class: 'sc-main' }, [
            U.el('div', { class: 'sc-sel', text: label }),
            U.el('div', { class: 'sc-why', html: badge + U.escapeHtml(c.why || '') + ' ' + U.escapeHtml(matchTxt) })
          ]),
          U.el('button', {
            class: 'btn' + (i === 0 ? ' btn-primary' : ''), text: '使う',
            onclick: () => {
              if (this.onPick) {
                this.onPick({
                  kind: 'target',
                  strategy: c.strategy,
                  selector: c.strategy === 'role' ? '' : c.selector,
                  role: c.role || 'button',
                  name: c.name || '',
                  index: c.matches > 1 ? (c.suggestIndex || 0) : 0,
                  html: U.$('#selHtml').value.slice(0, 4000)
                });
              }
              this.close();
            }
          })
        ]);
        box.appendChild(card);
      });

      if (res.targetHtml) {
        box.appendChild(U.el('div', { class: 'sel-preview' }, [
          U.el('b', { text: '解析した要素' }),
          U.el('div', { class: 'sp-html', text: res.targetHtml })
        ]));
      }

      if (res.alternatives && res.alternatives.length) {
        const alt = U.el('div', { class: 'sel-preview' });
        alt.appendChild(U.el('b', { text: 'ほかの候補（キーワードを絞り込むと精度が上がります）' }));
        res.alternatives.forEach(a => {
          alt.appendChild(U.el('div', { class: 'sp-html', text: '<' + a.tag + '> ' + a.text }));
        });
        box.appendChild(alt);
      }
    }
  };

  /* ══════════════ 変数の候補を集める ══════════════ */
  const BUILTIN_VARS = [
    { name: 'today', desc: '今日の日付 (2026-08-05)' },
    { name: 'now', desc: '現在日時 (2026-08-05 14:30:00)' },
    { name: 'timestamp', desc: 'ファイル名向けの日時 (20260805_143000)' },
    { name: 'index', desc: '繰り返しの何件目か (1から)' },
    { name: 'page_title', desc: '今開いているページのタイトル' },
    { name: 'page_url', desc: '今開いているページのURL' },
    { name: 'base_dir', desc: '出力先フォルダ' }
  ];

  /** 選択ノードより手前（上流）のノードが作る変数を集める */
  function upstreamVars(nodeId) {
    const g = FLOW.graph;
    const vars = [];
    const seen = new Set();
    const stack = [];
    g.edges.forEach(e => { if (e.to === nodeId) stack.push(e.from); });

    // 上流をさかのぼる
    const visited = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      const n = g.nodes.find(x => x.id === id);
      if (n) {
        const def = NODES.getType(n.type);
        if (def && def.provides) {
          (def.provides(n.data) || []).forEach(v => {
            if (v && !seen.has(v)) {
              seen.add(v);
              vars.push({ name: v, desc: (def.icon || '') + ' ' + (n.title || def.label) });
            }
          });
        }
        if (n.type === 'loop' && n.data.mode === 'csv' && !seen.has('CSVの列名')) {
          seen.add('CSVの列名');
          vars.push({ name: 'CSVの列名', desc: '🔁 CSVの見出し行がそのまま変数になります' });
        }
      }
      g.edges.forEach(e => { if (e.to === id) stack.push(e.from); });
    }

    // 繰り返しノードの中にいる場合、そのループの item も使える
    g.nodes.forEach(n => {
      if (n.type !== 'loop') return;
      if (!inLoopBody(n.id, nodeId)) return;
      const iv = n.data.item_var || 'item';
      if ((n.data.mode === 'list' || n.data.mode === 'csv') && !seen.has(iv)) {
        seen.add(iv);
        vars.push({ name: iv, desc: '🔁 ' + (n.title || '繰り返し') + ' の1件分' });
      }
    });

    return vars;
  }

  function inLoopBody(loopId, nodeId) {
    const g = FLOW.graph;
    const start = g.edges.filter(e => e.from === loopId && e.port === 'body').map(e => e.to);
    const seen = new Set();
    const stack = start.slice();
    while (stack.length) {
      const id = stack.pop();
      if (id === nodeId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      g.edges.forEach(e => { if (e.from === id) stack.push(e.to); });
    }
    return false;
  }

  /* ══════════════ 初期化 ══════════════ */
  function init() {
    dom = {
      empty: U.$('#inspectorEmpty'),
      body: U.$('#inspectorBody')
    };
    SelModal.init();
    FLOW.on('select', node => show(node));
  }

  function show(node) {
    current = node;
    if (!node) {
      dom.empty.hidden = false;
      dom.body.hidden = true;
      dom.body.textContent = '';
      return;
    }
    dom.empty.hidden = true;
    dom.body.hidden = false;
    render();
  }

  function refresh() {
    if (current) {
      const fresh = FLOW.getNode(current.id);
      if (fresh) { current = fresh; render(); }
    }
  }

  /* ══════════════ 描画 ══════════════ */
  function render() {
    const node = current;
    const def = NODES.getType(node.type);
    if (!def) return;
    const box = dom.body;
    const scrollTop = box.scrollTop;
    box.textContent = '';

    /* --- ヘッダ --- */
    const head = U.el('div', { class: 'insp-head' }, [
      U.el('div', { class: 'insp-ico', style: { '--nc': def.color }, text: def.icon }),
      U.el('div', { class: 'insp-titles' }, [
        U.el('input', {
          type: 'text', value: node.title || def.label, spellcheck: 'false',
          oninput: e => { node.title = e.target.value; FLOW.renderNode(node); FLOW.emitChange(); }
        }),
        U.el('small', { text: def.label + ' ノード' })
      ]),
      U.el('button', {
        class: 'btn btn-icon', title: 'このノードを削除', html: '🗑',
        onclick: () => { if (confirm('このノードを削除しますか？')) FLOW.deleteNode(node.id); }
      })
    ]);
    box.appendChild(head);

    if (def.desc) box.appendChild(U.el('p', { class: 'insp-desc', text: def.desc }));

    /* --- フィールド --- */
    const fields = U.el('div', { class: 'insp-fields' });
    const vars = BUILTIN_VARS.concat(upstreamVars(node.id));

    NODES.visibleFields(node.type, node.data).forEach(f => {
      const w = renderField(node, f, vars);
      if (w) fields.appendChild(w);
    });

    /* --- 検証結果 --- */
    const issues = FLOW.validateNode(node);
    if (issues.length) {
      const sec = U.el('div', { class: 'insp-section' }, [U.el('h4', { text: '⚠ 確認してください' })]);
      issues.forEach(i => {
        sec.appendChild(U.el('div', {
          class: 'issue ' + (i.level === 'err' ? 'err' : 'warn')
        }, [
          U.el('span', { class: 'issue-ico', text: i.level === 'err' ? '⛔' : '⚠️' }),
          U.el('div', { class: 'issue-body' }, [U.el('span', { text: i.msg })])
        ]));
      });
      fields.appendChild(sec);
    }

    box.appendChild(fields);

    box.appendChild(U.el('div', { class: 'insp-footer' }, [
      U.el('button', {
        class: 'btn', html: '📋 複製', onclick: () => FLOW.duplicateNode(node.id),
        disabled: def.single ? true : null
      }),
      U.el('button', {
        class: 'btn', html: '🎯 中央に表示', onclick: () => FLOW.centerOn(node.id)
      })
    ]));

    box.scrollTop = scrollTop;
  }

  /* ---------- フィールド1つを描く ---------- */
  function renderField(node, f, vars) {
    const d = node.data;

    const commit = () => {
      FLOW.renderNode(node);
      FLOW.drawEdges();
      FLOW.emitChange();
    };
    // 表示条件が変わる可能性のあるフィールドは、変更時にパネルごと再描画
    const commitAndRerender = () => { commit(); render(); };

    switch (f.type) {

      case 'checkbox': {
        const id = U.uid('f');
        const wrap = U.el('div', { class: 'field-check' }, [
          U.el('input', {
            type: 'checkbox', id: id, checked: !!d[f.key],
            onchange: e => { d[f.key] = e.target.checked; commitAndRerender(); }
          }),
          U.el('div', {}, [
            U.el('label', { for: id, text: f.label }),
            f.help ? U.el('p', { class: 'field-help', text: f.help }) : null
          ])
        ]);
        return wrap;
      }

      case 'select': {
        const sel = U.el('select', {
          onchange: e => { d[f.key] = e.target.value; commitAndRerender(); }
        }, (f.options || []).map(o =>
          U.el('option', { value: o[0], selected: String(d[f.key]) === String(o[0]) ? true : null, text: o[1] })
        ));
        return U.el('div', { class: 'field' }, [
          U.el('label', { text: f.label }), sel,
          f.help ? U.el('p', { class: 'field-help', text: f.help }) : null
        ]);
      }

      case 'number': {
        const inp = U.el('input', {
          type: 'number', value: d[f.key] === '' || d[f.key] === undefined ? (f.default || 0) : d[f.key],
          min: f.min !== undefined ? f.min : null,
          max: f.max !== undefined ? f.max : null,
          step: f.step || null,
          oninput: e => { d[f.key] = e.target.value === '' ? '' : Number(e.target.value); commit(); }
        });
        return U.el('div', { class: 'field' }, [
          U.el('label', { text: f.label }), inp,
          f.help ? U.el('p', { class: 'field-help', text: f.help }) : null
        ]);
      }

      case 'textarea': {
        const ta = U.el('textarea', {
          rows: f.rows || 4, spellcheck: 'false', placeholder: f.placeholder || '',
          oninput: e => { d[f.key] = e.target.value; commit(); },
          onfocus: e => { lastFocusedInput = e.target; }
        });
        ta.value = d[f.key] === undefined ? '' : d[f.key];
        return U.el('div', { class: 'field' }, [
          U.el('label', {}, [document.createTextNode(f.label), f.required ? U.el('span', { class: 'req', text: '*' }) : null]),
          ta,
          f.help ? U.el('p', { class: 'field-help', text: f.help }) : null,
          f.vars ? varHints(vars) : null
        ]);
      }

      case 'target':
        return renderTarget(node, f, commit);

      case 'columns':
        return renderColumns(node, f, commit);

      case 'text':
      default: {
        const inp = U.el('input', {
          type: 'text', value: d[f.key] === undefined ? '' : d[f.key],
          placeholder: f.placeholder || '', spellcheck: 'false',
          oninput: e => { d[f.key] = e.target.value; commit(); },
          onfocus: e => { lastFocusedInput = e.target; }
        });
        return U.el('div', { class: 'field' + (f.mono ? ' mono' : '') }, [
          U.el('label', {}, [document.createTextNode(f.label), f.required ? U.el('span', { class: 'req', text: '*' }) : null]),
          inp,
          f.help ? U.el('p', { class: 'field-help', text: f.help }) : null,
          f.vars ? varHints(vars) : null
        ]);
      }
    }
  }

  /* ---------- 変数チップ ---------- */
  function varHints(vars) {
    if (!vars || !vars.length) return null;
    const wrap = U.el('div', { class: 'var-hints' });
    vars.slice(0, 14).forEach(v => {
      wrap.appendChild(U.el('button', {
        class: 'var-hint', text: '{{' + v.name + '}}', title: v.desc || '',
        onclick: e => {
          e.preventDefault();
          insertVar('{{' + v.name + '}}');
        }
      }));
    });
    return wrap;
  }

  function insertVar(text) {
    const inp = lastFocusedInput;
    if (!inp || !inp.isConnected) { U.toast('先に入力欄をクリックしてください', 'warn'); return; }
    const s = inp.selectionStart === null ? inp.value.length : inp.selectionStart;
    const e = inp.selectionEnd === null ? s : inp.selectionEnd;
    inp.value = inp.value.slice(0, s) + text + inp.value.slice(e);
    inp.selectionStart = inp.selectionEnd = s + text.length;
    inp.focus();
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ══════════════ ターゲット（要素指定）エディタ ══════════════ */
  function renderTarget(node, f, commit) {
    const t = node.data[f.key] || (node.data[f.key] = NODES.newTarget());

    const box = U.el('div', { class: 'target-box' });
    box.appendChild(U.el('h4', { html: '🎯 ' + U.escapeHtml(f.label) }));

    /* --- 操作ボタン --- */
    const actions = U.el('div', { class: 'target-actions' }, [
      U.el('button', {
        class: 'btn btn-sm btn-primary', html: '🖍 スクショに印をつける',
        onclick: () => {
          ANNO.open(null, shot => {
            t.shots = t.shots || [];
            t.shots.push(shot);
            commit();
            render();
            U.toast('スクリーンショットを保存しました', 'ok');
          });
        }
      }),
      U.el('button', {
        class: 'btn btn-sm', html: '🔎 HTMLから推定',
        onclick: () => {
          const purpose = guessPurpose(node.type, f.key);
          SelModal.open(purpose, t.html || '', result => {
            if (result.kind === 'list') {
              applyListInfo(node, result.listInfo);
            } else {
              t.strategy = result.strategy;
              t.selector = result.selector;
              t.role = result.role;
              t.name = result.name;
              t.index = result.index || 0;
              t.html = result.html;
            }
            commit();
            render();
            U.toast('セレクタを設定しました', 'ok');
          });
        }
      })
    ]);
    box.appendChild(actions);

    /* --- セレクタ入力（探し方は1行目、値は2行目） --- */
    const strat = U.el('select', {
      class: 'ts-strategy',
      onchange: e => { t.strategy = e.target.value; commit(); render(); }
    }, Object.keys(NODES.STRATEGY_LABELS).map(k =>
      U.el('option', { value: k, selected: (t.strategy || 'css') === k ? true : null,
                       text: '探し方: ' + NODES.STRATEGY_LABELS[k] })));

    const row = U.el('div', { class: 'target-sel-row' }, [strat]);

    if ((t.strategy || 'css') === 'role') {
      row.appendChild(U.el('select', {
        class: 'ts-role',
        onchange: e => { t.role = e.target.value; commit(); }
      }, NODES.ROLE_OPTIONS.map(o =>
        U.el('option', { value: o[0], selected: (t.role || 'button') === o[0] ? true : null, text: o[1] }))));
      row.appendChild(U.el('input', {
        class: 'ts-value', type: 'text', value: t.name || '',
        placeholder: '表示されている文字',
        oninput: e => { t.name = e.target.value; commit(); },
        onfocus: e => { lastFocusedInput = e.target; }
      }));
    } else {
      const inp = U.el('input', {
        class: 'ts-value', type: 'text', value: t.selector || '', spellcheck: 'false',
        placeholder: placeholderFor(t.strategy),
        oninput: e => { t.selector = e.target.value; commit(); },
        onfocus: e => { lastFocusedInput = e.target; }
      });
      inp.style.fontFamily = 'var(--mono)';
      inp.style.fontSize = '12px';
      row.appendChild(inp);
    }
    box.appendChild(row);

    /* --- 何番目か --- */
    const idxRow = U.el('div', { class: 'field-row', style: { marginBottom: '0', marginTop: '8px' } }, [
      U.el('div', { class: 'field', style: { marginBottom: 0 } }, [
        U.el('label', { text: '複数見つかったとき', style: { fontSize: '11px' } }),
        U.el('select', {
          onchange: e => {
            const v = e.target.value;
            t.index = v === 'loop' ? 'loop' : Number(v);
            commit(); render();
          }
        }, [['0', '最初の1つを使う'],
            ['loop', '🔁 繰り返しの何件目かに合わせる（1回目→1番目…）'],
            ['1', '2番目を使う'], ['2', '3番目を使う'], ['3', '4番目を使う'],
            ['4', '5番目を使う'], ['5', '6番目を使う'], ['6', '7番目を使う'],
            ['7', '8番目を使う'], ['8', '9番目を使う'], ['9', '10番目を使う']]
          .map(o => U.el('option', {
            value: o[0],
            selected: String(t.index || 0) === o[0] ? true : null,
            text: o[1]
          })))
      ])
    ]);
    box.appendChild(idxRow);

    /* --- 状態表示 --- */
    const empty = NODES.targetEmpty(t);
    box.appendChild(U.el('div', {
      class: 'target-status ' + (empty ? 'ng' : 'ok'),
      text: empty ? '⚠ まだ要素が指定されていません' : '✓ ' + NODES.targetText(t)
    }));

    /* --- スクショ一覧 --- */
    if (t.shots && t.shots.length) {
      const list = U.el('div', { class: 'shot-list' });
      t.shots.forEach((shot, i) => {
        const card = U.el('div', { class: 'shot-card', title: 'クリックで編集' });
        const img = U.el('img', { alt: '' });
        ANNO.renderThumb(shot, 200).then(url => { img.src = url; });
        card.appendChild(img);
        const labels = ANNO.annoLabels(shot);
        card.appendChild(U.el('div', { class: 'sc-cap',
          text: labels.length ? labels.join(', ') : (shot.annos && shot.annos.length ? '印 ' + shot.annos.length + '個' : '印なし') }));
        card.appendChild(U.el('button', {
          class: 'sc-del', text: '✕', title: '削除',
          onclick: e => {
            e.stopPropagation();
            t.shots.splice(i, 1);
            commit(); render();
          }
        }));
        card.addEventListener('click', () => {
          ANNO.open(shot, updated => {
            t.shots[i] = updated;
            commit(); render();
          });
        });
        list.appendChild(card);
      });
      box.appendChild(list);
    }

    if (f.help) box.appendChild(U.el('p', { class: 'field-help', text: f.help }));
    return box;
  }

  function placeholderFor(strategy) {
    return {
      css: '#login-btn / .product-card a / button[type="submit"]',
      text: 'ログイン',
      label: 'メールアドレス',
      placeholder: '検索キーワードを入力',
      testid: 'submit-button',
      xpath: '//button[contains(text(),"ログイン")]'
    }[strategy || 'css'] || '';
  }

  function guessPurpose(nodeType, fieldKey) {
    if (nodeType === 'extract_list') return 'list';
    if (nodeType === 'input' || nodeType === 'select_option' || nodeType === 'upload') return 'input';
    if (nodeType === 'extract') return 'text';
    return 'click';
  }

  /* 一覧解析の結果を extract_list ノードに反映 */
  function applyListInfo(node, li) {
    const t = node.data.target || (node.data.target = NODES.newTarget());
    t.strategy = 'css';
    t.selector = li.containerSelector;
    t.index = 0;
    node.data.columns = (li.columns || []).map(c => ({
      name: c.name, selector: c.selector, attr: c.attr, attr_name: ''
    }));
    // 同じ名前が重複しないように連番を振る
    const used = {};
    node.data.columns.forEach(c => {
      if (used[c.name]) { used[c.name]++; c.name = c.name + used[c.name]; }
      else used[c.name] = 1;
    });
  }

  /* ══════════════ 列エディタ（一覧取得） ══════════════ */
  function renderColumns(node, f, commit) {
    const cols = node.data[f.key] || (node.data[f.key] = []);

    const wrap = U.el('div', { class: 'field' });
    wrap.appendChild(U.el('label', { text: f.label }));

    const table = U.el('div', { class: 'rows-editor' });
    table.appendChild(U.el('div', { class: 're-row re-head' }, [
      U.el('div', { text: '項目名（変数）' }),
      U.el('div', { text: '枠の中のセレクタ' }),
      U.el('div', { text: '取り出す物' }),
      U.el('div', { text: '' })
    ]));

    cols.forEach((c, i) => {
      const row = U.el('div', { class: 're-row' }, [
        U.el('input', {
          type: 'text', value: c.name || '', placeholder: 'タイトル',
          oninput: e => { c.name = e.target.value; commit(); }
        }),
        U.el('input', {
          type: 'text', value: c.selector || '', placeholder: 'h2 / a / .price',
          oninput: e => { c.selector = e.target.value; commit(); }
        }),
        U.el('select', {
          onchange: e => { c.attr = e.target.value; commit(); if (e.target.value === 'attr') render(); }
        }, [['text', '文字'], ['href', 'リンク先'], ['src', '画像URL'], ['html', 'HTML'],
            ['value', '入力値'], ['attr', '属性…']].map(o =>
          U.el('option', { value: o[0], selected: (c.attr || 'text') === o[0] ? true : null, text: o[1] }))),
        U.el('button', {
          class: 're-del', html: '✕', title: 'この項目を削除',
          onclick: () => { cols.splice(i, 1); commit(); render(); }
        })
      ]);
      table.appendChild(row);
      if (c.attr === 'attr') {
        table.appendChild(U.el('div', { class: 're-row', style: { gridTemplateColumns: '1fr' } }, [
          U.el('input', {
            type: 'text', value: c.attr_name || '', placeholder: '属性名 例: data-id',
            oninput: e => { c.attr_name = e.target.value; commit(); }
          })
        ]));
      }
    });

    if (!cols.length) {
      table.appendChild(U.el('div', { class: 're-row', style: { gridTemplateColumns: '1fr' } }, [
        U.el('div', { class: 'field-help', text: 'まだ項目がありません。「＋ 項目を追加」または「🔎 HTMLから推定」で自動検出できます。' })
      ]));
    }

    wrap.appendChild(table);
    wrap.appendChild(U.el('button', {
      class: 'btn btn-sm re-add', html: '＋ 項目を追加',
      onclick: () => {
        cols.push({ name: '項目' + (cols.length + 1), selector: '', attr: 'text', attr_name: '' });
        commit(); render();
      }
    }));
    if (f.help) wrap.appendChild(U.el('p', { class: 'field-help', text: f.help }));
    return wrap;
  }

  global.INSPECTOR = { init, show, refresh, SelModal, upstreamVars, BUILTIN_VARS };
})(window);
