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
 * @module inserter
 */

import {
  allBlocks,
  expandSlotDefaults,
  blockLabelFrom,
  findNode,
  patternRefusal,
  getBlock,
  locateNode,
  makeNode,
  placementTypesOf,
  canPlace,
  placementVerdict,
  composedRootTypes,
  readableDefinition,
  registryBlockSource,
  resolveComponentInstances,
  COMPONENT_INSTANCE_TYPE,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ComponentLookup,
  type ComponentUnresolvedReason,
  type DocumentLimits,
  type NestingSource,
  type NestingVerdict,
  type PlacedNode,
  type PlacementSite,
  type PlacementSources,
  type PlacementTarget,
  type PlacementVerdict,
  type ResolvedComposition,
  type SlotDefaultSource,
} from "@nextlyhq/blocks-engine";

import { EDITOR_WORDS } from "./editor-words";
import { emptySlotOf } from "./empty-slot";
import { positionOf, type OpPosition } from "./op-vocabulary";

/**
 * The category an entry falls under when its block declares none.
 *
 * A literal rather than an empty string, because the panel groups by this value
 * and a heading has to be nameable. Blocks arrive from plugins that need not
 * categorise themselves, so this is the common case for third-party blocks
 * rather than an error state.
 */
export const UNCATEGORISED = "other";

/**
 * The one category every component entry falls under, whatever its row says.
 *
 * A component is the site's own, placed as a link back to its definition, and
 * an author looks for it apart from the library's blocks: filing it under the
 * row's category would scatter the site's components among blocks they look
 * nothing like. Namespaced so no plugin's free-string category can collide
 * with it.
 */
export const COMPONENT_CATEGORY = "nextly:components";

/**
 * One offerable BLOCK: a block, or a block under one of its named variations.
 *
 * Two tiers in one list rather than a nested structure, because the panel
 * filters and keyboard-navigates across both and a nested shape would make
 * every consumer flatten it first. The third tier — patterns — is
 * {@link PatternInsertEntry}, a separate member of {@link InsertEntry} rather
 * than a block wearing extra fields: a pattern has no block name, no version
 * and no props, so folding it in here would make four fields optional on the
 * common case and leave every reader handling an absence blocks never produce.
 */
export interface BlockInsertEntry {
  /**
   * Which tier this is.
   *
   * Carried on the entry rather than inferred from which fields are present.
   * A shape test — "does it have a `blockName`" — is a second statement of the
   * same fact, and it answers wrongly the first time a tier gains a field the
   * test happens to name.
   */
  readonly kind: "block";
  /**
   * Stable identity, for React keys and for naming a selection across a
   * re-filter.
   *
   * Derived from the block and variation names rather than an index, because a
   * search narrows the list and an index-keyed selection would silently follow
   * the position instead of the entry — the highlighted row changing meaning
   * under the author as they type.
   */
  readonly id: string;
  readonly blockName: string;
  /** Absent on a block's own entry; present on each of its variations. */
  readonly variationName?: string;
  readonly label: string;
  readonly description: string;
  readonly category: string;
  readonly keywords: readonly string[];
  readonly icon?: string;
  /**
   * The version to stamp, taken from the definition that produced this entry.
   *
   * Carried rather than looked up again at insert time. The registry is
   * mutable — a plugin can register while a panel is open — so a second lookup
   * can answer with a different definition than the one the author was shown,
   * and stamp a version the props do not match.
   */
  readonly version: number;
  /**
   * The props this entry inserts with: the block's defaults, overlaid by the
   * variation's.
   *
   * A variation may narrow its block's props and never introduce one the
   * renderer does not accept, which is what makes the overlay safe to compute
   * here rather than at the call site.
   */
  readonly props: Readonly<Record<string, unknown>>;
}

/**
 * A stored pattern, as the palette needs to read it.
 *
 * The fields a pattern is STORED with that no palette reads — its slug, its
 * status, its granularity — are deliberately absent. A granularity decides
 * whether a pattern is offered as something to insert or as a way to start a
 * page, and that vocabulary belongs to the collection that declares it; a copy
 * of the four words here would be a second enumeration nothing keeps in step,
 * so the caller splits its own list and hands this the rows it means to offer.
 *
 * `keywords` arrives as ONE string because that is how it is stored — matched,
 * never enumerated — and {@link patternEntriesFrom} is where it becomes the
 * word list the palette searches.
 */
export interface SavedPattern {
  /** The stored row's id, which the insert plans against. */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly category?: string;
  /**
   * The author's own search terms, however they separated them.
   *
   * `null` as well as absent, because that is what a stored row holds: the
   * field is not required, and Nextly writes an unset non-required field as SQL
   * `NULL` and reads it back with the KEY PRESENT. A pattern saved without
   * keywords — the ordinary case — arrives here as `null`, so an
   * undefined-only check would reach `null.split` and take catalog
   * construction down with it.
   */
  readonly keywords?: string | null;
  /**
   * The pattern's document, carried whole — or absent, as a stored row's is.
   *
   * The collection does not mark its blocks field required and the field layer
   * persists an omitted document as SQL `NULL`, so a published row with a
   * title, a slug and a granularity but no content is a legal row. There is
   * nothing to offer for one, so it is skipped exactly as an empty pattern is;
   * reading `kind` off it took catalogue construction down.
   *
   * Held BY REFERENCE, and treated as immutable, which is how a stored row is
   * treated everywhere else it travels. Cloning each one instead would copy
   * every pattern's whole forest on each build of the catalogue, and the
   * catalogue is rebuilt whenever the palette opens — against a library the
   * design sizes at three thousand entries.
   *
   * What that costs is bounded, because the planner judges the forest AGAIN
   * before it plans: a row mutated between being offered and being clicked can
   * make the insert refuse, and cannot make it place something the nesting
   * rules forbid. And the value it would then place is the row as it stands
   * now, which for a live library is the better of the two answers.
   */
  readonly document?: BlockDocument | null;
}

