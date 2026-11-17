/**
 * Where an insert could land around the selected block: the candidates inside
 * it and after it, in the order the kind of block being added tries them, and
 * the position each one inserts at.
 *
 * @module insertion-candidates
 */

import {
  allBlocks,
  findNode,
  locateNode,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type PlacementTarget,
} from "@nextlyhq/blocks-engine";

import { SECTION_BLOCK } from "../../block-shortcuts";
import { emptySlotOf } from "../../canvas/empty-slot";
import { positionOf, type OpPosition } from "../../op-vocabulary";

import type { InsertEntry, SlotSource } from "./inserter-types";

/**
 * What kind of block an entry adds, which decides the order its places are
 * tried in.
 *
 * - `content`: anything that is not a layout block (Heading, Text, Image,
 *   Button, Divider, Accordion, Gallery…), which goes inside a selected block
 *   that holds blocks.
 * - `layout`: a block in the Layout group that holds blocks (Box, Columns,
 *   Column, Card), which goes after the selection, so Box then Box stays two
 *   siblings.
 * - `band`: a Section or a saved section, a band of the page, which goes
 *   after the top-level block holding a nested selection.
 */
export type EntryRole = "content" | "layout" | "band";

/**
 * One place a click in the Add panel may put a block, and what it goes after.
 *
 * `afterId` names the block the new one follows ("Adding after Heading"), and
 * is absent at the end of the page and inside a container. `between` is an
 * explicit place someone chose, a gap between two blocks: `afterId` and
 * `beforeId` name the blocks either side, either absent at an end.
 */
export interface InsertionCandidate {
  readonly kind:
    | "after-selection"
    | "after-ancestor"
    | "document-end"
    | "inside"
    | "between";
  readonly at: OpPosition;
  readonly target: PlacementTarget;
  readonly afterId?: string;
  /** The block a `between` place comes before. */
  readonly beforeId?: string;
  /** The container a block goes inside, for `inside`. */
  readonly insideId?: string;
}

/** What {@link insertionCandidates} reads besides the page and selection. */
export interface InsertionOptions {
  /** A container someone chose to add into (its "+"): that place only. */
  readonly inside?: string;
  /** A place someone chose, such as a gap between two blocks: that only. */
  readonly at?: OpPosition;
  /**
   * A block someone chose to add right after (a gap's "+"): the place just
   * after it, in its own region, only. Resolved against the page as it is
   * now, so an undo that moves the block moves the place with it.
   */
  readonly after?: string;
  /** The regions each block type declares, for "inside". */
  readonly slots?: SlotSource;
  /** What kind of block is being added; a content block when absent. */
  readonly role?: EntryRole;
}

/**
 * Where a click may put a block, in the order the places are tried. The ONE
 * answer every surface asks: a click or Enter on an Add panel tile, the
 * Components panel, search, the panel's line and each tile's description.
 *
 * - An explicit place (`at`, a gap's `after`, or a container's `inside`) is
 *   that place only.
 * - Nothing selected, or a selection the page no longer holds: the end of
 *   the page.
 * - A Section or saved section with a selection inside another block: after
 *   the top-level block holding it, so a band never lands inside a band.
 * - A content block with a selection that holds blocks: inside it, at the
 *   end of its shown region, then after it, then after each block around
 *   it, out to the page.
 * - A layout block (or a Section at the top level) with a selection that
 *   holds blocks: after it, then after each block around it, and inside it
 *   only last, for a block that belongs only there (a Column in Columns).
 * - A selection that holds no blocks: after it, then outward.
 *
 * Which place a given block takes is {@link insertionFor}'s question, asked
 * of the placement rule: the first that accepts it.
 */
