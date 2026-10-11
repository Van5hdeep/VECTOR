/**
 * Makes model output safe for remark-math before rendering:
 *  - converts \[…\] and \(…\) to $$…$$ and $…$
 *  - moves every $$…$$ display formula onto its own lines (remark-math only
 *    treats display math as a block when it stands alone; inline $$ leaks raw TeX)
 * Fenced code blocks and inline code are left untouched.
 */
export function normalizeMath(markdown: string): string {
  // Split out fenced code so we never rewrite code
  const parts = markdown.split(/(```[\s\S]*?(?:```|$))/g);
  return parts
    .map((part) => {
      if (part.startsWith("```")) return part;
      // Protect inline code spans
      const spans: string[] = [];
      let text = part.replace(/`[^`\n]+`/g, (m) => {
        spans.push(m);
        return `\u0000${spans.length - 1}\u0000`;
      });

      text = text
        .replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex: string) => `$$${tex}$$`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex: string) => `$${tex.trim()}$`);

      // Every display formula becomes its own block, separated from prose
      text = text.replace(/[ \t]*\$\$([\s\S]+?)\$\$[ \t]*/g, (_m, tex: string) => `\n\n$$\n${tex.trim()}\n$$\n\n`);
      text = text.replace(/\n{3,}/g, "\n\n");

      return text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => spans[Number(i)]);
    })
    .join("");
}