/**
 * One offerable PATTERN: a saved document inserted as a copy that keeps no
 * link back.
 *
 * **The document travels with the entry.** The palette judges what it offers
 * from these roots and the insert plans from the same value, so the two cannot
 * read different versions of one pattern — which is the palette-and-drop
 * disagreement {@link entryAllowedAt} already exists to prevent, one tier up.
 *
 * The root types are NOT carried beside it. They are a narrower view of the
 * document, derived where they are needed; storing both would be two statements
 * of one fact, and the stored one goes stale the first time an entry is built
 * from a document that has moved on.
 */
export interface PatternInsertEntry {
  readonly kind: "pattern";
  /**
   * Stable identity across the whole catalog, which is why it is not the
   * pattern's own id.
   *
   * Blocks are keyed by their namespaced name, and nothing stops a stored
   * pattern being saved under `core/heading`. Two entries sharing a key make
   * React reuse one row's state for the other and make a selection ambiguous,
   * so the tier is part of the key.
   */
  readonly id: string;
  /** The stored row's id, as {@link SavedPattern.id}. */
  readonly patternId: string;
  readonly label: string;
  readonly description: string;
  readonly category: string;
  readonly keywords: readonly string[];
  readonly icon?: string;
  readonly document: BlockDocument;
}

/**
 * Anything the palette can offer.
 *
 * A discriminated union rather than one widened shape: the two tiers share
 * what the panel DRAWS — a label, a description, a category, search words —
 * and share nothing about what inserting them does. One block becomes one node
 * from a name and a version; one pattern becomes a whole forest, re-identified,
 * planned against the destination document. A single shape would have to make
 * both halves optional and every consumer would branch on which half was
 * filled in — the branch this union makes the compiler check.
 */
export type InsertEntry =
  | BlockInsertEntry
  | PatternInsertEntry
  | ComponentInsertEntry;

/**
 * A stored component definition, as the library hands it to the palette.
 *
 * The same shape and the same caveats as {@link SavedPattern}, because it is
 * the same kind of row from a sibling collection: `keywords` is one stored
 * string, and `document` may be `null` for a published row saved without
 * content. Carried separately rather than widened onto `SavedPattern` because
 * what the two are FOR differs — a pattern is copied in and forgets its source,
 * a component is placed as one node that keeps pointing back — and a reader
 * should be able to tell from the type which it holds.
 */
export interface SavedComponent {
  /** The stored row's id, which an instance node points at. */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly category?: string;
  readonly keywords?: string | null;
  readonly document?: ComponentDocument | null;
  /**
   * How many pages currently place it, when the library can say.
   *
   * Optional because the count is a separate read the library may not have
   * made, and a tile that showed "used on 0 pages" for a count nobody took
   * would be stating a fact it does not hold.
   */
  readonly usedOn?: number;
}

/**
 * One offerable COMPONENT: a definition placed as a single instance node that
 * keeps pointing back at it.
 *
 * The document travels with the entry for the reason a pattern's does — the
 * palette judges placement from its roots — but what inserting it does is the
 * opposite of a pattern: nothing from the document is copied into the page.
 * One node is written, carrying the definition's id, and the renderer inlines
 * the definition at read time. That is what makes an edit to the definition
 * reach every page that placed it.
 */
export interface ComponentInsertEntry {
  readonly kind: "component";
  /** Prefixed, for the reason {@link PatternInsertEntry.id} is. */
  readonly id: string;
  /** The definition's stored id, which the instance node will point at. */
  readonly componentId: string;
  readonly label: string;
  readonly description: string;
  readonly category: string;
  readonly keywords: readonly string[];
  readonly icon?: string;
  /**
   * The definition the canvas resolves the placed instance against — the
   * lookup's, by identity — which is what a preview of the tile draws.
   */
  readonly document: ComponentDocument;
  /**
   * The block types at the roots of the definition AS THE CANVAS WILL DRAW
   * IT: a root that is itself an instance is followed into the definition it
   * names, through the same lookup the canvas resolves against.
   *
   * A definition may hold instances of other components, at its root included,
   * and an instance node's type is not a registered block — the nesting rule
   * answers "no restriction" for a type it cannot resolve. Judging placement
   * from the STORED roots would therefore offer a component whose real root is
   * confined to one parent at any destination, and the canvas would then draw
   * that root where it does not belong. The roots here are the block types
   * that actually land — each type once, in the order first met, which is all
   * a placement verdict reads. Read without composing the definition, because
   * a library of small wrappers around one large definition would otherwise
   * be cloned whole, once per wrapper, every time the panel opened.
   */
  readonly roots: readonly string[];
  readonly usedOn?: number;
}

