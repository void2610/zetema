"use client";

import { useCallback, useEffect, useState } from "react";
import DiffViewer from "@/components/DiffViewer";
import SourceBar from "@/components/SourceBar";
import { fetchSource, fetchWarmed, setSource } from "@/lib/api";

export default function Home() {
  const [repo, setRepo] = useState("");
  const [rev, setRev] = useState("");
  const [current, setCurrent] = useState<{ repo: string; rev: string; diff: string } | null>(null);
  const [warmed, setWarmed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  // backend は Next が自動起動する。初回 uv 実行は依存解決で数秒かかるためリトライして待つ。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 40; i++) {
        try {
          const s = await fetchSource();
          if (cancelled) return;
          setRepo(s.repo);
          setRev(s.rev_range);
          setWarmed(s.warmed);
          if (s.repo) setCurrent({ repo: s.repo, rev: s.rev_range, diff: s.diff });
          setBooting(false);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!cancelled) {
        setBooting(false);
        setConnError("バックエンドの起動を確認できませんでした");
      }
    })();
    return () => {
      cancelled = true;
    };
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

  const apply = useCallback(async (repoArg: string, revArg: string) => {
    setApplying(true);
    setError(null);
    try {
      const s = await setSource(repoArg, revArg);
      setWarmed(false);
      setCurrent({ repo: s.repo, rev: s.rev_range, diff: s.diff });
      setRepo(s.repo);
      setRev(s.rev_range);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }, []);

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

      <SourceBar
        initialRepo={repo}
        initialRev={rev}
        current={current ? { repo: current.repo, rev: current.rev } : null}
        applying={applying}
        error={error}
        onApply={apply}
      />

      {connError && (
        <div className="m-5 rounded-lg border border-verdict-fail/40 bg-verdict-fail/10 p-3 text-sm text-verdict-fail">
          バックエンドに接続できません: {connError}
        </div>
      )}

      {booting ? (
        <div className="flex flex-1 items-center justify-center px-5">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            バックエンド起動中…
          </p>
        </div>
      ) : current ? (
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
