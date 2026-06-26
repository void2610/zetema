"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 回答本文の Markdown 装飾（loop の Markdown コンポーネント移植）。dark 前提で prose-invert。
export function Markdown({ children }: { children: string }) {
  return (
    <div
      className={[
        "prose prose-invert prose-sm max-w-none break-words",
        "prose-headings:text-foreground prose-p:text-foreground/90 prose-li:text-foreground/90",
        "prose-strong:text-foreground prose-a:text-primary",
        "prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-muted/40 prose-pre:text-foreground/90 prose-pre:text-xs",
      ].join(" ")}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