/**
 * How a caller answers for a block's declared child regions.
 *
 * Deliberately NOT a registry, matching `NestingSource`: resolving a type to
 * its definition differs per caller, and a one-method source lets each supply
 * its own resolution while sharing the rule applied to the result.
 *
 * The NODE cannot answer this. A container inserted from the palette carries no
 * `slots` key at all — `makeNode` writes one only when children are supplied —
 * so asking the node whether it is a container answers "no" for every empty
 * one, which is exactly the case that needs filling.
 */
export interface SlotSource {
  /** The names of the child regions this block type declares, in order. */
  slotsOf(type: string): readonly string[] | undefined;
  /**
   * The region the canvas draws for this block in place of its first, when
   * it draws another: a collection list whose empty state is shown. Adding
   * inside such a block adds to the region the author sees.
   */
  shownSlotOf?(node: BlockNode): string | undefined;
}

/** The slot a list's empty state is drawn from. */
const EMPTY_STATE_SLOT = "empty";

/**
 * `slots`, naming the empty-state slot as the one drawn for each list the
 * canvas shows empty (see `EditorState.listsShowingEmpty`), so a block added
 * inside it, from the canvas or the Add panel, lands where it is seen.
 */
export function slotsShowingEmpty(
  slots: SlotSource,
  showingEmpty: ReadonlySet<string> | undefined
): SlotSource {
  if (showingEmpty === undefined || showingEmpty.size === 0) return slots;
  return {
    slotsOf: type => slots.slotsOf(type),
    shownSlotOf: node =>
      showingEmpty.has(node.id) &&
      slots.slotsOf(node.type)?.includes(EMPTY_STATE_SLOT) === true
        ? EMPTY_STATE_SLOT
        : slots.shownSlotOf?.(node),
  };
}

/**
 * Where an insert would land, as the nesting rule needs to see it.
 *
 * The engine's type, re-exported rather than restated. It is the input to
 * `placementVerdict`, which is the one implementation of the placement rule, so
 * a second declaration here would be a second vocabulary for the rule's own
 * argument — and every caller would reach the rule through a translation whose
 * two sides could drift.
 */
export type { PlacementTarget } from "@nextlyhq/blocks-engine";

/**
 * @deprecated Renamed to `PlacementTarget`, which is the engine's name for it
 * and now the only one. Kept as an alias for one release because this type is
 * published from the package entry; import `PlacementTarget` instead.
 *
 * Note the discriminant moved with the name: the member is `kind`, not `at`.
 * A value written as `{ at: "slot", ... }` no longer satisfies this type, and
 * that is deliberate — a silently accepted `at` would fall through every
 * `kind === "slot"` narrowing and be judged as a root placement.
 */
export type InsertTarget = PlacementTarget;

/**
 * The props a block is placed with: its defaults, overlaid by its example.
 *
 * The one answer for "what a block starts as", for the inserter that places
 * it and for anything that must tell an author's own values from a block's
 * starting ones (Getting started's "Write something"). Spread, so the caller
 * owns its copy and cannot reach back into the definition.
 */
function insertionProps(
  definition: Pick<AnyBlockDefinition, "defaultProps" | "example">
): Record<string, unknown> {
  return {
    ...(definition.defaultProps ?? {}),
    ...(definition.example?.props ?? {}),
  };
}

/**
 * A block's insert presets: its variations that are neither a look (one with
 * styles, picked for a block already on the page) nor the block's own named
 * look (`isDefault`). The one reading both the Add panel and the props a block
 * could have been placed with take, so the two can't disagree.
 */
function insertVariations(
  editor: AnyBlockDefinition["editor"]
): NonNullable<NonNullable<AnyBlockDefinition["editor"]>["variations"]> {
  return (editor?.variations ?? []).filter(
    variation => variation.styles === undefined && variation.isDefault !== true
  );
}

/** The props a block is placed with under one of its variations. */
function variationProps(
  base: Record<string, unknown>,
  variation: { readonly props?: object }
): Record<string, unknown> {
  return { ...base, ...(variation.props ?? {}) };
}

/**
 * Every set of props a block can be placed with: its own, then each
 * variation's. The candidates the inserter offers, for anything that must
 * tell an author's values from ones a block was placed with.
 */
export function insertionPropSets(
  definition: Pick<AnyBlockDefinition, "defaultProps" | "example" | "editor">
): Record<string, unknown>[] {
  const base = insertionProps(definition);
  return [
    base,
    ...insertVariations(definition.editor).map(variation =>
      variationProps(base, variation)
    ),
  ];
}

/**
 * Build the offerable list from block definitions.
 *
 * Takes definitions rather than reading the registry, matching how the engine
 * hands out `NestingSource`: the caller supplies `allBlocks()`, and a test
 * supplies a fixture without a global registry to clear between cases.
 *
 * A block emits its own entry followed immediately by its variations, and
 * blocks are ordered by the label the author actually reads. Registration
 * order is an implementation detail of whichever plugin loaded first, so
 * ordering by it would rearrange the palette when an unrelated plugin is
 * installed.
 */
