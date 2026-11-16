/**
 * What the Add panel offers at the place it inserts into: each entry with the
 * reason a place refuses it, kept while its inputs are, and the placement, lock
 * and wording each refusal is judged and said by.
 *
 * @module insert-panel-offers
 */

import {
  allBlocks,
  asPermittedList,
  permittedLabel,
  placementSiteIn,
  planInsertPattern,
  registryNestingSource,
  type BlockDocument,
  type ComponentLookup,
  type NestingSource,
  type NestingVerdict,
  type OpPosition,
  type PlacementSources,
  type PlacementVerdict,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import {
  placementWording,
  refusalWording,
  type RefusalWording,
} from "./drag-refusal";
import type { EditorState } from "./editor-state";
import {
  entryContentRefusal,
  offeredIn,
  withEntryContentField,
} from "./entry-content-rules";
import { insertLockAt, type InsertLock } from "./insert-lock";
import type { InsertPanelProps } from "./insert-panel-types";
import {
  blockLabel,
  blockSourceFor,
  catalogFrom,
  componentEntriesFrom,
  entryVerdictAt,
  insertionCandidates,
  insertionFor,
  nodeForComponentEntry,
  nodeForEntry,
  patternEntriesFrom,
  registrySlotSource,
  slotsShowingEmpty,
  type BlockInsertEntry,
  type ComponentInsertEntry,
  type EntryPlacement,
  type InsertionCandidate,
  type InsertEntry,
  type PatternInsertEntry,
} from "./inserter";
import { lockRefusalWording, type LockRefusalFacts } from "./lock-refusal";
import { refusalAnnouncement } from "./move-refusal";
import type { BuilderOp } from "./op-vocabulary";
import { usePreviewedCollection } from "./previewed-entry";
import { withArticle } from "./with-article";

/**
 * One entry as the panel offers it at the current place: where a click puts
 * it, or why it cannot go there.
 */
export type EntryOffer =
  | {
      readonly entry: InsertEntry;
      readonly place: InsertionCandidate;
      /**
       * Whether the place is past the one the placement line names, because
       * that one refuses this entry: the tile then says where it goes.
       */
      readonly climbed: boolean;
      readonly refusal?: undefined;
    }
  | {
      readonly entry: InsertEntry;
      readonly place?: undefined;
      readonly climbed?: undefined;
      readonly refusal: string;
    };

/**
 * The lookup a host that supplies none is judged under: nothing resolves.
 *
 * One shared instance rather than a `new Map()` per render, because the
 * catalogue memo is keyed on it and a fresh empty map each render would
 * rebuild the catalogue on every keystroke of the filter.
 */
const NO_DEFINITIONS: ComponentLookup = new Map();

/** No offers, while they are not being looked at. */
const NO_OFFERS: ReadonlyMap<string, EntryOffer> = new Map();

/** What {@link useInsertOffers} reads: the panel's own sources of blocks. */
export type InsertOffersInputs = Pick<
  InsertPanelProps,
  | "editor"
  | "definitions"
  | "patterns"
  | "components"
  | "componentDefinitions"
  | "nesting"
  | "inside"
  | "onInsert"
> & {
  /**
   * Whether to judge the offers at all. The editor's search keeps this hook
   * mounted while it is closed, and judging every entry against every place on
   * each edit is work nobody is looking at. `true` when absent.
   */
  enabled?: boolean;
};

/** What can be added, where each would go, and the act of adding one. */
export interface InsertOffers {
  /** Blocks, then saved patterns and components, in one list. */
  readonly catalog: readonly InsertEntry[];
  /** The places a click may use, in the order they are tried. */
  readonly candidates: readonly InsertionCandidate[];
  /** Each entry's offer, by entry id: its place, or why it has none. */
  readonly offers: ReadonlyMap<string, EntryOffer>;
  /** The definitions an insert builds a block's children from. */
  readonly blockSource: Parameters<typeof nodeForEntry>[1];
  /** Add an entry where its offer says, or nothing when it was refused. */
  readonly insert: (offer: EntryOffer | undefined) => void;
}

/**
 * The Add panel's offers and its insert, as a hook.
 *
 * The panel and the editor's search both call this, so a search row says the
 * place a tile would and adds there by the same path: one answer to "what can
 * be added here, and where does it go".
 *
 * @experimental
 */
export function useInsertOffers({
  editor,
  definitions,
  patterns,
  components,
  componentDefinitions,
  nesting,
  inside,
  onInsert,
  enabled = true,
}: InsertOffersInputs): InsertOffers {
  // ONE snapshot, taken per mount, that both the catalog and the default
  // expansion below read. The panel documents its palette as read once per
  // mount rather than subscribed to, and a second reading of the registry
  // taken later is a different list: a plugin registering while the panel is
  // open would leave a row offering one definition's version and props while
  // its children came from another.
  const palette = React.useMemo(
    () => definitions ?? allBlocks(),
    [definitions]
  );
  const source = React.useMemo(
    () => nesting ?? registryNestingSource(),
    [nesting]
  );
  // Blocks, then whatever saved patterns and components the host supplied.
  // One list rather than three, because the offer, the tokens and the filter
  // all run across every tier; the tabs then show their share of it. A block
  // only a template may hold is offered only while one is open.
  const documentKind = editor.document.kind;
  const catalog = React.useMemo<InsertEntry[]>(
    () => [
      ...catalogFrom(palette).filter(entry =>
        offeredIn(documentKind, entry.blockName)
      ),
      ...patternEntriesFrom(patterns ?? [], source, componentDefinitions),
      ...componentEntriesFrom(
        components ?? [],
        componentDefinitions ?? NO_DEFINITIONS
      ),
    ],
    [palette, patterns, components, componentDefinitions, source, documentKind]
  );
  // The field an Entry content block draws once placed: the template's
  // collection's first top-level blocks field, so the stored choice is
  // explicit from the start.
  const blocksFields = usePreviewedCollection()?.blocksFields;
  const firstBlocksField = blocksFields?.[0]?.name;
  // Whether the field a placed Entry content block names can be filled: not
  // while the collection's fields are on their way.
  const entryFieldsKnown = blocksFields !== undefined;

  // Inside a list the canvas shows empty, a block goes to its empty state.
  const showingEmpty = editor.listsShowingEmpty;
  const slotSource = React.useMemo(
    () => slotsShowingEmpty(registrySlotSource(), showingEmpty),
    [showingEmpty]
  );

  // Derived from the SAME snapshot the catalog is, so the row an author sees
  // and the subtree an insert builds cannot come from two different readings.
  // The palette may be a caller-supplied subset holding a definition the
  // registry does not, and the block being inserted is the one whose
  // declaration is read — so resolving only against the registry would offer
  // that block and then insert it without the children it declares.
  const blockSource = React.useMemo(() => blockSourceFor(palette), [palette]);

  // Recomputed from the CURRENT document and selection on every render rather
  // than remembered. A place is only valid against the document it was read
  // from, and an undo or a remote edit can move it without the selection
  // changing — a memo keyed on the selection alone would keep a position whose
  // index no longer names the same place.
  const candidates = insertionCandidates(editor.document, editor.selectedId, {
    slots: slotSource,
    ...(inside === undefined ? {} : { inside }),
  });

  // Remembered by what the verdicts depend on — the document, the places, the
  // catalog, the rule's sources and the locks — and not by the query, so a
  // keystroke asks no rule anything: judging a pattern walks its forest and a
  // component composes its definition, once per entry and place.
  const offerCache = React.useRef<OfferCache | undefined>(undefined);
  const offers = !enabled
    ? NO_OFFERS
    : cachedOffers(offerCache, {
        document: editor.document,
        candidates,
        catalog,
        source,
        components: componentDefinitions,
        expansion: { definitions: blockSource, nesting },
        editor,
        entryFieldsKnown,
      });
  /*
   * Add an entry where its offer says, or nothing when it was refused.
   *
   * The guard is the whole of what a refused tile does on a click or an Enter:
   * it stays reachable so its reason can be read, and choosing it changes
   * nothing.
   */
  const insert = (offer: EntryOffer | undefined) => {
    if (offer?.place === undefined) return;
    const { entry } = offer;
    const at = offer.place.at;
    if (entry.kind === "pattern") {
      insertPattern(entry, at);
      return;
    }
    if (entry.kind === "component") {
      insertComponent(entry, at);
      return;
    }
    // `nesting` rather than `source`. They differ exactly when the caller
    // supplied no rules: `source` has already defaulted to the REGISTRY, which
    // knows nothing about a supplied definition and so reports every one of its
    // types as unrestricted. Passing it defeats the fallback in
    // `expandSlotDefaults`, which derives the rules from these same
    // definitions — the only source that can see a supplied block's `parent`
    // and its slots' `allow`.
    const node = withEntryContentField(
      nodeForEntry(entry, blockSource, nesting),
      firstBlocksField
    );
    // `apply` is the only path a document changes by, so undo covers this
    // insert for free. It answers null when the op is refused, and a refusal
    // must not be reported as an insert — the panel offers only placements the
    // rule permits, so a null here means the document moved underneath it.
    if (editor.apply({ kind: "insert", node, at }) === null) return;
    // Selecting what was just added is what makes a second insert land after
    // it, so repeated inserts build downward instead of stacking at one point.
    editor.select(node.id);
    onInsert?.(node);
  };

  /**
   * Place a component: ONE insert of an instance node.
   *
   * No planner, because there is nothing to plan — a pattern is a forest that
   * has to be re-identified and judged root by root against the destination,
   * while an instance is a single node whose content lives in the definition.
   * The placement was judged when the tile was offered, by the definition's
   * roots, so a refusal here means the document moved underneath the panel.
   */
  const insertComponent = (entry: ComponentInsertEntry, at: OpPosition) => {
    const node = nodeForComponentEntry(entry);
    // Whether the PAGE has room for it — the one refusal the tile could not
    // make, because room moves with every edit — is the editor's own apply's
    // to make: it asks the resolver with the node in place, under the caps it
    // enforces, and tells the host why when it refuses. A null here is that
    // refusal, or a document that moved under the panel.
    if (editor.apply({ kind: "insert", node, at }) === null) return;
    editor.select(node.id);
    onInsert?.(node);
  };

  /**
   * Place a saved pattern: a whole forest, re-identified, as ONE edit.
   *
   * Through `planInsertPattern` rather than by building ops here. The planner
   * is the dry run — it mints ids that do not collide with the page, records
   * where each root was copied from, and refuses everything the apply would —
   * so a second construction in this file would be a second answer to what
   * inserting a pattern means.
   *
   * `applyAll`, so the whole group is one undo step. A pattern placed as
   * several inserts would come back one root at a time, which is not what the
   * author did.
   */
  const insertPattern = (entry: PatternInsertEntry, at: OpPosition) => {
    const plan = planInsertPattern(
      editor.document,
      { id: entry.patternId, document: entry.document },
      at,
      source,
      // The same lookup the catalogue judged the tile's roots by, so the offer
      // and the mutation resolve one forest. Without it the planner reads a
      // nested instance as its own unregistered type: unrestricted under a
      // parent rule, and barred by any slot naming what it admits.
      componentDefinitions
    );
    // A refusal here means the document moved underneath the panel: the
    // catalogue offers only patterns the planner accepts, judged against the
    // same rules. Reported as no insert rather than as a failed one.
    if (plan.pageOps === undefined) return;
    if (editor.applyAll(plan.pageOps) === null) return;

    // The FIRST root, so a second insert lands after the group rather than
    // inside it — the same rule the block path follows by selecting what it
    // just added.
    const first = plan.pageOps.find((op: BuilderOp) => op.kind === "insert");
    if (first === undefined || first.kind !== "insert") return;
    editor.select(first.node.id);
    onInsert?.(first.node);
  };

  return { catalog, candidates, offers, blockSource, insert };
}

/** What the offer was computed from, and the offer. */
interface OfferCache {
  readonly document: unknown;
  readonly candidates: string;
  readonly catalog: unknown;
  readonly source: unknown;
  readonly components: unknown;
  readonly definitions: unknown;
  readonly nesting: unknown;
  readonly editor: unknown;
  readonly entryFieldsKnown: boolean;
  readonly offers: ReadonlyMap<string, EntryOffer>;
}

/** What each entry's offer is judged from. */
interface OfferInputs {
  readonly document: BlockDocument;
  readonly candidates: readonly InsertionCandidate[];
  readonly catalog: readonly InsertEntry[];
  readonly source: NestingSource;
  readonly components: ComponentLookup | undefined;
  readonly expansion: EntryPlacement["expansion"];
  /** The lock rules and caps a place's locks are read with (`insert-lock`). */
  readonly editor: Pick<
    EditorState,
    "lockDefinitions" | "limits" | "lockRefusalFor"
  >;
  /** Whether the template's collection's blocks fields are known yet. */
  readonly entryFieldsKnown: boolean;
}

/**
 * Each entry's offer, judged again only when an input the verdicts read has
 * changed. Every input is compared by identity except the places, which are
 * rebuilt per render and so are compared by value.
 */
function cachedOffers(
  cache: { current: OfferCache | undefined },
  inputs: OfferInputs
): ReadonlyMap<string, EntryOffer> {
  const candidates = JSON.stringify(inputs.candidates);
  const held = cache.current;
  if (
    held !== undefined &&
    held.document === inputs.document &&
    held.candidates === candidates &&
    held.catalog === inputs.catalog &&
    held.source === inputs.source &&
    held.components === inputs.components &&
    held.definitions === inputs.expansion.definitions &&
    held.nesting === inputs.expansion.nesting &&
    held.editor === inputs.editor &&
    held.entryFieldsKnown === inputs.entryFieldsKnown
  ) {
    return held.offers;
  }
  const offers = offersFor(inputs);
  cache.current = {
    document: inputs.document,
    candidates,
    catalog: inputs.catalog,
    source: inputs.source,
    components: inputs.components,
    definitions: inputs.expansion.definitions,
    nesting: inputs.expansion.nesting,
    editor: inputs.editor,
    entryFieldsKnown: inputs.entryFieldsKnown,
    offers,
  };
  return offers;
}

/**
 * Each entry's offer: the first place that takes it, by
 * {@link insertionFor} over the places a click may use, or — when none does —
 * the reason the FIRST place refused it, which is the one the placement line
 * names and so the one the author is asking about.
 */
function offersFor(inputs: OfferInputs): ReadonlyMap<string, EntryOffer> {
  // What a place reads for every entry, worked out once per place.
  const places = new Map(
    inputs.candidates.map(candidate => [
      candidate,
      placeContext(inputs, candidate),
    ])
  );
  const offers = new Map<string, EntryOffer>();
  for (const entry of inputs.catalog) {
    // A rule about the whole document refuses the entry wherever it goes: a
    // template's one Entry content block, already placed.
    const anywhere =
      entry.kind === "block"
        ? entryContentRefusal(
            inputs.document,
            entry.blockName,
            inputs.entryFieldsKnown
          )
        : undefined;
    if (anywhere !== undefined) {
      offers.set(entry.id, { entry, refusal: anywhere });
      continue;
    }
    const first: { refusal: string | undefined } = { refusal: undefined };
    const taken = insertionFor(inputs.candidates, candidate => {
      const context = places.get(candidate);
      if (context === undefined) return undefined;
      const refusal = refusalAt(inputs, entry, candidate, context);
      if (candidate === inputs.candidates[0]) first.refusal = refusal;
      return refusal === undefined ? candidate : undefined;
    });
    offers.set(
      entry.id,
      taken === undefined
        ? {
            entry,
            refusal:
              first.refusal ?? "This can't be added to the page from here.",
          }
        : {
            entry,
            place: taken.answer,
            climbed: taken.answer !== inputs.candidates[0],
          }
    );
  }
  return offers;
}

/** What judging any entry at one place reads, asked once per place. */
interface PlaceContext {
  readonly placement: EntryPlacement | undefined;
  /** The locks at this place, read from the structure around it. */
  readonly locks: InsertLock;
  /**
   * The locks' answer for the catalog's first block here, which a pattern or
   * a component follows: each arrives as a block of its own type, which no
   * lock's starting blocks name. Asked on first use.
   */
  readonly firstBlockLock: () => LockRefusalFacts | undefined;
}

/** {@link PlaceContext} for one place, its locks read lazily. */
function placeContext(
  inputs: OfferInputs,
  candidate: InsertionCandidate
): PlaceContext {
  const firstBlock = inputs.catalog.find(
    (entry): entry is BlockInsertEntry => entry.kind === "block"
  );
  const locks = insertLockAt(inputs.document, candidate.at, {
    definitions: inputs.editor.lockDefinitions,
    nesting: inputs.source,
    limits: inputs.editor.limits,
    ask: inputs.editor.lockRefusalFor,
  });
  const asked: { answer?: LockRefusalFacts; done: boolean } = { done: false };
  return {
    placement: placementAt(inputs, candidate.at),
    locks,
    firstBlockLock: () => {
      if (!asked.done && firstBlock !== undefined) {
        const answer = lockAt(inputs, locks, firstBlock);
        if (answer !== undefined) asked.answer = answer;
      }
      asked.done = true;
      return asked.answer;
    },
  };
}

/**
 * Why an entry cannot go at a place, in the words the author reads, or
 * nothing when it can: the one placement rule first, then the locks.
 *
 * Each block is judged by its own insert, the store's own question: where a
 * locked slot is already broken, inserting the block it is missing can repair
 * it while any other block breaks it further, so one block's answer is not
 * every block's.
 */
function refusalAt(
  inputs: OfferInputs,
  entry: InsertEntry,
  candidate: InsertionCandidate,
  context: PlaceContext
): string | undefined {
  const verdict = entryVerdictAt(
    entry,
    candidate.target,
    inputs.source,
    inputs.components,
    context.placement
  );
  if (!verdict.allowed) {
    return (
      belongsInsideWording(verdict, entry) ??
      refusalAnnouncement(placementRefusal(verdict, entry, candidate))
    );
  }
  const lock =
    entry.kind === "block"
      ? lockAt(inputs, context.locks, entry)
      : context.firstBlockLock();
  return lock === undefined
    ? undefined
    : refusalAnnouncement(lockRefusalWording(lock));
}

/**
 * What the locks say of inserting one block at a place, from the structure
 * there: no trial insert, which runs only for the block actually added, in
 * the editor's apply.
 */
function lockAt(
  inputs: OfferInputs,
  locks: InsertLock,
  entry: BlockInsertEntry
): LockRefusalFacts | undefined {
  return locks.of(
    nodeForEntry(entry, inputs.expansion.definitions, inputs.expansion.nesting)
  );
}

/**
 * The placement rule's refusal in the words a drop's refusal uses, so an
 * author reads one sentence for one rule wherever they meet it. A block is
 * the subject, and named beside whatever inside it was refused; a pattern or
 * a component is named by the block of it that was refused.
 */
function placementRefusal(
  verdict: Exclude<NestingVerdict | PlacementVerdict, { allowed: true }>,
  entry: InsertEntry,
  candidate: InsertionCandidate
): RefusalWording {
  const regionType =
    candidate.target.kind === "slot" ? candidate.target.parentType : undefined;
  if ("blockType" in verdict) {
    return placementWording(
      verdict,
      entry.kind === "block" ? entry.blockName : verdict.blockType,
      regionType
    );
  }
  // Judged by the name rules alone, which name no block: the entry's own
  // type, or its first root's.
  return refusalWording(
    { reason: verdict.reason, permitted: verdict.permitted },
    subjectTypeOf(entry),
    regionType
  );
}

/**
 * A refusal whose rule names the containers an entry belongs inside, said as
 * one plain instruction: "Goes inside an Accordion. Select an Accordion
 * first, or drag this into one."
 *
 * Generated from the rule, never per block: the containers are the rule's
 * own permitted list, and the second sentence offers only what the tile can
 * do (a block can be dragged; a pattern or a component cannot). Selecting
 * such a container works because a click falls back to inside the selection.
 * Anything else, or a rule about a block nested within the entry, keeps the
 * shared refusal wording.
 */
function belongsInsideWording(
  verdict: Exclude<NestingVerdict | PlacementVerdict, { allowed: true }>,
  entry: InsertEntry
): string | undefined {
  if (
    verdict.reason !== "restricted-at-root" &&
    verdict.reason !== "wrong-parent"
  ) {
    return undefined;
  }
  if ("blockType" in verdict && verdict.blockType !== subjectTypeOf(entry)) {
    return undefined;
  }
  const containers = verdict.permitted.map(name =>
    withArticle(permittedLabel(name, blockLabel))
  );
  if (containers.length === 0) return undefined;
  const select =
    containers.length === 1
      ? `Select ${containers[0]} first`
      : "Select one first";
  const drag = entry.kind === "block" ? ", or drag this into one." : ".";
  return `Goes inside ${asPermittedList(containers, "or")}. ${select}${drag}`;
}

/** The block type an entry is named by in a refusal. */
function subjectTypeOf(entry: InsertEntry): string {
  if (entry.kind === "block") return entry.blockName;
  if (entry.kind === "component") return entry.roots[0] ?? entry.label;
  return entry.document.nodes[0]?.type ?? entry.label;
}

/**
 * A place as the one placement rule sees it, with what its ancestors refuse.
 * Undefined when the position's parent is not in the document, which the
 * name rules then judge alone.
 *
 * The rule reads block declarations from the palette's own source, the one
 * its catalog and its inserts read, so a definition the host supplied is the
 * one judged rather than the registry's under the same name.
 */
function placementAt(
  inputs: OfferInputs,
  at: OpPosition
): EntryPlacement | undefined {
  const sources: PlacementSources = {
    nesting: inputs.source,
    definitions: inputs.expansion.definitions,
    ...(inputs.components === undefined
      ? {}
      : { components: inputs.components }),
  };
  const site = placementSiteIn(
    inputs.document.nodes,
    at.parentId === undefined
      ? { kind: "root" }
      : { kind: "slot", parentId: at.parentId, slot: at.slot ?? "" },
    sources
  );
  return site === undefined
    ? undefined
    : { site, sources, expansion: inputs.expansion };
}
