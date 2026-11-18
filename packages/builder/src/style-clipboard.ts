/**
 * What "Copy style" takes from a block, and what a paste says.
 *
 * A copied style is the block's own values, at every state and device, and
 * the classes it wears: its block style, its text style and its shared
 * styles, as its class list holds them. Nothing else: its words, images and
 * links stay where they are. The paste itself is `batchStylePasteOps`, the
 * batch style path every multi-block edit takes, so it is one undo step.
 *
 * Kept in the editor rather than on the system clipboard, so copying a style
 * never replaces text or blocks the author copied.
 *
 * @module style-clipboard
 */
import {
  findNode,
  type AnyBlockDefinition,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import type { SkippedSettings, StyleSource } from "./batch-style";
import { blockLabel } from "./panels/add/inserter-catalog";

/** Said when "Paste style" is chosen before any style was copied. */
export const NOTHING_COPIED_YET =
  "Copy a block's style first: choose Copy style on the block that looks right.";

/**
 * The style "Copy style" takes from a block: a copy of its own values and
 * its class list, so a later edit of the block doesn't change what is
 * pasted. `null` for a block that is not on the page.
 */
export function copiedStyleOf(
  document: BlockDocument,
  id: string
): StyleSource | null {
  const node = findNode(document.nodes, id);
  if (node === undefined) return null;
  return {
    styles:
      node.styles === undefined ? undefined : structuredClone(node.styles),
    classes: [...(node.classes ?? [])],
  };
}

/**
 * The words for what the targets had no place for, one sentence per kind of
 * block ("3 settings don't apply to Image."), or `undefined` when nothing
 * was skipped. Every block of one kind skips the same settings of one
 * source, so each kind is named once.
 */
export function skippedSettingsWords(
  skipped: readonly SkippedSettings[],
  lookup?: (type: string) => AnyBlockDefinition | undefined
): string | undefined {
  const byType = new Map<string, number>();
  for (const each of skipped) {
    if (!byType.has(each.type)) byType.set(each.type, each.count);
  }
  if (byType.size === 0) return undefined;
  return [...byType]
    .map(([type, count]) => {
      const name = blockLabel(type, lookup);
      return count === 1
        ? `1 setting doesn't apply to ${name}.`
        : `${String(count)} settings don't apply to ${name}.`;
    })
    .join(" ");
}
