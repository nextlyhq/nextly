/**
 * What the inserter offers and is handed: the categories every entry falls
 * under, the block, pattern and component entries, the saved patterns and
 * components they are made from, the slots a block declares, and which of
 * those show an empty state. `inserter.ts` still exports each of these names.
 *
 * @module inserter-types
 */

import type {
  BlockDocument,
  BlockNode,
  ComponentDocument,
  PlacementTarget,
} from "@nextlyhq/blocks-engine";

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
