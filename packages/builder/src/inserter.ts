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
 * were offered is the thing that was rejected. {@link insertionPointFor}
 * therefore answers both halves at once, and everything downstream takes the
 * target from it rather than recomputing one.
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
  findNode,
  patternRefusal,
  getBlock,
  locateNode,
  makeNode,
  placementVerdict,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type NestingSource,
  type NestingVerdict,
  type PlacementTarget,
  type SlotDefaultSource,
} from "@nextlyhq/blocks-engine";

import { emptySlotOf } from "./empty-slot";
import { positionOf, type OpPosition } from "./ops";

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
export type InsertEntry = BlockInsertEntry | PatternInsertEntry;

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
}

/** Where an insert would land, as the nesting rule needs to see it. */
export type InsertTarget =
  | { readonly at: "root" }
  | { readonly at: "slot"; readonly parentType: string; readonly slot: string };

/**
 * A position to insert at, with the target that position implies.
 *
 * One value rather than two calls, so the filter and the insert cannot be
 * computed from different readings of the selection.
 *
 * `kind` is carried because the panel says where the block will go, and
 * "after the selected block" and "at the end of the page" are different
 * sentences. Deriving it afterwards by re-inspecting the selection would ask
 * the same question a second time and could answer differently.
 */
export interface InsertionPoint {
  readonly kind: "after-selection" | "document-end" | "inside-selection";
  readonly at: OpPosition;
  readonly target: InsertTarget;
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
    const keywords = editor?.keywords ?? [];
    // The block's DEFAULTS, overlaid by its EXAMPLE.
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
    const defaults = {
      ...(definition.defaultProps ?? {}),
      ...(definition.example?.props ?? {}),
    };

    entries.push({
      kind: "block",
      id: definition.name,
      blockName: definition.name,
      label: labelOf(definition),
      description: definition.description,
      category,
      keywords,
      icon: editor?.icon,
      version: definition.version,
      props: defaults,
    });