export function insertionCandidates(
  document: BlockDocument,
  selectedId: string | null,
  options: InsertionOptions = {}
): InsertionCandidate[] {
  if (options.at !== undefined) return explicitCandidates(document, options.at);
  if (options.after !== undefined) {
    const location = locateNode(document.nodes, options.after);
    const after =
      location === undefined
        ? undefined
        : afterCandidate(location, options.after, true);
    return after === undefined ? [] : explicitCandidates(document, after.at);
  }
  if (options.inside !== undefined) {
    return insideCandidates(document, options.inside, options.slots);
  }
  const end: InsertionCandidate = {
    kind: "document-end",
    at: { index: document.nodes.length },
    target: { kind: "root" },
  };
  if (selectedId === null) return [end];
  const after = afterCandidates(document, selectedId);
  if (after.length === 0) return [end];
  const outermost = after.at(-1);
  if (
    options.role === "band" &&
    after.length > 1 &&
    outermost?.target.kind === "root"
  ) {
    return [outermost];
  }
  const inside = insideCandidates(document, selectedId, options.slots);
  return (options.role ?? "content") === "content"
    ? [...inside, ...after]
    : [...after, ...inside];
}

/**
 * After the selected block, in its own region, then after each block it sits
 * in, out to the page: a block a region refuses goes after the nearest
 * container that can hold it.
 */
function afterCandidates(
  document: BlockDocument,
  selectedId: string
): InsertionCandidate[] {
  const candidates: InsertionCandidate[] = [];
  let current: string | undefined = selectedId;
  // Bounded by the document's depth: each step moves one parent out.
  while (current !== undefined) {
    const location = locateNode(document.nodes, current);
    const after =
      location === undefined
        ? undefined
        : afterCandidate(location, current, current === selectedId);
    if (location === undefined || after === undefined) break;
    candidates.push(after);
    current = location.parent?.id;
  }
  return candidates;
}

/**
 * An explicit place, named by the blocks either side of it: "between Hero
 * and Pricing", or after the last block of its region. None when the
 * container it is in is gone.
 */
function explicitCandidates(
  document: BlockDocument,
  at: OpPosition
): InsertionCandidate[] {
  const region = regionAt(document, at);
  if (region === undefined) return [];
  const { held, target, containerId } = region;
  const before = held[at.index]?.id;
  const after = at.index > 0 ? held[at.index - 1]?.id : undefined;
  if (before !== undefined) {
    return [
      {
        kind: "between",
        at,
        target,
        ...(after === undefined ? {} : { afterId: after }),
        beforeId: before,
      },
    ];
  }
  if (after !== undefined) {
    return [{ kind: "after-ancestor", at, target, afterId: after }];
  }
  return containerId === undefined
    ? [{ kind: "document-end", at, target }]
    : [{ kind: "inside", at, target, insideId: containerId }];
}

/**
 * The region a position is in: the blocks it holds, the target it implies,
 * and the container it belongs to (none at the page's top level). None when
 * that container is gone.
 */
function regionAt(
  document: BlockDocument,
  at: OpPosition
):
  | {
      readonly held: readonly BlockNode[];
      readonly target: PlacementTarget;
      readonly containerId?: string;
    }
  | undefined {
  if (at.parentId === undefined) {
    return { held: document.nodes, target: { kind: "root" } };
  }
  const parent = findNode(document.nodes, at.parentId);
  if (parent === undefined) return undefined;
  const slot = at.slot ?? "";
  return {
    held: parent.slots?.[slot] ?? [],
    target: { kind: "slot", parentType: parent.type, slot },
    containerId: parent.id,
  };
}

/** The end of a container's region the author chose to add into, if it has one. */
function insideCandidates(
  document: BlockDocument,
  insideId: string,
  slots: SlotSource | undefined
): InsertionCandidate[] {
  const container = findNode(document.nodes, insideId);
  if (container === undefined) return [];
  const slot =
    emptySlotOf(container, slots) ??
    slots?.shownSlotOf?.(container) ??
    Object.keys(container.slots ?? {})[0];
  if (slot === undefined) return [];
  const held = container.slots?.[slot] ?? [];
  return [
    {
      kind: "inside",
      at: { parentId: container.id, slot, index: held.length },
      target: { kind: "slot", parentType: container.type, slot },
      insideId: container.id,
    },
  ];
}

