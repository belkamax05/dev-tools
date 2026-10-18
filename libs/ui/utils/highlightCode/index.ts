/// <reference lib="dom.iterable" />
/// <reference lib="dom.asynciterable" />
// highlight.js includes DOM types; their iterator companions keep Bun streams iterable.
import { common, createLowlight } from 'lowlight';

export interface CodeToken {
  text: string;
  role: string;
}
interface SyntaxNode {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: SyntaxNode[];
}
const highlighter = createLowlight(common);
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const languages: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'xml',
  svg: 'xml',
  xml: 'xml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  sql: 'sql',
  diff: 'diff',
};

/** Highlight whole files before splitting lines, preserving multiline comment/string state. */
const highlightCode = (text: string, path: string) => {
  const language = languages[path.split('.').at(-1)?.toLowerCase() ?? ''];
  let tree: SyntaxNode = { type: 'text', value: text };
  if (language && highlighter.registered(language)) {
    try {
      tree = highlighter.highlight(language, text);
    } catch {
      /* Plain text fallback. */
    }
  }
  const lines: CodeToken[][] = [[]];
  const visit = (node: SyntaxNode, inherited = '') => {
    const classes = node.properties?.className;
    const role = Array.isArray(classes)
      ? String(classes.find((name) => String(name).startsWith('hljs-')) ?? inherited)
      : inherited;
    if (node.type === 'text') {
      const chunks = (node.value ?? '').replaceAll('\t', '    ').split('\n');
      chunks.forEach((chunk, index) => {
        if (index) lines.push([]);
        if (chunk) lines.at(-1)!.push({ text: chunk, role });
      });
    } else node.children?.forEach((child) => visit(child, role));
  };
  visit(tree);
  if (text.endsWith('\n')) lines.pop();
  return lines;
};

/** Wrap tokens by terminal cells so both sides can reserve identical physical row heights. */
export const wrapCodeLine = (tokens: CodeToken[], width: number) => {
  const rows: CodeToken[][] = [[]];
  let used = 0;
  for (const token of tokens)
    for (const { segment } of segments.segment(token.text)) {
      const cells = Bun.stringWidth(segment);
      if (used && used + cells > width) {
        rows.push([]);
        used = 0;
      }
      const row = rows.at(-1)!;
      const last = row.at(-1);
      if (last?.role === token.role) last.text += segment;
      else row.push({ text: segment, role: token.role });
      used += cells;
    }
  return rows;
};

export default highlightCode;
