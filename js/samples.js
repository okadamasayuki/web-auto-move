/* ══════════════════════════════════════════════════════════
   samples.js — すぐ動かせるサンプルフロー
   ──────────────────────────────────────────────────────────
   練習用サイト（quotes.toscrape.com / books.toscrape.com）は
   スクレイピングの学習用に公開されているサイトです。
   ══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  function t(sel) { return { strategy: 'css', selector: sel }; }
  function e(from, to, port) { return { id: 'e_' + from + '_' + (port || 'out'), from: from, port: port || 'out', to: to }; }

  const SAMPLES = [

    /* ══════════ 1. 一覧を Excel に ══════════ */
    {
      key: 'list-to-excel',
      icon: '📊',
      title: '一覧をまとめて Excel に保存',
      desc: 'ページ内の繰り返し部分（商品カードや検索結果）を表として取り出し、Excelに書き出します。いちばん基本の形です。',
      meta: 'ノード3個 / 初級',
      graph: {
        name: 'サンプル：一覧をExcelに保存',
        nodes: [
          { id: 's1', type: 'start', title: '開始', x: 80, y: 160,
            data: { url: 'https://quotes.toscrape.com/', base_dir: 'output', headless: false, polite_wait: 1 } },
          { id: 'n2', type: 'extract_list', title: '名言の一覧を取得', x: 400, y: 140,
            data: {
              target: t('.quote'),
              var_name: '一覧',
              columns: [
                { name: '名言', selector: 'span.text', attr: 'text', attr_name: '' },
                { name: '著者', selector: 'small.author', attr: 'text', attr_name: '' },
                { name: 'タグ', selector: '.tags a.tag', attr: 'text', attr_name: '' }
              ]
            } },
          { id: 'n3', type: 'save_table', title: 'Excelに保存', x: 720, y: 160,
            data: { source_var: '一覧', filename: '{{today}}_名言一覧.xlsx', format: 'xlsx' } }
        ],
        edges: [e('s1', 'n2'), e('n2', 'n3')]
      }
    },

    /* ══════════ 2. ページ送りで全ページ ══════════ */
    {
      key: 'paginate',
      icon: '📄',
      title: 'ページ送りで全ページ集める',
      desc: '「次へ」が無くなるまで自動でページを進み、各ページの一覧をCSVに追記していきます。何百ページでも対応できます。',
      meta: 'ノード5個 / 中級',
      graph: {
        name: 'サンプル：ページ送りで全件収集',
        nodes: [
          { id: 's1', type: 'start', title: '開始', x: 80, y: 200,
            data: { url: 'https://quotes.toscrape.com/', base_dir: 'output', polite_wait: 1.5 } },
          { id: 'n2', type: 'loop', title: 'ページ送りループ', x: 380, y: 180,
            data: { mode: 'pages', target: t('li.next a'), max_pages: 12, continue_on_error: true } },
          { id: 'n3', type: 'extract_list', title: 'このページの一覧', x: 700, y: 80,
            data: {
              target: t('.quote'),
              var_name: '一覧',
              columns: [
                { name: '名言', selector: 'span.text', attr: 'text', attr_name: '' },
                { name: '著者', selector: 'small.author', attr: 'text', attr_name: '' }
              ]
            } },
          { id: 'n4', type: 'save_table', title: 'CSVに追記', x: 1020, y: 80,
            data: { source_var: '一覧', filename: '全ページ一覧.csv', format: 'csv',
                    mode: 'append', encoding: 'utf-8-sig' } },
          { id: 'n5', type: 'log', title: '完了メッセージ', x: 700, y: 330,
            data: { message: '全ページの収集が終わりました。' } }
        ],
        edges: [e('s1', 'n2'), e('n2', 'n3', 'body'), e('n3', 'n4'), e('n2', 'n5', 'done')]
      }
    },

    /* ══════════ 3. CSVのURLを順に処理 ══════════ */
    {
      key: 'csv-batch',
      icon: '🔁',
      title: 'CSVのURLを何百件も順に処理',
      desc: '手元のCSVに並べたURLを1行ずつ開き、情報を取り出してフォルダ分けし、Wordに保存します。大量処理の定番パターンです。',
      meta: 'ノード7個 / 中級',
      graph: {
        name: 'サンプル：CSV一括処理',
        nodes: [
          { id: 's1', type: 'start', title: '開始', x: 60, y: 240,
            data: { url: 'https://books.toscrape.com/', base_dir: 'output', polite_wait: 1.5,
                    on_error: 'screenshot_continue' } },
          { id: 'n2', type: 'loop', title: 'CSVの各行', x: 340, y: 220,
            data: { mode: 'csv', csv_path: 'input.csv', csv_encoding: 'utf-8-sig',
                    item_var: 'item', limit: 3, continue_on_error: true } },
          { id: 'n3', type: 'goto', title: 'URLを開く', x: 660, y: 80,
            data: { mode: 'url', url: '{{url}}', wait_until: 'load' } },
          { id: 'n4', type: 'extract', title: 'タイトルを取得', x: 960, y: 80,
            data: { target: t('h1'), attr: 'text', var_name: 'タイトル', trim: true } },
          { id: 'n5', type: 'extract', title: '価格を取得', x: 1260, y: 80,
            data: { target: t('.price_color'), attr: 'text', var_name: '価格', trim: true } },
          { id: 'n6', type: 'mkdir', title: 'フォルダを作る', x: 960, y: 290,
            data: { path: '{{today}}/{{タイトル}}', var_name: 'folder' } },
          { id: 'n7', type: 'save_word', title: 'Wordに保存', x: 1260, y: 290,
            data: { dir: '{{today}}/{{タイトル}}', filename: '{{タイトル}}.docx',
                    title: '{{タイトル}}',
                    content: '価格: {{価格}}\nURL: {{page_url}}\n取得日時: {{now}}' } },
          { id: 'n8', type: 'log', title: '完了メッセージ', x: 660, y: 430,
            data: { message: 'CSVの全行の処理が終わりました。' } }
        ],
        edges: [
          e('s1', 'n2'), e('n2', 'n3', 'body'), e('n3', 'n4'), e('n4', 'n5'),
          e('n5', 'n6'), e('n6', 'n7'), e('n2', 'n8', 'done')
        ]
      }
    },

    /* ══════════ 4. ログイン → 大量ダウンロード ══════════ */
    {
      key: 'login-download',
      icon: '⬇️',
      title: 'ログインして資料を大量ダウンロード',
      desc: 'IDとパスワードは環境変数から読み込み、一覧の各行を開いてPDF等をフォルダ分けしながら保存します。URLは自分のサイトに合わせて書き換えてください。',
      meta: 'ノード9個 / 上級',
      graph: {
        name: 'サンプル：ログイン→一括ダウンロード',
        nodes: [
          { id: 's1', type: 'start', title: '開始（ログイン画面）', x: 60, y: 260,
            data: { url: 'https://example.com/login', base_dir: 'output', use_session: true,
                    polite_wait: 1.5, on_error: 'screenshot_continue' } },
          { id: 'n2', type: 'input', title: 'IDを入力', x: 330, y: 120,
            data: { target: { strategy: 'label', selector: 'メールアドレス' },
                    from_env: true, env_name: 'SITE_USER', clear_first: true } },
          { id: 'n3', type: 'input', title: 'パスワードを入力', x: 330, y: 320,
            data: { target: { strategy: 'label', selector: 'パスワード' },
                    from_env: true, env_name: 'SITE_PASS', clear_first: true } },
          { id: 'n4', type: 'click', title: 'ログインボタンを押す', x: 610, y: 320,
            data: { target: { strategy: 'role', role: 'button', name: 'ログイン' }, wait_after: 'load' } },
          { id: 'n5', type: 'extract_list', title: '資料の一覧を取得', x: 880, y: 320,
            data: {
              target: t('table tbody tr'),
              var_name: '資料一覧',
              columns: [
                { name: '資料名', selector: 'td:nth-of-type(1)', attr: 'text', attr_name: '' },
                { name: 'リンク', selector: 'a', attr: 'href', attr_name: '' }
              ]
            } },
          { id: 'n6', type: 'loop', title: '資料ごとに繰り返す', x: 1150, y: 300,
            data: { mode: 'list', list_var: '資料一覧', item_var: 'item',
                    limit: 3, continue_on_error: true } },
          { id: 'n7', type: 'goto', title: '資料ページを開く', x: 1430, y: 140,
            data: { mode: 'url', url: '{{item.リンク}}', wait_until: 'load' } },
          { id: 'n8', type: 'mkdir', title: '保存フォルダを作る', x: 1700, y: 140,
            data: { path: '{{today}}/{{item.資料名}}', var_name: 'folder' } },
          { id: 'n9', type: 'download', title: 'PDFをダウンロード', x: 1970, y: 140,
            data: { target: { strategy: 'role', role: 'link', name: 'ダウンロード' },
                    dir: '{{today}}/{{item.資料名}}', filename: '', var_name: 'last_download',
                    skip_existing: true, timeout: 180 } },
          { id: 'n10', type: 'save_text', title: 'メモを残す', x: 2240, y: 140,
            data: { dir: '{{today}}/{{item.資料名}}', filename: 'メモ.txt',
                    content: '資料名: {{item.資料名}}\nURL: {{page_url}}\n保存先: {{last_download}}\n取得日時: {{now}}',
                    mode: 'write' } },
          { id: 'n11', type: 'log', title: '完了メッセージ', x: 1430, y: 460,
            data: { message: 'すべての資料のダウンロードが終わりました。' } }
        ],
        edges: [
          e('s1', 'n2'), e('n2', 'n3'), e('n3', 'n4'), e('n4', 'n5'), e('n5', 'n6'),
          e('n6', 'n7', 'body'), e('n7', 'n8'), e('n8', 'n9'), e('n9', 'n10'),
          e('n6', 'n11', 'done')
        ]
      }
    },

    /* ══════════ 5. 条件分岐 ══════════ */
    {
      key: 'condition',
      icon: '🔀',
      title: '出たり出なかったりする画面に対応',
      desc: 'Cookieの同意バナーのように「出るときだけ閉じる」処理の作り方です。条件分岐ノードの使い方の見本になります。',
      meta: 'ノード5個 / 初級',
      graph: {
        name: 'サンプル：条件分岐でバナー対応',
        nodes: [
          { id: 's1', type: 'start', title: '開始', x: 80, y: 220,
            data: { url: 'https://quotes.toscrape.com/', base_dir: 'output' } },
          { id: 'n2', type: 'condition', title: '同意バナーは出た？', x: 360, y: 200,
            data: { mode: 'visible', target: t('#cookie-banner, .cookie-consent'), timeout: 3 } },
          { id: 'n3', type: 'click', title: '同意を押す', x: 680, y: 100,
            data: { target: { strategy: 'role', role: 'button', name: '同意' },
                    optional: true, wait_after: 'time', wait_ms: 500 } },
          { id: 'n4', type: 'log', title: 'バナー無し', x: 680, y: 300,
            data: { message: 'バナーは出ませんでした。そのまま進みます。' } },
          { id: 'n5', type: 'screenshot', title: '画面を保存', x: 980, y: 200,
            data: { mode: 'full', dir: 'screenshots/{{today}}', filename: '{{timestamp}}.png' } }
        ],
        edges: [
          e('s1', 'n2'), e('n2', 'n3', 'true'), e('n2', 'n4', 'false'),
          e('n3', 'n5'), e('n4', 'n5')
        ]
      }
    },

    /* ══════════ 6. 検索して結果を取る ══════════ */
    {
      key: 'search',
      icon: '🔎',
      title: 'キーワードで検索して結果を取る',
      desc: '検索欄に文字を入れて実行し、結果の一覧を取り出します。検索キーワードをCSVで何百件も回す形にも発展できます。',
      meta: 'ノード5個 / 初級',
      graph: {
        name: 'サンプル：検索して結果取得',
        nodes: [
          { id: 's1', type: 'start', title: '開始', x: 80, y: 200,
            data: { url: 'https://books.toscrape.com/', base_dir: 'output' } },
          { id: 'n2', type: 'input', title: '検索欄に入力', x: 360, y: 180,
            data: { target: { strategy: 'placeholder', selector: 'Search' },
                    value: 'python', clear_first: true, press_enter: true, wait_after: 'load' } },
          { id: 'n3', type: 'wait', title: '結果が出るまで待つ', x: 640, y: 200,
            data: { mode: 'visible', target: t('.product_pod'), timeout: 15 } },
          { id: 'n4', type: 'extract_list', title: '結果の一覧を取得', x: 920, y: 180,
            data: {
              target: t('.product_pod'),
              var_name: '一覧',
              columns: [
                { name: 'タイトル', selector: 'h3 a', attr: 'text', attr_name: '' },
                { name: 'リンク', selector: 'h3 a', attr: 'href', attr_name: '' },
                { name: '価格', selector: '.price_color', attr: 'text', attr_name: '' }
              ]
            } },
          { id: 'n5', type: 'save_table', title: 'Excelに保存', x: 1200, y: 200,
            data: { source_var: '一覧', filename: '検索結果_{{today}}.xlsx', format: 'xlsx' } }
        ],
        edges: [e('s1', 'n2'), e('n2', 'n3'), e('n3', 'n4'), e('n4', 'n5')]
      }
    }
  ];

  global.SAMPLES = SAMPLES;
})(window);
