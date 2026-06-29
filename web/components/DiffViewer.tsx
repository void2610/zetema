"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Highlight, themes, type Language } from "prism-react-renderer";
import { askStream, type AskMode } from "@/lib/api";
import { Markdown } from "@/components/Markdown";
import { MARKER, lineNo, parseUnifiedDiff, type DiffLine, type LineType } from "@/lib/diff";

// 質問の種類。アイコンは Lucide ベースの SVG をインライン定義。
const ASK_MODES: { id: AskMode; label: string; hint: string; icon: ReactNode }[] = [
  {
    id: "intent",
    label: "意図とレビュー",
    hint: "変更の意図の解説 + レビュー観点での指摘",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
  {
    id: "spec",
    label: "言語仕様",
    hint: "選択箇所で使われている構文・組み込み機能の解説",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
  {
    id: "tech",
    label: "技術解説",
    hint: "使われているライブラリ・パターン・設計の解説",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
];

// 拡張子 → Prism 言語名のマッピング（prism-react-renderer の内蔵言語のみ）。
const EXT_LANG: Record<string, Language> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  php: "php",
  swift: "swift",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  css: "css",
  scss: "scss",
  sass: "sass",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  m: "objectivec",
  mm: "objectivec",
  sql: "sql",
  diff: "diff",
  patch: "diff",
  pl: "perl",
  ps1: "powershell",
};

function detectLanguage(path: string): Language | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? null;
}

interface Sel {
  fileIndex: number;
  anchor: number;
  focus: number;
}

interface Ask {
  id: number;
  file: string;
  fileIndex: number;
  startIdx: number; // content 行 idx（diff スクロール同期用）
  endIdx: number;
  startLine: number;
  endLine: number;
  mode: AskMode;
  text: string;
  status: "streaming" | "done" | "error";
}

// 追加/削除は文字背景で表現。文字色はシンタックスハイライト側に任せる。
const ROW_BG: Record<LineType, string> = {
  insert: "bg-verdict-pass/10",
  delete: "bg-verdict-fail/10",
  hunk: "",
  normal: "",
  meta: "",
};
const MARKER_BG: Record<LineType, string> = {
  insert: "bg-verdict-pass/25",
  delete: "bg-verdict-fail/25",
  hunk: "",
  normal: "",
  meta: "",
};
// hunk / meta はコードではないので Prism にかけず色だけ付ける。
const META_COLOR: Record<LineType, string> = {
  insert: "",
  delete: "",
  hunk: "text-primary",
  normal: "",
  meta: "text-muted-foreground",
};

export default function DiffViewer({ diff }: { diff: string }) {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);
  // 選択可能行（content 行）だけを抜き出した配列をファイルごとに用意。
  const contents = useMemo(
    () => files.map((f) => f.lines.filter((l) => l.type === "insert" || l.type === "delete" || l.type === "normal")),
    [files],
  );

  const [sel, setSel] = useState<Sel | null>(null);
  const selRef = useRef<Sel | null>(null);
  const draggingRef = useRef(false);
  const setSelBoth = (s: Sel | null) => {
    selRef.current = s;
    setSel(s);
  };

  const [asks, setAsks] = useState<Ask[]>([]);
  const askId = useRef(0);
  const [mode, setMode] = useState<AskMode>("intent");
  // mode state はドラッグ確定時 (mouseup) のコールバックから参照するため ref でも持つ。
  const modeRef = useRef<AskMode>(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // diff 内位置で並べる（同期したときに上下関係が直感的になる）。
  const sortedAsks = useMemo(
    () => [...asks].sort((a, b) => a.fileIndex - b.fileIndex || a.startIdx - b.startIdx),
    [asks],
  );

  // diff と回答は同じスクロール空間に置く。
  const [activeAskId, setActiveAskId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const diffColRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLDivElement>(null);
  const askRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  // クリックジャンプ中は active 自動切り替えを抑制（行を通り過ぎる度に切り替わるのを防ぐ）。
  const lockUntilRef = useRef(0);
  // 各 ask の path を直接書き換える（setState だとスクロール毎の再描画が重いため）。
  const pathRefs = useRef<Map<number, SVGPathElement | null>>(new Map());
  // SVG をスクロール領域内に置くため、grid wrapper を ref で参照して座標基準にする。
  const gridRef = useRef<HTMLDivElement>(null);
  // スクロール時の active 判定を次フレームに集約するための rAF id。
  const scrollRafRef = useRef(0);

  const updateConnectors = useCallback(() => {
    const grid = gridRef.current;
    const diffCol = diffColRef.current;
    if (!grid || !diffCol) return;
    // SVG は grid wrapper の中に inset-0 で配置されているため、座標は grid 相対で OK。
    // スクロールしても grid の中での相対位置は変わらないので、scroll 毎の再計算は不要。
    const gRect = grid.getBoundingClientRect();
    const dRect = diffCol.getBoundingClientRect();
    for (const ask of sortedAsks) {
      const path = pathRefs.current.get(ask.id);
      if (!path) continue;
      const startRow = diffCol.querySelector<HTMLElement>(
        `[data-row="${ask.fileIndex}-${ask.startIdx}"]`,
      );
      const endRow = diffCol.querySelector<HTMLElement>(
        `[data-row="${ask.fileIndex}-${ask.endIdx}"]`,
      );
      const card = askRefs.current.get(ask.id);
      if (!startRow || !card) {
        path.setAttribute("d", "");
        continue;
      }
      const sRect = startRow.getBoundingClientRect();
      const eRect = (endRow ?? startRow).getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();

      const y1 = (sRect.top + eRect.bottom) / 2 - gRect.top;
      const x1 = dRect.right - gRect.left;
      const y2 = (cardRect.top + cardRect.bottom) / 2 - gRect.top;
      const x2 = cardRect.left - gRect.left;
      const cx = (x1 + x2) / 2;
      path.setAttribute("d", `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`);
    }
  }, [sortedAsks]);


  // 各回答カードを対応する diff 行の真横に配置。重なる場合は次のカードを下へ押し下げる。
  const positionCards = useCallback(() => {
    const aside = asideRef.current;
    const diffCol = diffColRef.current;
    if (!aside || !diffCol) return;
    const aTop = aside.getBoundingClientRect().top;
    const GAP = 8;
    let prevBottom = 0;
    for (const ask of sortedAsks) {
      const card = askRefs.current.get(ask.id);
      if (!card) continue;
      const row = diffCol.querySelector<HTMLElement>(
        `[data-row="${ask.fileIndex}-${ask.startIdx}"]`,
      );
      if (!row) {
        // 対応行が折りたたみ等で見えない場合はカードも隠す。
        card.style.display = "none";
        continue;
      }
      card.style.display = "";
      const desired = row.getBoundingClientRect().top - aTop;
      const top = Math.max(desired, prevBottom + GAP);
      card.style.top = `${top}px`;
      prevBottom = top + card.offsetHeight;
    }
    // カード総高が diff より長い場合は aside を伸ばす。
    aside.style.minHeight = `${prevBottom + GAP}px`;
  }, [sortedAsks]);

  // ファイルパスをキーにした既読 / 折りたたみ状態。
  const [viewed, setViewed] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const onScroll = useCallback(() => {
    // SVG はスクロール領域内なので path 自体は再計算不要。active 検出だけ rAF で集約。
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      if (Date.now() < lockUntilRef.current) return;
      const diffCol = diffColRef.current;
      const scroller = scrollRef.current;
      if (!diffCol || !scroller || asks.length === 0) return;
      const topRef = scroller.getBoundingClientRect().top + 24;
      let best: { id: number; dist: number } | null = null;
      for (const a of asks) {
        const el = diffCol.querySelector<HTMLElement>(`[data-row="${a.fileIndex}-${a.startIdx}"]`);
        if (!el) continue;
        const dist = Math.abs(el.getBoundingClientRect().top - topRef);
        if (!best || dist < best.dist) best = { id: a.id, dist };
      }
      if (best && best.id !== activeAskId) setActiveAskId(best.id);
    });
  }, [asks, activeAskId]);

  // resize / レイアウト変化で曲線とカード位置を再計算。
  useEffect(() => {
    const handler = () => {
      positionCards();
      updateConnectors();
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [updateConnectors, positionCards]);

  // ネイティブ scroll リスナー: React 合成イベントより低遅延で paint と同期させる。
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  // asks / folding / viewing が変わるたびにカード位置を再計算。
  // ストリーミングでカード高さも変わるため、layout commit 後にもう一度走らせる。
  useEffect(() => {
    positionCards();
    updateConnectors();
    const id = requestAnimationFrame(() => {
      positionCards();
      updateConnectors();
    });
    return () => cancelAnimationFrame(id);
  }, [positionCards, updateConnectors, asks, viewed, collapsed]);
  const toggleViewed = (key: string) => {
    setViewed((prev) => {
      const next = !prev[key];
      // Viewed を ON にしたら自動で畳む / OFF で開く。
      setCollapsed((c) => ({ ...c, [key]: next }));
      return { ...prev, [key]: next };
    });
  };
  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const confirm = useCallback(
    (s: Sel) => {
      const file = files[s.fileIndex];
      const content = contents[s.fileIndex];
      const a = Math.min(s.anchor, s.focus);
      const b = Math.max(s.anchor, s.focus);
      const picked = content.slice(a, b + 1);
      if (picked.length === 0) return;
      const body = picked.map((l) => MARKER[l.type] + l.text).join("\n");
      const fragment = [file.header, picked[0].hunkHeader, body].filter(Boolean).join("\n");
      const startLine = lineNo(picked[0]);
      const endLine = lineNo(picked[picked.length - 1]);
      const filePath = file.newPath || file.oldPath;

      const id = ++askId.current;
      const askMode = modeRef.current;
      setAsks((prev) => [
        {
          id,
          file: filePath,
          fileIndex: s.fileIndex,
          startIdx: a,
          endIdx: b,
          startLine,
          endLine,
          mode: askMode,
          text: "",
          status: "streaming",
        },
        ...prev,
      ]);
      setActiveAskId(id);

      askStream(
        { file: filePath, range: { start: startLine, end: endLine }, selected_diff: fragment, mode: askMode },
        {
          onDelta: (t) =>
            setAsks((prev) => prev.map((x) => (x.id === id ? { ...x, text: x.text + t } : x))),
          onDone: (result) =>
            setAsks((prev) =>
              prev.map((x) => (x.id === id ? { ...x, text: result || x.text, status: "done" } : x)),
            ),
          onError: (msg) =>
            setAsks((prev) =>
              prev.map((x) =>
                x.id === id ? { ...x, text: x.text + `\n\n\`[エラー] ${msg}\``, status: "error" } : x,
              ),
            ),
        },
      );
    },
    [files, contents],
  );

  useEffect(() => {
    const up = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const s = selRef.current;
      if (s) confirm(s);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [confirm]);

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden">
      {/* 質問モード切替（次の選択範囲の質問種別が決まる）。 */}
      <div className="absolute right-4 top-3 z-20 flex items-center gap-1 rounded-md border border-border bg-card/85 p-1 shadow-md backdrop-blur">
        {ASK_MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              aria-label={m.label}
              aria-pressed={active}
              onClick={() => setMode(m.id)}
              className={`group relative flex h-7 w-7 items-center justify-center rounded transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {m.icon}
              {/* ホバー時に意味を吹き出しで表示。 */}
              <span
                role="tooltip"
                className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-56 rounded-md border border-border bg-card px-2.5 py-2 text-left text-[11px] leading-snug text-foreground shadow-lg group-hover:block"
              >
                <span className="block font-medium">{m.label}</span>
                <span className="block text-muted-foreground">{m.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div ref={scrollRef} className="absolute inset-0 overflow-auto">
      <div
        ref={gridRef}
        className="relative grid grid-cols-[minmax(0,1fr)_minmax(22rem,34%)] gap-x-10"
      >
      {/* diff 本体 */}
      <div ref={diffColRef} className="select-none px-5 py-5">
        {files.map((file, fi) => {
          let selIdx = -1; // content 行カウンタ
          const filePath = file.newPath || file.oldPath;
          const key = filePath + "@" + fi;
          const isViewed = !!viewed[key];
          const isCollapsed = !!collapsed[key];
          const language = detectLanguage(filePath);
          const activeAsk = sortedAsks.find((x) => x.id === activeAskId);
          return (
            <div
              key={key}
              className={`surface mb-4 overflow-hidden ${isViewed ? "opacity-60" : ""}`}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleCollapsed(key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleCollapsed(key);
                  }
                }}
                className="flex cursor-pointer items-center gap-2 border-b border-border bg-card/40 px-3 py-2 hover:bg-card/60"
              >
                <span
                  aria-label={isCollapsed ? "ファイルを開く" : "ファイルを畳む"}
                  className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className={`h-3 w-3 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                  >
                    <path d="M3.22 5.97a.75.75 0 0 1 1.06 0L8 9.69l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.03a.75.75 0 0 1 0-1.06Z" />
                  </svg>
                </span>
                <span className="font-mono text-xs text-foreground/80">{filePath}</span>
                <label
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={isViewed}
                    onChange={() => toggleViewed(key)}
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  />
                  Viewed
                </label>
              </div>
              {!isCollapsed && (
                <div className="overflow-x-auto bg-muted/15 font-mono text-xs leading-relaxed">
                  <div className="min-w-max py-1">
                  {file.lines.map((line, li) => {
                    const selectable = line.type === "insert" || line.type === "delete" || line.type === "normal";
                    const idx = selectable ? ++selIdx : -1;
                    const selected =
                      selectable &&
                      sel?.fileIndex === fi &&
                      idx >= Math.min(sel.anchor, sel.focus) &&
                      idx <= Math.max(sel.anchor, sel.focus);
                    const active =
                      selectable &&
                      activeAsk?.fileIndex === fi &&
                      idx >= activeAsk.startIdx &&
                      idx <= activeAsk.endIdx;
                    return (
                      <Row
                        key={li}
                        line={line}
                        language={language}
                        selected={selected}
                        active={!!active}
                        rowKey={selectable ? `${fi}-${idx}` : undefined}
                        onDown={
                          selectable
                            ? () => {
                                draggingRef.current = true;
                                setSelBoth({ fileIndex: fi, anchor: idx, focus: idx });
                              }
                            : undefined
                        }
                        onEnter={
                          selectable
                            ? () => {
                                if (draggingRef.current && selRef.current?.fileIndex === fi)
                                  setSelBoth({ ...selRef.current, focus: idx });
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {files.length === 0 && (
          <p className="text-sm text-muted-foreground">diff が空です。対象リポジトリに変更がありません。</p>
        )}
      </div>

      {/* 回答 — 各カードは対応する diff 行の真横に絶対配置する。 */}
      <aside
        ref={asideRef}
        className="relative border-l border-border"
      >
        {sortedAsks.length === 0 && (
          <p className="px-5 py-5 text-sm text-muted-foreground">
            左の diff で行範囲をドラッグ選択（または単一行クリック）すると、その箇所についての回答がここに表示されます。
          </p>
        )}
        {sortedAsks.map((a) => {
            const isActive = a.id === activeAskId;
            return (
              <div
                key={a.id}
                ref={(el) => {
                  askRefs.current.set(a.id, el);
                }}
                onClick={() => {
                  // 回答カードクリックで対応する diff へジャンプ。
                  setActiveAskId(a.id);
                  const target = diffColRef.current?.querySelector<HTMLElement>(
                    `[data-row="${a.fileIndex}-${a.startIdx}"]`,
                  );
                  const scroller = scrollRef.current;
                  if (target && scroller) {
                    lockUntilRef.current = Date.now() + 500;
                    const offset =
                      target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 24;
                    scroller.scrollTo({ top: offset, behavior: "smooth" });
                  }
                }}
                style={{ left: 12, right: 12 }}
                className={`surface absolute cursor-pointer p-3 transition-shadow ${
                  isActive
                    ? "border-primary/60 shadow-[0_0_0_1px_var(--color-primary)]"
                    : "hover:border-foreground/20"
                }`}
              >
                <div className="mb-2 flex min-w-0 items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  {(() => {
                    const m = ASK_MODES.find((x) => x.id === a.mode);
                    return m ? (
                      <span
                        title={m.label}
                        className="flex h-4 w-4 shrink-0 items-center justify-center text-primary"
                      >
                        {m.icon}
                      </span>
                    ) : null;
                  })()}
                  <span className="min-w-0 flex-1 truncate text-foreground/80" title={a.file}>
                    {a.file}
                  </span>
                  <span className="shrink-0">
                    L{a.startLine}
                    {a.endLine !== a.startLine ? `–L${a.endLine}` : ""}
                  </span>
                  {a.status === "streaming" && (
                    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-primary">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                      回答中
                    </span>
                  )}
                  {a.status === "error" && (
                    <span className="shrink-0 whitespace-nowrap text-verdict-fail">エラー</span>
                  )}
                </div>
                {a.text ? (
                  <Markdown>{a.text}</Markdown>
                ) : (
                  <span className="text-sm text-muted-foreground">…</span>
                )}
              </div>
            );
          })}
      </aside>
      {/* diff の選択範囲 → 回答カード を結ぶベジェ曲線。スクロール領域内に置いてコンテンツと一緒に composit される。 */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 h-full w-full text-primary"
      >
        {sortedAsks.map((a) => {
          const isActive = a.id === activeAskId;
          return (
            <path
              key={a.id}
              ref={(el) => {
                pathRefs.current.set(a.id, el);
              }}
              fill="none"
              stroke="currentColor"
              strokeWidth={isActive ? 2 : 1.25}
              strokeOpacity={isActive ? 0.85 : 0.35}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      </div>
      </div>
    </div>
  );
}

function Row({
  line,
  language,
  selected,
  active,
  rowKey,
  onDown,
  onEnter,
}: {
  line: DiffLine;
  language: Language | null;
  selected: boolean;
  active?: boolean;
  rowKey?: string;
  onDown?: () => void;
  onEnter?: () => void;
}) {
  const selectable = onDown !== undefined;
  // active な ask の範囲行も選択中と同じ青で塗る（insert/delete の緑/赤背景より優先）。
  const rowBg = selected || active
    ? "bg-primary/15"
    : ROW_BG[line.type] || (selectable ? "hover:bg-foreground/[0.04]" : "");
  const isCode = line.type === "insert" || line.type === "delete" || line.type === "normal";
  return (
    <div
      data-row={rowKey}
      onMouseDown={onDown}
      onMouseEnter={onEnter}
      className={[
        "flex border-l-2",
        active ? "border-primary" : "border-transparent",
        rowBg,
        selectable ? "cursor-pointer" : "",
      ].join(" ")}
    >
      <span className="w-10 shrink-0 select-none px-2 text-right text-[11px] text-muted-foreground/40 tabular-nums">
        {line.oldNo ?? ""}
      </span>
      <span className="w-10 shrink-0 select-none px-2 text-right text-[11px] text-muted-foreground/40 tabular-nums">
        {line.newNo ?? ""}
      </span>
      {isCode ? (
        <>
          <span
            className={`w-5 shrink-0 select-none text-center text-foreground/60 ${MARKER_BG[line.type]}`}
          >
            {MARKER[line.type]}
          </span>
          <span className="flex-1 whitespace-pre pl-2">
            <CodeText text={line.text} language={language} />
          </span>
        </>
      ) : (
        <span className={`flex-1 whitespace-pre pl-2 ${META_COLOR[line.type]}`}>{line.text}</span>
      )}
    </div>
  );
}

// 1 行ぶんを Prism でハイライト。language 未対応時は素のテキストで返す。
function CodeText({ text, language }: { text: string; language: Language | null }) {
  if (!language) return <span>{text || " "}</span>;
  return (
    <Highlight code={text || " "} language={language} theme={themes.vsDark}>
      {({ tokens, getTokenProps }) => (
        <span>
          {tokens[0]?.map((token, i) => (
            <span key={i} {...getTokenProps({ token })} />
          ))}
        </span>
      )}
    </Highlight>
  );
}
