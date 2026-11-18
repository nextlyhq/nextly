/**
 * A written email's blocks in plain words, for a person comparing two
 * versions: what each block is and says, with each variable named in
 * brackets. Not the email itself: no markup and no Liquid.
 *
 * @module domains/email/written/describe
 */

import type {
  Chip,
  Condition,
  ContentBlock,
  Inline,
  PlainInline,
  WrittenBlock,
  WrittenLink,
} from "./document";

/** A variable as the reader sees it, with its fallback when it has one. */
function chip(c: Chip): string {
  return c.fallback ? `[${c.variable}, or "${c.fallback}"]` : `[${c.variable}]`;
}

/** The characters a description gives meaning to: marks, variables, breaks. */
const MARKUP = /[\\*_[\]↵]/g;

/**
 * A run's text or variable as written: spaces kept and a line break shown as
 * `↵`, so a change only to either still reads as a change, on one line. Text
 * that looks like a mark, a variable or a break is escaped with a backslash,
 * so literal `**Pay**` never reads the same as bold `Pay`.
 */
function shown(part: PlainInline | Inline): string {
  const text =
    part.type === "text"
      ? part.text.replace(MARKUP, char => `\\${char}`)
      : chip(part);
  return text.replace(/\r?\n/g, "↵");
}

/** Plain text with its variables: a heading, a button's label, alt text. */
function words(parts: ReadonlyArray<PlainInline>): string {
  return parts.map(shown).join("");
}

/**
 * Rich text with its variables, each run with its marks as they are written
 * by hand (`**bold**`, `_italic_`) and each link right after its run, so a
 * change only to a mark or a link reads as one.
 */
function richWords(parts: ReadonlyArray<Inline>): string {
  return parts
    .map(part => {
      let run = shown(part);
      if (part.italic) run = `_${run}_`;
      if (part.bold) run = `**${run}**`;
      return part.link ? `${run} (links to ${address(part.link)})` : run;
    })
    .join("");
}

function address(link: WrittenLink): string {
  return "url" in link ? link.url : chip(link.chip);
}

function shownWhen(condition: Condition | undefined): string {
  if (!condition) return "";
  const when =
    condition.when === "present"
      ? "has a value"
      : condition.when === "yes"
        ? "is yes"
        : "is no";
  return ` (shown when ${condition.variable} ${when})`;
}

function contentLine(block: ContentBlock): string {
  switch (block.type) {
    case "heading":
      return `Heading: ${words(block.text)}`;
    case "text":
      return `Text: ${richWords(block.text)}`;
    case "button":
      return `Button: ${words(block.label)} → ${address(block.link)}`;
    case "image": {
      const src = "url" in block.src ? block.src.url : chip(block.src.chip);
      const width = block.width ? `, ${block.width}px wide` : "";
      return `Image: ${words(block.alt) || "no alt text"} (${src}${width})`;
    }
    case "divider":
      return "Divider";
    case "spacer":
      return `Space (${block.height ?? 24}px)`;
  }
}

/** One block in plain words: a line, or for a list a line and each of its blocks. */
function describeBlock(block: WrittenBlock): string[] {
  if (block.type === "list") {
    return [
      `For each item in ${block.variable}:${shownWhen(block.show)}`,
      ...block.blocks.map(
        inner => `  ${contentLine(inner)}${shownWhen(inner.show)}`
      ),
    ];
  }
  return [`${contentLine(block)}${shownWhen(block.show)}`];
}

/** Blocks in plain words, one line each (a list's blocks indented under it). */
export function describeBlocks(blocks: ReadonlyArray<WrittenBlock>): string[] {
  return blocks.flatMap(describeBlock);
}
