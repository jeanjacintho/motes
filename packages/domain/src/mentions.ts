const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^( *(?:[-*+]|\d{1,9}[.)]))(\s+)/;
const QUOTE = /^ {0,3}>/;

// Not a mention when glued to a word, an email, a path or an escape; the name ends where a
// word character, an underscore, a hyphenated continuation or a domain suffix would continue it.
const MENTION =
  /(?<![A-Za-z0-9_@\\./+-])@([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_@]|\.[A-Za-z0-9])/g;
const MAX_SLUG_LENGTH = 64;

function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === ' ') width++;
    else if (char === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

/** Drops fenced and indented code blocks and quoted lines, keeping everything else line by line. */
function stripBlocks(markdown: string): string {
  let fence: { char: string; length: number } | undefined;
  let previousBlank = true;
  let inIndentedCode = false;
  // Content columns of the open list items, outermost first; code inside one is four further in.
  const openItems: number[] = [];
  const kept: string[] = [];
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence) {
      const closing = new RegExp(`^ {0,3}${fence.char}{${fence.length},}\\s*$`);
      if (closing.test(line)) fence = undefined;
      continue;
    }
    const opening = FENCE_OPEN.exec(line);
    // A backtick fence cannot carry backticks in its info string, or it is inline code.
    if (opening?.[1] && !(opening[1].startsWith('`') && opening[2]?.includes('`'))) {
      fence = { char: opening[1].charAt(0), length: opening[1].length };
      previousBlank = false;
      inIndentedCode = false;
      continue;
    }
    if (line.trim() === '') {
      previousBlank = true;
      kept.push('');
      continue;
    }
    const indented = /^(?: {4}|\t)/.test(line);
    const width = indentWidth(line);
    // A line indented less than an item's content has left that item.
    while (openItems.length > 0 && (openItems.at(-1) ?? 0) > width) openItems.pop();
    const content = openItems.at(-1) ?? 0;
    // Indented code cannot interrupt a paragraph, and inside a list it is code only when it sits
    // four columns past the item's content.
    if (indented && (previousBlank || inIndentedCode) && width >= content + 4) {
      inIndentedCode = true;
      previousBlank = false;
      continue;
    }
    inIndentedCode = false;
    previousBlank = false;
    if (QUOTE.test(line)) continue;
    // A marker nested in an open item may sit deeper than three spaces, but not as deep as code.
    const item = width < content + 4 ? LIST_ITEM.exec(line) : null;
    if (item) openItems.push((item[1] ?? '').length + Math.min((item[2] ?? '').length, 4));
    kept.push(line);
  }
  return kept.join('\n');
}

/** Removes `code spans`: a run of n backticks closes at the next run of exactly n. */
function stripCodeSpans(text: string): string {
  let result = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] !== '`') {
      result += text[index];
      index++;
      continue;
    }
    let end = index;
    while (text[end] === '`') end++;
    const run = text.slice(index, end);
    let close = text.indexOf(run, end);
    while (close >= 0 && (text[close - 1] === '`' || text[close + run.length] === '`'))
      close = text.indexOf(run, close + 1);
    if (close < 0) {
      result += run;
      index = end;
    } else {
      // A space keeps the text on either side of the span from fusing into one token.
      result += ' ';
      index = close + run.length;
    }
  }
  return result;
}

/**
 * The bot slugs mentioned in a comment's markdown, in order of first appearance and without
 * repeats. Code (fenced, indented, inline) and quoted lines do not count. Whether a slug names a
 * real bot is not decided here.
 */
export function parseMentions(markdown: string): string[] {
  const text = stripCodeSpans(stripBlocks(markdown));
  const found: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const slug = match[1];
    if (slug && slug.length <= MAX_SLUG_LENGTH && !found.includes(slug)) found.push(slug);
  }
  return found;
}
