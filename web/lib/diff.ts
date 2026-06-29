// unified diff の自前パーサ。diff 表示はメイン機能のため独自実装。
// loop の diff-view と同じく行を type で分類し、表示側で着色する。

export type LineType = "normal" | "insert" | "delete" | "hunk" | "meta";

export interface DiffLine {
  type: LineType;
  text: string; // マーカー(+/-/空白)を除いた内容。hunk/meta は行全体。
  oldNo: number | null;
  newNo: number | null;
  hunkHeader: string; // この行が属する hunk の @@ 行（fragment 生成用）
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  header: string; // "--- a/x" / "+++ b/y" の2行（fragment 生成用）
  lines: DiffLine[];
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
// "diff --git a/<old> b/<new>" からパスを取り出す（スペースを含むパスは未対応）。
const DIFF_GIT_RE = /^diff --git a\/(.+?) b\/(.+)$/;

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let oldNo = 0;
  let newNo = 0;
  let hunkHeader = "";
  let minus = "";
  let plus = "";

  const newFile = (oldPath = "", newPath = "") => {
    file = { oldPath, newPath, header: "", lines: [] };
    files.push(file);
    hunkHeader = "";
    minus = "";
    plus = "";
  };

  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git")) {
      const m = DIFF_GIT_RE.exec(raw);
      newFile(m?.[1] ?? "", m?.[2] ?? "");
      continue;
    }
    if (!file) {
      if (raw.startsWith("--- ") || raw.startsWith("@@")) newFile();
      else continue;
    }
    const f = file!;
    if (raw.startsWith("--- ")) {
      minus = raw;
      f.oldPath = raw.slice(4).replace(/^a\//, "");
      f.header = plus ? `${minus}\n${plus}` : minus;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      plus = raw;
      f.newPath = raw.slice(4).replace(/^b\//, "");
      f.header = `${minus}\n${plus}`;
      continue;
    }
    const m = HUNK_RE.exec(raw);
    if (m) {
      oldNo = parseInt(m[1], 10);
      newNo = parseInt(m[2], 10);
      hunkHeader = raw;
      f.lines.push({ type: "hunk", text: raw, oldNo: null, newNo: null, hunkHeader });
      continue;
    }
    const c = raw[0];
    if (c === "+") {
      f.lines.push({ type: "insert", text: raw.slice(1), oldNo: null, newNo, hunkHeader });
      newNo++;
    } else if (c === "-") {
      f.lines.push({ type: "delete", text: raw.slice(1), oldNo, newNo: null, hunkHeader });
      oldNo++;
    } else if (c === " ") {
      f.lines.push({ type: "normal", text: raw.slice(1), oldNo, newNo, hunkHeader });
      oldNo++;
      newNo++;
    } else if (c === "\\") {
      // "\ No newline at end of file"
      f.lines.push({ type: "meta", text: raw, oldNo: null, newNo: null, hunkHeader });
    }
    // それ以外(index 行など)は表示しない
  }
  // rename only / mode change など、内容差分を持たないエントリは表示しない。
  return files.filter((f) => f.lines.length > 0);
}

export const MARKER: Record<LineType, string> = {
  insert: "+",
  delete: "-",
  normal: " ",
  hunk: "",
  meta: "",
};

// 選択行の番号（新側優先、削除行は旧側）。
export function lineNo(l: DiffLine): number {
  return l.newNo ?? l.oldNo ?? 0;
}