export function catalogFrom(
  definitions: readonly AnyBlockDefinition[]
): BlockInsertEntry[] {
  const byLabel = [...definitions].sort((a, b) =>
    labelOf(a).localeCompare(labelOf(b))
  );

  const entries: BlockInsertEntry[] = [];
  for (const definition of byLabel) {
    const editor = definition.editor;
    const category = editor?.category ?? UNCATEGORISED;
    // A plugin block that names no keywords is still found by its own name,
    // which is the one word an author searching for it will type.
    const keywords =
      editor?.keywords === undefined || editor.keywords.length === 0
        ? [labelOf(definition)]
        : editor.keywords;
    // The block's DEFAULTS, overlaid by its EXAMPLE: see `insertionProps`.
    //
    // Defaults alone are what an author was getting, and they are deliberately
    // empty: `core/heading` defaults to `text: ""`, `core/text` to `text: ""`,
    // `core/button` to `label: ""`. Inserting those renders an empty `<h2>` —
    // an element with no height and nothing to read — so the block was added
    // and the page looked unchanged. An author cannot edit what they cannot
    // find, and cannot tell it from the insert having failed.
    //
    // `example` is the right source and needs no new contract: the engine
    // REQUIRES it on every definition, describing it as a worked instance, so
    // every block already carries one and a third-party block gets this for
    // free. Defaults stay underneath it, because an example states what is
    // worth showing rather than every prop — `core/image` illustrates a `src`
    // while its `loading: "lazy"` default still applies.
    //
    // Spread rather than referenced, so the entry owns its copy and the clone
    // taken at insert time cannot reach back into the definition.
    const defaults = insertionProps(definition);

    entries.push({
      kind: "block",
      id: definition.name,
      blockName: definition.name,
      label: labelOf(definition),
      // The engine refuses an empty description at registration; a blank one
      // still says nothing, so the block's name stands in rather than a gap.
      description:
        definition.description.trim() === ""
          ? labelOf(definition)
          : definition.description,
      category,
      keywords,
      icon: editor?.icon,
      version: definition.version,
      props: defaults,
    });

    for (const variation of insertVariations(editor)) {
      entries.push({
        kind: "block",
        id: `${definition.name}#${variation.name}`,
        blockName: definition.name,
        variationName: variation.name,
        // A variation without a label is still offerable; naming it by its own
        // `name` beats falling back to the block's label, which would show two
        // identical rows and give the author no way to tell them apart.
        label: variationLabel(variation),
        // Variations carry no description of their own. The block's is the
        // honest answer: it describes what will be inserted, which is a
        // configured instance of that block.
        description: definition.description,
        category,
        keywords,
        // No `icon` on a variation by design — the engine's `BlockVariation` has
        // no icon field, so every variation shares its block's. Inventing one
        // here would put a second, richer contract in the panel than the one
        // plugin authors can actually write against.
        icon: editor?.icon,
        version: definition.version,
        props: variationProps(defaults, variation),
      });
    }
  }
  return entries;
}

/**
 * Build the offerable pattern list from stored rows.
 *
 * **A pattern with no roots produces no entry.** Inserting it would add
 * nothing, so offering it is a row that reads as an action and is not one —
 * and it is the shape a pattern saved from a cleared selection actually takes,
 * rather than a hypothetical. Skipped rather than refused: an empty pattern is
 * a row someone can still finish, not an error to report from a palette.
 *
 * Order is the caller's. Blocks are sorted here because their order comes from
 * whichever plugin registered first, which is an implementation detail; stored
 * rows arrive from a query that already said what order it wanted, and sorting
 * them again would overrule it.
 */
export function patternEntriesFrom(
  patterns: readonly SavedPattern[],
  nesting: NestingSource,
  definitions?: ComponentLookup
): PatternInsertEntry[] {
  const entries: PatternInsertEntry[] = [];
  for (const pattern of patterns) {
    const document = pattern.document;
    if (document === undefined || document === null) continue;
    // The planner refuses a document that is not a pattern outright, as
    // `not-a-pattern`, and the type admits one: `SavedPattern.document` is a
    // `BlockDocument`, so a page or a component row handed to this by mistake
    // is a legal value. Offering it produces a tile that accepts a click and
    // cannot succeed, which is the disagreement between the palette and the
    // insert that this module exists to prevent.
    // The planner's own preflight, asked whole rather than reproduced in part.
    // The ways a stored row can be unusable are not a short list: the wrong
    // kind, no nodes, an envelope the apply cannot read, a node whose shape it
    // cannot apply, two nodes rendering one DOM id, an internal placement the
    // rules no longer allow. `planInsertPattern` refuses every one of them
    // wherever the pattern is put, so a tile for one accepts a click that
    // cannot succeed — and a palette keeping its own subset of that list drifts
    // the first time the planner learns a new way to say no.
    //
    // Asked ONCE per row rather than inside `entryAllowedAt`, because none of
    // it depends on the destination: per target it would re-walk every
    // pattern's forest on each keystroke of a filter, against a library the
    // design sizes at three thousand entries.
    if (patternRefusal(document, nesting, definitions) !== undefined) continue;
    entries.push({
      kind: "pattern",
      id: `${PATTERN_ENTRY_PREFIX}${pattern.id}`,
      patternId: pattern.id,
      label: pattern.title,
      // Empty rather than absent, matching a block's, so the panel draws one
      // description slot for both tiers instead of two.
      description: pattern.description ?? "",
      category: pattern.category ?? UNCATEGORISED,
      keywords: keywordsOf(pattern.keywords),
      document,
    });
  }
  return entries;
}

