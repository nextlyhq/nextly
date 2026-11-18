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

/**
 * Visit every node of every rich text value the block's props hold, in
 * reading order. Iterative and bounded by the document's node limit, since
 * stored rich text reaches here unvalidated; entries that are not nodes are
 * skipped.
 */
export function eachRichTextNode(
  node: BlockNode,
  visit: (part: RichTextNode) => void
): void {
  for (const value of Object.values(node.props)) {
    if (!isRichTextValue(value)) continue;
    const stack: unknown[] = [...value.root.children].reverse();
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
}

/** The words a rich text node holds, its children's joined in order. */
export function richTextWords(part: RichTextNode): string {
  const words: string[] = [];
  const stack: unknown[] = [part];
  let read = 0;
  while (stack.length > 0 && read < MAX_NODES) {
    const entry = stack.pop();
    read += 1;
    if (!isRichTextNode(entry)) continue;
    if (typeof entry.text === "string") words.push(entry.text);
    const children = Array.isArray(entry.children) ? entry.children : [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
  return words.join("");
}