/**
 * The place just after one block in its own region, or `undefined` where no op
 * can name it (a parent with no named slot).
 */
function afterCandidate(
  location: NonNullable<ReturnType<typeof locateNode>>,
  id: string,
  selected: boolean
): InsertionCandidate | undefined {
  let here: OpPosition;
  try {
    here = positionOf(location);
  } catch {
    return undefined;
  }
  return {
    kind: selected ? "after-selection" : "after-ancestor",
    at: { ...here, index: here.index + 1 },
    target:
      location.parent === undefined
        ? { kind: "root" }
        : {
            kind: "slot",
            parentType: location.parent.type,
            slot: location.slot ?? "",
          },
    afterId: id,
  };
}

/**
 * The place a block takes: the first of the candidates whose region accepts
 * it, by the caller's reading of the placement rule, or `undefined` when none
 * does (and the panel says why).
 */
export function insertionFor<T>(
  candidates: readonly InsertionCandidate[],
  accepts: (candidate: InsertionCandidate) => T | undefined
): { readonly candidate: InsertionCandidate; readonly answer: T } | undefined {
  for (const candidate of candidates) {
    const answer = accepts(candidate);
    if (answer !== undefined) return { candidate, answer };
  }
  return undefined;
}

/**
 * The group the block library files its layout blocks under: a block in it
 * that holds blocks is a layout block.
 */
const LAYOUT_CATEGORY = "layout";

/**
 * Each entry's {@link EntryRole}, by entry id, read from what its blocks
 * already declare: their group and their regions. A plugin block needs no
 * field of its own to be placed as a layout block.
 *
 * - a saved section is a `band`, and so is a Section block;
 * - a block is `layout` when it is in the Layout group and holds blocks;
 * - a component is `layout` when any of its top-level blocks is one;
 * - everything else is `content`.
 *
 * `definitions` are the palette's own, read before the registry's, as the
 * insert reads them; a component's blocks may be outside the palette, so the
 * registry answers for the rest.
 */
export function entryRoles(
  catalog: readonly InsertEntry[],
  definitions: readonly AnyBlockDefinition[] | undefined
): ReadonlyMap<string, EntryRole> {
  const byName = definitionsByName(definitions);
  const isLayout = (type: string): boolean => {
    const definition = byName.get(type);
    return (
      definition?.editor?.category === LAYOUT_CATEGORY &&
      Object.keys(definition.slots ?? {}).length > 0
    );
  };
  const roles = new Map<string, EntryRole>();
  for (const entry of catalog) {
    roles.set(entry.id, roleOf(entry, isLayout));
  }
  return roles;
}

/** One entry's role, given which block types are layout blocks. */
function roleOf(
  entry: InsertEntry,
  isLayout: (type: string) => boolean
): EntryRole {
  if (entry.kind === "pattern") return "band";
  if (entry.kind === "component") {
    return entry.roots.some(isLayout) ? "layout" : "content";
  }
  if (entry.blockName === SECTION_BLOCK) return "band";
  return isLayout(entry.blockName) ? "layout" : "content";
}

/**
 * Every registered block definition by name, with the supplied ones written
 * second, so they WIN for a name in both: the palette offered that
 * definition, so the insert must build, and place, that block. Read ONCE, so
 * one reading answers every lookup of a catalogue's build.
 */
export function definitionsByName(
  definitions: readonly AnyBlockDefinition[] | undefined
): ReadonlyMap<string, AnyBlockDefinition> {
  const byName = new Map<string, AnyBlockDefinition>();
  for (const definition of allBlocks()) byName.set(definition.name, definition);
  for (const definition of definitions ?? []) {
    byName.set(definition.name, definition);
  }
  return byName;
}
