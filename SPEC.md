# Zetema 仕様書

## 1. 概要

ローカルの git diff を Web UI に表示し、diff の行範囲を選択するだけで、その範囲についての固定の質問がローカルの Claude Code (`claude -p`) に送られ、回答が同じ UI 上にストリーム表示されるツール。

## 2. 不変条件

- 自由プロンプト入力は存在しない。ユーザーの入力チャネルは diff の範囲選択のみ。
- 固定プロンプトはサーバ側（`--append-system-prompt`）に保持し、クライアントから変更・送信できない。
- ローカル完結。Claude 呼び出しは `claude` CLI のみを使用し、Agent SDK は使わない。
- セッションは起動ごとに作られる。起動時にclaudecodeがdiffを裏で読み込み始める想定

## 3. インタラクション

1. 起動時に diff source を引数指定して立ち上げる。
2. ブラウザで diff を閲覧する。
3. 行範囲を選択し、確定すると質問が自動送信される。
4. 選択箇所に紐づくパネルに、回答が逐次ストリーム表示される。

## 4. 構成

```
起動時：backend が claude セッションを 1 本常駐起動し、diff 全体を投入してウォームアップ

Browser（diff 描画 + 範囲選択のみ、自由入力欄なし）
   │  POST /ask { file, range, selected_diff }
   │  ← レスポンスは SSE（text delta を逐次）
   ▼
ローカル backend（薄いブリッジ）
   │  固定プロンプトを保持（クライアントからは不可視・変更不可）
   │  常駐セッションの stdin に選択行を user メッセージとして送信
   ▼
claude -p（常駐, stream-json 双方向）  →  NDJSON を逐次出力
   │  diff 全体は既に文脈にあり、Read で周辺コードも参照可
   │  backend がイベントをパースし text delta を SSE へ転送
   ▼
Browser が選択範囲に紐づくパネルへ回答を描画
```

- フロントエンド：diff パーサ + 行選択 UI + SSE クライアント。 Next.js, tailwindcss, shadcn.ui を想定
- バックエンド：`/ask` 1エンドポイント + 常駐 `claude` セッションへの送信 + stream-json → SSE 変換。
- 常駐セッション 1 本（loop の `RoleSession` 型）。起動時に diff でウォームアップし、各選択は同一会話の追加ターンとして直列処理する（回答間で会話文脈を共有）。

## 5. Claude Code 呼び出し

起動時に**常駐セッションを 1 本** spawn し、stream-json 双方向 IO で運用する（loop の `RoleSession` 型）。

```sh
claude -p \
  --append-system-prompt "$FIXED_PROMPT" \
  --input-format stream-json \
  --output-format stream-json --verbose --include-partial-messages \
  --allowedTools Read --disallowedTools Write Edit MultiEdit Bash \
  --model sonnet
```

起動直後にウォームアップとして diff 全体を user メッセージで投入し、以降は選択行を user メッセージとして同じ stdin に追記して送る。cwd は対象リポジトリに設定し、Read で周辺コードを参照させる。

| フラグ | 役割 | 備考 |
|--------|------|------|
| `-p` | print / headless | 擬似 TTY 不要 |
| `--append-system-prompt` | 固定の質問・観点を注入 | サーバ側に固定するのが「自由入力不可」の要 |
| `--input-format stream-json` | stdin から user メッセージを逐次注入 | これが常駐セッション化の要。送信 → 読む → 再送を同一プロセスで繰り返す |
| `--output-format stream-json` | 1行1 JSON の NDJSON を逐次出力 | `--verbose --include-partial-messages` 併用で部分ストリーム（`text_delta`） |
| `--allowedTools Read` | 選択範囲の周辺コードを読ませる | 書き込み系は `--disallowedTools` で禁止（read-only） |
| `--model` | モデル選択 | alias 推奨（`sonnet` / `opus`） |

備考：
- 固定プロンプトは「観点」をシステムプロンプトに、「対象」を stdin（diff・選択行）に置く分離。
- 常駐 1 本のため選択は直列処理。回答間で会話文脈が共有される。
- ウォームアップ投入により diff は最初のターンで文脈に載り、以降の選択は周辺 Read のみで素早く応答できる。

## 6. データ契約

### リクエスト
```
POST /ask
{
  "file": "src/foo.rs",
  "range": { "start": 42, "end": 58 },
  "selected_diff": "<unified diff 断片>"
}
```
※ プロンプト本文はリクエストに含めない（サーバ固定）。

### レスポンス（SSE）
- `event: delta` … `{ "text": "..." }`（逐次）
- `event: done`  … `{ ... }`
- `event: error` … `{ "message": "...", "exit_code": ... }`

## 7. 技術スタック（確定）

`loop`（`claude` CLI を stream-json で spawn し SSE 変換する前例）を踏襲しつつ、Zetema はステートレス（選択 = 1プロセス = 1回答）で DB・永続セッション不要なため、より薄い構成とする。

### バックエンド
| 項目 | 採用 | 備考 |
|------|------|------|
| 言語 | Python 3.12 | loop と統一。CLI spawn + stream-json パースの実装資産を流用 |
| Web フレームワーク | FastAPI + Uvicorn | SSE は `StreamingResponse(media_type="text/event-stream")` |
| 依存管理 | uv（PEP 723 inline script） | `uv run server.py` 単体起動 |
| Claude 起動 | `subprocess.Popen` + stream-json | loop の `RoleSession` をステートレス化（send→read→close の1往復） |
| diff 取得 | backend が `git diff` を subprocess 実行 | 起動引数で git リビジョン範囲（例: `HEAD~1`, `--staged`）/ リポジトリパスを指定 |

### フロントエンド
| 項目 | 採用 | 備考 |
|------|------|------|
| フレームワーク | Next.js 15 (App Router) + React 19 + TypeScript | 単一画面構成 |
| スタイル | Tailwind CSS + shadcn/ui | |
| パッケージ管理 | pnpm | |
| diff パース + 描画 + 行選択 | `react-diff-view` | unified diff のパース・行番号付き描画・行範囲ハイライトを提供。範囲選択 UI のみ薄く自作 |
| SSE 受信 | `fetch` + `ReadableStream` で SSE を手動パース | `/ask` は POST のため GET 専用の `EventSource` は使えない。`delta` / `done` / `error` を購読 |
| 型生成 | openapi-typescript | FastAPI の OpenAPI から TS 型を自動生成 |

### 通信
- REST: `GET /api/diff` … 起動時に読み込んだ diff と warmed 状態を返す
- SSE: `POST /ask` … `StreamingResponse`。クライアントは `fetch` のストリームを手動パース

### 逐次ストリーミングの要点
真の逐次 delta には `--include-partial-messages` が出す `stream_event`（`content_block_delta` の `text_delta`）をパースして即 SSE `delta` に流す。loop の「`type: result` まで読む」方式とは異なり、partial を拾う実装にする。

## 8. 確定した設計判断

- **文脈の渡し方**：起動時に diff 全体を投入してウォームアップし、各選択では選択行を送信。`--allowedTools Read` で周辺コードの読み込みを許可する。
- **選択操作**：Web なのでマウス操作（行ガターのドラッグ選択）。
