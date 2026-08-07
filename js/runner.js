/* ══════════════════════════════════════════════════════════
   runner.js — 「▶ 実行」: ローカル実行環境（wam_runner.py）との連携
   ──────────────────────────────────────────────────────────
   ブラウザ単体では他サイトの操作もフォルダ保存もできないため、
   PC上の小さなサーバー（wam_runner.py）に生成コードを渡して実行し、
   ログと実行レポートをこの画面から見られるようにする。
   ══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const U = global.U;
  const FLOW = global.FLOW;
  const CODEGEN = global.CODEGEN;
  const NODES = global.NODES;

  const LS_KEY = 'wam.runner';

  const R = {
    url: 'http://127.0.0.1:8765',
    token: '',
    connected: false,
    deps: null,
    run: null,          // { id, dir, output, offset, done }
    statusTimer: null,
    logTimer: null
  };

  let dom = null;

  /* ══════════════ 通信 ══════════════ */
  function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'X-WAM-Token': R.token }, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 8000);
    return fetch(R.url.replace(/\/+$/, '') + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      signal: ctrl.signal
    }).then(res => res.json().then(j => {
      clearTimeout(timer);
      if (!res.ok) throw new Error(j && j.error ? j.error : 'HTTP ' + res.status);
      return j;
    })).catch(err => {
      clearTimeout(timer);
      throw err;
    });
  }

  /* ══════════════ 接続まわり ══════════════ */
  function checkStatus(silent) {
    return api('/status').then(st => {
      R.reachable = true;
      R.connected = st.auth === true;   // 接続コードが合ってはじめて「接続済み」
      R.deps = st.deps || {};
      updateBadge();
      if (R.connected) {
        showPanel();
        if (st.running && !R.run) {
          // ページを開き直しても、実行中のものがあれば拾う
          R.run = { id: st.running, offset: 0, done: false };
          startLogPolling();
        }
        renderDeps(st);
      } else {
        showSetup();
      }
      return st;
    }).catch(err => {
      R.reachable = false;
      R.connected = false;
      updateBadge();
      showSetup();
      if (!silent) U.toast('実行環境に接続できません。wam_runner.py を起動してください', 'warn', 3500);
      throw err;
    });
  }

  function connect() {
    const url = dom.url.value.trim() || 'http://127.0.0.1:8765';
    const token = dom.token.value.trim().toUpperCase();
    if (!token) { U.toast('実行環境の画面に表示された接続コードを入力してください', 'warn'); return; }
    R.url = url;
    R.token = token;
    checkStatus(true).then(st => {
      if (st.auth === true) {
        U.lsSet(LS_KEY, { url: R.url, token: R.token });
        U.toast('実行環境に接続しました', 'ok');
      } else {
        U.toast('接続コードが違います。実行環境の黒い画面に表示された8桁を確認してください', 'err', 4500);
      }
    }).catch(() => {
      U.toast('接続できませんでした。wam_runner.py が起動しているか確認してください', 'err', 4000);
    });
  }

  function updateBadge() {
    if (!dom) return;
    dom.badge.textContent = R.connected ? '🟢 接続済み'
      : R.reachable ? '🟡 起動を確認・コード未入力' : '⚪ 未接続';
    dom.badge.classList.toggle('on', R.connected);
    const topBtn = U.$('#btnRun');
    if (topBtn) topBtn.classList.toggle('connected', R.connected);
  }

  function showSetup() {
    if (!dom) return;
    dom.setup.hidden = false;
    dom.panel.hidden = true;
  }

  function showPanel() {
    if (!dom) return;
    dom.setup.hidden = true;
    dom.panel.hidden = false;
  }

  function renderDeps(st) {
    if (!dom) return;
    const d = st.deps || {};
    const need = [];
    const g = FLOW.graph;
    if (!d.playwright) need.push('playwright（必須）');
    if (g.nodes.some(n => n.type === 'save_word') && !d.docx) need.push('python-docx（Word保存に必要）');
    if (g.nodes.some(n => n.type === 'save_table' && n.data.format !== 'csv') && !d.openpyxl) need.push('openpyxl（Excel保存に必要）');
    dom.deps.innerHTML = need.length
      ? '⚠ 実行環境に足りないもの: <b>' + U.escapeHtml(need.join(' / ')) + '</b><br>' +
        '実行環境側の黒い画面で <code>pip install playwright python-docx openpyxl</code> と ' +
        '<code>python -m playwright install chromium</code> を実行してください。'
      : '✅ 実行に必要なものはそろっています（Python ' + U.escapeHtml(st.python || '') + '）';
    dom.deps.className = 'run-deps ' + (need.length ? 'ng' : 'ok');
  }

  /* ══════════════ 実行 ══════════════ */
  function runFlow() {
    // まず検証。エラーがあれば実行しない
    const gen = CODEGEN.generate(FLOW.graph);
    const issues = FLOW.validateGraph().concat(gen.issues || []);
    const errs = issues.filter(i => i.level === 'err');
    if (errs.length) {
      U.toast('要修正が ' + errs.length + ' 件あります。先に直してください（🩺チェック参照）', 'err', 4500);
      appendLog('⛔ 実行できません。次のエラーを直してください:\n' +
        errs.map(e => '  ・' + (e.title || '') + ' — ' + e.msg).join('\n') + '\n');
      return;
    }

    dom.log.textContent = '';
    appendLog('▶ 実行環境へ送信しています…\n');
    dom.btnRun.disabled = true;

    api('/run', {
      method: 'POST',
      body: { name: FLOW.graph.name || 'flow', files: gen.files },
      timeout: 15000
    }).then(res => {
      R.run = { id: res.run, dir: res.dir, output: res.output, offset: 0, done: false };
      appendLog('✅ 開始しました。\n📁 保存先: ' + res.output + '\n' + '─'.repeat(46) + '\n');
      dom.dir.textContent = res.output || res.dir || '';
      dom.btnStop.disabled = false;
      dom.btnReport.disabled = false;
      startLogPolling();
    }).catch(err => {
      dom.btnRun.disabled = false;
      appendLog('⛔ 開始できませんでした: ' + err.message + '\n');
      U.toast('実行を開始できませんでした: ' + err.message, 'err', 4500);
    });
  }

  function stopFlow() {
    if (!R.run) return;
    api('/stop', { method: 'POST', body: { run: R.run.id } })
      .then(() => appendLog('\n⏹ 停止しました（ブラウザ窓が残った場合は手で閉じてください）\n'))
      .catch(err => U.toast('停止に失敗: ' + err.message, 'err'));
  }

  function openReport() {
    if (!R.run) return;
    window.open(R.url.replace(/\/+$/, '') + '/report/' + R.run.id + '/run_report.html', '_blank');
  }

  /* ── ログ取得 ── */
  function startLogPolling() {
    stopLogPolling();
    R.logTimer = setInterval(pollLogs, 1200);
    pollLogs();
  }

  function stopLogPolling() {
    if (R.logTimer) { clearInterval(R.logTimer); R.logTimer = null; }
  }

  function pollLogs() {
    if (!R.run) { stopLogPolling(); return; }
    api('/logs?run=' + encodeURIComponent(R.run.id) + '&offset=' + (R.run.offset || 0))
      .then(res => {
        if (res.text) appendLog(res.text);
        R.run.offset = res.offset;
        if (res.output && dom.dir.textContent !== res.output) dom.dir.textContent = res.output;
        dom.btnReport.disabled = false;
        if (res.done && !R.run.done) {
          R.run.done = true;
          stopLogPolling();
          dom.btnRun.disabled = false;
          dom.btnStop.disabled = true;
          appendLog('\n' + '─'.repeat(46) + '\n' +
            (res.returncode === 0 ? '✅ 実行が終了しました。' : '⚠ 終了コード ' + res.returncode + ' で終了しました。') +
            '\n📁 結果: ' + (res.output || '') + '\n🖼 「実行レポートを開く」で画面の記録を確認できます。\n');
          U.toast(res.returncode === 0 ? '実行が終了しました' : '実行が終了しました（エラーあり）',
                  res.returncode === 0 ? 'ok' : 'warn', 4000);
        }
      })
      .catch(() => { /* 一時的な通信エラーは次のポーリングに任せる */ });
  }

  function appendLog(text) {
    if (!dom) return;
    dom.log.textContent += text;
    const atBottom = dom.log.scrollHeight - dom.log.scrollTop - dom.log.clientHeight < 120;
    if (atBottom || true) dom.log.scrollTop = dom.log.scrollHeight;
  }

  /* ══════════════ モーダル ══════════════ */
  function openModal() {
    init();
    dom.modal.hidden = false;
    const saved = U.lsGet(LS_KEY, null);
    if (saved) {
      R.url = saved.url || R.url;
      R.token = saved.token || '';
      dom.url.value = R.url;
      dom.token.value = R.token;
    }
    checkStatus(true).catch(() => { /* 未接続表示のまま */ });
    // モーダルを開いている間だけ、定期的に接続確認
    if (R.statusTimer) clearInterval(R.statusTimer);
    R.statusTimer = setInterval(() => {
      if (dom.modal.hidden) { clearInterval(R.statusTimer); R.statusTimer = null; return; }
      if (!R.connected) checkStatus(true).catch(() => {});
    }, 3000);
  }

  function init() {
    if (dom) return;
    dom = {
      modal: U.$('#runModal'),
      badge: U.$('#runnerBadge'),
      setup: U.$('#runSetup'),
      panel: U.$('#runPanel'),
      url: U.$('#runnerUrl'),
      token: U.$('#runnerToken'),
      deps: U.$('#runnerDeps'),
      dir: U.$('#runDir'),
      log: U.$('#runLog'),
      btnConnect: U.$('#btnRunnerConnect'),
      btnRun: U.$('#btnRunFlow'),
      btnStop: U.$('#btnRunStop'),
      btnReport: U.$('#btnRunReport')
    };
    initOsTabs();
    dom.btnConnect.addEventListener('click', connect);
    dom.token.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
    dom.btnRun.addEventListener('click', runFlow);
    dom.btnStop.addEventListener('click', stopFlow);
    dom.btnReport.addEventListener('click', openReport);
  }

  /* ══════════════ OS別の起動手順 ══════════════ */
  function detectOs() {
    const p = (navigator.userAgentData && navigator.userAgentData.platform) ||
              navigator.platform || navigator.userAgent || '';
    return /mac|iphone|ipad/i.test(p) ? 'mac' : 'win';
  }

  function showOs(os) {
    U.$$('.os-tab').forEach(b => b.classList.toggle('active', b.dataset.os === os));
    U.$$('.os-body').forEach(b => { b.hidden = b.dataset.os !== os; });
  }

  function initOsTabs() {
    U.$$('.os-tab').forEach(b => {
      b.addEventListener('click', () => showOs(b.dataset.os));
    });
    showOs(detectOs());

    U.$$('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const el = document.getElementById(btn.dataset.copy);
        if (!el) return;
        const text = el.textContent;
        const done = () => {
          const old = btn.textContent;
          btn.textContent = '✅ コピーしました';
          setTimeout(() => { btn.textContent = old; }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, () => selectText(el));
        } else {
          selectText(el);
        }
      });
    });
  }

  function selectText(el) {
    try {
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      U.toast('選択しました。Ctrl+C（Macは⌘+C）でコピーしてください', 'info', 3500);
    } catch (e) { /* 無視 */ }
  }

  /**
   * 実行環境が開いたリンク（…/#connect=コード&port=番号）を読み取り、
   * コードの入力なしで自動接続する。
   */
  function autoConnectFromHash() {
    const hash = String(location.hash || '').replace(/^#/, '');
    if (!hash || hash.indexOf('connect=') < 0) return false;

    const params = {};
    hash.split('&').forEach(kv => {
      const i = kv.indexOf('=');
      if (i > 0) params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    const token = String(params.connect || '').trim().toUpperCase();
    if (!token) return false;

    // アドレスバーからコードを消す（履歴に残さない）
    try { history.replaceState(null, '', location.pathname + location.search); }
    catch (e) { location.hash = ''; }

    R.url = 'http://127.0.0.1:' + (parseInt(params.port, 10) || 8765);
    R.token = token;

    openModal();
    dom.url.value = R.url;
    dom.token.value = R.token;
    checkStatus(true).then(st => {
      if (st.auth === true) {
        U.lsSet(LS_KEY, { url: R.url, token: R.token });
        U.toast('実行環境に自動で接続しました。「▶ このフローを実行」で開始できます', 'ok', 4500);
      }
    }).catch(() => {
      U.toast('実行環境に接続できませんでした。黒い画面が開いたままか確認してください', 'warn', 4000);
    });
    return true;
  }

  global.RUNNER = { openModal, checkStatus, autoConnectFromHash };
})(window);
