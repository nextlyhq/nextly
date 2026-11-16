/**
 * What the inserter may offer, and where a chosen entry would land.
 *
 * Pure, and separate from the panel that draws it, for the reason
 * `shell-state` gives: this is set membership and derivation, none of it needs
 * React, and a component test in jsdom cannot assert it — jsdom reports every
 * element as zero-sized and renders a filtered list identically to an unfiltered
 * one that happens to be short. The decisions are made here, where they can be
 * asserted; the panel only draws what this returns.
 *
 * **The palette and the insert must agree, and that is why the target travels
 * with the position.** A panel that decides what to OFFER from one reading and
 * inserts against another will show a block, accept the click, and have the op
 * layer refuse it — a refusal the author cannot act on, because the thing they
 * were offered is the thing that was rejected. {@link insertionCandidates}
 * therefore hands out each place as a position AND the target it implies, and
 * everything downstream takes the target from it rather than recomputing one.
 *
 * **The nesting rule is CALLED, never restated.** `canBeRoot` and `canNest`
 * come from the engine, which documents itself as the one implementation
 * precisely because a canvas judging a drop and a validator judging a stored
 * document are the same question at different moments.
 *
 * This module answers where an entry may be inserted and the node it inserts,
 * and is the entry for the rest: the entries' shapes are in
 * `inserter-types.ts`, building the catalog in `inserter-catalog.ts`, the
 * palette's search and groups in `inserter-palette.ts`, and the places an
 * insert could land in `insertion-candidates.ts`.
 *
 * @module inserter
 */

import {
  allBlocks,
  expandSlotDefaults,
  makeNode,
  placementTypesOf,
  canPlace,
  placementVerdict,
  registryBlockSource,
  COMPONENT_INSTANCE_TYPE,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type ComponentLookup,
  type NestingSource,
  type NestingVerdict,
  type PlacedNode,
  type PlacementSite,
  type PlacementSources,
  type PlacementTarget,
  type PlacementVerdict,
  type SlotDefaultSource,
} from "@nextlyhq/blocks-engine";

import type {
  BlockInsertEntry,
  InsertEntry,
  SlotSource,
} from "./inserter-types";

// The entries' shapes, building the catalog, grouping and searching the
// palette, and where an insert may land live in modules of their own beside
// this one; every name this module exported still is.
export {
  blockLabel,
  catalogFrom,
  COMPONENT_ENTRY_PREFIX,
  componentEntriesFrom,
  type CompositionRefusal,
  compositionRefusal,
  insertionPropSets,
  nodeForComponentEntry,
  PATTERN_ENTRY_PREFIX,
  patternEntriesFrom,
  unplaceableComponentEntries,
  variationLabel,
} from "./inserter-catalog";
export {
  categoryHeading,
  filterEntries,
  groupByCategory,
  type InsertGroup,
  paletteGroups,
} from "./inserter-palette";
export {
  type BlockInsertEntry,
  COMPONENT_CATEGORY,
  type ComponentInsertEntry,
  type InsertEntry,
  type InsertTarget,
  type PatternInsertEntry,
  type SavedComponent,
  type SavedPattern,
  type SlotSource,
  slotsShowingEmpty,
  UNCATEGORISED,
  type PlacementTarget,
} from "./inserter-types";
export {
  type InsertionCandidate,
  insertionCandidates,
  insertionFor,
} from "./insertion-candidates";

/**
 * Whether this entry may be placed at this target, and why not when it may not.
 *
 * The verdict travels rather than a boolean, because a caller explaining a
 * refusal is the only place the reason is still known — and recovering it means
 * classifying the placement a second time.
 *
 * BOTH halves are asked, and the child's first. `block.ts` is explicit that
 * neither implies the other: a slot naming a type does not confine that type to
 * it, and a child restricting its parents says nothing about which of that
 * parent's slots may hold it. Asking only the allow-list would offer a column
 * at the page root; asking only `parent` would let anything into a slot that
 * names what it holds.
 *
 * The child's half runs first so its reason survives when both would refuse.
 * "This block belongs inside a Columns" tells an author where to go; "this
 * region does not take that block" leaves them looking for a region, which is
 * the less actionable of the two sentences.
 */
export function entryAllowedAt(
  entry: InsertEntry,
  target: PlacementTarget,
  source: NestingSource,
  definitions?: ComponentLookup
): NestingVerdict {
  // A pattern and a component are both judged by their ROOTS. The instance
  // node's own type is not a registered block, and the nesting source answers
  // "no restriction" for a type it cannot resolve — so judging the instance by
  // its type would let a component whose root is a section be placed inside a
  // paragraph. The definition's roots are what will actually render there,
  // and a component's were read through the canvas's lookup when it was
  // offered.
  if (entry.kind === "pattern") {
    return rootsAllowedAt(entry.document, target, source, definitions);
  }
  if (entry.kind === "component") {
    return placementVerdict(entry.roots, target, source);
  }
  return blockAllowedAt(entry.blockName, target, source);
}

