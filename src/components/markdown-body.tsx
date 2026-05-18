import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";

import "highlight.js/styles/github-dark.css";


const PROSE_CLASSES =
  "prose prose-sm dark:prose-invert max-w-none " +
  "prose-pre:bg-zinc-900 prose-pre:text-zinc-100 " +
  "prose-code:text-sm prose-code:bg-zinc-100 dark:prose-code:bg-zinc-800 " +
  "prose-code:px-1 prose-code:py-0.5 prose-code:rounded";

export function MarkdownBody({ children }: { children: string }) {
  return (
    <div className={PROSE_CLASSES}>
      <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{children}</ReactMarkdown>
    </div>
  );
}
