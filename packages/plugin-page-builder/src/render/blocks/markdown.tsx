import { createElement, type ReactNode } from "react";

import { safeUrl } from "./util";

/**
 * A tiny, SAFE Markdown subset → React elements. We never emit raw HTML; every node is
 * a known element built from parsed tokens, so there is no injection surface. Supports
 * headings (#..######), unordered (`- `) and ordered (`1. `) lists, blank-line-separated
 * paragraphs, and inline **bold**, *italic*, `code`, and [text](url) (url is scheme-checked).
 */

/**
 * Inline formatting → safe elements. Supports **bold**, *italic*, `code`,
 * [text](url), ==highlight== (mark), ~~strike~~ (del), ^sup^ (sup), ~sub~ (sub).
 * Order matters: `~~` (strike) is matched before `~` (sub).
 */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(==([^=]+)==)|(~~([^~]+)~~)|(\^([^^]+)\^)|(~([^~]+)~)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) out.push(<strong key={i}>{m[2]}</strong>);
    else if (m[4] !== undefined) out.push(<em key={i}>{m[4]}</em>);
    else if (m[6] !== undefined) out.push(<code key={i}>{m[6]}</code>);
    else if (m[8] !== undefined) {
      const href = safeUrl(m[9]);
      out.push(
        href ? (
          <a key={i} href={href}>
            {m[8]}
          </a>
        ) : (
          m[8]
        )
      );
    } else if (m[11] !== undefined) out.push(<mark key={i}>{m[11]}</mark>);
    else if (m[13] !== undefined) out.push(<del key={i}>{m[13]}</del>);
    else if (m[15] !== undefined) out.push(<sup key={i}>{m[15]}</sup>);
    else if (m[17] !== undefined) out.push(<sub key={i}>{m[17]}</sub>);
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Back-compat alias used internally by renderMarkdown. */
const inline = renderInline;

export function renderMarkdown(md: string): ReactNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let key = 0;

  const flushPara = () => {
    if (!para.length) return;
    blocks.push(<p key={key++}>{inline(para.join(" "))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems.map((t, i) => <li key={i}>{inline(t)}</li>);
    blocks.push(
      createElement(listOrdered ? "ol" : "ul", { key: key++ }, items)
    );
    listItems = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (line.trim() === "") {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      const level = `h${heading[1].length}`;
      blocks.push(createElement(level, { key: key++ }, inline(heading[2])));
    } else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (listItems.length && ordered !== listOrdered) flushList();
      listOrdered = ordered;
      listItems.push((ul ?? ol)![1]);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}
