"""diff source: 起動引数で指定した git リビジョン範囲から unified diff を取得する。"""

from __future__ import annotations

import subprocess
from pathlib import Path


def git_diff(repo: Path, rev_range: list[str]) -> str:
    """`git diff <rev_range...>` を実行して unified diff を返す。

    rev_range は git diff に渡す引数列（例: [] / ["HEAD~1"] / ["--staged"] / ["main", "feature"]）。
    """
    cmd = ["git", "-C", str(repo), "diff", *rev_range]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"git diff 失敗 (exit {proc.returncode}): {proc.stderr.strip()}")
    return proc.stdout
