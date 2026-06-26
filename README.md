# Zetema

ローカルの git diff を Web UI に表示し、diff の行範囲をマウスで選択するだけで、その範囲についての固定の質問がローカルの Claude Code (`claude -p`) に送られ、回答が同じ UI 上にストリーム表示されるツール。

> **Zetema**（ζήτημα, *zetema* / 「ゼテーマ」）— ギリシア語で「テキストの一節について立てて探究する問い」。古代の *zetemata* 文献（Homeric Zetemata 等）は本文の難所を問答形式で究明する学術ジャンルだった。本ツールでは「行を選択する＝その箇所への問いを発する」操作がまさに zetema にあたる。

詳細仕様は [SPEC.md](./SPEC.md) を参照。

## 構成

```
backend/   FastAPI + 常駐 claude セッション（stream-json → SSE 変換）
web/       Next.js + 自前 diff レンダラ（diff 描画・行選択・SSE 受信）
```

- 対象 repo と diff（git リビジョン範囲）は **フロントの上部バーから切り替え**られる。切り替えるたびに backend は新しい `git diff` を取得し、claude セッションを張り直して diff でウォームアップする。
- ブラウザで diff の行範囲をドラッグ選択（または単一行クリック）すると、その箇所が常駐セッションへ送られ、回答が選択に紐づくパネルへ逐次表示される。
- 役割は「レビュアーを補佐する秘書」。差分の目的・動作を中立的に解説し、評価や意思決定はしない。
- 自由プロンプト入力は無い。入力チャネルは行範囲選択のみ。固定プロンプトは backend の `--append-system-prompt` に保持され、クライアントからは不可視・変更不可。

## 必要環境

- `claude`（Claude Code CLI）にログイン済み
- `uv`（Python 3.12+）
- `node` / `pnpm`

## 起動

フロントだけで完結する。**backend は Next 起動時に自動で立ち上がる**ため、手動起動は不要。

```sh
cd web
pnpm install
pnpm dev            # http://localhost:3000（backend も自動起動）
```

ブラウザを開き、上部バーに対象リポジトリのパスを入力して「適用」するだけ。`uv` が PATH に通っている必要がある（Next が `uv run server.py` を spawn するため）。

<details>
<summary>backend を手動で起動したい場合</summary>

別ポートや初期 repo を指定したい場合は手動起動も可能（その場合フロントは spawn をスキップする）:

```sh
cd backend
uv run server.py                                        # repo はフロントで設定
uv run server.py --repo /path/to/target-repo            # 初期 repo を指定
uv run server.py --repo /path/to/target-repo -- HEAD~1  # 初期 diff を HEAD~1 に
```

`--repo` は省略可。`--port`（既定 8765）/ `--model`（既定 sonnet）も指定可。`--` 以降は初期 diff の `git diff` 引数。
backend が 8765 以外なら `NEXT_PUBLIC_API_BASE=http://127.0.0.1:9000 pnpm dev` で指す。
</details>

## テスト

バックエンドのテスト（パーサ・git diff の単体 + claude 実起動の統合）:

```sh
cd backend
uv run --with fastapi --with 'uvicorn[standard]' --with httpx --with pytest pytest tests -v
```

（`just test` でも可。）統合テストは `claude` を実際に起動する。無い環境では自動 skip。`RUN_CLAUDE_INTEGRATION=0` で明示無効化。

## データ契約

- `GET /api/source` → `{ repo, rev_range, diff, warmed }`（現在の対象）
- `POST /api/source` `{ repo, rev_range }` → 対象を切り替え `{ repo, rev_range, diff, warmed:false }` / 失敗時 `400 { error }`
- `GET /api/warmed` → `{ warmed }`（ウォームアップ完了のポーリング用）
- `POST /ask` `{ file, range: {start, end}, selected_diff }` → SSE
  - `event: delta` … `{ "text": "..." }`（逐次）
  - `event: done` … `{ "result": "..." }`
  - `event: error` … `{ "message": "...", "exit_code": ... }`
