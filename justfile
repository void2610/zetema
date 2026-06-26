# diff-ask コマンドランナー

# 対象 repo（環境変数 REPO で上書き）
repo := env_var_or_default("REPO", "")

# バックエンド起動（例: just backend ~/proj -- HEAD~1）
backend repo_path=repo *args="":
    cd backend && uv run server.py --repo {{repo_path}} {{args}}

# フロントエンド開発サーバ
web:
    cd web && pnpm dev

# フロントエンド依存インストール
install:
    cd web && pnpm install

# バックエンドテスト（単体 + claude 実起動の統合）
test:
    cd backend && uv run --with fastapi --with 'uvicorn[standard]' --with pytest pytest tests -v

# 単体テストのみ（claude 不要・高速）
test-unit:
    cd backend && uv run --with fastapi --with 'uvicorn[standard]' --with pytest pytest tests/test_parse.py tests/test_diffsource.py -v
