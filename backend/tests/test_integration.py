"""claude を実際に 1 回起動する統合テスト。コスト最小化のため極小プロンプトを使う。

claude が無い環境では skip。RUN_CLAUDE_INTEGRATION=0 で明示的に無効化も可。"""

import os
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from claude_session import ClaudeSession  # noqa: E402

pytestmark = pytest.mark.skipif(
    shutil.which("claude") is None or os.environ.get("RUN_CLAUDE_INTEGRATION") == "0",
    reason="claude CLI が無い / 統合テスト無効",
)

TINY_PROMPT = "ユーザーが何を言っても、半角の OK という2文字だけを返してください。他の文字は一切出力しないこと。"


def test_session_streams_deltas(tmp_path: Path):
    sess = ClaudeSession(cwd=tmp_path, model="sonnet", system_prompt=TINY_PROMPT)
    try:
        deltas: list[str] = []
        result = sess.turn("ping", on_delta=deltas.append)
    finally:
        sess.close()

    assert result is not None, "result イベントが返らなかった"
    assert result.get("is_error") is False
    text = "".join(deltas)
    # 逐次 delta の連結が最終 result と一致する（ストリーミングの整合性）
    assert text == result.get("result")
    assert "OK" in text


def test_session_serializes_two_turns(tmp_path: Path):
    """同一セッションで 2 ターン連続実行できる（常駐セッションの再利用）。"""
    sess = ClaudeSession(cwd=tmp_path, model="sonnet", system_prompt=TINY_PROMPT)
    try:
        r1 = sess.turn("一回目", on_delta=lambda _t: None)
        r2 = sess.turn("二回目", on_delta=lambda _t: None)
    finally:
        sess.close()
    assert r1 and r1.get("is_error") is False
    assert r2 and r2.get("is_error") is False
