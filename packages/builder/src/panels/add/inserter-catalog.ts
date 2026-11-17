/**
 * Building the inserter's catalog: a block's entries and their variations,
 * the entries for saved patterns and components, why a component cannot be
 * offered, the words each entry is found by, and an entry's label.
 *
 * @module inserter-catalog
 */

import {
  blockLabelFrom,
  patternRefusal,
  getBlock,
  makeNode,
  composedRootTypes,
  readableDefinition,
  resolveComponentInstances,
  COMPONENT_INSTANCE_TYPE,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type ComponentLookup,
  type ComponentUnresolvedReason,
  type DocumentLimits,
  type NestingSource,
  type ResolvedComposition,
} from "@nextlyhq/blocks-engine";

import {
  type BlockInsertEntry,
  COMPONENT_CATEGORY,
  type ComponentInsertEntry,
  type InsertEntry,
  type PatternInsertEntry,
  type SavedComponent,
  type SavedPattern,
  UNCATEGORISED,
} from "./inserter-types";

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
 * A variation's name as the surfaces show it: its label, or its own `name`
 * when it has none, so two unlabeled variations of one block stay apart.
 */
export function variationLabel(variation: {
  readonly name: string;
  readonly label?: string;
}): string {
  return variation.label ?? variation.name;
}