/**
 * The prefix that keeps a pattern's catalog id out of the block namespace.
 *
 * Blocks are keyed by their namespaced name and a stored pattern can be saved
 * under any string, `core/heading` included, so the tier has to be part of the
 * key. A colon rather than a separator a block name can contain: `#` already
 * separates a block from its variation, and reusing it would make
 * `core/heading#hero` and a pattern named `hero` compete for one id.
 */
export const PATTERN_ENTRY_PREFIX = "pattern:";

/** The same rule for a component's catalog id, in its own namespace. */
export const COMPONENT_ENTRY_PREFIX = "component:";

/**
 * The component entries a library of stored definitions yields.
 *
 * Skipped, never refused: a row the palette has nothing to offer for — see
 * {@link offerableDefinition} for which, and a row whose definition the
 * canvas's lookup does not hold — produces no entry, because a tile that
 * accepts a click and then fails is worse than no tile. The row supplies the
 * label, category and usage; the definition judged and drawn is the lookup's. Where a
 * definition's roots may sit on THIS page is asked per placement, by
 * {@link entryAllowedAt}, exactly as a pattern's are.
 */
export function componentEntriesFrom(
  components: readonly SavedComponent[],
  definitions: ComponentLookup
): ComponentInsertEntry[] {
  const entries: ComponentInsertEntry[] = [];
  for (const component of components) {
    // The LOOKUP's definition, not the row's copy: it is what the canvas will
    // resolve the placed instance against, so a row the lookup does not hold
    // would place an instance drawn as missing, and a row whose copy differs
    // would be judged by roots the canvas does not draw.
    const offered = offerableDefinition(
      definitions.get(component.id),
      definitions
    );
    if (offered === undefined) continue;
    entries.push(componentEntryOf(component, offered));
  }
  return entries;
}

/**
 * The rows {@link componentEntriesFrom} offered no entry for, each as an entry
 * with nothing in it to place: no roots, and an empty definition.
 *
 * For a surface that lists the library to manage it as well as to place from
 * it. A component saved without content, or with none the canvas could draw,
 * is still one an author can open and fill, so it is listed, refused, rather
 * than left out. Never handed to the offers: there is nothing in it to judge
 * or to place, and the surface says so.
 *
 * Given the entries already built rather than the lookup, because building
 * them walks every definition's roots, and a second walk to learn which rows
 * were offered would repeat it.
 */
export function unplaceableComponentEntries(
  components: readonly SavedComponent[],
  entries: readonly InsertEntry[]
): ComponentInsertEntry[] {
  const offered = new Set(
    entries.flatMap(entry =>
      entry.kind === "component" ? [entry.componentId] : []
    )
  );
  return components
    .filter(component => !offered.has(component.id))
    .map(component =>
      componentEntryOf(component, {
        document: { formatVersion: 1, kind: "component", nodes: [] },
        roots: [],
      })
    );
}

/** One stored row as an entry, with the definition and roots it offers. */
function componentEntryOf(
  component: SavedComponent,
  offered: Pick<ComponentInsertEntry, "document" | "roots">
): ComponentInsertEntry {
  return {
    kind: "component",
    id: `${COMPONENT_ENTRY_PREFIX}${component.id}`,
    componentId: component.id,
    label: component.title,
    description: component.description ?? "",
    // Every component under the one components group and with the one
    // component mark, whatever its row declares: see COMPONENT_CATEGORY.
    category: COMPONENT_CATEGORY,
    icon: "component",
    keywords: keywordsOf(component.keywords),
    ...offered,
    ...(component.usedOn === undefined ? {} : { usedOn: component.usedOn }),
  };
}

/**
 * What a stored row offers — the definition and the roots it draws — or
 * nothing, when the palette has nothing to offer for the row.
 *
 * Nothing for a row with no document, one whose document the resolver would
 * not read — not a component definition, another format, nodes that are not a
 * list — or one with no roots: each is a legal stored row and none can be
 * placed. A definition's INTERNAL nesting is not re-judged here — it was judged
 * when the definition was saved, and it is the definition's own concern rather
 * than the page's.
 *
 * The roots are read through `definitions` — the lookup the canvas resolves
 * against, handed in rather than rebuilt from the list so the tile and the
 * canvas cannot read two different maps — by the engine's own roots query,
 * which follows a root instance into the definition it names without
 * composing anything, and answers nothing where the resolver would leave a
 * root STANDING. That is a root the canvas would draw as a placeholder and
 * the nesting rule cannot judge: the component it points at is missing from
 * the lookup, is this definition itself, or nests past the composition cap.
 * A row whose roots compose to nothing is withheld too: a tile for it would
 * be placed vacuously — no root type to refuse — and render nothing. An
 * unresolvable instance BELOW the root is the definition's own concern,
 * exactly as its internal nesting is, and does not withhold the tile.
 *
 * Room is NOT asked here. Whether a definition fits the page's caps is a
 * property of the page that moves with every edit, and the click asks the
 * resolver about it with the page in hand ({@link compositionRefusal}); a
 * definition too large for the site's cap under any page is a tile whose
 * every click says so.
 *
 * Read ONCE per row here rather than per placement inside
 * {@link entryAllowedAt}, for the reason a pattern's preflight is: per target
 * it would re-walk every definition on each keystroke of a filter.
 */
