import { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import Icon from "../ui/Icon";
import { normalizeMath } from "../../lib/mathText";

// Never show red error text: unparseable TeX falls back to neutral monospace (styled in chat.css)
const KATEX_OPTIONS = { throwOnError: false, errorColor: "inherit", strict: "ignore" as const };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CodeBlock({ className, children, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const code = String(children).replace(/\n$/, "");
  const inline = !match && !String(children).includes("\n");

  if (inline) {
    return <code className="md-inline-code" {...props}>{children}</code>;
  }

  return (
    <div className="md-code">
      <div className="md-code__head">
        <span>{match ? match[1] : "text"}</span>
        <button
          className="md-code__copy"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
          aria-label="Copy code"
        >
          <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre><code className={className}>{children}</code></pre>
    </div>
  );
}

/** Markdown + GFM tables + KaTeX + code blocks. Memoised so streaming only re-renders the last message. */
const MessageView = memo(function MessageView({ content }: { content: string }) {
  // Display formulas must stand on their own lines to render as blocks
  const markdown = useMemo(() => normalizeMath(content), [content]);
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
        components={{
          code: CodeBlock,
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
});

export default MessageView;
