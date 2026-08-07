#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Web Auto Move 実行環境（ローカルランナー）
==========================================

Web Auto Move（ブラウザで開くフロー編集画面）の「▶ 実行」ボタンから、
このPCで実際にスクレイピングを動かすための小さなサーバーです。

■ 使い方
    1. Python 3.8 以上を入れておく（https://www.python.org/）
    2. このファイルをダブルクリック、またはターミナルで
           python wam_runner.py
    3. 画面に表示される「接続コード」を、Web Auto Move の
       「▶ 実行」画面に入力して接続する

■ 仕組みと安全性
    - このサーバーは 127.0.0.1（このPCの中）だけで待ち受けます。
      外部のネットワークからは接続できません。
    - 実行の指示には毎回「接続コード」が必要です。コードを知らない
      Webページからは実行できません。
    - 実行結果は ホームフォルダ/WebAutoMove/ の下に保存されます。

標準ライブラリのみで動きます（スクレイピング本体には playwright が必要）。
"""

import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

VERSION = "1.2"
DEFAULT_PORT = 8765
APP_URL = "https://okadamasayuki.github.io/web-auto-move/"
BASE_DIR = Path.home() / "WebAutoMove"
STATE_DIR = BASE_DIR / "_state"               # ログイン状態など、実行をまたいで残すもの


def _load_or_make_token():
    """接続コードは一度作ったら使い回す。
    毎回変わると、ブラウザ側に保存した接続情報が無効になり、
    再起動のたびに入力し直しになってしまうため。"""
    f = STATE_DIR / "token.txt"
    try:
        if f.exists():
            t = f.read_text(encoding="utf-8").strip().upper()
            if re.fullmatch(r"[0-9A-F]{8}", t):
                return t
    except Exception:
        pass
    t = secrets.token_hex(4).upper()
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        f.write_text(t, encoding="utf-8")
        try:
            os.chmod(f, 0o600)
        except Exception:
            pass
    except Exception:
        pass
    return t


TOKEN = _load_or_make_token()                 # 8桁の接続コード

RUNS = {}          # run_id -> {proc, dir, log, name, started, lf}
LOCK = threading.Lock()


# ──────────────────────────────────────────────
#  ちょっとした道具
# ──────────────────────────────────────────────
def check_dep(mod):
    try:
        __import__(mod)
        return True
    except Exception:
        return False


def deps():
    return {
        "playwright": check_dep("playwright"),
        "docx": check_dep("docx"),
        "openpyxl": check_dep("openpyxl"),
    }


def safe_name(s):
    s = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", str(s)).strip().strip(".")
    return s[:60] or "flow"


def find_chrome():
    """普段使いの Google Chrome を探す。"""
    cands = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expanduser(r"~\AppData\Local\Google\Chrome\Application\chrome.exe"),
        "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium", "/usr/bin/chromium-browser",
    ]
    for c in cands:
        if c and os.path.exists(c):
            return c
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chrome"):
        p = shutil.which(name)
        if p:
            return p
    return None


def current_run_id():
    with LOCK:
        for rid, r in RUNS.items():
            if r["proc"].poll() is None:
                return rid
    return None


# ──────────────────────────────────────────────
#  HTTP サーバー
# ──────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    server_version = "WAMRunner/" + VERSION

    def log_message(self, *args):      # アクセスログは出さない（静かに）
        pass

    # --- 共通ヘッダ ---
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-WAM-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        # Chrome の Private Network Access 対応（HTTPSページ→localhost）
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _auth(self):
        tok = self.headers.get("X-WAM-Token") or \
            parse_qs(urlparse(self.path).query).get("token", [""])[0]
        return tok == TOKEN

    # --- ルーティング ---
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)

        if u.path == "/":
            # ここをブックマークしておけば、いつでもコード入力なしでつながる
            target = f"{APP_URL}#connect={TOKEN}&port={self.server.server_address[1]}"
            body = (
                '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">'
                '<title>Web Auto Move に接続しています…</title>'
                f'<meta http-equiv="refresh" content="0; url={target}">'
                '<style>body{font-family:sans-serif;text-align:center;margin-top:80px;color:#333}'
                'a{color:#4f46e5}</style></head><body>'
                '<h2>🕸️ Web Auto Move に接続しています…</h2>'
                f'<p>自動で移動しない場合は <a href="{target}">こちらをクリック</a></p>'
                '</body></html>'
            ).encode("utf-8")
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except Exception:
                pass
            return

        if u.path == "/status":
            # 接続確認用。秘密情報は含めない（トークン無しでも応答し、
            # トークンが合っているかだけ auth で返す）
            return self._json(200, {
                "ok": True, "app": "web-auto-move-runner", "version": VERSION,
                "python": sys.version.split()[0],
                "deps": deps(),
                "base_dir": str(BASE_DIR),
                "running": current_run_id(),
                "auth": self._auth(),
            })

        if u.path == "/logs":
            if not self._auth():
                return self._json(403, {"error": "接続コードが違います"})
            q = parse_qs(u.query)
            rid = q.get("run", [""])[0]
            offset = int(q.get("offset", ["0"])[0] or 0)
            r = RUNS.get(rid)
            if not r:
                return self._json(404, {"error": "その実行は見つかりません"})
            try:
                text = r["log"].read_bytes().decode("utf-8", "replace")
            except Exception:
                text = ""
            done = r["proc"].poll() is not None
            if done and r.get("lf"):
                try:
                    r["lf"].close()
                except Exception:
                    pass
                r["lf"] = None
            return self._json(200, {
                "text": text[offset:], "offset": len(text),
                "done": done, "returncode": r["proc"].returncode,
                "dir": str(r["dir"]), "output": str(r["dir"] / "output"),
            })

        if u.path.startswith("/report/"):
            # 実行レポートの配信。run_id（推測不能な乱数）が実質の鍵。
            parts = u.path.split("/", 3)
            rid = parts[2] if len(parts) > 2 else ""
            rest = unquote(parts[3]) if len(parts) > 3 and parts[3] else "run_report.html"
            r = RUNS.get(rid)
            if not r:
                return self._json(404, {"error": "その実行は見つかりません"})
            base = (r["dir"] / "output").resolve()
            target = (base / rest).resolve()
            if not str(target).startswith(str(base)) or not target.is_file():
                return self._json(404, {"error": "ファイルがありません"})
            ctype = {
                ".html": "text/html; charset=utf-8",
                ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
            }.get(target.suffix.lower(), "application/octet-stream")
            body = target.read_bytes()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except Exception:
                pass
            return

        return self._json(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        if not self._auth():
            return self._json(403, {"error": "接続コードが違います。実行環境の画面に表示されたコードを入力してください。"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
        except Exception:
            return self._json(400, {"error": "リクエストを読み取れませんでした"})

        if u.path == "/run":
            running = current_run_id()
            if running:
                return self._json(409, {"error": "別のフローを実行中です。停止してから実行してください。", "run": running})

            files = payload.get("files") or {}
            if "scraper.py" not in files:
                return self._json(400, {"error": "scraper.py がありません"})
            name = safe_name(payload.get("name") or "flow")

            rid = secrets.token_hex(8)
            run_dir = BASE_DIR / (datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + name)
            run_dir.mkdir(parents=True, exist_ok=True)
            for fname, content in files.items():
                (run_dir / safe_name(fname)).write_text(str(content), encoding="utf-8")

            log_path = run_dir / "runner_log.txt"
            lf = open(log_path, "wb")
            env = dict(os.environ)
            env["PYTHONIOENCODING"] = "utf-8"
            env["PYTHONUNBUFFERED"] = "1"
            # ログイン状態は実行ごとのフォルダではなく、共通の場所に残す
            # （毎回ログインし直しにならないように）
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            env["WAM_STATE_DIR"] = str(STATE_DIR)
            try:
                proc = subprocess.Popen(
                    [sys.executable, "scraper.py"],
                    cwd=str(run_dir),
                    stdout=lf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                    env=env,
                )
            except Exception as ex:
                lf.close()
                return self._json(500, {"error": "起動に失敗しました: " + str(ex)})

            with LOCK:
                RUNS[rid] = {"proc": proc, "dir": run_dir, "log": log_path,
                             "name": name, "started": time.time(), "lf": lf}
            print(f"▶ 実行開始: {name}  →  {run_dir}")
            return self._json(200, {"run": rid, "dir": str(run_dir),
                                    "output": str(run_dir / "output")})

        if u.path == "/launch-chrome":
            # 普段使いの Chrome を「つなげる状態」で開く。
            # Playwright が起動したブラウザではないので、Google 等のログイン制限を受けない。
            port = int(payload.get("port") or 9222)
            prof = STATE_DIR / "chrome-profile"
            prof.mkdir(parents=True, exist_ok=True)
            exe = find_chrome()
            if not exe:
                return self._json(404, {
                    "error": "Google Chrome が見つかりませんでした。インストールしてから、もう一度お試しください。"})
            try:
                subprocess.Popen(
                    [exe, f"--remote-debugging-port={port}",
                     f"--user-data-dir={prof}",
                     "--no-first-run", "--no-default-browser-check",
                     "about:blank"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    stdin=subprocess.DEVNULL)
            except Exception as ex:
                return self._json(500, {"error": "Chrome を起動できませんでした: " + str(ex)})
            print(f"🌐 ログイン用の Chrome を開きました（ポート {port}）")
            return self._json(200, {"ok": True, "port": port, "profile": str(prof), "exe": exe})

        if u.path == "/stop":
            r = RUNS.get(payload.get("run") or "")
            if not r:
                return self._json(404, {"error": "その実行は見つかりません"})
            if r["proc"].poll() is None:
                try:
                    r["proc"].terminate()
                except Exception:
                    pass
            print("⏹ 停止要求を受け付けました")
            return self._json(200, {"ok": True})

        return self._json(404, {"error": "not found"})


# ──────────────────────────────────────────────
#  起動
# ──────────────────────────────────────────────
def offer_playwright_install():
    if check_dep("playwright"):
        return
    print("⚠ playwright がまだ入っていません（スクレイピングの実行に必要です）。")
    try:
        ans = input("   いまインストールしますか？ [y/N]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        ans = ""
    if ans == "y":
        subprocess.call([sys.executable, "-m", "pip", "install", "playwright", "python-docx", "openpyxl"])
        subprocess.call([sys.executable, "-m", "playwright", "install", "chromium"])
    else:
        print("   あとで入れる場合:  pip install playwright && python -m playwright install chromium")


def main():
    global APP_URL
    port = DEFAULT_PORT
    auto_open = True
    for i, a in enumerate(sys.argv):
        if a == "--port" and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
        elif a == "--url" and i + 1 < len(sys.argv):
            APP_URL = sys.argv[i + 1]
        elif a == "--no-open":
            auto_open = False
    app_url = APP_URL

    BASE_DIR.mkdir(parents=True, exist_ok=True)
    offer_playwright_install()

    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError:
        print(f"⛔ ポート {port} が使用中です。別のポートで起動します…")
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        port = server.server_address[1]

    # 接続用リンク。#以降はサーバーに送られないので、コードが外に漏れることはない
    connect_url = f"{app_url}#connect={TOKEN}&port={port}"

    # コードを見失っても大丈夫なように、ファイルにも残しておく
    try:
        here = Path(__file__).resolve().parent
        (here / "接続コード.txt").write_text(
            "Web Auto Move 実行環境\n\n"
            f"接続コード : {TOKEN}\n"
            f"アドレス   : http://127.0.0.1:{port}\n\n"
            "この画面を閉じてしまった場合は、下のリンクをブラウザで開くと\n"
            "自動で接続されます（コードの入力は不要です）。\n\n"
            f"{connect_url}\n",
            encoding="utf-8")
    except Exception:
        pass

    d = deps()
    print()
    print("=" * 60)
    print("  🕸️  Web Auto Move 実行環境が起動しました")
    print("=" * 60)
    print()
    print("     接 続 コ ー ド :   " + "  ".join(TOKEN))
    print()
    print("-" * 60)
    print(f"  ★ かんたん接続 : http://127.0.0.1:{port}")
    print("     （ここをブックマークしておけば、コード入力は一切不要です）")
    print(f"  保存先     : {BASE_DIR}")
    print(f"  playwright : {'OK' if d['playwright'] else '未インストール'}"
          f" / Word出力: {'OK' if d['docx'] else '－'}"
          f" / Excel出力: {'OK' if d['openpyxl'] else '－'}")
    print("-" * 60)
    if auto_open:
        print("  ブラウザを開いて自動で接続します。")
        print("  （開かない場合は、上の接続コードを画面に入力してください）")
    else:
        print("  Web Auto Move の「▶ 実行」画面で、上の接続コードを入力してください。")
    print()
    print("  ★ この黒い画面は閉じないでください（閉じると実行できません）")
    print("     終了するときは Ctrl+C を押してください。")
    print("=" * 60)
    print()

    if auto_open:
        threading.Timer(1.0, lambda: webbrowser.open(connect_url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n終了します。実行中のフローがあれば止めます…")
        with LOCK:
            for r in RUNS.values():
                if r["proc"].poll() is None:
                    try:
                        r["proc"].terminate()
                    except Exception:
                        pass


if __name__ == "__main__":
    main()
