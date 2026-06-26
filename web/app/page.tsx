"use client";

import { useCallback, useEffect, useState } from "react";
import DiffViewer from "@/components/DiffViewer";
import { fetchSource, fetchWarmed, setSource } from "@/lib/api";

const PRESETS: { label: string; rev: string }[] = [
  { label: "作業ツリー", rev: "" },
  { label: "ステージ", rev: "--staged" },
  { label: "直前コミット", rev: "HEAD~1" },
];

export default function Home() {
  const [repo, setRepo] = useState("");
  const [rev, setRev] = useState("");
  const [current, setCurrent] = useState<{ repo: string; rev: string; diff: string } | null>(null);
  const [warmed, setWarmed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connError, setConnError] = useState<string | null>(null);

  useEffect(() => {
    fetchSource()
      .then((s) => {
        setRepo(s.repo);
        setRev(s.rev_range);
        setWarmed(s.warmed);
        if (s.repo) setCurrent({ repo: s.repo, rev: s.rev_range, diff: s.diff });
      })
      .catch((e) => setConnError(String(e)));
  }, []);

  useEffect(() => {
    if (warmed || !current) return;
    const t = setInterval(() => {
      fetchWarmed()
        .then(setWarmed)
        .catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [warmed, current]);

  const apply = useCallback(
    async (revOverride?: string) => {
      const r = revOverride ?? rev;
      if (revOverride !== undefined) setRev(revOverride);
      setApplying(true);
      setError(null);
      try {
        const s = await setSource(repo, r);
        setWarmed(false);
        setCurrent({ repo: s.repo, rev: s.rev_range, diff: s.diff });
        setRepo(s.repo);
        setRev(s.rev_range);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setApplying(false);
      }
    },
    [repo, rev],
  );

  const inputCls =
    "rounded-md border border-border bg-background px-2.5 py-1 font-mono text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40";

  return (
    <div className="flex h-screen flex-col">
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-border/80 bg-background/70 px-5 backdrop-blur-xl">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 font-mono text-base leading-none text-primary ring-1 ring-primary/25">
          ζ
        </span>
        <span className="font-semibold tracking-tight">Zetema</span>
        {current && (
          <span
            className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ring-1 ${
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
        )}
      </header>

      {/* ソース切り替えバー */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card/30 px-5 py-2.5">
        <label className="text-xs text-muted-foreground">repo</label>
        <input
          className={`${inputCls} min-w-0 flex-1`}
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && apply()}
          placeholder="/path/to/target-repo"
          spellCheck={false}
        />
        <label className="ml-1 text-xs text-muted-foreground">diff</label>
        <input
          className={`${inputCls} w-44`}
          value={rev}
          onChange={(e) => setRev(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && apply()}
          placeholder="(空)=作業ツリー"
          spellCheck={false}
        />
        <div className="flex items-center gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => apply(p.rev)}
              disabled={applying || !repo}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => apply()}
          disabled={applying || !repo}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {applying ? "適用中…" : "適用"}
        </button>
      </div>

      {connError && (
        <div className="m-5 rounded-lg border border-verdict-fail/40 bg-verdict-fail/10 p-3 text-sm text-verdict-fail">
          バックエンドに接続できません: {connError}
        </div>
      )}
      {error && (
        <div className="mx-5 mt-3 rounded-lg border border-verdict-fail/40 bg-verdict-fail/10 p-3 text-sm text-verdict-fail">
          {error}
        </div>
      )}

      {current ? (
        <DiffViewer key={`${current.repo}::${current.rev}`} diff={current.diff} />
      ) : (
        !connError && (
          <div className="flex flex-1 items-center justify-center px-5">
            <p className="text-sm text-muted-foreground">
              上の repo に対象リポジトリのパスを入力し、「適用」で diff を読み込んでください。
            </p>
          </div>
        )
      )}
    </div>
  );
}
