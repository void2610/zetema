"use client";

import { useEffect, useState } from "react";
import DiffViewer from "@/components/DiffViewer";
import { fetchDiff } from "@/lib/api";

export default function Home() {
  const [diff, setDiff] = useState<string | null>(null);
  const [warmed, setWarmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDiff()
      .then((d) => {
        setDiff(d.diff);
        setWarmed(d.warmed);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // ウォームアップ未完なら数秒ごとに状態を取り直す。
  useEffect(() => {
    if (warmed || diff === null) return;
    const t = setInterval(() => {
      fetchDiff()
        .then((d) => setWarmed(d.warmed))
        .catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [warmed, diff]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">Zetema</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            warmed
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
          }`}
        >
          {warmed ? "準備完了" : "ウォームアップ中…"}
        </span>
      </header>

      {error && (
        <div className="m-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          バックエンドに接続できません: {error}
        </div>
      )}
      {diff !== null && <DiffViewer diff={diff} />}
      {diff === null && !error && <p className="p-4 text-zinc-500">読み込み中…</p>}
    </div>
  );
}
