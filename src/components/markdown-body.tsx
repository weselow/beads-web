import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkBreaks from "remark-breaks";

import "highlight.js/styles/github-dark.css";


const PROSE_CLASSES =
  "prose prose-sm dark:prose-invert max-w-none " +
  // Tighten vertical rhythm: prose-sm defaults are tuned for long-form docs,
  // not the terse bead fields rendered here.
  "prose-p:my-2 prose-headings:mt-3 prose-headings:mb-2 " +
  "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 " +
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 " +
  "prose-pre:bg-zinc-900 prose-pre:text-zinc-100 " +
  "prose-code:text-sm prose-code:bg-zinc-100 dark:prose-code:bg-zinc-800 " +
  "prose-code:px-1 prose-code:py-0.5 prose-code:rounded";

export function MarkdownBody({ children }: { children: string }) {
  return (
    <div className={PROSE_CLASSES}>
      <ReactMarkdown remarkPlugins={[remarkBreaks]} rehypePlugins={[rehypeHighlight]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
