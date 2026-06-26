"""常駐 claude セッション（loop の RoleSession 型）と stream-json パーサ。

副作用のない parse_event / iter_turn はテスト対象。ClaudeSession は subprocess を持つ薄いラッパ。"""

from __future__ import annotations

import json
import subprocess
import threading
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path

WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"]
READ_TOOLS = ["Read", "Grep", "Glob"]


def user_msg(text: str) -> str:
    """stream-json 入力の user メッセージ 1 行。"""
    return json.dumps(
        {"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": text}]}},
        ensure_ascii=False,
    )


def parse_event(line: str) -> list[tuple[str, object]]:
    """NDJSON 1 行を表示イベント列に畳む。

    返り値の要素は ("delta", str) / ("thinking", str) / ("result", dict)。
    解釈できない行は空リスト。
    """
    line = line.strip()
    if not line:
        return []
    try:
        o = json.loads(line)
    except json.JSONDecodeError:
        return []
    if not isinstance(o, dict):
        return []
    t = o.get("type")
    if t == "stream_event":
        ev = o.get("event", {})
        if ev.get("type") == "content_block_delta":
            d = ev.get("delta", {})
            if d.get("type") == "text_delta":
                return [("delta", d.get("text", ""))]
            if d.get("type") == "thinking_delta":
                return [("thinking", d.get("thinking", ""))]
        return []
    if t == "result":
        return [("result", o)]
    return []


def iter_turn(lines: Iterable[str]) -> Iterator[tuple[str, object]]:
    """行イテレータを表示イベント列へ変換し、result で打ち切る。"""
    for line in lines:
        for ev in parse_event(line):
            yield ev
            if ev[0] == "result":
                return


class ClaudeSession:
    """常駐 claude セッション。stream-json 双方向 IO で send → read を繰り返す。

    turn() は lock で直列化されるため、同時 /ask は順に処理される（仕様: 常駐 1 本・直列）。"""

    def __init__(self, cwd: Path, model: str, system_prompt: str, transcript_path: Path | None = None):
        cmd = [
            "claude",
            "-p",
            "--append-system-prompt",
            system_prompt,
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--allowedTools",
            *READ_TOOLS,
            "--disallowedTools",
            *WRITE_TOOLS,
            "--model",
            model,
        ]
        self.proc = subprocess.Popen(
            cmd, cwd=str(cwd), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1,
        )
        self.lock = threading.Lock()
        self._closed = False
        self._sf = transcript_path.open("w", encoding="utf-8") if transcript_path else None

    def _send(self, text: str) -> None:
        if self.proc.stdin and not self.proc.stdin.closed:
            self.proc.stdin.write(user_msg(text) + "\n")
            self.proc.stdin.flush()

    def turn(self, text: str, on_delta: Callable[[str], None]) -> dict | None:
        """user メッセージを送り、次の result まで読む。delta を on_delta へ。result dict を返す。"""
        with self.lock:
            if self.proc.stdout is None:
                return None
            self._send(text)
            for line in self.proc.stdout:
                if self._sf:
                    self._sf.write(line)
                    self._sf.flush()
                for kind, payload in parse_event(line):
                    if kind == "delta":
                        on_delta(payload)  # type: ignore[arg-type]
                    elif kind == "result":
                        return payload  # type: ignore[return-value]
            return None

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            if self.proc.stdin and not self.proc.stdin.closed:
                self.proc.stdin.close()
            self.proc.wait(timeout=30)
        except (OSError, subprocess.TimeoutExpired):
            self.proc.kill()
        if self._sf:
            self._sf.close()
