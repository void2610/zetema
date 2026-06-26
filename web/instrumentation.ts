// Next サーバ起動時に 1 度だけ実行される。Python backend を自動起動し、フロントだけで完結させる。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { spawnBackend } = await import("./lib/backend-spawn");
  await spawnBackend();
}
