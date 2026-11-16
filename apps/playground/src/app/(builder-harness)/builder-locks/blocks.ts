import type { AnyBlockDefinition } from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";

/**
 * The locked blocks this harness edits, one per lock.
 *
 * Each is the core box under another name with its `children` slot locked, so
 * it renders through the box's own render and nothing here draws a block. The
 * starting blocks are core blocks whose props declare what is content: a
 * heading's text is, and its level is not, which is the line a `contentOnly`
 * area holds.
 *
 * Registered by the harness alone, never in the playground's registry or its
 * config, so no other route or page sees them.
 */
const box = coreBlocks.find(block => block.name === "core/box");
if (box === undefined) throw new Error("[builder-locks] core/box is missing");

const heading = { type: "core/heading", props: { text: "Locked title" } };
const paragraph = { type: "core/text", props: { text: "Locked copy" } };

function locked(
  name: string,
  label: string,
  slot: Record<string, unknown>
): AnyBlockDefinition {
  return {
    ...box!,
    name,
    editor: { ...box!.editor, label },
    slots: { children: slot },
  };
}

export const LOCKED_BLOCKS: readonly AnyBlockDefinition[] = [
  locked("e2e/fixed-row", "Fixed row", {
    defaultBlock: [heading, paragraph],
    lock: "all",
  }),
  locked("e2e/loose-row", "Loose row", {
    defaultBlock: [heading, paragraph],
    lock: "insert",
  }),
  locked("e2e/sealed-card", "Sealed card", {
    defaultBlock: [heading],
    lock: "contentOnly",
  }),
  // A contentOnly area around a fixed row, for a repair inside one: the row's
  // own slot inherits contentOnly, so its break is held by both.
  locked("e2e/sealed-shelf", "Sealed shelf", {
    defaultBlock: [{ type: "e2e/fixed-row" }],
    lock: "contentOnly",
  }),
];
