"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Highlight, themes, type Language } from "prism-react-renderer";
import { askStream } from "@/lib/api";
import { Markdown } from "@/components/Markdown";
import { MARKER, lineNo, parseUnifiedDiff, type DiffLine, type LineType } from "@/lib/diff";

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
  startLine: number;
  endLine: number;
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

  // ファイルパスをキーにした既読 / 折りたたみ状態。
  const [viewed, setViewed] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
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
      setAsks((prev) => [
        { id, file: filePath, startLine, endLine, text: "", status: "streaming" },
        ...prev,
      ]);

      askStream(
        { file: filePath, range: { start: startLine, end: endLine }, selected_diff: fragment },
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
    <div className="grid flex-1 grid-cols-[1fr_minmax(22rem,34%)] overflow-hidden">
      {/* diff 本体 */}
      <div className="select-none overflow-auto px-5 py-5">
        {files.map((file, fi) => {
          let selIdx = -1; // content 行カウンタ
          const filePath = file.newPath || file.oldPath;
          const key = filePath + "@" + fi;
          const isViewed = !!viewed[key];
          const isCollapsed = !!collapsed[key];
          const language = detectLanguage(filePath);
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
                <div className="overflow-x-auto bg-muted/15 py-1 font-mono text-xs leading-relaxed">
                  {file.lines.map((line, li) => {
                    const selectable = line.type === "insert" || line.type === "delete" || line.type === "normal";
                    const idx = selectable ? ++selIdx : -1;
                    const selected =
                      selectable &&
                      sel?.fileIndex === fi &&
                      idx >= Math.min(sel.anchor, sel.focus) &&
                      idx <= Math.max(sel.anchor, sel.focus);
                    return (
                      <Row
                        key={li}
                        line={line}
                        language={language}
                        selected={selected}
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
              )}
            </div>
          );
        })}
        {files.length === 0 && (
          <p className="text-sm text-muted-foreground">diff が空です。対象リポジトリに変更がありません。</p>
        )}
      </div>

      {/* 回答 */}
      <aside className="overflow-auto border-l border-border px-5 py-5">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">回答</h2>
        {asks.length === 0 && (
          <p className="text-sm text-muted-foreground">
            左の diff で行範囲をドラッグ選択（または単一行クリック）すると、その箇所についての回答がここに表示されます。
          </p>
        )}
        <div className="flex flex-col gap-3">
          {asks.map((a) => (
            <div key={a.id} className="surface p-3">
              <div className="mb-2 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <span className="text-foreground/80">{a.file}</span>
                <span>
                  L{a.startLine}
                  {a.endLine !== a.startLine ? `–L${a.endLine}` : ""}
                </span>
                {a.status === "streaming" && (
                  <span className="ml-auto flex items-center gap-1 text-primary">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                    回答中
                  </span>
                )}
                {a.status === "error" && <span className="ml-auto text-verdict-fail">エラー</span>}
              </div>
              {a.text ? (
                <Markdown>{a.text}</Markdown>
              ) : (
                <span className="text-sm text-muted-foreground">…</span>
              )}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Row({
  line,
  language,
  selected,
  onDown,
  onEnter,
}: {
  line: DiffLine;
  language: Language | null;
  selected: boolean;
  onDown?: () => void;
  onEnter?: () => void;
}) {
  const selectable = onDown !== undefined;
  const rowBg = selected
    ? "bg-primary/15"
    : ROW_BG[line.type] || (selectable ? "hover:bg-foreground/[0.04]" : "");
  const isCode = line.type === "insert" || line.type === "delete" || line.type === "normal";
  return (
    <div
      onMouseDown={onDown}
      onMouseEnter={onEnter}
      className={["flex", rowBg, selectable ? "cursor-pointer" : ""].join(" ")}
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
