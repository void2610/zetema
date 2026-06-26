# Zetema

ローカルの git diff を Web UI に表示し、diff の行範囲をマウスで選択するだけで、その範囲についての固定の質問がローカルの Claude Code (`claude -p`) に送られ、回答が同じ UI 上にストリーム表示されるツール。

> **Zetema**（ζήτημα, *zetema* / 「ゼテーマ」）— ギリシア語で「テキストの一節について立てて探究する問い」。古代の *zetemata* 文献（Homeric Zetemata 等）は本文の難所を問答形式で究明する学術ジャンルだった。本ツールでは「行を選択する＝その箇所への問いを発する」操作がまさに zetema にあたる。

詳細仕様は [SPEC.md](./SPEC.md) を参照。

## 構成

```
backend/   FastAPI + 常駐 claude セッション（stream-json → SSE 変換）
web/       Next.js + react-diff-view（diff 描画・行選択・SSE 受信）
```

- 起動時に backend が対象 repo の `git diff` を取得し、claude セッションを 1 本常駐起動して diff でウォームアップする。
- ブラウザで diff の行範囲をドラッグ選択（または単一行クリック）すると、その箇所が常駐セッションへ送られ、回答が選択に紐づくパネルへ逐次表示される。
- 自由プロンプト入力は無い。入力チャネルは行範囲選択のみ。固定プロンプトは backend の `--append-system-prompt` に保持され、クライアントからは不可視・変更不可。

## 必要環境

- `claude`（Claude Code CLI）にログイン済み
- `uv`（Python 3.12+）
- `node` / `pnpm`

## 起動

### 1. バックエンド

```sh
cd backend
uv run server.py --repo /path/to/target-repo            # working tree の diff
uv run server.py --repo /path/to/target-repo -- HEAD~1  # HEAD~1 との diff
uv run server.py --repo /path/to/target-repo -- --staged # ステージ済みの diff
```

`--port`（既定 8765）/ `--model`（既定 sonnet）も指定可。`--` 以降は `git diff` にそのまま渡す引数。

### 2. フロントエンド

```sh
cd web
pnpm install
pnpm dev            # http://localhost:3000
```

backend が 8765 以外の場合は `NEXT_PUBLIC_API_BASE` で指す:

```sh
NEXT_PUBLIC_API_BASE=http://127.0.0.1:9000 pnpm dev
```

## テスト

バックエンドのテスト（パーサ・git diff の単体 + claude 実起動の統合）:

```sh
cd backend
uv run --with fastapi --with 'uvicorn[standard]' --with pytest pytest tests -v
```

統合テストは `claude` を実際に起動する。無い環境では自動 skip。`RUN_CLAUDE_INTEGRATION=0` で明示無効化。

## データ契約

- `GET /api/diff` → `{ "diff": "<unified diff>", "warmed": <bool> }`
- `POST /ask` `{ file, range: {start, end}, selected_diff }` → SSE
  - `event: delta` … `{ "text": "..." }`（逐次）
  - `event: done` … `{ "result": "..." }`
  - `event: error` … `{ "message": "...", "exit_code": ... }`
</content>
