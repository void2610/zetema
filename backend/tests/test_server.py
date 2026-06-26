"""source 切り替え API のバリデーション経路テスト（claude 不要。不正系は session を作らない）。"""

import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402

client = TestClient(server.make_app())


def test_get_source_initial():
    r = client.get("/api/source")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"repo", "rev_range", "diff", "warmed"}


def test_post_source_requires_repo():
    r = client.post("/api/source", json={"repo": "", "rev_range": ""})
    assert r.status_code == 400
    assert "repo" in r.json()["error"]


def test_post_source_missing_dir():
    r = client.post("/api/source", json={"repo": "/no/such/dir/zzz", "rev_range": ""})
    assert r.status_code == 400
    assert "ディレクトリ" in r.json()["error"]


def test_post_source_non_git_dir(tmp_path: Path):
    r = client.post("/api/source", json={"repo": str(tmp_path), "rev_range": ""})
    assert r.status_code == 400
    assert "git diff" in r.json()["error"]


def test_ask_without_session():
    # session 未設定状態（不正系テストのみ実行されている前提）で /ask は 400。
    if server.STATE["session"] is not None:
        return
    r = client.post(
        "/ask", json={"file": "a", "range": {"start": 1, "end": 1}, "selected_diff": "x"}
    )
    assert r.status_code == 400


def test_warmed_endpoint():
    r = client.get("/api/warmed")
    assert r.status_code == 200
    assert "warmed" in r.json()
