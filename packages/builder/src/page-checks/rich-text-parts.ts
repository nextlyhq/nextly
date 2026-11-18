/**
 * The rich text a block holds, as the page checks read it: every prop whose
 * value is a stored rich text value, walked node by node in reading order.
 *
 * Shared by the checks that look inside rich text (its headings, its links),
 * so they agree on what a block's rich text is and walk it one way.
 *
 * @module page-checks/rich-text-parts
 */
import {
  isRichTextNode,
  isRichTextValue,
  MAX_NODES,
  type BlockNode,
  type RichTextNode,
} from "@nextlyhq/blocks-engine";

/** An image's alternative text, as the rich text renderer reads it. */
function imageAlt(image: RichTextNode): string {
  const alt = image.altText ?? image.alt;
  return typeof alt === "string" ? alt : "";
}

/**
 * Visit each node from `roots` down, in reading order. Iterative and bounded
 * by the document's node limit, since stored rich text reaches here
 * unvalidated; entries that are not nodes are skipped.
 */
function walkRichText(
  roots: readonly unknown[],
  visit: (part: RichTextNode) => void
): void {
  const stack: unknown[] = [...roots].reverse();
  let read = 0;
  while (stack.length > 0 && read < MAX_NODES) {
    const entry = stack.pop();
    read += 1;
    if (!isRichTextNode(entry)) continue;
    visit(entry);
    const children = Array.isArray(entry.children) ? entry.children : [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
}

/** Visit every node of every rich text value the block's props hold. */
export function eachRichTextNode(
  node: BlockNode,
  visit: (part: RichTextNode) => void
): void {
  for (const value of Object.values(node.props)) {
    if (isRichTextValue(value)) walkRichText(value.root.children, visit);
  }
}

/**
 * The words a rich text node holds, its children's joined in order, an
 * image's alternative text among them, which names a link holding it.
 */
export function richTextWords(part: RichTextNode): string {
  const words: string[] = [];
  walkRichText([part], entry => {
    if (typeof entry.text === "string") words.push(entry.text);
    if (entry.type === "image") words.push(imageAlt(entry));
  });
  return words.join("");
}
