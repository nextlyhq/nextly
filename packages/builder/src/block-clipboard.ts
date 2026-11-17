/**
 * Copied blocks: what is put on the clipboard, how it is read back, and where
 * a paste lands.
 *
 * Pure, with no DOM and no React, so every rule here can be asserted on its
 * own; `block-clipboard-transport` moves the text on and off the clipboard and
 * `block-clipboard-verbs` wires both to the editor.
 *
 * ## The copied-blocks format
 *
 * One JSON object: `{ nextlyBlocks: 1, origin, blocks }`.
 *
 * - `nextlyBlocks` is the format's version and also what marks the text as
 *   copied blocks, so text from anywhere else is never read as blocks.
 * - `origin` is the address of the site the blocks were copied on (scheme,
 *   host and port). Blocks point at the site's own shared styles, block
 *   styles, variables, components and media by id, and those ids mean nothing
 *   on another site, so a paste whose origin differs is refused and pointed to
 *   Export / Import, which carries those items with the blocks.
 * - `blocks` are the copied blocks as the page stores them, children
 *   included. Nothing is rewritten on copy: a paste makes the fresh ids.
 *
 * @module block-clipboard
 */

import {
  ENTRY_CONTENT_TYPE,
  findNode,
  holdsEntryContent,
  isPlainRecord,
  nodeShapeRefusal,
  placementTypesOf,
  planPasteBlocks,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type ComponentLookup,
  type NestingSource,
  type PlanRefusal,
} from "@nextlyhq/blocks-engine";
import { z } from "zod";

import { compositionRefusalReason } from "./composition-refusal";
import { entryContentRefusal, offeredIn } from "./entry-content-rules";
import type { BuilderOp, OpPosition } from "./op-vocabulary";
import type { SlotSource } from "./panels/add/inserter-types";
import {
  insertionCandidates,
  insertionFor,
  runRole,
} from "./panels/add/insertion-candidates";
import { normalizeSelection } from "./selection";

/** The clipboard type copied blocks travel under, beside plain text. */
export const BLOCK_CLIPBOARD_TYPE = "application/x-nextly-blocks+json";

/** The version of the copied-blocks format this builder writes and reads. */
export const BLOCK_CLIPBOARD_VERSION = 1;

/** Copied blocks, as they are put on the clipboard. */
export interface CopiedBlocks {
  readonly nextlyBlocks: typeof BLOCK_CLIPBOARD_VERSION;
  /** The address of the site they were copied on. */
  readonly origin: string;
  readonly blocks: readonly BlockNode[];
}

/** Said when copied blocks come from another site. */
export const FOREIGN_SITE_REFUSAL =
  "These blocks were copied on another site, so they can’t be pasted here. To move blocks between sites, save them as a section, then use Export and Import on the Saved sections list.";

/** Said when copied blocks were written in a format this builder does not read. */
export const OTHER_VERSION_REFUSAL =
  "These blocks were copied from a different version of the editor, so they can’t be pasted here. Copy them again.";

/** Said when copied Entry content would land in a page that is not a template. */
const ENTRY_CONTENT_TEMPLATE_ONLY =
  "An Entry content block goes only in a template, so it can’t be pasted here.";

/** Said when Paste finds no copied blocks on the clipboard. */
export const NOTHING_TO_PASTE =
  "There are no copied blocks to paste. Copy blocks first.";

/**
 * The selected blocks as copied blocks, or `null` with nothing selected.
 *
 * Only the outermost selected blocks, in page order: a block selected with
 * the container around it is copied once, inside that container, as Delete
 * removes it once.
 */
export function copyOfSelection(
  document: BlockDocument,
  selectedIds: readonly string[],
  origin: string
): CopiedBlocks | null {
  const blocks = normalizeSelection(document, selectedIds).flatMap(id => {
    const node = findNode(document.nodes, id);
    return node === undefined ? [] : [node];
  });
  if (blocks.length === 0) return null;
  return { nextlyBlocks: BLOCK_CLIPBOARD_VERSION, origin, blocks };
}

/** Copied blocks as the text put on the clipboard. */
export function serializeCopiedBlocks(copied: CopiedBlocks): string {
  return JSON.stringify(copied);
}

/**
 * One block as the op layer would carry it.
 *
 * Any page can put text on the clipboard, so a paste claiming this site's
 * origin is not proof it came from here. What protects the page is what
 * protects every stored page: the op layer's shape rule here, the placement
 * rules the planner asks, and the renderer, which draws a type it does not
 * know as a placeholder and escapes what it draws. The op layer's own shape rule
 * decides, so a paste never accepts a block that rule would then refuse.
 */
const pastedNode = z.custom<BlockNode>(
  value =>
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    // The shape rule is what makes this value a block, so it is handed the
    // value to judge as one; it answers with a reason for anything else.
    nodeShapeRefusal(value as unknown as BlockNode) === undefined
);

/** The envelope, read before the blocks: version and origin first. */
const envelope = z.object({
  nextlyBlocks: z.number(),
  origin: z.string(),
  blocks: z.array(z.unknown()),
});

const pastedBlocks = z.array(pastedNode).min(1);

