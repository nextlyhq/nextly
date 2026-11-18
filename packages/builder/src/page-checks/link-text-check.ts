/**
 * The link text check: a link or button with no words, or with only vague
 * ones ("click here", "read more"), and a linked icon with no label.
 *
 * Screen reader users often list a page's links and buttons on their own, so
 * each one's words must say where it goes or what it does without the text
 * around it. A screen reader label stands in for a button's words, and words
 * bound to a field are the entry's to give. The vague-text list is English,
 * the language the builder edits.
 *
 * @module page-checks/link-text-check
 */
import { walkNodes, type BlockNode } from "@nextlyhq/blocks-engine";

import type { PageCheck, PageCheckResult } from "./page-checks";
import { eachRichTextNode, richTextWords } from "./rich-text-parts";

/** Words that say nothing of where a link goes, compared as normalized. */
const VAGUE_WORDS: ReadonlySet<string> = new Set([
  "click here",
  "click",
  "here",
  "read more",
  "more",
  "learn more",
  "more info",
  "more information",
  "find out more",
  "details",
  "link",
  "this link",
  "this",
  "go",
  "continue",
]);

/** Words as compared: lower case, spaces collapsed, edge punctuation gone. */
function normalized(words: string): string {
  return words
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "");
}

/** Whether the words only say "click here" or the like. */
function isVague(words: string): boolean {
  return VAGUE_WORDS.has(normalized(words));
}

/** A prop's text, trimmed; anything that is not text reads as none. */
function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Whether a prop is bound to a field. */
function bound(node: BlockNode, prop: string): boolean {
  return node.bindings?.[prop] !== undefined;
}

/** Whether a block links somewhere: an address, an entry, or a bound one. */
function links(node: BlockNode): boolean {
  const { href, entryCollection, entryId } = node.props;
  return (
    textOf(href) !== "" ||
    bound(node, "href") ||
    (textOf(entryCollection) !== "" && textOf(entryId) !== "")
  );
}

const WHY_EMPTY =
  "Screen readers announce it as just “link” or “button”, so people can’t tell what it does.";
const WHY_VAGUE =
  "People who list a page’s links hear only these words, out of context, so they can’t tell where it goes.";

/** A Button with no words, or only vague ones. */
function buttonFindings(node: BlockNode): PageCheckResult[] {
  if (textOf(node.props.ariaLabel) !== "" || bound(node, "label")) return [];
  const label = textOf(node.props.label);
  const fix = { tab: "content", id: "label" } as const;
  if (label === "") {
    return [
      {
        nodeId: node.id,
        what: "Button has no text",
        why: WHY_EMPTY,
        todo: "Write what the button does in Label.",
        fix,
      },
    ];
  }
  if (!isVague(label)) return [];
  return [
    {
      nodeId: node.id,
      what: "Button text doesn’t say where it goes",
      why: WHY_VAGUE,
      todo: "Say where it goes in Label, like “See pricing”, or add a Screen reader label.",
      fix,
    },
  ];
}

/** An Icon that links somewhere with no label to read in its place. */
function iconFindings(node: BlockNode): PageCheckResult[] {
  if (!links(node) || textOf(node.props.label) !== "" || bound(node, "label")) {
    return [];
  }
  return [
    {
      nodeId: node.id,
      what: "Icon button has no label",
      why: "Screen readers can’t read a picture of an icon, so people can’t tell what it does.",
      todo: "Say what it does in Screen reader label, like “Open the menu”.",
      fix: { tab: "content", id: "label" },
    },
  ];
}

/** A link's words judged: none, vague, or fine. */
function linkWordsFinding(
  node: BlockNode,
  words: string,
  part: string,
  fix?: PageCheckResult["fix"]
): PageCheckResult | undefined {
  const at = { nodeId: node.id, part, ...(fix === undefined ? {} : { fix }) };
  if (words.trim() === "") {
    return {
      ...at,
      what: "Link has no text",
      why: WHY_EMPTY,
      todo: "Give the link words that say where it goes.",
    };
  }
  if (!isVague(words)) return undefined;
  return {
    ...at,
    what: `Link text doesn’t say where it goes: “${words.trim()}”`,
    why: WHY_VAGUE,
    todo: "Use words that say where it goes, like “Read our pricing”.",
  };
}

/** A Heading that links, judged by its words; the links in rich text. */
function linkFindings(node: BlockNode): PageCheckResult[] {
  const found: PageCheckResult[] = [];
  if (node.type === "core/heading" && links(node) && !bound(node, "text")) {
    const finding = linkWordsFinding(node, textOf(node.props.text), "heading", {
      tab: "content",
      id: "text",
    });
    if (finding !== undefined) found.push(finding);
  }
  let index = 0;
  eachRichTextNode(node, part => {
    if (part.type !== "link") return;
    const finding = linkWordsFinding(
      node,
      richTextWords(part),
      `link-${String(index)}`
    );
    index += 1;
    if (finding !== undefined) found.push(finding);
  });
  return found;
}

/** Every link and button on the page with no words, or only vague ones. */
export const LINK_TEXT_CHECK: PageCheck = {
  id: "link-text",
  group: "accessibility",
  run: page => {
    const found: PageCheckResult[] = [];
    walkNodes(page.document.nodes, node => {
      if (node.type === "core/button") found.push(...buttonFindings(node));
      else if (node.type === "core/icon") found.push(...iconFindings(node));
      else found.push(...linkFindings(node));
    });
    return found;
  },
};