    for (const variation of editor?.variations ?? []) {
      entries.push({
        kind: "block",
        id: `${definition.name}#${variation.name}`,
        blockName: definition.name,
        variationName: variation.name,
        // A variation without a label is still offerable; naming it by its own
        // `name` beats falling back to the block's label, which would show two
        // identical rows and give the author no way to tell them apart.
        label: variation.label ?? variation.name,
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
        props: { ...defaults, ...(variation.props ?? {}) },
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
  nesting: NestingSource
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
    if (patternRefusal(document, nesting) !== undefined) continue;
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
 */
export function blockLabel(type: string): string {
  const definition = getBlock(type);
  // An unregistered type still has to read as something. Humanising its
  // identity is the same fallback a registered-but-unlabelled block gets, so a
  // block that disappears from the registry does not change what it is called
  // in the middle of an editing session.
  return definition === undefined ? humanise(type) : labelOf(definition);
}

function labelOf(definition: AnyBlockDefinition): string {
  const declared = definition.editor?.label;
  if (declared !== undefined && declared !== "") return declared;
  return humanise(definition.name);
}

/**
 * Turn a namespaced block name into something readable.
 *
 * The namespace is dropped because it answers "who shipped this", which a
 * palette groups by rather than repeats on every row. Separators become spaces
 * and only the first letter is capitalised — title-casing every word would
 * render "Collection Loop", which reads like a proper noun for a thing that is
 * a description.
 */
function humanise(name: string): string {
  const local = name
    .slice(name.indexOf("/") + 1)
    .replace(/[-_]+/g, " ")
    .trim();
  if (local === "") return name;
  return local.charAt(0).toUpperCase() + local.slice(1);
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
  target: InsertTarget,
  source: NestingSource
): NestingVerdict {
  if (entry.kind === "pattern") {
    return patternAllowedAt(entry.document, target, source);
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
 */
function patternAllowedAt(
  document: BlockDocument,
  target: InsertTarget,
  source: NestingSource
): NestingVerdict {
  return placementVerdict(
    document.nodes.map(root => root.type),
    placedAt(target),
    source
  );
}

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
  target: InsertTarget,
  source: NestingSource
): NestingVerdict {
  return placementVerdict([blockName], placedAt(target), source);
}

/**
 * This module's target, in the vocabulary the rule is written in.
 *
 * Two names for one idea, and the translation is here so it happens ONCE.
 * `InsertTarget` is published by this package and spells the discriminant
 * `at`; the engine's `PlacementTarget` spells it `kind`. Converging them is a
 * change to a published type across every drag, drop and refusal surface that
 * reads one, so the rule is shared first and the spelling after — a second
 * implementation of the RULE is what produces a palette that offers what the
 * insert refuses, where two spellings of the target produce a rename.
 */
function placedAt(target: InsertTarget): PlacementTarget {
  return target.at === "root"
    ? { kind: "root" }
    : { kind: "slot", parentType: target.parentType, slot: target.slot };
}

/**
 * The entries a target will actually accept.
 *
 * Refused entries are REMOVED rather than shown disabled. A palette is a list
 * of things you can do; a row that cannot be clicked is a question the author
 * has to answer before every insert, and the answer never changes while the
 * selection stands. The verdict's reason stays available through
 * {@link entryAllowedAt} for surfaces where the author has already committed to
 * a placement — a refused DROP has to say why, because the author aimed there.
 */
export function allowedEntries<TEntry extends InsertEntry>(
  entries: readonly TEntry[],
  target: InsertTarget,
  source: NestingSource
): TEntry[] {
  return entries.filter(entry => entryAllowedAt(entry, target, source).allowed);
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
 * Where a new block goes, given what is selected.
 *
 * After the selected block, as a sibling in the same region — which is what an
 * author who just clicked a block and reached for the inserter means. Inserting
 * INTO a selected container is a different intention and gets its own gesture
 * on the canvas; guessing between the two from one click would make the same
 * action do two things depending on what kind of block happened to be selected.
 *
 * Falls back to the end of the document when nothing is selected, and when the
 * selection names a node the document no longer has — a stale id after an undo,
 * or a selection made against a document that has since been replaced.
 *
 * Returns `null` only when the selected node sits somewhere no op can name: a
 * parent without a slot. Appending at the end instead would silently insert
 * somewhere the author was not looking, so the caller is told it cannot answer
 * rather than handed a plausible wrong position.
 */
export function insertionPointFor(
  document: BlockDocument,
  selectedId: string | null,
  slots?: SlotSource
): InsertionPoint | null {
  const end: InsertionPoint = {
    kind: "document-end",
    at: { index: document.nodes.length },
    target: { at: "root" },
  };
  if (selectedId === null) return end;

  const location = locateNode(document.nodes, selectedId);
  if (location === undefined) return end;

  // An EMPTY container takes the block instead of standing beside it.
  //
  // Without this a container can be inserted and never filled: every insert
  // lands as a sibling, so `core/columns` arrives empty and stays empty, and
  // the seven container blocks in the library are decorative. Selecting an
  // empty container and adding a block means putting it IN there — there is no
  // other reading of the gesture.
  //
  // Only when empty, which is what keeps a sibling reachable. A container the
  // author has already filled takes a sibling instead, and adding a third child
  // to it is done by selecting the second and inserting after that — so both
  // placements stay available without a second affordance to discover.
  const selected = findNode(document.nodes, selectedId);
  const emptySlot =
    selected === undefined ? null : emptySlotOf(selected, slots);
  if (selected !== undefined && emptySlot !== null) {
    return {
      kind: "inside-selection",
      at: { parentId: selected.id, slot: emptySlot, index: 0 },
      target: { at: "slot", parentType: selected.type, slot: emptySlot },
    };
  }

  let after: OpPosition;
  try {
    const here = positionOf(location);
    after = { ...here, index: here.index + 1 };
  } catch {
    // `positionOf` refuses a parent with no named slot, which is a position the
    // op vocabulary cannot express. That refusal is about the SELECTED node's
    // surroundings rather than about anything the author did, so it is reported
    // as "no answer" rather than raised at them.
    return null;
  }

  if (location.parent === undefined) {
    return { kind: "after-selection", at: after, target: { at: "root" } };
  }
  // `positionOf` has already refused the slot-less case, so a parent here has a
  // slot. Read it from the location rather than re-deriving from `after`, whose
  // type permits a top-level position that this branch has excluded.
  return {
    kind: "after-selection",
    at: after,
    target: {
      at: "slot",
      parentType: location.parent.type,
      slot: location.slot ?? "",
    },
  };
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
 * The registry as a block-definition source.
 *
 * Reads the DEFINITION rather than the node, because a container inserted from
 * the palette has no `slots` key until something is put in it — which is
 * precisely the container that needs filling.
 */
export function registryBlockSource(): SlotDefaultSource {
  return { get: type => getBlock(type) };
}

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
