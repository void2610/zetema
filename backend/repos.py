"""リポジトリ候補: zetema と同じ階層（GitHub dir）配下の git リポジトリを列挙する。

ブランチ・コミット一覧も提供し、フロントの repo / diff 選択 UI に渡す。
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


def _base_dir() -> Path:
    """候補をスキャンする基準ディレクトリ。既定は zetema と同じ階層（このファイルの 2 つ上）。"""
    env = os.environ.get("ZETEMA_REPOS_DIR")
    if env:
        return Path(env).expanduser()
    return Path(__file__).resolve().parents[2]


def known_repos() -> list[dict]:
    """基準ディレクトリ直下で .git を持つサブディレクトリを名前順に返す。"""
    base = _base_dir()
    repos: list[dict] = []
    if not base.is_dir():
        return repos
    for child in sorted(base.iterdir(), key=lambda p: p.name.lower()):
        if child.is_dir() and (child / ".git").exists():
            repos.append({"name": child.name, "path": str(child)})
    return repos


def repo_branches(repo: Path) -> tuple[list[str], str | None]:
    branches = [b.strip() for b in _git(repo, ["branch", "--format=%(refname:short)"]).splitlines() if b.strip()]
    try:
        head = _git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).strip()
        default = head.split("/", 1)[-1] if head else None
    except RuntimeError:
        default = None
    return branches, default


def repo_commits(repo: Path, limit: int = 30) -> list[dict]:
    # NUL 区切りでフィールドを分け、subject 内の任意文字に対応する。
    fmt = "%H%x00%h%x00%s%x00%cr%x00%an"
    out = _git(repo, ["log", f"-n{limit}", f"--format={fmt}"])
    commits: list[dict] = []
    for line in out.splitlines():
        parts = line.split("\x00")
        if len(parts) != 5:
            continue
        h, short, subject, rel_date, author = parts
        commits.append({"hash": h, "short": short, "subject": subject, "rel_date": rel_date, "author": author})
    return commits


def _git(repo: Path, args: list[str]) -> str:
    proc = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} 失敗 (exit {proc.returncode}): {proc.stderr.strip()}")
    return proc.stdout
