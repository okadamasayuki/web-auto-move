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

    /* ══════════ 0. ミニマム：YouTubeで動画を順に開く ══════════ */
    {
      key: 'youtube-mini',
      icon: '🎬',
      title: 'ミニマム：YouTubeの動画を順に開く',
      desc: '一番小さな練習用フロー（7ノード）。「高く評価した動画」を上から10本、開いて→5秒ながめて→戻る、を繰り返すだけ。▶実行を押すとブラウザが立ち上がり、画面がバーッと切り替わっていくのを目で見られます。初回はブラウザが開いたら手でYouTubeにログインしてください（最大5分待ちます）。2回目からはログイン状態を再利用します。',
      meta: 'ノード7個 / まずはこれ',
      graph: {
        name: 'ミニマム：YouTubeの動画を順に開く',
        nodes: [
          { id: 's1', type: 'start', title: '開始：高く評価した動画を開く', x: 60, y: 100,
            data: { url: 'https://www.youtube.com/playlist?list=LL', base_dir: 'output',
                    headless: false, use_session: true, polite_wait: 0.5,
                    on_error: 'screenshot_continue',
                    viewport_w: 1440, viewport_h: 900 } },
          { id: 'g0', type: 'log', title: 'ログインの案内', x: 340, y: 100,
            data: { message: '★ YouTubeにログインしていない場合は、いま開いたブラウザで手動ログインしてください（最大5分待ちます）。一度ログインすれば次回からは不要です。' } },
          { id: 'w1', type: 'wait', title: '一覧を待つ（初回はこの間にログイン）', x: 620, y: 100,
            data: { mode: 'visible', target: t('ytd-playlist-video-renderer a#video-title'),
                    timeout: 300 } },
          { id: 'lp', type: 'loop', title: '上から10本くり返す', x: 900, y: 80,
            data: { mode: 'elements', elements_target: t('ytd-playlist-video-renderer a#video-title'),
                    limit: 10, continue_on_error: true } },
          { id: 'ck', type: 'click', title: '{{index}}本目の動画を開く', x: 1180, y: 60,
            data: { target: { strategy: 'css', selector: 'ytd-playlist-video-renderer a#video-title',
                              index: 'loop' },
                    wait_after: 'time', wait_ms: 1500 } },
          { id: 'w2', type: 'wait', title: '5秒ながめる', x: 1460, y: 80,
            data: { mode: 'time', ms: 5000 } },
          { id: 'bk', type: 'goto', title: '一覧へ戻る', x: 1740, y: 80,
            data: { mode: 'back', wait_until: 'load' } },
          { id: 'fin', type: 'log', title: '完了', x: 900, y: 360,
            data: { message: '10本ぶん見終わりました！' } }
        ],
        edges: [
          e('s1', 'g0'), e('g0', 'w1'), e('w1', 'lp'),
          e('lp', 'ck', 'body'), e('ck', 'w2'), e('w2', 'bk'),
          e('lp', 'fin', 'done')
        ]
      }
    },

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

    /* ══════════ 2.5 並んだリンクを順番にクリック ══════════ */
    {
      key: 'click-each',
      icon: '🖱️',
      title: '並んだリンクを順番にクリック',
      desc: '一覧に並んだ同じ形のリンクを上から順に1つずつ開き、詳細ページで情報を控えて一覧に戻る…を繰り返します。「次のやつ、また次のやつ」と押していく操作の見本です。',
      meta: 'ノード7個 / 中級',
      graph: {
        name: 'サンプル：並んだリンクを順番にクリック',
        nodes: [
          { id: 's1', type: 'start', title: '開始', x: 60, y: 220,
            data: { url: 'https://books.toscrape.com/', base_dir: 'output', polite_wait: 1,
                    on_error: 'screenshot_continue' } },
          { id: 'lp', type: 'loop', title: '並んだ本の数だけ', x: 340, y: 200,
            data: { mode: 'elements', elements_target: t('article.product_pod h3 a'),
                    limit: 5, continue_on_error: true },
          },
          { id: 'ck', type: 'click', title: '{{index}}番目の本を開く', x: 620, y: 80,
            data: { target: { strategy: 'css', selector: 'article.product_pod h3 a', index: 'loop' },
                    wait_after: 'load' } },
          { id: 'ex', type: 'extract', title: 'タイトルを取得', x: 900, y: 80,
            data: { target: t('h1'), attr: 'text', var_name: 'タイトル', trim: true } },
          { id: 'ex2', type: 'extract', title: '価格を取得', x: 1180, y: 80,
            data: { target: t('.price_color'), attr: 'text', var_name: '価格', trim: true } },
          { id: 'sv', type: 'save_text', title: '結果を追記', x: 1460, y: 80,
            data: { dir: '', filename: 'クリック結果.txt', mode: 'append', encoding: 'utf-8',
                    content: '{{index}}. {{タイトル}}　{{価格}}　{{page_url}}' } },
          { id: 'bk', type: 'goto', title: '一覧に戻る', x: 1740, y: 80,
            data: { mode: 'back', wait_until: 'load' } },
          { id: 'fin', type: 'log', title: '完了', x: 620, y: 380,
            data: { message: '並んだリンクをすべて処理しました。' } }
        ],
        edges: [
          e('s1', 'lp'), e('lp', 'ck', 'body'), e('ck', 'ex'), e('ex', 'ex2'),
          e('ex2', 'sv'), e('sv', 'bk'), e('lp', 'fin', 'done')
        ]
      }
    },

    /* ══════════ 2.6 実戦テンプレート：契約書の一括収集 ══════════ */
    {
      key: 'contract-harvest',
      icon: '⭐',
      title: '実戦：一覧を順に開いて契約書を全部保存',
      desc: 'ホバーメニュー→検索→一覧のリンクを上から順に開き、タイトル入力欄から名前を取って「番号_タイトル」フォルダを作成。契約書ファイルを全部保存してメモを残し、一覧に戻って次へ…を、ページ送りしながら100件でも繰り返す構成の見本。セレクタ（例）を自分のサイトのものに差し替えて使ってください。',
      meta: 'ノード18個 / 実戦テンプレート',
      graph: {
        name: 'テンプレ：契約書の一括収集',
        nodes: [
          { id: 's1', type: 'start', title: '開始（自分のサイトのURLに変更）', x: 60, y: 60,
            data: { url: 'https://example.com/', base_dir: 'output', polite_wait: 1.5,
                    on_error: 'screenshot_continue', headless: false } },
          { id: 'h1', type: 'hover', title: 'メニューにマウスを乗せる', x: 340, y: 60,
            data: { target: t('.global-nav .menu-parent'), wait_ms: 600 } },
          { id: 'c1', type: 'click', title: '開いたメニューの項目を押す', x: 620, y: 60,
            data: { target: t('.global-nav .dropdown a.item'), wait_after: 'load' } },
          { id: 'in1', type: 'input', title: '絞り込み条件を入力', x: 900, y: 60,
            data: { target: t('input[name="keyword"]'), value: '検索キーワード（例）',
                    clear_first: true, wait_after: 'none' } },
          { id: 'sel1', type: 'select_option', title: 'プルダウンで種類を選ぶ', x: 1180, y: 60,
            data: { target: t('select[name="category"]'), by: 'label', value: '契約書類（例）' } },
          { id: 'c2', type: 'click', title: '検索ボタンを押す（あれば）', x: 1460, y: 60,
            data: { target: { strategy: 'role', role: 'button', name: '検索' },
                    optional: true, wait_after: 'load' } },
          { id: 'lpP', type: 'loop', title: 'ページ送り（次へが無くなるまで）', x: 60, y: 320,
            data: { mode: 'pages', target: t('.pagination a.next'), max_pages: 10,
                    continue_on_error: true } },
          { id: 'lpE', type: 'loop', title: '並んだリンクの数だけ', x: 340, y: 340,
            data: { mode: 'elements', elements_target: t('.result-list .result-item a.title'),
                    limit: 0, continue_on_error: true } },
          { id: 'sn', type: 'script', title: '通し番号を+1', x: 620, y: 340,
            data: { code: '# ページをまたいでも 1, 2, 3… と続く通し番号\nctx["番号"] = int(ctx.get("番号", 0)) + 1\nlog(f"  🔢 通し番号: {ctx[\'番号\']}")\n',
                    provides: '番号' } },
          { id: 'ck', type: 'click', title: '上から順にリンクを開く', x: 900, y: 340,
            data: { target: { strategy: 'css', selector: '.result-list .result-item a.title', index: 'loop' },
                    wait_after: 'load' } },
          { id: 'exT', type: 'extract', title: 'タイトルを入力欄から取得', x: 1180, y: 340,
            data: { target: t('input.title-field'), attr: 'value', var_name: 'タイトル',
                    trim: true, default_value: '無題' } },
          { id: 'md', type: 'mkdir', title: '「番号_タイトル」フォルダ作成', x: 1460, y: 340,
            data: { path: '{{番号}}_{{タイトル}}', var_name: 'folder' } },
          { id: 'lpD', type: 'loop', title: '契約書ファイルの数だけ', x: 60, y: 600,
            data: { mode: 'elements', elements_target: t('a[href$=".pdf"]'),
                    limit: 0, continue_on_error: true } },
          { id: 'dl', type: 'download', title: 'ファイルを順に保存', x: 340, y: 620,
            data: { target: { strategy: 'css', selector: 'a[href$=".pdf"]', index: 'loop' },
                    dir: '{{番号}}_{{タイトル}}', filename: '', var_name: 'last_download',
                    skip_existing: true, optional: true, timeout: 180 } },
          { id: 'exM', type: 'extract', title: '控えたい文言を取得', x: 620, y: 640,
            data: { target: t('.summary'), attr: 'text', var_name: '抜き書き',
                    trim: true, default_value: '' } },
          { id: 'memo', type: 'save_text', title: 'メモを同じフォルダへ', x: 900, y: 640,
            data: { dir: '{{番号}}_{{タイトル}}', filename: 'メモ.txt', mode: 'write', encoding: 'utf-8',
                    content: '番号: {{番号}}\nタイトル: {{タイトル}}\nURL: {{page_url}}\n取得日時: {{now}}\n--- 控え ---\n{{抜き書き}}' } },
          { id: 'bk', type: 'goto', title: '一覧ページへ戻る', x: 1180, y: 640,
            data: { mode: 'back', wait_until: 'load' } },
          { id: 'fin', type: 'log', title: '全ページ完了', x: 1460, y: 640,
            data: { message: '全ページの処理が終わりました。output フォルダと run_report.html を確認してください。' } }
        ],
        edges: [
          e('s1', 'h1'), e('h1', 'c1'), e('c1', 'in1'), e('in1', 'sel1'), e('sel1', 'c2'),
          e('c2', 'lpP'),
          e('lpP', 'lpE', 'body'),
          e('lpE', 'sn', 'body'), e('sn', 'ck'), e('ck', 'exT'), e('exT', 'md'), e('md', 'lpD'),
          e('lpD', 'dl', 'body'),
          e('lpD', 'exM', 'done'), e('exM', 'memo'), e('memo', 'bk'),
          e('lpP', 'fin', 'done')
        ]
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