function offerableDefinition(
  stored: BlockDocument | null | undefined,
  definitions: ComponentLookup
): Pick<ComponentInsertEntry, "document" | "roots"> | undefined {
  // The resolver's OWN rule for a supplied definition, not the kind alone: a
  // definition in a format this build does not read is left standing on the
  // canvas, and a tile for it would place a placeholder.
  const document = readableDefinition(stored ?? undefined);
  if (document === undefined || document.nodes.length === 0) return undefined;
  const roots = composedRootTypes(document, definitions);
  if (roots === undefined || roots.length === 0) return undefined;
  return { document, roots };
}

/**
 * Why the edit that turned `before` into `after` would leave an instance
 * standing on THIS page, or nothing when it would not.
 *
 * A definition is judged offerable on its own — its roots — but whether the
 * page has ROOM for it is a property of the page: the resolver spends one
 * node budget across every instance it inlines, in document order, and nests
 * to a depth counted from the page root, so a page near its cap can hold the
 * one stored instance node and then leave it unresolved when it renders. The
 * op layer cannot see that (it counts stored nodes, and an instance is one),
 * so the edit asks the RESOLVER ITSELF: the edited document is composed the
 * way the canvas will compose it, and the reason the resolver gives is the
 * reason the author is told.
 *
 * Asked of the two DOCUMENTS rather than of a placed node, because every
 * edit asks the same question: a move carries an instance ahead of another
 * and takes the budget that one had, or into another's slot content one
 * composition deeper; a duplicate or a paste places a copy; a pattern brings
 * instances of its own. What refuses is every instance the edit LEAVES
 * STANDING that stood before it — a placed one, an instance nested inside its
 * definition, which the resolver reports under an id it minted rather than
 * the node's, and an instance already on the page that the edit takes the
 * budget from. Each is a placeholder the edit would put on the page. An
 * instance the page could not hold BEFORE the edit is not the edit's doing,
 * so the two compositions are compared rather than the second read alone;
 * the resolver mints an instance's ids from what it derives them from, so the
 * same instance answers to the same id in both.
 *
 * Asked by the editor's own apply, once per accepted group, rather than by
 * each surface before it applies: room is a property of the page that moves
 * with every edit, every surface reaches the page through that apply, and a
 * surface that asked for itself would be one more that could forget to. Two
 * compositions per edit are cheap where one per tile per keystroke is not.
 *
 * `undefined` for "it composes", and for a reason that is not about room —
 * a missing definition is the tile's concern and was judged when it was
 * offered — so this refuses only what the page cannot hold. Judged under the
 * same `limits` the edit was applied under, since the editor and the canvas
 * both run under the site's.
 */
export function compositionRefusal(
  before: BlockDocument,
  after: BlockDocument,
  definitions: ComponentLookup,
  limits?: DocumentLimits,
  /**
   * How a document is composed, for a caller that already holds compositions:
   * the editor's store shares one per document between this check and its
   * lock check. Defaults to composing each document here.
   */
  compose: (document: BlockDocument) => ResolvedComposition = document =>
    resolveComponentInstances(
      document,
      definitions,
      limits === undefined ? {} : { limits }
    )
): CompositionRefusal | undefined {
  const standing = new Set(
    compose(before).unresolved.map(entry => entry.instanceId)
  );
  const introduced = compose(after).unresolved.find(
    entry => !standing.has(entry.instanceId) && entry.reason in ROOM_REFUSALS
  );
  if (introduced === undefined) return undefined;
  const sentence = ROOM_REFUSALS[introduced.reason];
  return sentence === undefined
    ? undefined
    : { reason: introduced.reason, sentence };
}

/** A refusal about room: the resolver's reason, and the words an author reads. */
export interface CompositionRefusal {
  readonly reason: ComponentUnresolvedReason;
  readonly sentence: string;
}

/**
 * The resolver's reasons that are about the PAGE having no room, each as the
 * sentence the author reads. Every other reason — a missing definition, a
 * cycle, a malformed row — is about the definition, and was the tile's
 * concern when it was offered.
 */
const ROOM_REFUSALS: Readonly<
  Partial<Record<ComponentUnresolvedReason, string>>
> = {
  budget:
    "This page has no room left for that component: placing it would take the page past its block limit.",
  "node-depth":
    "That component's content would be nested too deeply here. Place it nearer the top of the page.",
  "composed-depth":
    "That component would be nested inside too many components here. Place it nearer the top of the page.",
};

/**
 * The single node placing a component writes.
 *
 * ONE node, carrying the definition's id and nothing of its content. The
 * renderer inlines the definition at read time, which is the whole point of
 * placing a component rather than copying a pattern: an edit to the definition
 * reaches this page without this page being touched. No variant and no
 * overrides yet — an instance freshly placed inherits everything.
 */
