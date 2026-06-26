// Next サーバ起動時に Python backend を子プロセスとして起動する（Node ランタイム専用）。
// 既に同ポートで応答があれば（手動起動・dev 再起動）spawn しない。

import { spawn } from "node:child_process";
import path from "node:path";

let started = false;

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8765";

async function alive(): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE}/api/warmed`, { signal: AbortSignal.timeout(600) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function spawnBackend(): Promise<void> {
  if (started) return;
  started = true;
  if (await alive()) {
    console.log("[zetema] backend は既に起動済み。spawn をスキップします。");
    return;
  }
  const backendDir = process.env.ZETEMA_BACKEND_DIR ?? path.resolve(process.cwd(), "..", "backend");
  const port = new URL(API_BASE).port || "8765";
  console.log(`[zetema] backend を起動します: uv run server.py --port ${port} (cwd=${backendDir})`);

  const child = spawn("uv", ["run", "server.py", "--port", port], {
    cwd: backendDir,
    stdio: "inherit",
    env: process.env,
  });
  child.on("error", (e) => console.error("[zetema] backend の起動に失敗しました:", e));

  const kill = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // noop
    }
  };
  process.on("exit", kill);
  process.on("SIGINT", () => {
    kill();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    kill();
    process.exit(0);
  });
}
