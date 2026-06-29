# /// script
# requires-python = ">=3.12"
# dependencies = ["fastapi", "uvicorn[standard]"]
# ///
"""Zetema backend。

対象 repo と diff（git リビジョン範囲）はフロントから切り替えられる。切り替え時は新しい diff で
常駐 claude セッションを張り直し、diff でウォームアップする。/ask は現在のセッションへ選択範囲を
送り、回答を SSE で逐次転送する。

使い方:
    uv run server.py [--repo /path/to/repo] [-- <git diff に渡す引数...>]
    --repo を省略して起動し、後からフロントで設定することもできる。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shlex
import threading
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from claude_session import ClaudeSession
from diffsource import git_diff
from prompts import FIXED_SYSTEM_PROMPT, WARMUP_TEMPLATE, render_selection
from repos import known_repos, repo_branches, repo_commits

# 起動後はフロントからの切り替えで更新される共有状態。SOURCE_LOCK で切り替えを直列化する。
STATE: dict = {
    "repo": None,
    "rev_range": [],
    "diff": "",
    "session": None,
    "model": "sonnet",
    "warmed": threading.Event(),
}
SOURCE_LOCK = threading.Lock()

SSE_HEADERS = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}


def sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _warm(sess: ClaudeSession, diff: str) -> None:
    """diff 全体を投入してセッションをウォームアップ。最新セッションのときだけ warmed を立てる。"""
    sess.turn(WARMUP_TEMPLATE.format(diff=diff or "(diff は空です)"), on_delta=lambda _t: None)
    if STATE["session"] is sess:
        STATE["warmed"].set()


def set_source(repo: Path, rev_range: list[str]) -> str:
    """対象を切り替える。新しい diff を取得し、claude セッションを張り直してウォームアップする。

    git diff に失敗した場合（git repo でない等）は RuntimeError を送出する（セッションは作らない）。
    """
    with SOURCE_LOCK:
        diff = git_diff(repo, rev_range)  # 不正な repo/引数はここで RuntimeError
        sess = ClaudeSession(cwd=repo, model=STATE["model"], system_prompt=FIXED_SYSTEM_PROMPT)
        old = STATE["session"]
        STATE["warmed"].clear()
        STATE["session"] = sess
        STATE["repo"] = repo
        STATE["rev_range"] = rev_range
        STATE["diff"] = diff
        if old is not None:
            old.close()
        threading.Thread(target=_warm, args=(sess, diff), daemon=True).start()
        return diff


def make_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/source")
    async def get_source():
        return JSONResponse(
            {
                "repo": str(STATE["repo"] or ""),
                "rev_range": shlex.join(STATE["rev_range"]),
                "diff": STATE["diff"],
                "warmed": STATE["warmed"].is_set(),
            }
        )

    @app.post("/api/source")
    async def post_source(req: Request):
        body = await req.json()
        repo_s = (body.get("repo") or "").strip()
        rev_s = (body.get("rev_range") or "").strip()
        if not repo_s:
            return JSONResponse({"error": "repo は必須です"}, status_code=400)
        repo = Path(repo_s).expanduser()
        if not repo.is_dir():
            return JSONResponse({"error": f"ディレクトリが存在しません: {repo}"}, status_code=400)
        repo = repo.resolve()
        try:
            rev = shlex.split(rev_s)
        except ValueError as e:
            return JSONResponse({"error": f"diff 引数の解釈に失敗しました: {e}"}, status_code=400)
        try:
            diff = set_source(repo, rev)
        except RuntimeError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        return JSONResponse(
            {"repo": str(repo), "rev_range": shlex.join(rev), "diff": diff, "warmed": False}
        )

    @app.get("/api/warmed")
    async def get_warmed():
        return JSONResponse({"warmed": STATE["warmed"].is_set()})

    @app.get("/api/repos")
    async def get_repos():
        return JSONResponse({"repos": known_repos()})

    @app.get("/api/branches")
    async def get_branches(repo: str = ""):
        p = Path(repo).expanduser()
        if not repo or not p.is_dir():
            return JSONResponse({"error": "repo ディレクトリが不正です"}, status_code=400)
        try:
            branches, default = repo_branches(p.resolve())
        except RuntimeError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        return JSONResponse({"branches": branches, "default": default})

    @app.get("/api/commits")
    async def get_commits(repo: str = "", limit: int = 30):
        p = Path(repo).expanduser()
        if not repo or not p.is_dir():
            return JSONResponse({"error": "repo ディレクトリが不正です"}, status_code=400)
        try:
            commits = repo_commits(p.resolve(), limit)
        except RuntimeError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        return JSONResponse({"commits": commits})

    @app.post("/ask")
    async def ask(req: Request):
        body = await req.json()
        file = body.get("file", "")
        rng = body.get("range") or {}
        selected_diff = body.get("selected_diff", "")
        if not selected_diff:
            return JSONResponse({"error": "selected_diff is required"}, status_code=400)
        session: ClaudeSession | None = STATE["session"]
        if session is None:
            return JSONResponse({"error": "対象ソースが未設定です"}, status_code=400)
        msg = render_selection(file, int(rng.get("start", 0)), int(rng.get("end", 0)), selected_diff)

        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def worker():
            def on_delta(text: str):
                loop.call_soon_threadsafe(queue.put_nowait, ("delta", text))

            try:
                result = session.turn(msg, on_delta)
                loop.call_soon_threadsafe(queue.put_nowait, ("done", result))
            except Exception as e:  # noqa: BLE001 - クライアントへ error イベントで返す
                loop.call_soon_threadsafe(queue.put_nowait, ("error", str(e)))

        threading.Thread(target=worker, daemon=True).start()

        async def gen():
            while True:
                kind, payload = await queue.get()
                if kind == "delta":
                    yield sse("delta", {"text": payload})
                elif kind == "done":
                    is_error = bool(payload and payload.get("is_error"))
                    if is_error:
                        yield sse("error", {"message": "claude returned error", "exit_code": None})
                    else:
                        yield sse("done", {"result": (payload or {}).get("result", "")})
                    return
                elif kind == "error":
                    yield sse("error", {"message": payload, "exit_code": None})
                    return

        return StreamingResponse(gen(), media_type="text/event-stream", headers=SSE_HEADERS)

    return app


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", type=Path, help="初期の対象 git リポジトリ（省略可。後からフロントで設定可）")
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("rev_range", nargs="*", help="初期 diff の git 引数（例: HEAD~1 / --staged）")
    args = ap.parse_args()

    STATE["model"] = args.model
    if args.repo is not None:
        try:
            set_source(args.repo.expanduser().resolve(), args.rev_range)
        except RuntimeError as e:
            print(f"[warn] 初期ソースの設定に失敗しました（フロントから設定してください）: {e}")

    app = make_app()
    try:
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    finally:
        if STATE["session"] is not None:
            STATE["session"].close()


if __name__ == "__main__":
    main()
