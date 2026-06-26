"""git diff 取得の単体テスト（一時 git repo を作って検証、claude 不要）。"""

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from diffsource import git_diff  # noqa: E402


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


def _init_repo(repo: Path) -> None:
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t")
    _git(repo, "config", "user.name", "t")


def test_working_tree_diff(tmp_path: Path):
    repo = tmp_path / "r"
    repo.mkdir()
    _init_repo(repo)
    f = repo / "a.txt"
    f.write_text("line1\nline2\n")
    _git(repo, "add", "a.txt")
    _git(repo, "commit", "-qm", "init")
    f.write_text("line1\nCHANGED\n")

    diff = git_diff(repo, [])
    assert "a.txt" in diff
    assert "-line2" in diff
    assert "+CHANGED" in diff


def test_staged_diff(tmp_path: Path):
    repo = tmp_path / "r"
    repo.mkdir()
    _init_repo(repo)
    f = repo / "a.txt"
    f.write_text("x\n")
    _git(repo, "add", "a.txt")
    _git(repo, "commit", "-qm", "init")
    f.write_text("y\n")
    _git(repo, "add", "a.txt")

    assert git_diff(repo, []) == ""  # working tree はクリーン
    assert "+y" in git_diff(repo, ["--staged"])


def test_rev_range(tmp_path: Path):
    repo = tmp_path / "r"
    repo.mkdir()
    _init_repo(repo)
    f = repo / "a.txt"
    f.write_text("v1\n")
    _git(repo, "add", "a.txt")
    _git(repo, "commit", "-qm", "c1")
    f.write_text("v2\n")
    _git(repo, "add", "a.txt")
    _git(repo, "commit", "-qm", "c2")

    diff = git_diff(repo, ["HEAD~1"])
    assert "-v1" in diff
    assert "+v2" in diff
