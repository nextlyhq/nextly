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

/** Text with its variables, on one line. */
function words(parts: ReadonlyArray<PlainInline | Inline>): string {
  return parts
    .map(part => (part.type === "text" ? part.text : chip(part)))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
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
    case "text": {
      const links = block.text.flatMap(part =>
        part.link ? [address(part.link)] : []
      );
      const linked = links.length > 0 ? ` (links to ${links.join(", ")})` : "";
      return `Text: ${words(block.text)}${linked}`;
    }
    case "button":
      return `Button: ${words(block.label)} → ${address(block.link)}`;
    case "image": {
      const src = "url" in block.src ? block.src.url : chip(block.src.chip);
      return `Image: ${words(block.alt) || "no alt text"} (${src})`;
    }
    case "divider":
      return "Divider";
    case "spacer":
      return `Space (${block.height ?? 24}px)`;
  }
}

/** One block in plain words: a line, or for a list a line and each of its blocks. */
export function describeBlock(block: WrittenBlock): string[] {
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
