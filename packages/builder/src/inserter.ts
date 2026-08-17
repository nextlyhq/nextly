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
  canBeRoot,
  canNest,
  canNestInSlot,
  locateNode,
  makeNode,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type NestingSource,
  type NestingVerdict,
} from "@nextlyhq/blocks-engine";

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
 * One offerable thing: a block, or a block under one of its named variations.
 *
 * Two tiers in one list rather than a nested structure, because the panel
 * filters and keyboard-navigates across both and a nested shape would make
 * every consumer flatten it first. Gutenberg's third tier — patterns — has no
 * mechanism in this engine and is therefore ABSENT rather than stubbed: an
 * empty "Patterns" section would promise a feature that does not exist and
 * would have to be un-promised when one arrives with a different shape.
 */
export interface InsertEntry {
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
  readonly kind: "after-selection" | "document-end";
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
): InsertEntry[] {
  const byLabel = [...definitions].sort((a, b) =>
    labelOf(a).localeCompare(labelOf(b))
  );

  const entries: InsertEntry[] = [];
  for (const definition of byLabel) {
    const editor = definition.editor;
    const category = editor?.category ?? UNCATEGORISED;
    const keywords = editor?.keywords ?? [];
    // `defaultProps` is the block's own object. Spreading here means the entry
    // owns its copy, so the clone taken at insert time cannot reach back into
    // the definition — and two inserts of one entry cannot share substructure.
    const defaults = { ...(definition.defaultProps ?? {}) };

    entries.push({
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
  if (target.at === "root") return canBeRoot(entry.blockName, source);
  const child = canNest(entry.blockName, target.parentType, source);
  if (!child.allowed) return child;
  return canNestInSlot(entry.blockName, target.parentType, target.slot, source);
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
export function allowedEntries(
  entries: readonly InsertEntry[],
  target: InsertTarget,
  source: NestingSource
): InsertEntry[] {
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
export function filterEntries(
  entries: readonly InsertEntry[],
  query: string
): InsertEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...entries];
  return entries.filter(entry =>
    [entry.label, entry.blockName, entry.description, ...entry.keywords].some(
      field => field.toLowerCase().includes(needle)
    )
  );
}

/** A category heading and the entries under it, in the order the panel draws them. */
export interface InsertGroup {
  readonly category: string;
  readonly entries: readonly InsertEntry[];
}

/**
 * Group entries under their categories, preserving the order they arrive in.
 *
 * First appearance decides category order rather than an alphabetical sort of
 * the headings, so a block and its variations stay adjacent and the sort
 * applied upstream is not undone here by a second ordering rule.
 */
export function groupByCategory(
  entries: readonly InsertEntry[]
): InsertGroup[] {
  const groups = new Map<string, InsertEntry[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.category);
    if (bucket === undefined) groups.set(entry.category, [entry]);
    else bucket.push(entry);
  }
  return [...groups].map(([category, grouped]) => ({
    category,
    entries: grouped,
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
  selectedId: string | null
): InsertionPoint | null {
  const end: InsertionPoint = {
    kind: "document-end",
    at: { index: document.nodes.length },
    target: { at: "root" },
  };
  if (selectedId === null) return end;

  const location = locateNode(document.nodes, selectedId);
  if (location === undefined) return end;

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
 * The node an entry inserts.
 *
 * Props are deep-copied. The entry outlives every insert made from it, so
 * handing out its own object would let an edit to one inserted block reach the
 * catalog — and through it every block inserted from that entry afterwards.
 * A shallow copy is not enough, because a default value may be an array or a
 * nested object and those would still be shared.
 */
export function nodeForEntry(entry: InsertEntry): BlockNode {
  return makeNode(entry.blockName, entry.version, structuredClone(entry.props));
}
