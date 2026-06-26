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
    <div className="flex h-screen flex-col">
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-border/80 bg-background/70 px-5 backdrop-blur-xl">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 font-mono text-base leading-none text-primary ring-1 ring-primary/25">
          ζ
        </span>
        <span className="font-semibold tracking-tight">Zetema</span>
        <span
          className={`ml-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ring-1 ${
            warmed
              ? "bg-verdict-pass/10 text-verdict-pass ring-verdict-pass/25"
              : "bg-verdict-handoff/10 text-verdict-handoff ring-verdict-handoff/25"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${warmed ? "bg-verdict-pass" : "animate-pulse bg-verdict-handoff"}`}
          />
          {warmed ? "準備完了" : "ウォームアップ中"}
        </span>
      </header>

      {error && (
        <div className="m-5 rounded-lg border border-verdict-fail/40 bg-verdict-fail/10 p-3 text-sm text-verdict-fail">
          バックエンドに接続できません: {error}
        </div>
      )}
      {diff !== null && <DiffViewer diff={diff} />}
      {diff === null && !error && <p className="p-5 text-sm text-muted-foreground">読み込み中…</p>}
    </div>
  );
}