export function nodeForComponentEntry(entry: ComponentInsertEntry): BlockNode {
  return makeNode(COMPONENT_INSTANCE_TYPE, 1, {
    componentId: entry.componentId,
  });
}

/**
 * The author's stored search terms, as the list the palette matches.
 *
 * Stored as ONE string because the field is matched and never enumerated, and
 * the collection's own note says authors separate them however they like — so
 * commas, semicolons and whitespace all split, and empty runs between two
 * separators produce nothing rather than an empty term that matches every
 * query.
 */
function keywordsOf(stored: string | null | undefined): readonly string[] {
  // Both absences, and they arrive by different roads: `undefined` from a
  // caller that omitted the field, `null` from a stored row whose author never
  // filled it in.
  if (stored === undefined || stored === null) return [];
  return stored
    .split(/[\s,;]+/u)
    .map(word => word.trim())
    .filter(word => word !== "");
}

/**
 * The name an author reads.
 *
 * A declared `editor.label` wins. Without one, the namespaced identity is
 * humanised rather than shown raw: "core/collection-loop" reads as "Collection
 * loop". Showing the identity verbatim is honest and hostile — a palette is
 * read by whoever writes the page, not by whoever registered the block, and
 * every block that has simply not been labelled yet would present as an
 * internal name.
 *
 * Derived rather than stored, because a definition gaining a real label must
 * override this immediately, and a copy written into the entry at build time
 * would keep the guess alongside it.
 *
 * `lookup` is where the definition comes from, the process registry unless a
 * caller says otherwise. A surface outside the editor — the entry screen, which
 * deliberately registers nothing — resolves blocks through its own resolver,
 * and asking the empty registry there would humanise a block whose declared
 * label the editor shows, so the two screens would name one block twice.
 */
export function blockLabel(
  type: string,
  lookup: (type: string) => AnyBlockDefinition | undefined = getBlock
): string {
  // An unregistered type still has to read as something: its name made
  // readable, the same fallback a registered-but-unlabelled block gets, so a
  // block that disappears from the registry does not change what it is called
  // in the middle of an editing session. The engine words it, so a refusal
  // from a save names a block the way the editor does.
  return blockLabelFrom(type, lookup(type));
}

/** A registered definition's label, as {@link blockLabel} reads it. */
function labelOf(definition: AnyBlockDefinition): string {
  return blockLabelFrom(definition.name, definition);
}

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
 * Narrow the catalog by what the author typed.
 *
 * Matches the label, the namespaced block name, the declared keywords and the
 * description — the block name included because it is what appears in
 * documentation and in an agent's output, so someone who knows `core/heading`
 * should not have to guess that it is labelled "Heading".
 *
 * An empty or whitespace-only query returns the list unchanged rather than
 * nothing: the panel opens with no query, and a filter that treated that as
 * "match nothing" would show an empty palette on open.
 */
export function filterEntries<TEntry extends InsertEntry>(
  entries: readonly TEntry[],
  query: string
): TEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...entries];
  return entries.filter(entry =>
    searchableWords(entry).some(field => field.toLowerCase().includes(needle))
  );
}

/**
 * The words one entry is matched on.
 *
 * A block additionally carries its namespaced name because that is what appears
 * in documentation and in an agent's output. A pattern has no such identity to
 * offer — its stored id is a row key nobody types — so the tier decides the
 * list rather than every field being read off whichever entry arrives.
 */
function searchableWords(entry: InsertEntry): readonly string[] {
  const shared = [entry.label, entry.description, ...entry.keywords];
  return entry.kind === "block" ? [entry.blockName, ...shared] : shared;
}

/** A category heading and the entries under it, in the order the panel draws them. */
export interface InsertGroup<TEntry extends InsertEntry = InsertEntry> {
  readonly category: string;
  readonly entries: readonly TEntry[];
}

/**
 * Group entries under their categories.
 *
 * `preferred` names the headings a library wants offered first — a page starts
 * as structure, so "layout" belongs above "interactive", and neither
 * first-appearance nor an alphabetical sort produces that. It is a caller's
 * declaration rather than a constant here, because categories are free strings
 * contributed by any plugin and this module has no standing to rank them.
 *
 * Categories outside `preferred` follow, in first-appearance order. A plugin
 * that ships an unranked category still gets a heading rather than being hidden
 * behind a list it was never named in — dropping it would make a block
 * unreachable through the very panel that exists to reach it.
 */
export function groupByCategory<TEntry extends InsertEntry>(
  entries: readonly TEntry[],
  preferred: readonly string[] = []
): InsertGroup<TEntry>[] {
  const groups = new Map<string, TEntry[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.category);
    if (bucket === undefined) groups.set(entry.category, [entry]);
    else bucket.push(entry);
  }

  // Ranked first, in the order declared; then everything else as it arrived.
  // `preferred` may name categories nothing claims, so it is filtered against
  // what is actually present rather than trusted to describe this catalogue.
  const ranked = preferred.filter(category => groups.has(category));
  const rest = [...groups.keys()].filter(
    category => !ranked.includes(category)
  );

  return [...ranked, ...rest].map(category => ({
    category,
    entries: groups.get(category) ?? [],
  }));
}

