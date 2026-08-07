/* ══════════════════════════════════════════════════════════
   nodes.js — ノード種別の定義（このツールの心臓部）
   各ノードは「人間がブラウザでやる1操作」に対応する。
   ══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const U = global.U;

  /* ---------- ターゲット（要素の指定）の既定値 ---------- */
  function newTarget() {
    return {
      strategy: 'css',   // css | text | role | label | placeholder | testid | xpath
      selector: '',
      role: 'button',
      name: '',
      index: 0,          // 0 = 最初の1つ
      note: '',
      shots: [],         // [{id, dataUrl, width, height, annos:[...]}]
      html: ''           // 開発者ツールから貼り付けたHTML（参考用に保持）
    };
  }

  const STRATEGY_LABELS = {
    css:         'CSSセレクタ',
    text:        '表示文字',
    role:        '役割＋名前',
    label:       'ラベル',
    placeholder: 'プレースホルダ',
    testid:      'テストID',
    xpath:       'XPath'
  };

  const ROLE_OPTIONS = [
    ['button', 'ボタン (button)'],
    ['link', 'リンク (link)'],
    ['textbox', '入力欄 (textbox)'],
    ['checkbox', 'チェックボックス'],
    ['radio', 'ラジオボタン'],
    ['combobox', 'プルダウン (combobox)'],
    ['tab', 'タブ'],
    ['menuitem', 'メニュー項目'],
    ['heading', '見出し'],
    ['listitem', 'リスト項目'],
    ['row', '表の行'],
    ['cell', '表のセル'],
    ['img', '画像']
  ];

  /* ターゲットが未設定かどうか */
  function targetEmpty(t) {
    if (!t) return true;
    if (t.strategy === 'role') return !String(t.name || '').trim();
    return !String(t.selector || '').trim();
  }

  /* ターゲットを1行の説明文にする */
  function targetText(t) {
    if (!t) return '';
    let s = t.strategy === 'role'
      ? (t.role || 'button') + ' 「' + (t.name || '') + '」'
      : String(t.selector || '');
    if (t.index === 'loop') s += ' [{{index}}番目]';
    else if (Number(t.index) > 0) s += ' [' + (Number(t.index) + 1) + '番目]';
    return s;
  }

  function esc(s) { return U.escapeHtml(s); }
  function codeSpan(s) { return '<span class="sm-code">' + esc(s) + '</span>'; }
  function warnSpan(s) { return '<span class="sm-warn">' + esc(s) + '</span>'; }

  /* 「対象要素」フィールドの共通定義 */
  function targetField(label, help) {
    return {
      key: 'target',
      type: 'target',
      label: label || '対象の要素',
      help: help || 'スクショに印をつけ、開発者ツールのHTMLからセレクタを推定できます。'
    };
  }

  /* 待機まわりの共通フィールド */
  const WAIT_AFTER_FIELDS = [
    {
      key: 'wait_after', type: 'select', label: 'このあとの待ち方', default: 'load',
      options: [
        ['none', '待たない'],
        ['load', 'ページの読み込み完了を待つ'],
        ['networkidle', '通信が落ち着くまで待つ（重いページ向け）'],
        ['selector', '特定の要素が出るまで待つ'],
        ['time', '固定時間だけ待つ']
      ],
      help: 'クリック後に画面が切り替わる場合は「読み込み完了」または「要素が出るまで」が確実です。'
    },
    {
      key: 'wait_selector', type: 'text', mono: true, label: '待つ要素のセレクタ',
      placeholder: '#result-table', showIf: d => d.wait_after === 'selector'
    },
    {
      key: 'wait_ms', type: 'number', label: '待つ時間 (ミリ秒)', default: 1000, min: 0, step: 100,
      showIf: d => d.wait_after === 'time'
    }
  ];

  /* ══════════════════════════════════════════════════════════
     ノード定義
     ══════════════════════════════════════════════════════════ */
  const TYPES = {

    /* ────────── 基本 ────────── */
    start: {
      label: '開始', icon: '🚀', category: '基本', color: '#c7d2fe', single: true, noInput: true,
      desc: 'フローの出発点です。最初に開くURLと、ブラウザの動かし方をここで決めます。',
      fields: [
        { key: 'url', type: 'text', label: '最初に開くURL', required: true, vars: true,
          placeholder: 'https://example.com/login',
          help: 'ここから自動操作が始まります。' },
        { key: 'base_dir', type: 'text', label: '出力先フォルダ（基準）', default: 'output', vars: true,
          placeholder: 'output',
          help: 'ダウンロードや保存の基準になるフォルダ。相対パスならスクリプトと同じ場所に作られます。' },
        { key: 'connect_mode', type: 'select', label: 'どのブラウザで動かすか', default: 'own',
          options: [
            ['own', '専用のブラウザを新しく開く（既定）'],
            ['cdp', '自分のChromeにつないで動かす（ログイン済みのまま使える）']
          ],
          help: 'Google・Microsoft など一部のサイトは、自動操作ブラウザからのログインを拒否します。' +
                'そういうサイトや、すでにログイン済みの環境をそのまま使いたいときは「自分のChromeにつなぐ」を選んでください。' +
                '（▶実行の画面から、つなぐ用のChromeをボタン1つで開けます）' },
        { key: 'cdp_url', type: 'text', label: 'つなぎ先', default: 'http://127.0.0.1:9222', mono: true,
          showIf: d => d.connect_mode === 'cdp',
          help: '▶実行の画面の「🌐 ログイン用ブラウザを開く」で開いたChromeにつながります。' },
        { key: 'browser', type: 'select', label: 'ブラウザ', default: 'chromium',
          showIf: d => (d.connect_mode || 'own') !== 'cdp',
          options: [['chromium', 'Chromium（Chrome系・推奨）'], ['firefox', 'Firefox'], ['webkit', 'WebKit（Safari系）']] },
        { key: 'headless', type: 'checkbox', label: 'ブラウザを見えない状態で動かす（ヘッドレス）', default: false,
          help: 'オフ（既定）＝ブラウザの窓が実際に開いて、クリックやページ移動が目の前で見えます。まずはオフのまま確認してください。' +
                'オン＝窓を出さずに裏で動きます。速くて邪魔になりませんが、様子は見えません（そのぶん実行レポートで確認できます）。' },
        { key: 'viewport_w', type: 'number', label: '画面の幅 (px)', default: 1440, min: 320, step: 10 },
        { key: 'viewport_h', type: 'number', label: '画面の高さ (px)', default: 900, min: 320, step: 10 },
        { key: 'timeout', type: 'number', label: '各操作のタイムアウト (秒)', default: 30, min: 1, step: 1,
          help: '要素が見つからないときに、何秒まで待つか。' },
        { key: 'slowmo', type: 'number', label: '1操作ごとの間 (ミリ秒)', default: 0, min: 0, step: 50,
          help: '動きをゆっくりにして目視確認したいとき用。300くらいにすると追いやすくなります。' },
        { key: 'polite_wait', type: 'number', label: '1件ごとの待ち時間 (秒)', default: 1, min: 0, step: 0.5,
          help: '相手のサーバーに負荷をかけないためのマナー待機。繰り返し処理で効いてきます。0.5〜2秒を推奨。' },
        { key: 'user_agent', type: 'text', label: 'User-Agent（任意）', placeholder: '空欄なら既定値', mono: true },
        { key: 'locale', type: 'text', label: '言語 / ロケール', default: 'ja-JP', mono: true },
        { key: 'use_session', type: 'checkbox', label: 'ログイン状態を覚えておく', default: false,
          help: 'オンにすると、このフロー専用のブラウザとして起動し、ログイン状態が残ります。' +
                '初回に開いたブラウザで手動ログインすれば、2回目からはログイン済みの状態で始まります。' +
                'ログインが必要なサイトを扱うときはオンにしてください。' },
        { key: 'keep_open', type: 'checkbox', label: '終了後もブラウザを開いたままにする', default: false,
          help: '最後の画面を目視で確認したいときに便利です（Enterを押すまで閉じません）。' },
        { key: 'record_preview', type: 'checkbox', label: '実行レポートを作る（開いた画面を記録）', default: true,
          help: '各ステップで画面を撮影し、output/run_report.html に「どの画面が開いてどう進んだか」を画像つきで記録します。実行中もこのファイルをブラウザで開けば、5秒ごとの自動更新で進み具合を見られます。ヘッドレスでも確認できるようになります。' },
        { key: 'preview_limit', type: 'number', label: '記録する画像の上限（枚）', default: 150, min: 10, step: 10,
          showIf: d => d.record_preview !== false,
          help: '大量の繰り返しでディスクを使いすぎないための上限。超えた分は文字だけ記録します。' },
        { key: 'on_error', type: 'select', label: 'エラーが起きたとき', default: 'screenshot_stop',
          options: [
            ['screenshot_stop', 'スクショを撮って停止する'],
            ['screenshot_continue', 'スクショを撮って次へ進む'],
            ['stop', 'そのまま停止する']
          ],
          help: '「次へ進む」にすると、繰り返し処理の途中で1件失敗しても全体が止まりません。' }
      ],
      summary: d => (d.url ? codeSpan(d.url) : warnSpan('URL未設定')) +
        '<br>' + esc((d.headless ? 'ヘッドレス' : '画面あり') + ' / ' + (d.browser || 'chromium')),
      chips: d => {
        const c = [{ text: '📁 ' + (d.base_dir || 'output') }];
        if (d.use_session) c.push({ text: '🔑 セッション再利用' });
        return c;
      },
      validate: d => (!d.url ? [{ level: 'err', msg: '開始ノードのURLが空です。' }] : [])
    },

    /* ────────── 操作 ────────── */
    goto: {
      label: 'ページ移動', icon: '🧭', category: '操作', color: '#bfdbfe',
      desc: '指定したURLへ移動します。「戻る」「進む」「再読み込み」もここで行えます。',
      fields: [
        { key: 'mode', type: 'select', label: '動作', default: 'url',
          options: [['url', 'URLを開く'], ['back', '前のページへ戻る'], ['forward', '次のページへ進む'], ['reload', '再読み込み']] },
        { key: 'url', type: 'text', label: 'URL', vars: true, mono: true,
          placeholder: 'https://example.com/list?page={{index}}',
          help: '{{変数}} が使えます。例）https://example.com/item/{{item.id}}',
          showIf: d => (d.mode || 'url') === 'url' },
        { key: 'wait_until', type: 'select', label: '読み込み完了の判定', default: 'load',
          options: [['load', 'load（通常）'], ['domcontentloaded', 'DOM構築まで（速い）'],
                    ['networkidle', '通信が落ち着くまで（重いページ向け）'], ['commit', '応答が来た時点']] }
      ],
      summary: d => {
        const m = d.mode || 'url';
        if (m === 'back') return '⬅ 前のページへ戻る';
        if (m === 'forward') return '➡ 次のページへ進む';
        if (m === 'reload') return '🔄 再読み込み';
        return d.url ? codeSpan(d.url) : warnSpan('URL未設定');
      },
      validate: d => ((d.mode || 'url') === 'url' && !d.url
        ? [{ level: 'err', msg: 'ページ移動のURLが空です。' }] : [])
    },

    click: {
      label: 'クリック', icon: '👆', category: '操作', color: '#a7f3d0',
      desc: 'ボタンやリンクをクリックします。スクショに赤枠を引き、HTMLからセレクタを推定できます。',
      fields: [
        targetField('クリックする要素'),
        { key: 'button', type: 'select', label: 'ボタン', default: 'left',
          options: [['left', '左クリック'], ['right', '右クリック'], ['middle', '中クリック']] },
        { key: 'click_count', type: 'number', label: 'クリック回数', default: 1, min: 1, max: 3,
          help: '2 にするとダブルクリックになります。' },
        { key: 'expect_new_tab', type: 'checkbox', label: '新しいタブ／ウィンドウが開く', default: false,
          help: '「別ウィンドウで開く」リンクの場合はオンに。以降の操作は新しいタブに切り替わります。' },
        { key: 'optional', type: 'checkbox', label: '見つからなくても次へ進む', default: false,
          help: 'Cookieの同意バナーなど、出たり出なかったりする要素に使います。' },
        { key: 'force', type: 'checkbox', label: '重なりを無視して強制クリック', default: false,
          help: '他の要素が上に重なっていてクリックできないときの最終手段です。' }
      ].concat(WAIT_AFTER_FIELDS),
      summary: d => {
        const t = d.target;
        if (targetEmpty(t)) return warnSpan('対象が未設定');
        return codeSpan(targetText(t));
      },
      chips: d => {
        const c = [];
        const n = d.target && d.target.shots ? d.target.shots.length : 0;
        if (n) c.push({ text: '📷 スクショ' + n, cls: 'chip-shot' });
        if (d.expect_new_tab) c.push({ text: '🗔 新規タブ' });
        if (d.optional) c.push({ text: '任意' });
        return c;
      },
      validate: d => (targetEmpty(d.target)
        ? [{ level: 'err', msg: 'クリック対象のセレクタが未設定です。' }] : [])
    },

    input: {
      label: '文字入力', icon: '⌨️', category: '操作', color: '#a7f3d0',
      desc: '入力欄に文字を打ち込みます。IDやパスワードは環境変数から読み込めます。',
      fields: [
        targetField('入力する欄'),
        { key: 'from_env', type: 'checkbox', label: '環境変数から読み込む（IDやパスワード向け）', default: false,
          help: 'コードに直接パスワードを書かずに済みます。安全性が高い方法です。' },
        { key: 'env_name', type: 'text', label: '環境変数名', mono: true, placeholder: 'SITE_PASSWORD',
          showIf: d => !!d.from_env,
          help: '実行前に設定します。Windows: set SITE_PASSWORD=xxxx / Mac: export SITE_PASSWORD=xxxx' },
        { key: 'value', type: 'text', label: '入力する文字', vars: true, placeholder: '検索キーワード / {{item.名前}}',
          showIf: d => !d.from_env, help: '{{変数}} が使えます。' },
        { key: 'clear_first', type: 'checkbox', label: '既存の文字を消してから入れる', default: true },
        { key: 'type_delay', type: 'number', label: '1文字ごとの間 (ミリ秒)', default: 0, min: 0, step: 10,
          help: '0 なら一括入力。人間らしく打ちたい場合は 50〜100。' },
        { key: 'press_enter', type: 'checkbox', label: '入力後に Enter を押す', default: false }
      ].concat(WAIT_AFTER_FIELDS.map(f => f.key === 'wait_after' ? Object.assign({}, f, { default: 'none' }) : f)),
      summary: d => {
        if (targetEmpty(d.target)) return warnSpan('対象が未設定');
        const v = d.from_env ? '環境変数 ' + (d.env_name || '?') : (d.value || '(空)');
        return codeSpan(targetText(d.target)) + '<br>← ' + esc(v);
      },
      chips: d => {
        const c = [];
        if (d.from_env) c.push({ text: '🔒 環境変数' });
        if (d.press_enter) c.push({ text: '⏎ Enter' });
        return c;
      },
      validate: d => {
        const out = [];
        if (targetEmpty(d.target)) out.push({ level: 'err', msg: '入力欄のセレクタが未設定です。' });
        if (d.from_env && !d.env_name) out.push({ level: 'err', msg: '環境変数名が空です。' });
        return out;
      }
    },

    press: {
      label: 'キー入力', icon: '🔤', category: '操作', color: '#a7f3d0',
      desc: 'Enter / Tab / Escape などのキーを押します。',
      fields: [
        { key: 'key', type: 'select', label: 'キー', default: 'Enter',
          options: [['Enter', 'Enter'], ['Tab', 'Tab'], ['Escape', 'Escape'], ['ArrowDown', '↓'], ['ArrowUp', '↑'],
                    ['ArrowLeft', '←'], ['ArrowRight', '→'], ['PageDown', 'PageDown'], ['PageUp', 'PageUp'],
                    ['End', 'End'], ['Home', 'Home'], ['Backspace', 'Backspace'], ['Delete', 'Delete'],
                    ['Control+a', 'Ctrl+A（全選択）'], ['Control+c', 'Ctrl+C'], ['Control+v', 'Ctrl+V'],
                    ['__custom__', 'その他（手入力）']] },
        { key: 'custom_key', type: 'text', label: 'キー名', mono: true, placeholder: 'Shift+F5',
          showIf: d => d.key === '__custom__' },
        { key: 'use_target', type: 'checkbox', label: '特定の要素にフォーカスして押す', default: false },
        Object.assign(targetField('フォーカスする要素'), { showIf: d => !!d.use_target })
      ],
      summary: d => codeSpan(d.key === '__custom__' ? (d.custom_key || '?') : (d.key || 'Enter')) + ' を押す'
    },

    select_option: {
      label: 'プルダウン選択', icon: '🔽', category: '操作', color: '#a7f3d0',
      desc: '<select> のプルダウンから項目を選びます。',
      fields: [
        targetField('プルダウン（select要素）'),
        { key: 'by', type: 'select', label: '選び方', default: 'label',
          options: [['label', '表示されている文字で選ぶ'], ['value', 'value属性で選ぶ'], ['index', '上から何番目かで選ぶ']] },
        { key: 'value', type: 'text', label: '選ぶ値', vars: true, placeholder: '東京都',
          showIf: d => (d.by || 'label') !== 'index' },
        { key: 'index', type: 'number', label: '何番目（0 が先頭）', default: 0, min: 0,
          showIf: d => d.by === 'index' }
      ],
      summary: d => targetEmpty(d.target) ? warnSpan('対象が未設定')
        : codeSpan(targetText(d.target)) + '<br>→ ' + esc(d.by === 'index' ? (d.index || 0) + '番目' : (d.value || '(空)')),
      validate: d => (targetEmpty(d.target) ? [{ level: 'err', msg: 'プルダウンのセレクタが未設定です。' }] : [])
    },

    hover: {
      label: 'マウスを乗せる', icon: '🖐️', category: '操作', color: '#a7f3d0',
      desc: '要素にマウスを乗せます。ホバーで開くメニューを出すときに使います。',
      fields: [targetField('マウスを乗せる要素'),
        { key: 'wait_ms', type: 'number', label: '乗せたあと待つ (ミリ秒)', default: 500, min: 0, step: 100 }],
      summary: d => targetEmpty(d.target) ? warnSpan('対象が未設定') : codeSpan(targetText(d.target)),
      validate: d => (targetEmpty(d.target) ? [{ level: 'err', msg: 'ホバー対象が未設定です。' }] : [])
    },

    upload: {
      label: 'ファイル添付', icon: '📎', category: '操作', color: '#a7f3d0',
      desc: '「ファイルを選択」欄に、手元のファイルを添付します。',
      fields: [
        targetField('ファイル選択欄 (input[type=file])'),
        { key: 'file_path', type: 'text', label: '添付するファイルのパス', vars: true, mono: true,
          placeholder: 'input/{{item.ファイル名}}', required: true }
      ],
      summary: d => codeSpan(d.file_path || '未設定'),
      validate: d => {
        const o = [];
        if (targetEmpty(d.target)) o.push({ level: 'err', msg: 'ファイル選択欄のセレクタが未設定です。' });
        if (!d.file_path) o.push({ level: 'err', msg: '添付するファイルのパスが空です。' });
        return o;
      }
    },

    scroll: {
      label: 'スクロール', icon: '📜', category: '操作', color: '#a7f3d0',
      desc: 'ページを下げます。スクロールすると続きが読み込まれる（無限スクロール）ページにも対応します。',
      fields: [
        { key: 'mode', type: 'select', label: 'やり方', default: 'bottom',
          options: [['bottom', '一番下まで'], ['top', '一番上へ'], ['pixels', '指定ピクセルだけ'],
                    ['element', '特定の要素が見えるところまで'], ['infinite', '無限スクロール（増えなくなるまで）']] },
        { key: 'pixels', type: 'number', label: 'スクロール量 (px)', default: 800, step: 100, showIf: d => d.mode === 'pixels' },
        Object.assign(targetField('見えるようにする要素'), { showIf: d => d.mode === 'element' }),
        { key: 'max_times', type: 'number', label: '最大の繰り返し回数', default: 20, min: 1,
          showIf: d => d.mode === 'infinite', help: '安全のための上限。増えなくなったら自動で止まります。' },
        { key: 'wait_ms', type: 'number', label: '1回ごとに待つ (ミリ秒)', default: 800, min: 0, step: 100,
          showIf: d => d.mode === 'infinite' || d.mode === 'bottom' }
      ],
      summary: d => {
        const m = { bottom: '一番下までスクロール', top: '一番上へ', pixels: (d.pixels || 800) + 'px スクロール',
                    element: '要素が見えるまで', infinite: '無限スクロール（最大' + (d.max_times || 20) + '回）' };
        return esc(m[d.mode || 'bottom']);
      },
      validate: d => (d.mode === 'element' && targetEmpty(d.target)
        ? [{ level: 'err', msg: 'スクロール先の要素が未設定です。' }] : [])
    },

    wait: {
      label: '待機', icon: '⏳', category: '操作', color: '#a7f3d0',
      desc: '次に進む前に待ちます。読み込みが遅いページで安定させたいときに挟みます。',
      fields: [
        { key: 'mode', type: 'select', label: '待ち方', default: 'time',
          options: [['time', '決まった時間だけ'], ['visible', '要素が表示されるまで'], ['hidden', '要素が消えるまで'],
                    ['load', 'ページ読み込み完了まで'], ['networkidle', '通信が落ち着くまで'], ['url', 'URLが変わるまで']] },
        { key: 'ms', type: 'number', label: '待つ時間 (ミリ秒)', default: 2000, min: 0, step: 100, showIf: d => (d.mode || 'time') === 'time' },
        Object.assign(targetField('待つ対象の要素'), { showIf: d => d.mode === 'visible' || d.mode === 'hidden' }),
        { key: 'url_part', type: 'text', label: 'URLに含まれる文字', mono: true, placeholder: '/mypage', showIf: d => d.mode === 'url' },
        { key: 'timeout', type: 'number', label: 'タイムアウト (秒)', default: 30, min: 1,
          showIf: d => ['visible', 'hidden', 'url'].indexOf(d.mode) >= 0 }
      ],
      validate: d => (['visible', 'hidden'].indexOf(d.mode) >= 0 && targetEmpty(d.target)
        ? [{ level: 'err', msg: '待つ対象の要素が未設定です。' }] : []),
      summary: d => {
        const m = d.mode || 'time';
        if (m === 'time') return esc((d.ms || 2000) + ' ミリ秒待つ');
        if (m === 'visible') return '表示されるまで待つ: ' + codeSpan(targetText(d.target) || '?');
        if (m === 'hidden') return '消えるまで待つ: ' + codeSpan(targetText(d.target) || '?');
        if (m === 'url') return 'URLに ' + codeSpan(d.url_part || '?') + ' が入るまで';
        return m === 'load' ? 'ページ読み込み完了まで' : '通信が落ち着くまで';
      }
    },

    frame: {
      label: 'フレーム切替', icon: '🖼️', category: '操作', color: '#a7f3d0',
      desc: 'ページの中に埋め込まれた別ページ（iframe）を操作したいときに切り替えます。',
      fields: [
        { key: 'mode', type: 'select', label: '動作', default: 'enter',
          options: [['enter', 'iframe の中に入る'], ['exit', '元のページに戻る']] },
        Object.assign(targetField('iframe の要素'), { showIf: d => (d.mode || 'enter') === 'enter' })
      ],
      summary: d => ((d.mode || 'enter') === 'enter'
        ? 'iframeへ: ' + codeSpan(targetText(d.target) || '?') : '元のページに戻る'),
      validate: d => {
        if ((d.mode || 'enter') !== 'enter') return [];
        const o = [];
        if (targetEmpty(d.target)) o.push({ level: 'err', msg: 'iframe のセレクタが未設定です。' });
        else if (['css', 'xpath'].indexOf(d.target.strategy || 'css') < 0) {
          o.push({ level: 'warn', msg: 'iframe の指定は「CSSセレクタ」でのみ行えます。探し方をCSSセレクタに変えてください。' });
        }
        return o;
      }
    },

    /* ────────── 取得 ────────── */
    extract: {
      label: '情報取得', icon: '🔍', category: '取得', color: '#fde68a',
      desc: 'ページ内の文字やリンク先を取り出して、名前をつけて覚えます。後のノードで {{名前}} として使えます。',
      fields: [
        targetField('取り出す要素'),
        { key: 'attr', type: 'select', label: '何を取り出すか', default: 'text',
          options: [['text', '表示されている文字'], ['html', 'HTML（タグ込み）'], ['href', 'リンク先URL (href)'],
                    ['src', '画像などのURL (src)'], ['value', '入力欄の値 (value)'], ['attr', '任意の属性']] },
        { key: 'attr_name', type: 'text', label: '属性名', mono: true, placeholder: 'data-id', showIf: d => d.attr === 'attr' },
        { key: 'var_name', type: 'text', label: '覚える名前（変数名）', default: '取得値', required: true,
          placeholder: '商品名', help: '後で {{商品名}} のように使えます。日本語でもOKです。' },
        { key: 'multiple', type: 'checkbox', label: '複数ヒットしたら全部つなげる', default: false,
          help: 'オフだと最初の1つだけ。オンにすると全部を区切り文字でつなぎます。' },
        { key: 'join_with', type: 'text', label: 'つなぐ区切り', default: ', ', showIf: d => !!d.multiple },
        { key: 'trim', type: 'checkbox', label: '前後の空白・改行を取り除く', default: true },
        { key: 'regex', type: 'text', label: '正規表現で一部だけ抜き出す（任意）', mono: true,
          placeholder: '[0-9,]+', help: '例）「価格: 1,280円」から数字だけ取りたいとき [0-9,]+ と入力。' },
        { key: 'default_value', type: 'text', label: '見つからなかったときの値', placeholder: '（空欄）',
          help: '要素が無くてもここの値を入れて処理を続けます。' }
      ],
      summary: d => (targetEmpty(d.target) ? warnSpan('対象が未設定') : codeSpan(targetText(d.target))) +
        '<br>→ <b>{{' + esc(d.var_name || '取得値') + '}}</b>',
      chips: d => {
        const c = [{ text: '{{' + (d.var_name || '取得値') + '}}', cls: 'chip-var' }];
        const n = d.target && d.target.shots ? d.target.shots.length : 0;
        if (n) c.push({ text: '📷 スクショ' + n, cls: 'chip-shot' });
        return c;
      },
      validate: d => {
        const o = [];
        if (targetEmpty(d.target)) o.push({ level: 'err', msg: '取得対象のセレクタが未設定です。' });
        if (!d.var_name) o.push({ level: 'err', msg: '変数名が空です。' });
        return o;
      },
      provides: d => [d.var_name || '取得値']
    },

    extract_list: {
      label: '一覧取得', icon: '📋', category: '取得', color: '#fde68a',
      desc: '検索結果や商品一覧のような「同じ形が並んだ部分」をまとめて表として取り出します。繰り返しノードと組み合わせて使います。',
      fields: [
        Object.assign(targetField('1件分の枠（繰り返される要素）'),
          { help: '「商品カード1枚」「表の行1つ」に当たる要素を指定します。例：.product-card / table tbody tr' }),
        { key: 'columns', type: 'columns', label: '取り出す項目',
          help: '1件の枠の中から、さらに絞り込んで取り出す項目を並べます。セレクタは枠の中の相対指定です。',
          default: [
            { name: 'タイトル', selector: 'h2, h3, .title', attr: 'text', attr_name: '' },
            { name: 'リンク', selector: 'a', attr: 'href', attr_name: '' }
          ] },
        { key: 'var_name', type: 'text', label: '覚える名前（変数名）', default: '一覧', required: true,
          help: '繰り返しノードで「この一覧の各項目」として使えます。' },
        { key: 'limit', type: 'number', label: '最大件数（0 = 全部）', default: 0, min: 0 },
        { key: 'skip_empty', type: 'checkbox', label: '全項目が空の行は捨てる', default: true }
      ],
      summary: d => {
        const cols = (d.columns || []).map(c => c.name).filter(Boolean);
        return (targetEmpty(d.target) ? warnSpan('枠が未設定') : codeSpan(targetText(d.target))) +
          '<br>' + esc(cols.length ? cols.join(' / ') : '項目が未設定');
      },
      chips: d => {
        const c = [{ text: '{{' + (d.var_name || '一覧') + '}}', cls: 'chip-var' }];
        c.push({ text: (d.columns || []).length + '項目' });
        return c;
      },
      validate: d => {
        const o = [];
        if (targetEmpty(d.target)) o.push({ level: 'err', msg: '一覧の「1件分の枠」が未設定です。' });
        if (!(d.columns || []).filter(c => c.name && c.selector !== undefined).length) {
          o.push({ level: 'err', msg: '取り出す項目が1つも設定されていません。' });
        }
        if (!d.var_name) o.push({ level: 'err', msg: '変数名が空です。' });
        return o;
      },
      provides: d => [d.var_name || '一覧']
    },

    /* ────────── 保存 ────────── */
    mkdir: {
      label: 'フォルダ作成', icon: '📁', category: '保存', color: '#ddd6fe',
      desc: 'フォルダを作ります。すでにあれば何もしません。変数を使って自動で振り分けられます。',
      fields: [
        { key: 'path', type: 'text', label: 'フォルダのパス', required: true, vars: true, mono: true,
          default: '{{today}}/{{index}}', placeholder: '{{today}}/{{商品名}}',
          help: '出力先フォルダ（開始ノードで指定）からの相対パスです。「/」で階層を作れます。' },
        { key: 'var_name', type: 'text', label: '作ったパスを覚える名前', default: 'folder',
          help: '後で {{folder}} として、ダウンロード先などに使えます。' }
      ],
      summary: d => codeSpan(d.path || '未設定') + '<br>→ <b>{{' + esc(d.var_name || 'folder') + '}}</b>',
      chips: d => [{ text: '{{' + (d.var_name || 'folder') + '}}', cls: 'chip-var' }],
      validate: d => (!d.path ? [{ level: 'err', msg: 'フォルダのパスが空です。' }] : []),
      provides: d => [d.var_name || 'folder']
    },

    download: {
      label: 'ダウンロード', icon: '⬇️', category: '保存', color: '#ddd6fe',
      desc: 'ダウンロードのリンク／ボタンを押して、指定したフォルダにファイルを保存します。',
      fields: [
        targetField('ダウンロードのボタン／リンク'),
        { key: 'dir', type: 'text', label: '保存先フォルダ', vars: true, mono: true, default: '{{today}}',
          help: '出力先フォルダからの相対パス。無ければ自動で作られます。例）{{today}}/{{商品名}}' },
        { key: 'filename', type: 'text', label: 'ファイル名（空欄なら元の名前）', vars: true, mono: true,
          placeholder: '{{index}}_{{商品名}}.pdf',
          help: '拡張子まで含めて指定します。空欄ならサイト側の名前をそのまま使います。' },
        { key: 'var_name', type: 'text', label: '保存先パスを覚える名前', default: 'last_download' },
        { key: 'timeout', type: 'number', label: 'タイムアウト (秒)', default: 120, min: 5,
          help: '大きなファイルは長めに。' },
        { key: 'skip_existing', type: 'checkbox', label: '同名ファイルが既にあればスキップ', default: false,
          help: '途中で止まった処理を再実行するときに便利です。' },
        { key: 'optional', type: 'checkbox', label: 'ダウンロードできなくても次へ進む', default: false }
      ],
      summary: d => (targetEmpty(d.target) ? warnSpan('ボタンが未設定') : codeSpan(targetText(d.target))) +
        '<br>📁 ' + esc((d.dir || '(直下)') + '/' + (d.filename || '元のファイル名')),
      chips: d => {
        const c = [{ text: '{{' + (d.var_name || 'last_download') + '}}', cls: 'chip-var' }];
        if (d.skip_existing) c.push({ text: '重複スキップ' });
        return c;
      },
      validate: d => (targetEmpty(d.target)
        ? [{ level: 'err', msg: 'ダウンロードボタンのセレクタが未設定です。' }] : []),
      provides: d => [d.var_name || 'last_download']
    },

    save_text: {
      label: 'メモ保存', icon: '📝', category: '保存', color: '#ddd6fe',
      desc: '取得した情報をテキストファイル（.txt / .md）に書き出します。',
      fields: [
        { key: 'dir', type: 'text', label: '保存先フォルダ', vars: true, mono: true, default: '{{today}}' },
        { key: 'filename', type: 'text', label: 'ファイル名', vars: true, mono: true, required: true,
          default: 'memo.txt', placeholder: '{{商品名}}.txt' },
        { key: 'content', type: 'textarea', label: '書き込む内容', vars: true, rows: 6, required: true,
          default: '商品名: {{商品名}}\nURL: {{page_url}}\n取得日時: {{now}}',
          help: '{{変数}} が使えます。改行もそのまま反映されます。' },
        { key: 'mode', type: 'select', label: '書き込み方', default: 'write',
          options: [['write', '新規作成（上書き）'], ['append', '末尾に追記']],
          help: '繰り返しの中で1つのファイルにまとめたいときは「追記」にします。' },
        { key: 'encoding', type: 'select', label: '文字コード', default: 'utf-8',
          options: [['utf-8', 'UTF-8（推奨）'], ['utf-8-sig', 'UTF-8 BOM付き（Excel向け）'], ['cp932', 'Shift_JIS (cp932)']] }
      ],
      summary: d => codeSpan((d.dir ? d.dir + '/' : '') + (d.filename || '未設定')) +
        '<br>' + esc((d.mode === 'append' ? '追記' : '新規') + ' / ' + String(d.content || '').split('\n')[0].slice(0, 40)),
      validate: d => {
        const o = [];
        if (!d.filename) o.push({ level: 'err', msg: 'メモのファイル名が空です。' });
        if (!d.content) o.push({ level: 'warn', msg: 'メモの内容が空です。' });
        return o;
      }
    },

    save_word: {
      label: 'Word保存', icon: '📄', category: '保存', color: '#ddd6fe',
      desc: '取得した情報を Word (.docx) にして保存します。表として一覧を貼り付けることもできます。',
      fields: [
        { key: 'dir', type: 'text', label: '保存先フォルダ', vars: true, mono: true, default: '{{today}}' },
        { key: 'filename', type: 'text', label: 'ファイル名', vars: true, mono: true, required: true,
          default: '{{today}}_レポート.docx', placeholder: '{{商品名}}.docx' },
        { key: 'title', type: 'text', label: '見出し', vars: true, default: '{{page_title}}' },
        { key: 'content', type: 'textarea', label: '本文', vars: true, rows: 6,
          default: 'URL: {{page_url}}\n取得日時: {{now}}',
          help: '空行で段落が分かれます。' },
        { key: 'add_table', type: 'checkbox', label: '一覧を表として貼り付ける', default: false },
        { key: 'table_var', type: 'text', label: '表にする一覧の変数名', default: '一覧', showIf: d => !!d.add_table,
          help: '「一覧取得」ノードで付けた名前を入れます。' },
        { key: 'add_images', type: 'checkbox', label: '画像ファイルを貼り付ける', default: false },
        { key: 'image_var', type: 'text', label: '画像のパスが入った変数名', default: 'last_download',
          showIf: d => !!d.add_images }
      ],
      summary: d => codeSpan((d.dir ? d.dir + '/' : '') + (d.filename || '未設定')) +
        '<br>' + esc(d.title || '(見出しなし)'),
      chips: d => (d.add_table ? [{ text: '表あり' }] : []),
      validate: d => (!d.filename ? [{ level: 'err', msg: 'Wordのファイル名が空です。' }] : [])
    },

    save_table: {
      label: 'Excel/CSV保存', icon: '📊', category: '保存', color: '#ddd6fe',
      desc: '「一覧取得」で集めたデータを Excel (.xlsx) や CSV に書き出します。',
      fields: [
        { key: 'source_var', type: 'text', label: '書き出す一覧の変数名', default: '一覧', required: true,
          help: '「一覧取得」ノードで付けた名前を入れます。' },
        { key: 'dir', type: 'text', label: '保存先フォルダ', vars: true, mono: true, default: '' },
        { key: 'filename', type: 'text', label: 'ファイル名', vars: true, mono: true, required: true,
          default: '{{today}}_一覧.xlsx' },
        { key: 'format', type: 'select', label: '形式', default: 'xlsx',
          options: [['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV (.csv)']] },
        { key: 'encoding', type: 'select', label: 'CSVの文字コード', default: 'utf-8-sig',
          options: [['utf-8-sig', 'UTF-8 BOM付き（Excelで文字化けしない）'], ['utf-8', 'UTF-8'], ['cp932', 'Shift_JIS (cp932)']],
          showIf: d => d.format === 'csv' },
        { key: 'mode', type: 'select', label: '書き込み方', default: 'write',
          options: [['write', '新規作成（上書き）'], ['append', '末尾に追記']],
          help: '繰り返しの中で少しずつ足していくなら「追記」。' }
      ],
      summary: d => '{{' + esc(d.source_var || '一覧') + '}} → ' + codeSpan(d.filename || '未設定'),
      validate: d => {
        const o = [];
        if (!d.source_var) o.push({ level: 'err', msg: '書き出す一覧の変数名が空です。' });
        if (!d.filename) o.push({ level: 'err', msg: 'ファイル名が空です。' });
        return o;
      }
    },

    screenshot: {
      label: 'スクショ保存', icon: '📸', category: '保存', color: '#ddd6fe',
      desc: '今のページの画像を保存します。証跡を残したいときに便利です。',
      fields: [
        { key: 'mode', type: 'select', label: '範囲', default: 'viewport',
          options: [['viewport', '見えている範囲'], ['full', 'ページ全体（縦に長くてもOK）'], ['element', '特定の要素だけ']] },
        Object.assign(targetField('撮影する要素'), { showIf: d => d.mode === 'element' }),
        { key: 'dir', type: 'text', label: '保存先フォルダ', vars: true, mono: true, default: 'screenshots/{{today}}' },
        { key: 'filename', type: 'text', label: 'ファイル名', vars: true, mono: true, default: '{{timestamp}}.png' }
      ],
      summary: d => codeSpan((d.dir ? d.dir + '/' : '') + (d.filename || '{{timestamp}}.png')),
      validate: d => (d.mode === 'element' && targetEmpty(d.target)
        ? [{ level: 'err', msg: '撮影する要素が未設定です。' }] : [])
    },

    /* ────────── 制御 ────────── */
    loop: {
      label: '繰り返し', icon: '🔁', category: '制御', color: '#a5f3fc',
      desc: '同じ処理を何度も繰り返します。何百件・何千件の自動処理はこのノードが担当します。',
      outputs: [
        { id: 'body', label: 'くり返す', cls: 'o-body' },
        { id: 'done', label: '終わったら', cls: 'o-done' }
      ],
      fields: [
        { key: 'mode', type: 'select', label: '繰り返し方', default: 'count',
          options: [
            ['count', '回数を指定して繰り返す'],
            ['list', '「一覧取得」の各項目について繰り返す'],
            ['csv', 'CSVファイルの各行について繰り返す'],
            ['elements', '画面に並んだ同じ要素の数だけ（順番にクリック向け）'],
            ['pages', 'ページ送り（「次へ」が無くなるまで）']
          ] },
        { key: 'count', type: 'number', label: '回数', default: 10, min: 1, showIf: d => (d.mode || 'count') === 'count' },
        Object.assign(targetField('数える要素（1件分）'), {
          key: 'elements_target', showIf: d => d.mode === 'elements',
          help: '並んでいるリンクやボタンの「1つ分」を指定します。見つかった個数だけ本体を繰り返します。' +
                '本体のクリックノードで「複数見つかったとき → 🔁 繰り返しの何件目かに合わせる」を選ぶと、' +
                '1回目は1番目、2回目は2番目…と順番に押していけます。' +
                'クリックで別ページへ移動する場合は、本体の最後に「ページ移動：前のページへ戻る」を入れて一覧に戻してください。'
        }),
        { key: 'list_var', type: 'text', label: '一覧の変数名', default: '一覧', showIf: d => d.mode === 'list',
          help: '「一覧取得」ノードで付けた名前。' },
        { key: 'csv_path', type: 'text', label: 'CSVファイルのパス', mono: true, default: 'input.csv',
          showIf: d => d.mode === 'csv',
          help: '1行目を見出しとして扱います。見出し名が変数名になります（例：url 列 → {{url}}）。' },
        { key: 'csv_encoding', type: 'select', label: 'CSVの文字コード', default: 'utf-8-sig',
          options: [['utf-8-sig', 'UTF-8（BOM有無どちらでも）'], ['cp932', 'Shift_JIS (cp932)']],
          showIf: d => d.mode === 'csv' },
        Object.assign(targetField('「次へ」ボタン'), { showIf: d => d.mode === 'pages' }),
        { key: 'max_pages', type: 'number', label: '最大ページ数', default: 50, min: 1, showIf: d => d.mode === 'pages',
          help: '安全のための上限。「次へ」が消えたらそこで止まります。' },
        { key: 'item_var', type: 'text', label: '1件分を入れる変数名', default: 'item',
          showIf: d => d.mode === 'list' || d.mode === 'csv',
          help: '本体の中で {{item.タイトル}} のように使えます。' },
        { key: 'start_at', type: 'number', label: '何件目から始めるか（1 = 先頭）', default: 1, min: 1,
          help: '途中で止まった処理を再開したいときに使います。' },
        { key: 'limit', type: 'number', label: '最大処理件数（0 = 全部）', default: 0, min: 0,
          help: 'まずは 3 くらいにして試してから 0 にするのがおすすめです。' },
        { key: 'continue_on_error', type: 'checkbox', label: '1件失敗しても次の件へ進む', default: true,
          help: '大量処理では基本オンにします。失敗した件はログに残ります。' }
      ],
      summary: d => {
        const m = d.mode || 'count';
        if (m === 'count') return esc((d.count || 10) + ' 回くり返す');
        if (m === 'list') return '{{' + esc(d.list_var || '一覧') + '}} の各項目';
        if (m === 'csv') return codeSpan(d.csv_path || 'input.csv') + ' の各行';
        if (m === 'elements') return '並んだ ' + codeSpan(targetText(d.elements_target) || '未設定') + ' の数だけ';
        return 'ページ送り（最大' + esc(d.max_pages || 50) + 'ページ）';
      },
      chips: d => {
        const c = [];
        if (d.limit) c.push({ text: '上限 ' + d.limit + '件', cls: 'chip-warn' });
        if (d.start_at > 1) c.push({ text: d.start_at + '件目から' });
        if (d.mode === 'list' || d.mode === 'csv') c.push({ text: '{{' + (d.item_var || 'item') + '}}', cls: 'chip-var' });
        return c;
      },
      validate: (d, node, graph) => {
        const o = [];
        if (d.mode === 'pages' && targetEmpty(d.target)) {
          o.push({ level: 'err', msg: '「次へ」ボタンのセレクタが未設定です。' });
        }
        if (d.mode === 'list' && !d.list_var) o.push({ level: 'err', msg: '一覧の変数名が空です。' });
        if (d.mode === 'csv' && !d.csv_path) o.push({ level: 'err', msg: 'CSVのパスが空です。' });
        if (d.mode === 'elements' && targetEmpty(d.elements_target)) {
          o.push({ level: 'err', msg: '「数える要素」のセレクタが未設定です。' });
        }
        if (graph && !graph.edges.some(e => e.from === node.id && e.port === 'body')) {
          o.push({ level: 'warn', msg: '「くり返す」の出口に何もつながっていません。中身が空のループになります。' });
        }
        return o;
      },
      provides: d => (d.mode === 'list' || d.mode === 'csv' ? [d.item_var || 'item', 'index'] : ['index'])
    },

    condition: {
      label: '条件分岐', icon: '🔀', category: '制御', color: '#a5f3fc',
      outputs: [
        { id: 'true', label: 'はい', cls: 'o-true' },
        { id: 'false', label: 'いいえ', cls: 'o-false' }
      ],
      desc: '条件によって処理を分けます。「ボタンがあれば押す」「値が空なら飛ばす」などに使います。',
      fields: [
        { key: 'mode', type: 'select', label: '条件', default: 'exists',
          options: [
            ['exists', '要素がページに存在する'],
            ['visible', '要素が画面に見えている'],
            ['text_contains', 'ページに特定の文字がある'],
            ['var_equals', '変数が特定の値と一致する'],
            ['var_contains', '変数に特定の文字が含まれる'],
            ['var_empty', '変数が空である'],
            ['custom', '自分でPythonの条件式を書く']
          ] },
        Object.assign(targetField('判定する要素'), { showIf: d => ['exists', 'visible'].indexOf(d.mode || 'exists') >= 0 }),
        { key: 'text', type: 'text', label: '探す文字', vars: true, showIf: d => d.mode === 'text_contains' },
        { key: 'var_name', type: 'text', label: '変数名', default: '取得値',
          showIf: d => ['var_equals', 'var_contains', 'var_empty'].indexOf(d.mode) >= 0 },
        { key: 'value', type: 'text', label: '比べる値', vars: true,
          showIf: d => ['var_equals', 'var_contains'].indexOf(d.mode) >= 0 },
        { key: 'custom_py', type: 'textarea', label: 'Python の条件式', rows: 3, mono: true,
          placeholder: 'int(ctx.get("件数", 0)) > 100', showIf: d => d.mode === 'custom',
          help: '変数は ctx["名前"] で参照できます。ページは page 変数です。' },
        { key: 'timeout', type: 'number', label: '判定の待ち時間 (秒)', default: 3, min: 0,
          showIf: d => ['exists', 'visible'].indexOf(d.mode || 'exists') >= 0,
          help: '要素が出てくるのを何秒待ってから「無い」と判断するか。' }
      ],
      summary: d => {
        const m = d.mode || 'exists';
        if (m === 'exists') return codeSpan(targetText(d.target) || '?') + ' がある？';
        if (m === 'visible') return codeSpan(targetText(d.target) || '?') + ' が見えている？';
        if (m === 'text_contains') return 'ページに「' + esc(d.text || '?') + '」がある？';
        if (m === 'var_equals') return '{{' + esc(d.var_name || '?') + '}} == ' + esc(d.value || '?') + ' ？';
        if (m === 'var_contains') return '{{' + esc(d.var_name || '?') + '}} に「' + esc(d.value || '?') + '」？';
        if (m === 'var_empty') return '{{' + esc(d.var_name || '?') + '}} は空？';
        return codeSpan(String(d.custom_py || '?').slice(0, 40));
      },
      validate: (d, node, graph) => {
        const o = [];
        if (graph) {
          const hasT = graph.edges.some(e => e.from === node.id && e.port === 'true');
          const hasF = graph.edges.some(e => e.from === node.id && e.port === 'false');
          if (!hasT && !hasF) o.push({ level: 'warn', msg: '分岐の出口が両方ともつながっていません。' });
        }
        return o;
      }
    },

    script: {
      label: 'カスタムコード', icon: '🐍', category: '制御', color: '#a5f3fc',
      desc: '用意されたノードで足りないときに、Python のコードを直接書き足せます。',
      fields: [
        { key: 'code', type: 'textarea', label: 'Python コード', rows: 8, mono: true,
          default: '# page: 現在のページ / ctx: 変数の入れ物 / out_dir: 出力先(Path)\n' +
                   '# 例）ページのタイトルを変数に入れる\n' +
                   'ctx["ページ名"] = page.title()\n',
          help: '使える変数: page（Playwrightのページ）, ctx（辞書）, out_dir（Path）, log（ログ出力関数）' },
        { key: 'provides', type: 'text', label: 'この中で作る変数名（カンマ区切り・任意）', mono: true,
          placeholder: 'ページ名, 件数', help: '書いておくと、他のノードの変数候補に出てきます。' }
      ],
      summary: d => codeSpan(String(d.code || '').split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))[0] || '(空)'),
      provides: d => String(d.provides || '').split(',').map(s => s.trim()).filter(Boolean)
    },

    log: {
      label: 'ログ出力', icon: '💬', category: '制御', color: '#a5f3fc',
      desc: '実行中の進み具合を画面に表示します。長い処理の進捗確認に。',
      fields: [
        { key: 'message', type: 'text', label: 'メッセージ', vars: true,
          default: '{{index}} 件目を処理中: {{page_title}}' }
      ],
      summary: d => esc(d.message || '(空)')
    },

    stop: {
      label: '停止', icon: '🛑', category: '制御', color: '#a5f3fc',
      outputs: [],
      desc: 'ここでフローを終了します。条件分岐と組み合わせて「該当なしなら終了」に使います。',
      fields: [
        { key: 'mode', type: 'select', label: '止め方', default: 'loop',
          options: [['loop', '今の繰り返しから抜ける'], ['skip', 'この1件を飛ばして次の件へ'], ['all', 'プログラム全体を終了する']] },
        { key: 'message', type: 'text', label: '終了メッセージ', vars: true, default: '' }
      ],
      summary: d => esc({ loop: '繰り返しから抜ける', skip: 'この件を飛ばす', all: '全体を終了' }[d.mode || 'loop'])
    }
  };

  /* ---------- カテゴリ順 ---------- */
  const CATEGORIES = ['基本', '操作', '取得', '保存', '制御'];

  /* ---------- ヘルパー ---------- */
  function getType(t) { return TYPES[t] || null; }

  function outputsOf(type) {
    const def = TYPES[type];
    if (!def) return [{ id: 'out', label: '' }];
    if (def.outputs) return def.outputs;
    return [{ id: 'out', label: '' }];
  }

  /* 新規ノードの初期データを作る */
  function defaultData(type) {
    const def = TYPES[type];
    const d = {};
    if (!def) return d;
    (def.fields || []).forEach(f => {
      if (f.type === 'target') d[f.key] = newTarget();
      else if (f.default !== undefined) d[f.key] = U.deepClone(f.default);
      else if (f.type === 'checkbox') d[f.key] = false;
      else if (f.type === 'columns') d[f.key] = [];
      else d[f.key] = '';
    });
    return d;
  }

  /* 保存済みデータに、後から増えたフィールドの既定値を補う */
  function migrateData(type, data) {
    const def = TYPES[type];
    const d = data || {};
    if (!def) return d;
    (def.fields || []).forEach(f => {
      if (d[f.key] === undefined) {
        if (f.type === 'target') d[f.key] = newTarget();
        else if (f.default !== undefined) d[f.key] = U.deepClone(f.default);
        else if (f.type === 'checkbox') d[f.key] = false;
        else if (f.type === 'columns') d[f.key] = [];
        else d[f.key] = '';
      } else if (f.type === 'target') {
        const base = newTarget();
        for (const k in base) if (d[f.key][k] === undefined) d[f.key][k] = base[k];
      }
    });
    return d;
  }

  /* 表示されるフィールドだけを返す */
  function visibleFields(type, data) {
    const def = TYPES[type];
    if (!def) return [];
    return (def.fields || []).filter(f => !f.showIf || f.showIf(data));
  }

  global.NODES = {
    TYPES, CATEGORIES, STRATEGY_LABELS, ROLE_OPTIONS,
    getType, outputsOf, defaultData, migrateData, visibleFields,
    newTarget, targetEmpty, targetText
  };
})(window);