/**
 * Whether every root of a pattern may sit at a target.
 *
 * A pattern arrives as a FOREST and is inserted as one atomic group, so it goes
 * where all of its roots go: offering one whose second root the destination
 * refuses would accept the click and then have the planner reject the whole
 * insert, which is the palette-and-drop disagreement this module exists to
 * prevent. `planInsertPattern` asks exactly this before it plans, root by root,
 * against the same rule.
 *
 * The FIRST refusal is returned rather than a collected list, and the reason is
 * the point: a verdict names one restriction and the set that produced it, so
 * an author is told where the thing they picked can go. A refusal summarising
 * three roots would name none of them.
 *
 * Only the roots. A pattern's INTERNAL nesting is a property of the pattern
 * rather than of the destination — it is the same wherever it is offered — so
 * it belongs to whatever judges the pattern itself, not to a question about
 * this target.
 *
 * Each root is resolved as a placed node is ({@link placementTypesOf}): a
 * pattern is COPIED into the page as it stands, and one of its roots may be a
 * component instance — saving a placed component as a pattern stores exactly
 * that node. Judged by its own type, which is not a registered block and which
 * the nesting source therefore restricts nowhere, such a pattern was offered
 * where the component's own tile is refused.
 */
function rootsAllowedAt(
  document: BlockDocument,
  target: PlacementTarget,
  source: NestingSource,
  definitions?: ComponentLookup
): NestingVerdict {
  return placementVerdict(
    document.nodes.flatMap(root => placementTypesOf(root, definitions)),
    target,
    source
  );
}

/**
 * The block types a node ALREADY ON THE PAGE is judged by when it moves.
 *
 * The engine's rule, re-exported here because this is where the builder's
 * placement questions are answered and every one of them asks it: the drag,
 * the keyboard move, a pattern's roots, and — in the engine itself — the
 * planners the click runs. One implementation, so an offer cannot resolve
 * against a forest the mutation judges raw.
 */
export { placementTypesOf };

/**
 * Whether a block type may be placed at a target, by NAME.
 *
 * The same rule as {@link entryAllowedAt} and the same code, reached without a
 * palette entry. A drag moves a node that already exists, so the only thing it
 * has is a type name — and asking the question a second way is how the palette
 * and the canvas come to disagree about where a block may go, with the palette
 * offering what the drop refuses.
 *
 * Both halves are asked, because a placement needs both to agree and neither is
 * derivable from the other: `parent` is the child saying where it makes sense,
 * a slot's `allow` is the container saying what it holds.
 *
 * The child's half runs first so its reason survives when both would refuse.
 * "This block belongs inside a Columns" tells an author where to go; "this
 * region does not take that block" leaves them looking for a region, which is
 * the less actionable of the two sentences.
 */
export function blockAllowedAt(
  blockName: string,
  target: PlacementTarget,
  source: NestingSource
): NestingVerdict {
  return placementVerdict([blockName], target, source);
}

/**
 * The entries a target will actually accept: {@link entryVerdictAt}'s allowed
 * ones, for a caller that needs the set rather than each reason.
 */
export function allowedEntries<TEntry extends InsertEntry>(
  entries: readonly TEntry[],
  target: PlacementTarget,
  source: NestingSource,
  definitions?: ComponentLookup,
  placement?: EntryPlacement
): TEntry[] {
  // Derived from the verdict rather than asked beside it, so the set and the
  // reasons the panel shows for what is left out come from one question.
  return entries.filter(
    entry =>
      entryVerdictAt(entry, target, source, definitions, placement).allowed
  );
}

/**
 * Whether one entry may be placed at a target, with the rule's reason when it
 * may not.
 *
 * The verdict rather than a boolean, because the Add panel keeps a refused
 * entry in view and says why: an author who cannot see a block has no way to
 * learn where it would go.
 */
export function entryVerdictAt(
  entry: InsertEntry,
  target: PlacementTarget,
  source: NestingSource,
  definitions?: ComponentLookup,
  /**
   * The place as the one placement rule sees it: the site, with what its
   * ancestors refuse, and what an insert expands a block's starting children
   * from. Absent, the entry is judged by the name rules alone.
   */
  placement?: EntryPlacement
): NestingVerdict | PlacementVerdict {
  // Present, the placement rule is the whole answer: it asks the name rules
  // itself, of the same parent and slot, for a component's roots read through
  // `placement.sources.components`, which is why that has to be the lookup
  // the catalog was built with. Asking `entryAllowedAt` beside it would ask
  // each name rule twice.
  return placement === undefined
    ? entryAllowedAt(entry, target, source, definitions)
    : canPlace(
        insertedBy(entry, placement.expansion),
        placement.site,
        placement.sources
      );
}

/** What {@link allowedEntries} needs to judge entries by the one placement rule. */
export interface EntryPlacement {
  readonly site: PlacementSite;
  /**
   * Where the rule reads its answers. `components` is the lookup the catalog's
   * component and pattern entries were read through: the rule judges a
   * placement by the roots it reads there, and without it a placement's roots
   * are unknown and restrict nothing.
   */
  readonly sources: PlacementSources;
  /**
   * The pair a click insert hands {@link nodeForEntry}, so a block is judged
   * with exactly the children its insert seeds.
   */
  readonly expansion: {
    readonly definitions: SlotDefaultSource;
    readonly nesting: NestingSource | undefined;
  };
}