/**
 * The groups the Add panel draws, in its order: the categories the host ranks
 * (the library's own), then the site's components, then any other category a
 * plugin declared, then the blocks that declared none.
 *
 * Derived from {@link groupByCategory} rather than grouped again, so the two
 * cannot disagree about which entries share a heading; this only decides where
 * the two headings the panel itself names sit. The components follow the
 * ranked categories because they are what an author reaches for next once the
 * basic blocks are passed. The uncategorised go last, because "More blocks" is
 * a remainder and reads as one only at the end.
 */
export function paletteGroups<TEntry extends InsertEntry>(
  entries: readonly TEntry[],
  preferred: readonly string[] = [],
  blockOrder: readonly string[] = []
): InsertGroup<TEntry>[] {
  const groups = groupByCategory(entries, [
    ...preferred,
    COMPONENT_CATEGORY,
  ]).map(group => ({
    ...group,
    entries: inBlockOrder(group.entries, blockOrder),
  }));
  return [
    ...groups.filter(group => group.category !== UNCATEGORISED),
    ...groups.filter(group => group.category === UNCATEGORISED),
  ];
}

/**
 * A group's entries with the blocks the host ranks first, in its order, and
 * everything else after them as it arrived (by label). A sort that keeps
 * ties in place, so a block's variations stay right behind it.
 */
function inBlockOrder<TEntry extends InsertEntry>(
  entries: readonly TEntry[],
  blockOrder: readonly string[]
): TEntry[] {
  if (blockOrder.length === 0) return [...entries];
  const rank = new Map(blockOrder.map((name, index) => [name, index]));
  const rankOf = (entry: TEntry): number =>
    (entry.kind === "block" ? rank.get(entry.blockName) : undefined) ??
    blockOrder.length;
  return [...entries].sort((a, b) => rankOf(a) - rankOf(b));
}

/**
 * The words a category's heading is drawn with.
 *
 * The library's category ids are words for code ("content"), so the ones it
 * declares are named as an author reads them; "content" is "Text" because that
 * is what the blocks under it are. The two groups the panel itself makes are
 * named here too. A plugin's category is a free string it chose to be read,
 * so it is drawn as written.
 */
export function categoryHeading(category: string): string {
  return Object.hasOwn(CATEGORY_HEADINGS, category)
    ? (CATEGORY_HEADINGS[category] ?? category)
    : category;
}

/**
 * The headings {@link categoryHeading} names, keyed by category id. Read with
 * `Object.hasOwn` because a category is a plugin's free string, and a plain
 * object would answer "constructor" with an inherited function.
 */
const CATEGORY_HEADINGS: Readonly<Record<string, string>> = {
  layout: "Layout",
  content: "Text",
  // What a template draws of the entry itself.
  entry: "Entry",
  media: "Media",
  interactive: "Interactive",
  // The two groups the panel makes are named with the editor's words.
  [COMPONENT_CATEGORY]: `Your ${EDITOR_WORDS.components.toLowerCase()}`,
  [UNCATEGORISED]: `More ${EDITOR_WORDS.blocks.toLowerCase()}`,
};

/**
 * One place a click in the Add panel may put a block, and what it goes after.
 *
 * `afterId` names the block the new one follows ("Adding after Heading"), and
 * is absent at the end of the page and inside a container.
 */
export interface InsertionCandidate {
  readonly kind:
    | "after-selection"
    | "after-ancestor"
    | "document-end"
    | "inside";
  readonly at: OpPosition;
  readonly target: PlacementTarget;
  readonly afterId?: string;
  /** The container a block goes inside, for `inside`. */
  readonly insideId?: string;
}

/**
 * Where a click in the Add panel may put a block, in the order they are tried.
 *
 * As the editor's rule says (after the selection; inside it only last):
 * - nothing selected, or a selection the document no longer holds: the end of
 *   the page;
 * - otherwise after the selected block, in its own region, then after each
 *   block it sits in, out to the page, so a block the selection's region
 *   refuses goes after the nearest container that can hold it; and last,
 *   inside the selection when it is a container, so a block that only
 *   belongs inside one (an accordion's item, say) goes where the author
 *   pointed once nothing after it would take it;
 * - `inside`, a container the author chose to add into (its "+"): that
 *   container's region alone, at its end.
 *
 * The same list for every block; which place a given block takes is
 * {@link insertionFor}'s question, asked of the placement rule.
 */
export function insertionCandidates(
  document: BlockDocument,
  selectedId: string | null,
  options: { readonly inside?: string; readonly slots?: SlotSource } = {}
): InsertionCandidate[] {
  if (options.inside !== undefined) {
    return insideCandidates(document, options.inside, options.slots);
  }
  const end: InsertionCandidate = {
    kind: "document-end",
    at: { index: document.nodes.length },
    target: { kind: "root" },
  };
  if (selectedId === null) return [end];
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
  if (candidates.length === 0) return [end];
  return [
    ...candidates,
    ...insideCandidates(document, selectedId, options.slots),
  ];
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

/**
 * A variation's name as the surfaces show it: its label, or its own `name`
 * when it has none, so two unlabeled variations of one block stay apart.
 */
export function variationLabel(variation: {
  readonly name: string;
  readonly label?: string;
}): string {
  return variation.label ?? variation.name;
}
