# /// script
# requires-python = ">=3.12"
# dependencies = ["fastapi", "uvicorn[standard]"]
# ///
"""Zetema backend。

起動時に対象 repo の git diff を取得し、常駐 claude セッションを 1 本立ち上げて diff で
ウォームアップする。/ask で受けた選択範囲を同じセッションへ送り、回答を SSE で逐次転送する。

使い方:
    uv run server.py --repo /path/to/repo [-- <git diff に渡す引数...>]
    例: uv run server.py --repo ~/proj -- HEAD~1
        uv run server.py --repo ~/proj -- --staged
"""

from __future__ import annotations

import argparse
import asyncio
import json
import threading
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from claude_session import ClaudeSession
from diffsource import git_diff
from prompts import FIXED_SYSTEM_PROMPT, WARMUP_TEMPLATE, render_selection

# 起動時に確定し、以降は読み取り専用で共有する状態（ステートレス API・常駐 1 セッション）。
STATE: dict = {"diff": "", "session": None, "warmed": threading.Event()}

SSE_HEADERS = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}


def sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def make_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/diff")
    async def get_diff():
        return JSONResponse({"diff": STATE["diff"], "warmed": STATE["warmed"].is_set()})

    @app.post("/ask")
    async def ask(req: Request):
        body = await req.json()
        file = body.get("file", "")
        rng = body.get("range") or {}
        selected_diff = body.get("selected_diff", "")
        if not selected_diff:
            return JSONResponse({"error": "selected_diff is required"}, status_code=400)
        msg = render_selection(file, int(rng.get("start", 0)), int(rng.get("end", 0)), selected_diff)

        session: ClaudeSession = STATE["session"]
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


def warmup(session: ClaudeSession, diff: str) -> None:
    """diff 全体を投入してセッションをウォームアップ（最初のターンを消費）。"""
    session.turn(WARMUP_TEMPLATE.format(diff=diff or "(diff は空です)"), on_delta=lambda _t: None)
    STATE["warmed"].set()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, type=Path, help="対象 git リポジトリのパス")
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("rev_range", nargs="*", help="git diff に渡す引数（例: HEAD~1 / --staged）")
    args = ap.parse_args()

    repo = args.repo.expanduser().resolve()
    STATE["diff"] = git_diff(repo, args.rev_range)
    session = ClaudeSession(cwd=repo, model=args.model, system_prompt=FIXED_SYSTEM_PROMPT)
    STATE["session"] = session
    # ウォームアップはバックグラウンドで。/ask は session.lock により完了まで待たされる。
    threading.Thread(target=warmup, args=(session, STATE["diff"]), daemon=True).start()

    app = make_app()
    try:
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    finally:
        session.close()


if __name__ == "__main__":
    main()
