"""stream-json パーサの単体テスト（subprocess 不要）。"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from claude_session import iter_turn, parse_event, user_msg  # noqa: E402


def test_user_msg_shape():
    o = json.loads(user_msg("こんにちは"))
    assert o["type"] == "user"
    assert o["message"]["role"] == "user"
    assert o["message"]["content"][0]["text"] == "こんにちは"


def test_parse_text_delta():
    line = json.dumps(
        {"type": "stream_event", "event": {"type": "content_block_delta", "index": 0,
         "delta": {"type": "text_delta", "text": "hello"}}}
    )
    assert parse_event(line) == [("delta", "hello")]


def test_parse_thinking_delta():
    line = json.dumps(
        {"type": "stream_event", "event": {"type": "content_block_delta",
         "delta": {"type": "thinking_delta", "thinking": "考え中"}}}
    )
    assert parse_event(line) == [("thinking", "考え中")]


def test_parse_result():
    line = json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": "done"})
    evs = parse_event(line)
    assert evs[0][0] == "result"
    assert evs[0][1]["result"] == "done"


def test_parse_ignores_noise():
    assert parse_event("") == []
    assert parse_event("not json") == []
    assert parse_event(json.dumps({"type": "system", "subtype": "init"})) == []
    assert parse_event(json.dumps({"type": "stream_event", "event": {"type": "message_start"}})) == []


def test_iter_turn_stops_at_result():
    lines = [
        json.dumps({"type": "system", "subtype": "init"}),
        json.dumps({"type": "stream_event", "event": {"type": "content_block_delta",
                    "delta": {"type": "text_delta", "text": "a"}}}),
        json.dumps({"type": "stream_event", "event": {"type": "content_block_delta",
                    "delta": {"type": "text_delta", "text": "b"}}}),
        json.dumps({"type": "result", "is_error": False, "result": "ab"}),
        json.dumps({"type": "stream_event", "event": {"type": "content_block_delta",
                    "delta": {"type": "text_delta", "text": "SHOULD_NOT_APPEAR"}}}),
    ]
    out = list(iter_turn(lines))
    assert [e for e in out if e[0] == "delta"] == [("delta", "a"), ("delta", "b")]
    assert out[-1][0] == "result"
    assert all(e[1] != "SHOULD_NOT_APPEAR" for e in out)


def test_full_reassembly():
    """delta を連結すると result.result と一致する。"""
    lines = [
        json.dumps({"type": "stream_event", "event": {"type": "content_block_delta",
                    "delta": {"type": "text_delta", "text": "hello"}}}),
        json.dumps({"type": "stream_event", "event": {"type": "content_block_delta",
                    "delta": {"type": "text_delta", "text": " world"}}}),
        json.dumps({"type": "result", "is_error": False, "result": "hello world"}),
    ]
    deltas, result = [], None
    for kind, payload in iter_turn(lines):
        if kind == "delta":
            deltas.append(payload)
        elif kind == "result":
            result = payload
    assert "".join(deltas) == result["result"]
