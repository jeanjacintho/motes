import { fromMarkdown } from 'mdast-util-from-markdown';

// Not a mention when glued to a word, an email, a path or an escape; the name ends where a
// word character, an underscore, a hyphenated continuation or a domain suffix would continue it.
const MENTION =
  /(?<![A-Za-z0-9_@\\./+-])@([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_@]|\.[A-Za-z0-9])/g;
const MAX_SLUG_LENGTH = 64;

type Node = {
  type: string;
  children?: Node[];
  position?: { start: { offset?: number | undefined }; end: { offset?: number | undefined } };
};

/** Source text of every prose node, in document order; code, quotes and raw HTML are skipped. */
function proseOf(node: Node, source: string, out: string[]): void {
  if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'blockquote') return;
  if (node.type === 'text') {
    // The raw slice keeps escapes like `\@`, which the parsed value would have resolved.
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) out.push(source.slice(start, end));
    return;
  }
  for (const child of node.children ?? []) proseOf(child, source, out);
}

/**
 * The bot slugs mentioned in a comment's markdown, in order of first appearance and without
 * repeats. Code (fenced, indented, inline) and quoted blocks do not count. Whether a slug names a
 * real bot is not decided here.
 */
export function parseMentions(markdown: string): string[] {
  const source = markdown.replace(/\r\n?/g, '\n');
  const prose: string[] = [];
  proseOf(fromMarkdown(source) as Node, source, prose);
  const found: string[] = [];
  for (const text of prose) {
    for (const match of text.matchAll(MENTION)) {
      const slug = match[1];
      if (slug && slug.length <= MAX_SLUG_LENGTH && !found.includes(slug)) found.push(slug);
    }
  }
  return found;
}
