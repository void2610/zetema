// backend は POST /ask を SSE で返すため、GET 専用の EventSource ではなく
// fetch + ReadableStream で SSE フレームを手動パースする。

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8765";

export interface DiffResponse {
  diff: string;
  warmed: boolean;
}

export async function fetchDiff(): Promise<DiffResponse> {
  const res = await fetch(`${API_BASE}/api/diff`);
  if (!res.ok) throw new Error(`/api/diff ${res.status}`);
  return res.json();
}

export interface AskRequest {
  file: string;
  range: { start: number; end: number };
  selected_diff: string;
}

export interface AskHandlers {
  onDelta: (text: string) => void;
  onDone: (result: string) => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
}

export async function askStream(req: AskRequest, h: AskHandlers): Promise<void> {
  const res = await fetch(`${API_BASE}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: h.signal,
  });
  if (!res.ok || !res.body) {
    h.onError(`/ask ${res.status}`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE はフレーム区切りが空行（\n\n）。
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      dispatchFrame(frame, h);
    }
  }
}

function dispatchFrame(frame: string, h: AskHandlers): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return;
  let data: { text?: string; result?: string; message?: string };
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }
  if (event === "delta") h.onDelta(data.text ?? "");
  else if (event === "done") h.onDone(data.result ?? "");
  else if (event === "error") h.onError(data.message ?? "unknown error");
}