/** What reading the clipboard's text found. */
export type ReadCopiedBlocks =
  /** Blocks to paste. */
  | { readonly blocks: readonly BlockNode[]; readonly refusal?: undefined }
  /** Copied blocks that cannot be pasted here, and why, in plain words. */
  | { readonly refusal: string; readonly blocks?: undefined }
  /** Not copied blocks at all: the text is left to whatever reads text. */
  | null;

/**
 * Read the clipboard's text as copied blocks.
 *
 * `null` for text that is not copied blocks, so ordinary text is never taken
 * for blocks. Copied blocks from another site, or in another version of the
 * format, are refused with the reason; blocks the op layer would not carry
 * are refused as a selection that cannot be copied.
 */
export function readCopiedBlocks(
  text: string,
  origin: string
): ReadCopiedBlocks {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const read = envelope.safeParse(parsed);
  if (!read.success) return null;
  if (read.data.nextlyBlocks !== BLOCK_CLIPBOARD_VERSION) {
    return { refusal: OTHER_VERSION_REFUSAL };
  }
  if (read.data.origin !== origin) return { refusal: FOREIGN_SITE_REFUSAL };
  const blocks = pastedBlocks.safeParse(read.data.blocks);
  if (!blocks.success) {
    return {
      refusal: compositionRefusalReason({
        problem: read.data.blocks.length === 0 ? "empty" : "invalid-node",
      }),
    };
  }
  return { blocks: blocks.data };
}

/** What a paste needs besides the page, the selection and the blocks. */
export interface PasteSources {
  /** The nesting rule, as every other insert asks it. */
  readonly nesting: NestingSource;
  /** The site's components, so a placed component is judged by what it draws. */
  readonly components?: ComponentLookup;
  /** Block definitions beyond the registry's, for a block's role. */
  readonly definitions?: readonly AnyBlockDefinition[];
  /** Each block type's regions, for pasting inside a container. */
  readonly slots?: SlotSource;
  /**
   * The editor's lock check, phrased: why a lock refuses these ops, or
   * `null`. A place whose lock refuses the paste is passed over for the next
   * one, as the Add panel passes over a locked place for a clicked tile.
   */
  readonly lockRefusal?: (ops: readonly BuilderOp[]) => string | null;
}

/** A paste, planned: the ops and the copies' ids, or why it is refused. */
export type PastePlan =
  | {
      readonly ops: readonly BuilderOp[];
      /** The pasted top-level blocks, in page order, for selecting them. */
      readonly newIds: readonly string[];
      readonly refusal?: undefined;
    }
  | { readonly refusal: string; readonly ops?: undefined };

/**
 * Plan a paste where a click on a tile adding these blocks would land.
 *
 * The places are the Add panel's (`insertionCandidates`), tried in the order
 * that panel tries them for a run of this kind (`runRole`): content goes
 * inside a selected container at its end, after a selected block that holds
 * none, and at the end of the page with nothing selected. The first place the
 * engine's paste planner accepts is taken; when none does, the paste is
 * refused with the first place's reason, in the words every other refused
 * insert uses.
 */
export function planPaste(
  document: BlockDocument,
  selectedId: string | null,
  blocks: readonly BlockNode[],
  sources: PasteSources
): PastePlan {
  // A template holds one Entry content block, so a paste bringing a second
  // is refused as adding one is.
  if (blocks.some(block => holdsEntryContent(block))) {
    // Only a template draws an entry, so anywhere else the block is refused
    // here rather than left for the save to refuse.
    if (!offeredIn(document.kind, ENTRY_CONTENT_TYPE)) {
      return { refusal: ENTRY_CONTENT_TEMPLATE_ONLY };
    }
    const held = entryContentRefusal(document, ENTRY_CONTENT_TYPE);
    if (held !== undefined) return { refusal: held };
  }

  const role = runRole(
    blocks.flatMap(block => placementTypesOf(block, sources.components)),
    sources.definitions
  );
  const candidates = insertionCandidates(document, selectedId, {
    role,
    ...(sources.slots === undefined ? {} : { slots: sources.slots }),
  });
  const planAt = (at: OpPosition) =>
    planPasteBlocks(document, blocks, at, sources.nesting, sources.components);

  const locked = (ops: readonly BuilderOp[]) =>
    sources.lockRefusal?.(ops) ?? null;
  const found = insertionFor(candidates, candidate => {
    const plan = planAt(candidate.at);
    if (plan.pageOps === undefined) return undefined;
    return locked(plan.pageOps) === null ? plan.pageOps : undefined;
  });
  if (found === undefined) {
    // Every place refused, so the reason is the one for where the paste was
    // first meant to go: the planner's, or the lock's there.
    const first = candidates[0];
    const plan = first === undefined ? undefined : planAt(first.at);
    if (plan?.pageOps !== undefined) {
      return {
        refusal:
          locked(plan.pageOps) ??
          compositionRefusalReason({ problem: "destination-locked" }),
      };
    }
    const refusal: PlanRefusal = plan ?? { problem: "invalid-position" };
    return { refusal: compositionRefusalReason(refusal) };
  }
  const ops = found.answer;
  const newIds = ops.flatMap(op => (op.kind === "insert" ? [op.node.id] : []));
  return { ops, newIds };
}