/**
 * What an entry would insert, as the placement rule reads it: a block as
 * {@link nodeForEntry} builds it, starting children included, a pattern's
 * blocks, or a component placement.
 *
 * A block is built by the insert's own function rather than described as its
 * type and props: a block whose slot starts with a clickable child is refused
 * under a linked card for that child, and judging the empty shell would offer
 * a row whose click the store then refuses.
 */
function insertedBy(
  entry: InsertEntry,
  expansion: EntryPlacement["expansion"]
): readonly PlacedNode[] {
  switch (entry.kind) {
    case "block":
      return [nodeForEntry(entry, expansion.definitions, expansion.nesting)];
    case "pattern":
      return entry.document.nodes;
    case "component":
      return [
        {
          type: COMPONENT_INSTANCE_TYPE,
          props: { componentId: entry.componentId },
        },
      ];
  }
}

/**
 * The node a BLOCK entry inserts, carrying whatever children its block declares
 * it starts with.
 *
 * Blocks only, and the parameter says so rather than the body branching. One
 * pattern is a forest, re-identified against the ids the destination already
 * holds and planned as one atomic group — `planInsertPattern` in the engine —
 * so there is no single node to hand back, and a function returning one for a
 * pattern would have to invent an answer or throw.
 *
 * Props are deep-copied. The entry outlives every insert made from it, so
 * handing out its own object would let an edit to one inserted block reach the
 * catalog — and through it every block inserted from that entry afterwards.
 * A shallow copy is not enough, because a default value may be an array or a
 * nested object and those would still be shared.
 *
 * The children come from `expandSlotDefaults` rather than from anything written
 * here, so "what does this slot start with" is answered in one place: the block
 * declares it, the engine expands it with ids minted per instance, and a
 * container that declares nothing still arrives with no `slots` key at all.
 * Building the children here instead would put a second answer beside the
 * declaration, and the two would agree only until one of them changed.
 */
export function nodeForEntry(
  entry: BlockInsertEntry,
  definitions: SlotDefaultSource,
  nesting?: NestingSource
): BlockNode {
  return makeNode(
    entry.blockName,
    entry.version,
    structuredClone(entry.props),
    // The nesting source travels with the definitions rather than being
    // rederived inside the engine. A caller that supplies its own rules uses
    // them to decide what may be OFFERED, and a seeded child that skipped them
    // would be a placement the caller's own rules forbid, arriving by being
    // declared rather than chosen.
    expandSlotDefaults(entry.blockName, definitions, nesting)
  );
}

/**
 * The registry as a block-definition source, re-exported from the engine.
 *
 * Defined there rather than here because the save validator reads the same
 * source to check a locked slot's children, and two readings of one registry
 * agree only until one of them changes.
 */
export { registryBlockSource };

/**
 * The definitions an insert expands declared starting children from, given the
 * palette's own catalog.
 *
 * Supplied definitions are consulted FIRST and the registry second, which is
 * what keeps the offer and the insert reading one declaration. A caller may
 * hand the palette a definition the registry does not hold — a host block, a
 * fixture — and the catalog then offers it; resolving only against the registry
 * would find no declaration for that block and insert it stripped of the
 * children it declares, silently, because an absent declaration and a declared
 * emptiness are the same answer.
 *
 * The fallback is the other half and not a leftover: an entry names child TYPES
 * the supplied list has no reason to contain, so those still resolve against
 * everything registered. Consulting the supplied list first changes which
 * declaration wins for a name in both, and that is the intended order — the
 * palette offered THAT definition, so the insert must build THAT block.
 */
export function blockSourceFor(
  definitions: readonly AnyBlockDefinition[] | undefined
): SlotDefaultSource {
  // Both readings are taken ONCE, here, rather than on each lookup. A source
  // that consulted the live registry per call would answer from a different
  // set of definitions than the catalog its caller built alongside it, so a
  // row offered from one reading could be inserted with children from another.
  const byName = new Map<string, AnyBlockDefinition>();
  for (const definition of allBlocks()) byName.set(definition.name, definition);
  // Supplied definitions are written second, so they WIN for a name in both:
  // the palette offered that definition, so the insert must build that block.
  for (const definition of definitions ?? []) {
    byName.set(definition.name, definition);
  }
  return { get: type => byName.get(type) };
}

/**
 * The registry as a slot source.
 *
 * DERIVED from `registryBlockSource` rather than reading the registry again:
 * the names of a block's slots are a narrower view of its declaration, and two
 * readings of one registry would agree until one of them learned to filter.
 *
 * Here rather than beside either caller. The palette asks it where an insert
 * would land and the canvas asks it which regions a drag can aim at, and those
 * two have to agree: a container the palette will fill but the drag cannot see
 * is a block that behaves differently depending on how an author reached it.
 */
export function registrySlotSource(): SlotSource {
  const definitions = registryBlockSource();
  return {
    slotsOf: type => {
      const declared = definitions.get(type)?.slots;
      return declared === undefined ? undefined : Object.keys(declared);
    },
  };
}
