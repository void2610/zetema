"use client";

import { useEffect, useRef, useState } from "react";
import { listRepos, listBranches, listCommits, type RepoEntry, type CommitEntry } from "@/lib/api";

type Mode = "preset" | "branch" | "commit";

const PRESETS: { label: string; rev: string }[] = [
  { label: "作業ツリー", rev: "" },
  { label: "ステージ", rev: "--staged" },
  { label: "直前コミット", rev: "HEAD~1" },
  { label: "直近3コミット", rev: "HEAD~3" },
];

const MANUAL = "__manual__";

interface Props {
  initialRepo: string;
  initialRev: string;
  current: { repo: string; rev: string } | null;
  applying: boolean;
  error: string | null;
  onApply: (repo: string, rev: string) => void;
}

const inputCls =
  "rounded-md border border-border bg-background px-2.5 py-1 font-mono text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function SourceBar({ initialRepo, initialRev, current, applying, error, onApply }: Props) {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [repo, setRepo] = useState(initialRepo);
  const [manual, setManual] = useState(false);

  // initialRev からモードと branch 比較の base/target を推測（リロード復元用）。
  const inferMode = (r: string): Mode =>
    r.includes(" ") ? "commit" : r.includes("..") ? "branch" : "preset";
  const [mode, setMode] = useState<Mode>(inferMode(initialRev));
  const [branches, setBranches] = useState<string[]>([]);
  const initialBranch = initialRev.includes("..") && !initialRev.includes(" ")
    ? initialRev.split("..")
    : ["", ""];
  const [base, setBase] = useState(initialBranch[0]);
  const [target, setTarget] = useState(initialBranch[1]);
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  // commit モード復元用: "<hash>~1 <hash>" の右側の hash を取り出す。
  const initialCommitHash = (() => {
    if (!initialRev.includes(" ")) return "";
    const parts = initialRev.split(" ");
    return parts.length === 2 ? parts[1] : "";
  })();
  const [selectedCommit, setSelectedCommit] = useState(initialCommitHash);

  // クエリ復元で initialRev が遅れて入ってきた場合に一度だけ反映する。
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    if (!initialRev && !initialRepo) return;
    seeded.current = true;
    setMode(inferMode(initialRev));
    if (initialRev.includes("..") && !initialRev.includes(" ")) {
      const [b, t] = initialRev.split("..");
      setBase(b);
      setTarget(t);
    } else if (initialRev.includes(" ")) {
      const parts = initialRev.split(" ");
      if (parts.length === 2) setSelectedCommit(parts[1]);
    }
  }, [initialRepo, initialRev]);

  useEffect(() => {
    listRepos().then((r) => {
      setRepos(r);
      // 候補に無い初期 repo は手動入力扱い。
      if (initialRepo && !r.some((x) => x.path === initialRepo)) setManual(true);
    });
  }, [initialRepo]);

  // page 側 (URL 復元含む) で適用された repo を内部 state にも反映し、branch 一覧取得をトリガーする。
  useEffect(() => {
    if (initialRepo) setRepo(initialRepo);
  }, [initialRepo]);

  // repo が確定したらブランチ / コミットを取得（ブランチ比較・コミット選択の選択肢用）。
  useEffect(() => {
    if (!repo) {
      setBranches([]);
      setCommits([]);
      return;
    }
    let live = true;
    listBranches(repo).then((b) => {
      if (!live) return;
      setBranches(b.branches);
      setBase((prev) => prev || b.default || b.branches[0] || "");
      setTarget((prev) => prev || b.default || b.branches[0] || "");
    });
    listCommits(repo).then((c) => live && setCommits(c));
    return () => {
      live = false;
    };
  }, [repo]);

  const onRepoSelect = (v: string) => {
    if (v === MANUAL) {
      setManual(true);
      setRepo("");
      return;
    }
    setManual(false);
    setRepo(v);
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-card/30 px-5 py-2.5">
      {/* repo 選択 */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">repo</label>
        {manual ? (
          <input
            className={`${inputCls} min-w-0 flex-1`}
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && repo && onApply(repo, "")}
            placeholder="/path/to/target-repo"
            spellCheck={false}
            autoFocus
          />
        ) : (
          <select
            className={`${inputCls} min-w-0 flex-1`}
            value={repos.some((r) => r.path === repo) ? repo : ""}
            onChange={(e) => onRepoSelect(e.target.value)}
          >
            <option value="" disabled>
              — リポジトリを選択 —
            </option>
            {repos.map((r) => (
              <option key={r.path} value={r.path}>
                {r.name}
              </option>
            ))}
            <option value={MANUAL}>手動入力…</option>
          </select>
        )}
        {manual && repos.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setManual(false);
              setRepo("");
            }}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            一覧から選ぶ
          </button>
        )}
      </div>

      {/* diff モード切替 + 各モード UI */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
          {(["preset", "branch", "commit"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "preset" ? "プリセット" : m === "branch" ? "ブランチ比較" : "コミット"}
            </button>
          ))}
        </div>

        {mode === "preset" && (
          <div className="flex flex-wrap items-center gap-1">
            {PRESETS.map((p) => {
              const active = current?.repo === repo && current?.rev === p.rev;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => repo && onApply(repo, p.rev)}
                  disabled={applying || !repo}
                  className={`rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-40 ${
                    active
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}

        {mode === "branch" && (
          <div className="flex flex-wrap items-center gap-1.5">
            <select className={`${inputCls} w-40`} value={base} onChange={(e) => setBase(e.target.value)}>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">..</span>
            <select className={`${inputCls} w-40`} value={target} onChange={(e) => setTarget(e.target.value)}>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => repo && base && target && onApply(repo, `${base}..${target}`)}
              disabled={applying || !repo || !base || !target}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              比較
            </button>
          </div>
        )}

        {mode === "commit" && (
          <select
            className={`${inputCls} min-w-0 flex-1`}
            value={commits.some((c) => c.hash === selectedCommit) ? selectedCommit : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (!v || !repo) return;
              setSelectedCommit(v);
              onApply(repo, `${v}~1 ${v}`);
            }}
            disabled={applying || !repo || commits.length === 0}
          >
            <option value="" disabled>
              {commits.length === 0 ? "— コミットなし —" : "— コミットを選択（そのコミットの変更を表示）—"}
            </option>
            {commits.map((c) => (
              <option key={c.hash} value={c.hash}>
                {c.short}  {c.subject}  ({c.rel_date} · {c.author})
              </option>
            ))}
          </select>
        )}

        {applying && <span className="text-xs text-muted-foreground">適用中…</span>}
      </div>

      {error && <p className="text-xs text-verdict-fail">{error}</p>}
    </div>
  );
}
