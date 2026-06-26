"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Diff,
  Hunk,
  computeNewLineNumber,
  computeOldLineNumber,
  getChangeKey,
  parseDiff,
  type ChangeData,
  type ChangeEventArgs,
  type FileData,
} from "react-diff-view";
import { askStream } from "@/lib/api";

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

function lineNo(c: ChangeData): number {
  const n = computeNewLineNumber(c);
  return n > 0 ? n : computeOldLineNumber(c);
}

function marker(c: ChangeData): string {
  return c.type === "insert" ? "+" : c.type === "delete" ? "-" : " ";
}

// 選択 change から claude へ渡す unified diff 断片を組み立てる。
function buildFragment(file: FileData, flat: FlatChange[], a: number, b: number): string {
  const slice = flat.slice(a, b + 1);
  const header = `--- a/${file.oldPath}\n+++ b/${file.newPath}`;
  const hunkHeader = slice[0]?.hunkHeader ?? "";
  const body = slice.map((f) => marker(f.change) + f.change.content).join("\n");
  return [header, hunkHeader, body].filter(Boolean).join("\n");
}

interface FlatChange {
  change: ChangeData;
  hunkHeader: string;
}

function flatten(file: FileData): FlatChange[] {
  const out: FlatChange[] = [];
  for (const h of file.hunks) {
    for (const c of h.changes) out.push({ change: c, hunkHeader: h.content });
  }
  return out;
}

export default function DiffViewer({ diff }: { diff: string }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const flats = useMemo(() => files.map(flatten), [files]);

  const [sel, setSel] = useState<Sel | null>(null);
  const selRef = useRef<Sel | null>(null);
  const draggingRef = useRef(false);
  const setSelBoth = (s: Sel | null) => {
    selRef.current = s;
    setSel(s);
  };

  const [asks, setAsks] = useState<Ask[]>([]);
  const askId = useRef(0);

  const confirm = useCallback(
    (s: Sel) => {
      const file = files[s.fileIndex];
      const flat = flats[s.fileIndex];
      const a = Math.min(s.anchor, s.focus);
      const b = Math.max(s.anchor, s.focus);
      const fragment = buildFragment(file, flat, a, b);
      const startLine = lineNo(flat[a].change);
      const endLine = lineNo(flat[b].change);
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
              prev.map((x) =>
                x.id === id ? { ...x, text: result || x.text, status: "done" } : x,
              ),
            ),
          onError: (msg) =>
            setAsks((prev) =>
              prev.map((x) =>
                x.id === id ? { ...x, text: x.text + `\n\n[エラー] ${msg}`, status: "error" } : x,
              ),
            ),
        },
      );
    },
    [files, flats],
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

  const eventsFor = (fileIndex: number, keyToIndex: Map<string, number>) => {
    const start = (args: ChangeEventArgs) => {
      if (!args.change) return;
      const idx = keyToIndex.get(getChangeKey(args.change));
      if (idx === undefined) return;
      draggingRef.current = true;
      setSelBoth({ fileIndex, anchor: idx, focus: idx });
    };
    const extend = (args: ChangeEventArgs) => {
      if (!draggingRef.current || !args.change) return;
      const idx = keyToIndex.get(getChangeKey(args.change));
      if (idx === undefined) return;
      setSelBoth(selRef.current ? { ...selRef.current, focus: idx } : null);
    };
    return { onMouseDown: start, onMouseEnter: extend };
  };

  return (
    <div className="flex flex-1 gap-4 overflow-hidden">
      <div className="flex-1 overflow-auto select-none p-4">
        {files.map((file, fi) => {
          const flat = flats[fi];
          const keyToIndex = new Map(flat.map((f, i) => [getChangeKey(f.change), i]));
          const selectedKeys =
            sel && sel.fileIndex === fi
              ? flat
                  .slice(Math.min(sel.anchor, sel.focus), Math.max(sel.anchor, sel.focus) + 1)
                  .map((f) => getChangeKey(f.change))
              : [];
          const events = eventsFor(fi, keyToIndex);
          return (
            <div key={file.oldPath + file.newPath + fi} className="mb-6 overflow-hidden rounded border border-zinc-300">
              <div className="border-b border-zinc-300 bg-zinc-100 px-3 py-2 font-mono text-sm text-zinc-700">
                {file.newPath || file.oldPath}
              </div>
              <Diff
                viewType="unified"
                diffType={file.type}
                hunks={file.hunks}
                gutterEvents={events}
                codeEvents={events}
                selectedChanges={selectedKeys}
              >
                {(hunks) => hunks.map((h) => <Hunk key={h.content} hunk={h} />)}
              </Diff>
            </div>
          );
        })}
        {files.length === 0 && (
          <p className="text-zinc-500">diff が空です。対象リポジトリに変更がありません。</p>
        )}
      </div>

      <aside className="w-[40%] max-w-xl overflow-auto border-l border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500">回答</h2>
        {asks.length === 0 && (
          <p className="text-sm text-zinc-400">
            左の diff で行範囲をドラッグ選択すると、その箇所についての回答がここに表示されます。
          </p>
        )}
        <div className="flex flex-col gap-4">
          {asks.map((a) => (
            <div key={a.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="mb-2 font-mono text-xs text-zinc-500">
                {a.file} L{a.startLine}
                {a.endLine !== a.startLine ? `–L${a.endLine}` : ""}
                {a.status === "streaming" && " · 回答中…"}
                {a.status === "error" && " · エラー"}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{a.text || "…"}</div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
