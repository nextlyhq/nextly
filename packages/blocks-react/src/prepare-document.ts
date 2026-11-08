/**
 * The passes a stored document goes through before anything reads it.
 *
 * Gathered here because there is now more than one reader. The renderer turns a
 * document into HTML and the route helper turns it into metadata, and both must
 * describe the SAME page — a title derived from a node the HTML withholds is
 * wrong in a way nothing surfaces, and it is published off-site to every
 * crawler rather than only to the visitor.
 *
 * Each pass exists for a failure that was reachable without it, and the ORDER
 * is part of the contract:
 *
 * 1. **Envelope and format guard.** The envelope is database input, read
 *    before the repairs that make its contents safe; a corrupt column holding
 *    `null` throws on first property access. An unsupported `formatVersion`
 *    means nothing below can be trusted to mean what it says.
 * 2. **Shape repair**, against the caps the SITE configured — a site that
 *    raised `maxNodes` for long pages must not have its content truncated
 *    against the default.
 * 3. **Composition**, which replaces each component instance with the tree its
 *    definition describes. Before migration, so a definition written against
 *    an older block version is upgraded like any other content rather than
 *    reaching the renderer at whatever version it was authored at. Its
 *    definitions are shape-repaired first, for the reason pass 2 exists: an
 *    unsanitized node inlined into a sanitized host reintroduces one level
 *    down exactly what the host was repaired to remove.
 * 4. **Migration**, so a node behind its definition is read as its current
 *    props rather than its stored ones.
 * 5. **Condition gating**, which removes a node and its whole subtree from the
 *    output. This is the one whose absence leaks: a gated node is deliberately
 *    withheld, so anything derived from it publishes what was withheld.
 * 6. **Address repair**, which drops later duplicates of a repeated id — so a
 *    duplicate that never renders cannot speak for the page.
 * 7. **Bindings**, when the reader supplies what they read. Each binding is
 *    checked and filled into its prop, so what blocks render and what
 *    metadata says come from the same values. After gating, so a withheld
 *    node is never read or reported; after address repair, so each filled
 *    node has one id. A list item's bindings wait for the list to draw it.
 * 8. **Known placeholders**, whose subtrees the renderer replaces wholesale. A
 *    node whose migration failed, whose type nothing registered, or whose
 *    stored version is ahead of its definition emits a placeholder and none of
 *    its content.
 *
 * Gathering the passes here does not by itself make two readers agree. Each
 * pass's ARGUMENTS are as much of the contract as the pass and its position:
 * the same calls made with a different predicate or different caps is a
 * COPY of this pipeline rather than a use of it, and it diverges exactly as a
 * hand-written sequence would. The placeholder predicate handed to the address
 * repair is the sharp one, because omitting it is silent and changes which
 * nodes survive.
 *
 * @module prepare-document
 */
import {
  bindDocument,
  COMPONENT_INSTANCE_TYPE,
  createBindingRun,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  isPlainRecord,
  migrateDocument,
  resolveComponentInstances,
  SITE_SETTING_FIELD_SHAPES,
} from "@nextlyhq/blocks-engine";
import type {
  BindingIssue,
  BindingRun,
  BindingSchemaSource,
  BlockDocument,
  BoundValues,
  ComponentLookup,
  ConditionIssue,
  DefinitionsById,
  DocumentLimits,
  MigratedNode,
  ResolvedBlockNode,
  ResolvedDocument,
  StyleCompileContext,
  UnresolvedInstance,
} from "@nextlyhq/blocks-engine";

import { queryRowFields } from "./blocks/named-read";
import type { NamedQueryHost, PageBindings } from "./context";
import type { BlockResolver } from "./resolver";
import { migrationSourceFor } from "./resolver";
import { dedupeNodeIds, sanitizeDocument } from "./sanitize";
import {
  entryConditionedIn,
  gateByConditions,
  pruneHiddenNodes,
  type ConditionGate,
} from "./visibility";

export interface PrepareDocumentArgs {
  /** Where block definitions come from. */
  resolver: BlockResolver;
  /** Caps this site holds its documents to. */
  limits?: DocumentLimits;
  /** Consulted for `limits` when none was given directly. */
  styleContext?: StyleCompileContext;
  /**
   * The component definitions this document may inline, at whatever posture
   * the caller chose — a draft one for the editor, a published one for a
   * served page.
   *
   * Optional, and its absence is not the same as an empty map only in what it
   * SAYS: both compose nothing, but a caller that never fetched has a page
   * whose components are all reported unresolved, which is the honest answer
   * for a reader that did not ask for them. Every existing caller omits it and
   * keeps exactly the behaviour it had, because a document holding no instance
   * is returned unchanged.
   */
  definitions?: DefinitionsById;
  /**
   * The render's binding pass, from {@link pageBindingRun}. Absent, no binding
   * is read or filled: every prop shows its own value, as it always has, and
   * the bound stage is the stage before it.
   */
  bindings?: BindingRun;
  /**
   * Keep the blocks a list's item decides, for each list to judge against
   * the items it draws, holding back every other conditioned block, as an
   * editor drawing a page with its conditions applied does. Absent, every
   * conditioned block is held back until a route decides them.
   */
  itemsDecided?: boolean;
}

/**
 * One render's binding pass over a page's bindings, in the page's language.
 *
 * Shared by every reader of one page, the renderer and the metadata alike,
 * so the two fill the same props with the same values.
 */
export function pageBindingRun(
  bindings: PageBindings,
  locale: string | undefined,
  resolver: BlockResolver,
  /**
   * The render's named queries, whose declared rows a list item's bindings
   * are checked against: the same lookup the list runs its query through.
   */
  namedQueries?: Pick<NamedQueryHost, "definitionOf">
): BindingRun {
  const shapes = bindings.fieldShapes;
  const schema: BindingSchemaSource = {
    fieldsOf: ref => {
      // The settings a page is handed, typed by the engine's one table.
      if ("site" in ref) return SITE_SETTING_FIELD_SHAPES;
      // A named query's rows with their own field schema: the fields it
      // declares, as the process registry holds it.
      if ("query" in ref) {
        return queryRowFields(namedQueries, ref.query, slug =>
          shapes?.fieldsOf({ collection: slug })
        );
      }
      return shapes?.fieldsOf(ref);
    },
  };
  return createBindingRun({
    sources: {
      ...(bindings.entry === undefined ? {} : { entry: bindings.entry }),
      ...(bindings.singles === undefined ? {} : { singles: bindings.singles }),
      // Copied into a plain record: the settings are read by field name.
      ...(bindings.site === undefined
        ? {}
        : { site: bindings.site === null ? null : { ...bindings.site } }),
    },
    ...(bindings.entryRef === undefined ? {} : { entryRef: bindings.entryRef }),
    schema,
    ...(locale === undefined ? {} : { locale }),
    ...(bindings.timeZone === undefined ? {} : { timeZone: bindings.timeZone }),
    ...(bindings.mediaCollection === undefined
      ? {}
      : { mediaCollection: bindings.mediaCollection }),
    props: resolver,
  });
}

/**
 * Whether a node renders its own markup, decided from the document alone.
 *
 * Only the outcomes knowable WITHOUT calling the block: an unregistered type, a
 * failed migration, and a node stored ahead of the definition that would render
 * it.
 *
 * A block DECLARING that its props draw nothing (`rendersNothing`) is a separate
 * question, decided by the drawless test rather than here, because the two are
 * not equally safe to act on. A node this pass rejects resolves to a visible
 * placeholder, which is already an exceptional state; a block that draws nothing
 * is an ordinary one — an image waiting for its picture — and dropping it costs
 * the page its stylesheet unless the stored sheet can account for it.
 *
 * It is consulted ELSEWHERE too, and the distinction is worth keeping straight:
 * the block boundary reads it to decide whether a node's `cssId` and attributes
 * may be refused, which is a question about one node's own output and costs
 * nothing when the answer is wrong in the safe direction.
 *
 * The rest are NOT knowable here, and deliberately so: whether a block throws,
 * returns something unrenderable, or renders a given slot at all is only
 * settled by calling it, which happens inside the boundary further down. A node
 * that ends in one of those placeholders can still reserve an address it never
 * uses. Closing that would mean deciding addresses after render, which is a
 * different design than compiling the document once up front.
 */
export function rendersOwnMarkup(
  node: ResolvedBlockNode,
  resolver: BlockResolver
): boolean {
  // An instance nothing could inline stands for a subtree that is not here, so
  // it is a placeholder for the same reason a failed migration is — and it is
  // asked FIRST, because the reserved instance type has no registered block
  // and would otherwise fall through to the unknown-block answer, which is
  // true and tells an author nothing they can act on.
  if (isUnresolvedInstance(node)) return false;
  if (node.migrationFailed === true) return false;
  const definition = resolver.get(node.type);
  if (definition === undefined) return false;
  return node.version <= definition.version;
}

/**
 * Drop the subtrees the renderer replaces with a placeholder.
 *
 * Exported so the renderer removes them the same way rather than keeping its
 * own copy: two implementations of one pass agree the day they are written and
 * drift after, and this one decides what a stored stylesheet may still describe.
 */
export function pruneKnownPlaceholders(
  document: BlockDocument,
  resolver: BlockResolver
): BlockDocument {
  let changed = false;

  const walk = (nodes: ResolvedBlockNode[]): ResolvedBlockNode[] => {
    const kept: ResolvedBlockNode[] = [];
    for (const node of nodes) {
      // The whole subtree goes: a placeholder replaces the node AND everything
      // it would have contained, so a healthy child of a broken parent never
      // reaches the page either.
      if (!rendersOwnMarkup(node, resolver)) {
        changed = true;
        continue;
      }
      if (!node.slots) {
        kept.push(node);
        continue;
      }
      // Only the slots the DEFINITION declares. A block never calls
      // `renderSlot` for a region it does not declare, so a stored slot left
      // behind by a hand edit or a definition that dropped one is not on the
      // page — and a leaf that declares none renders none at all.
      //
      // Pruned HERE rather than left to each reader, because this result is the
      // documented render-equivalent tree: the style compiler walks every
      // stored slot too, so an undeclared one would have its descendants'
      // rules — including any `url(...)` they carry — compiled into the sheet
      // for markup nobody receives. The SEO walk already refuses to descend
      // into them; this makes the tree itself say so, once, for every reader.
      const declared = resolver.get(node.type)?.slots ?? {};
      const slotKeys = Object.keys(node.slots);
      let slotsChanged = false;
      const slots: Record<string, ResolvedBlockNode[]> = {};
      // Iterated in DECLARATION order, not stored order. The renderer asks for
      // its slots by calling `renderSlot` once per declaration, so declaration
      // order is the order the page presents — and this tree is documented as
      // the render-equivalent one. Emitting stored order instead leaves the
      // tree's own key order describing a page nobody is served, and makes two
      // documents that render identically compare as different.
      for (const name of Object.keys(declared)) {
        const children = node.slots[name];
        // Declared but never stored. Left ABSENT rather than added as an empty
        // array: this pass repairs what a reader would mis-render, and a slot
        // with no children renders nothing whether the key is there or not.
        // Adding it would rewrite every document that omits an optional slot.
        if (children === undefined) continue;
        const next = walk(children);
        if (next !== children) slotsChanged = true;
        slots[name] = next;
      }
      // Undeclared slots are dropped by never being visited above, so the
      // change is detected by comparing what survived against what was stored.
      // Counting is enough: every surviving name came from `declared`, so an
      // equal count means the same set.
      if (Object.keys(slots).length !== Object.keys(node.slots).length) {
        slotsChanged = true;
      }
      // A reorder is a change even when nothing was dropped or rewritten.
      // Without this a stored order that merely DIFFERS from the declaration
      // would compute the reordered object and then discard it.
      else if (
        Object.keys(slots).some((name, index) => name !== slotKeys[index])
      ) {
        slotsChanged = true;
      }
      if (slotsChanged) changed = true;
      kept.push(slotsChanged ? { ...node, slots } : node);
    }
    // `changed` tracks BOTH kinds of edit. Tracking only dropped nodes returned
    // the original array whenever every node survived — silently discarding the
    // rebuilt ones, so a slot-level change was computed and then thrown away.
    return changed ? kept : nodes;
  };

  const nodes = walk(document.nodes);
  return nodes === document.nodes ? document : { ...document, nodes };
}

/**
 * The document as the page will actually present it, or `null` when the page
 * presents nothing but a placeholder.
 *
 * `null` rather than an empty document, because the two mean different things
 * to a caller: an empty page has no content to describe, while an unreadable
 * one has content that cannot be trusted to mean anything. A metadata reader
 * must not describe either, and only the second is worth a different message.
 */
/**
 * Every state the read pipeline passed through, in order.
 *
 * 🔴 **A stage holds the SAME REFERENCE as the stage before it when its pass
 * changed nothing.** That is the contract these fields exist to support, and it
 * is invisible from the type: a caller decides whether a stored stylesheet still
 * describes the tree that renders by comparing stages with `!==`.
 *
 * Break it — a defensive clone, a `structuredClone`, a `map` that always
 * allocates — and every document reads as repaired. A repaired document with no
 * compile context has its whole sheet withheld, so every page silently loses its
 * stylesheet on the happy path with no error anywhere. `prepare-stages.test.ts`
 * asserts the identity directly, by reference.
 */
export interface DocumentReadStages {
  /** After the caps pass. */
  sanitized: BlockDocument;
  /** After component instances are replaced by the trees they stand for. */
  resolved: ResolvedDocument;
  /**
   * Every component definition this document READ, unresolvable ones included.
   *
   * Carried out of the pipeline because its consumer is cache tagging, which
   * is several layers up and cannot re-derive it: the transitive set is only
   * known once the composition has walked. An id that failed to resolve
   * belongs in it for the same reason it belongs in the resolver's own list —
   * a page that could not draw a component because it is not published yet
   * must regenerate when it is.
   */
  referencedComponents: readonly string[];
  /** Every instance left standing, and why. Empty on a clean composition. */
  unresolvedInstances: readonly UnresolvedInstance[];
  /** After migration to the current format. */
  migrated: BlockDocument;
  /**
   * Every node migration rewrote the props of, as the engine reported them.
   *
   * Carried rather than re-derived. The two documents above make it LOOK
   * recoverable by comparing node references, but that answers the question a
   * second time from an invariant asserted only for top-level nodes — and a
   * parent rebuilt because a child moved compares unequal while its own props
   * never changed.
   */
  rewritten: MigratedNode[];
  /** After condition-gated nodes are withheld. */
  gated: BlockDocument;
  /** After addresses are made unique over what will render. */
  deduped: BlockDocument;
  /**
   * After the page's bindings are filled into props. The same reference as
   * {@link deduped} when the reader supplied no bindings or none filled
   * anything. Bindings change props only, never ids, slots or styles.
   */
  bound: BlockDocument;
  /** What each filled prop holds, by node id: a bound date's machine value. */
  boundValues: ReadonlyMap<string, BoundValues>;
  /** Every binding the page's pass could not use as stored. */
  bindingIssues: readonly BindingIssue[];
  /** After known placeholders are dropped. The document to read. */
  prepared: BlockDocument;
}

/**
 * The read pipeline, reporting every state it passed through.
 *
 * `prepareDocumentForRead` is this function's `prepared` field and nothing else,
 * so a reader that needs only the result cannot fall out of step with one that
 * needs the intermediates.
 *
 * Returns `null` for ONE reason only: an unreadable envelope — a non-object, or
 * a `formatVersion` this build does not speak. A document whose every node
 * resolves to a placeholder comes back with stages whose `prepared` tree is
 * empty, NOT as `null`, because that is a judgement about reading rather than a
 * fact about the document: the renderer still walks it to draw the markers.
 * `prepareDocumentForRead` applies that judgement; this function reports.
 */
export function prepareDocumentReadStages(
  document: BlockDocument,
  args: PrepareDocumentArgs
): DocumentReadStages | null {
  const before = stagesBeforeBindings(
    document,
    args,
    args.itemsDecided === true ? itemsKept : undefined
  );
  return before === null ? null : withBindings(before, args);
}

/**
 * The gating an editor applies while a list's items are judged: no entry is
 * known, so a block reading it is held back, and one a list's item decides is
 * kept for the list.
 */
function itemsKept(migrated: BlockDocument): BlockDocument {
  return gateByConditions(migrated, {}).document;
}

/** The stages up to and including address repair: none depends on bindings. */
type StagesBeforeBindings = Omit<
  DocumentReadStages,
  "bound" | "boundValues" | "bindingIssues" | "prepared"
>;

/** The caps a run reads a document under, as the pipeline resolves them. */
function limitsOf(args: PrepareDocumentArgs): DocumentLimits {
  return args.limits ?? args.styleContext?.limits ?? DEFAULT_LIMITS;
}

/** Passes 1 to 6: the envelope guard, repair, composition, migration, gating and address repair. */
function stagesBeforeBindings(
  document: BlockDocument,
  args: PrepareDocumentArgs,
  /**
   * The gating pass, once a route knows the entry; absent, every conditioned
   * block is held back. Given one, a conditioned component instance is
   * expanded too, carrying its conditions onto what replaces it, so it shows
   * where its conditions hold.
   */
  decide?: (migrated: BlockDocument) => BlockDocument
): StagesBeforeBindings | null {
  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document)
  ) {
    return null;
  }
  if (document.formatVersion !== DOCUMENT_FORMAT_VERSION) return null;

  const limits = limitsOf(args);
  const sanitized = sanitizeDocument(document, limits);
  const composed = resolveComponentInstances(
    sanitized,
    args.definitions === undefined || args.definitions.size === 0
      ? EMPTY_DEFINITIONS
      : repairingLookup(args.definitions, limits),
    decide === undefined ? { limits } : { limits, conditioned: "carry" }
  );
  const { doc, rewritten } = migrateDocument(
    composed.document,
    migrationSourceFor(args.resolver)
  );
  // The predicate matters as much as the pass: a placeholder replaces its whole
  // subtree, so a child under one holds no address on the page. Deduping without
  // it lets that unreachable child RESERVE an id and drop the later node that
  // reuses it — and the placeholder prune then removes the reserving parent too,
  // leaving neither node. The renderer keeps the later node, so the two readers
  // would describe different pages.
  // Held rather than inlined: the caller compares stages by REFERENCE, and
  // running the pass twice would hand it a different object for the same state.
  const gated = decide === undefined ? pruneHiddenNodes(doc) : decide(doc);
  const visible = dedupeNodeIds(gated, node =>
    rendersOwnMarkup(node, args.resolver)
  );
  return {
    sanitized,
    resolved: composed.document,
    referencedComponents: composed.referenced,
    unresolvedInstances: composed.unresolved,
    migrated: doc,
    rewritten,
    gated,
    deduped: visible,
  };
}

/** Passes 7 and 8: the page's bindings, then the known placeholders. */
function withBindings(
  before: StagesBeforeBindings,
  args: PrepareDocumentArgs
): DocumentReadStages {
  const visible = before.deduped;
  const binding =
    args.bindings === undefined
      ? undefined
      : bindDocument(visible, args.bindings);
  const bound = binding?.document ?? visible;
  const prepared = pruneKnownPlaceholders(bound, args.resolver);
  // A document whose nodes were ALL placeholders presents nothing but
  // placeholders, which is the case `null` names. Returning the empty document
  // instead would report "a page with no content" for a page that has content
  // it cannot render — the exact distinction this return value exists to draw,
  // and a caller spreading its own fallbacks over the result would describe the
  // page as empty rather than as unreadable.
  //
  // A document that was ALREADY empty stays empty: nothing was withheld there.
  // Compared against the tree AFTER gating, not against the stored one. A page
  // whose blocks are all condition-gated is legitimately empty for this
  // visitor — nothing failed to render, it was withheld on purpose — and
  // reporting it as unreadable would show an unsupported-content fallback for a
  // page that is working exactly as configured. Only content that survived
  // gating and then turned out to be unrenderable is a placeholder-only page.
  return {
    ...before,
    bound,
    boundValues: binding?.bound ?? NO_BOUND_VALUES,
    bindingIssues: binding?.issues ?? [],
    prepared,
  };
}

/**
 * A document prepared up to the point where its bindings are filled, for a
 * route that has to read what the bindings need before it renders.
 *
 * Opaque on purpose. The stages it stands for are kept in a module-level
 * `WeakMap` that nothing outside this module can write, so a value a caller
 * built or copied is not one, and the renderer runs the whole pipeline for it
 * instead. Each is also bound to the document object, the resolver, the
 * component definitions and the caps it was prepared under, and is used only
 * where all of them are the ones the renderer is given.
 *
 * @internal Shared by this package's route and renderer.
 * @experimental
 */
export interface PreparedDocument {
  /**
   * The tree the page will present, before its bindings are filled: what a
   * route reads for. Its known placeholders are already removed.
   */
  readonly presented: BlockDocument;
}

/** What a prepared document was made from, and the stages it stands for. */
interface PreparedRecord {
  readonly document: BlockDocument;
  readonly resolver: BlockResolver;
  readonly definitions: DefinitionsById | undefined;
  readonly limits: DocumentLimits;
  readonly stages: StagesBeforeBindings;
  /**
   * The entry-scoped blocks kept because their conditions held for the page's
   * entry, by id; empty for a document gated without an entry.
   */
  readonly held: ReadonlySet<string>;
}

/** Every prepared document this module made, and nothing else. */
const PREPARED = new WeakMap<PreparedDocument, PreparedRecord>();

/** The definitions as the pipeline tells them apart: none, or some. */
function definitionsKey(
  definitions: DefinitionsById | undefined
): DefinitionsById | undefined {
  return definitions === undefined || definitions.size === 0
    ? undefined
    : definitions;
}

/**
 * Prepare a document up to its bindings, once, for a route to read for and
 * then hand to the renderer.
 *
 * @internal Shared by this package's route and renderer.
 */
export function prepareDocument(
  document: BlockDocument,
  args: Omit<PrepareDocumentArgs, "bindings">
): PreparedDocument | null {
  const stages = stagesBeforeBindings(document, args);
  if (stages === null) return null;
  const prepared: PreparedDocument = Object.freeze({
    presented: pruneKnownPlaceholders(stages.deduped, args.resolver),
  });
  PREPARED.set(prepared, {
    document,
    resolver: args.resolver,
    definitions: definitionsKey(args.definitions),
    limits: limitsOf(args),
    stages,
    held: NOTHING_HELD,
  });
  return prepared;
}

/** Shared so a document gated without an entry allocates no set. */
const NOTHING_HELD: ReadonlySet<string> = new Set();

/**
 * A prepared document gated again by its blocks' visibility conditions, and
 * what could not be checked.
 *
 * @internal Shared by this package's route and renderer.
 * @experimental
 */
export interface RegatedDocument {
  readonly prepared: PreparedDocument;
  readonly issues: readonly ConditionIssue[];
}

/**
 * Gate a prepared document again, now that the entry its page shows is known.
 *
 * {@link prepareDocument} holds every conditioned block back, since nothing
 * is known yet to decide them. A route that has read the entry calls this to
 * decide them: from the migrated tree the preparation already holds, so the
 * page is composed and migrated once, through the same gating, address repair
 * and placeholder passes, in the same order. `"keep-all"` keeps every
 * conditioned block, for the reads a route makes before it knows the entry;
 * such a preparation is for reading, not for drawing, and names none held.
 *
 * `null` for a preparation this module did not make.
 *
 * @internal Shared by this package's route and renderer.
 */
export function regateDocument(
  prepared: PreparedDocument,
  gate: ConditionGate | "keep-all"
): RegatedDocument | null {
  const record = PREPARED.get(prepared);
  if (record === undefined) return null;
  const args: PrepareDocumentArgs = {
    resolver: record.resolver,
    limits: record.limits,
    ...(record.definitions === undefined
      ? {}
      : { definitions: record.definitions }),
  };
  // From the stored document again, so a conditioned component instance is
  // composed now that something can decide it, through every pass in the
  // same order; the decision itself is the gating pass's.
  let issues: readonly ConditionIssue[] = [];
  const stages = stagesBeforeBindings(record.document, args, migrated => {
    const decided = gateByConditions(migrated, gate);
    issues = decided.issues;
    return decided.document;
  });
  if (stages === null) return null;
  const visible = stages.deduped;
  const regated: PreparedDocument = Object.freeze({
    presented: pruneKnownPlaceholders(visible, record.resolver),
  });
  // Read off the tree that is drawn, after address repair: a passing block
  // that repair dropped as a duplicate must not lend its id to the block
  // that kept it, which may be one a list's item decides.
  const held = gate === "keep-all" ? NOTHING_HELD : entryConditionedIn(visible);
  PREPARED.set(regated, { ...record, stages, held });
  return { prepared: regated, issues };
}

/**
 * The blocks a preparation kept because their conditions held for the
 * page's entry, by id. The renderer draws these where it would otherwise
 * hold a conditioned block back; every other conditioned block that reaches
 * it is one a list's item decides.
 *
 * @internal Shared by this package's route and renderer.
 */
export function heldConditionsOf(
  prepared: PreparedDocument | undefined
): ReadonlySet<string> {
  return (
    (prepared === undefined ? undefined : PREPARED.get(prepared))?.held ??
    NOTHING_HELD
  );
}

/**
 * The read stages for a document: from a prepared document when it is one
 * this module made for this very document under these very arguments, and by
 * running the pipeline otherwise.
 *
 * @internal Shared by this package's route and renderer.
 */
export function readStagesFor(
  document: BlockDocument,
  args: PrepareDocumentArgs,
  prepared: PreparedDocument | undefined
): DocumentReadStages | null {
  const record = prepared === undefined ? undefined : PREPARED.get(prepared);
  const reusable =
    record !== undefined &&
    record.document === document &&
    record.resolver === args.resolver &&
    record.definitions === definitionsKey(args.definitions) &&
    // The same caps object, as the route hands the renderer the one it
    // prepared under: a different one may hold different caps.
    record.limits === limitsOf(args);
  if (reusable) return withBindings(record.stages, args);
  return prepareDocumentReadStages(document, args);
}

/**
 * Whether a node is an instance THIS RUN could not compose.
 *
 * The marker is a render-time fact and nothing removes it from stored content:
 * node validation does not reject unknown keys, so a hand-edited, imported or
 * legacy document can carry `unresolvedComponent` on an ordinary block. Read
 * as a resolver marker, that would replace real content with a placeholder —
 * and where it is the page's only node, the reading view answers `null` and
 * the page is withheld entirely.
 *
 * The TYPE is what carries the discrimination, and checking the reason
 * against the engine's list as well was measured to add none: a node wearing
 * the reserved name is an instance whatever string sits beside it, and no
 * block may register that name, so the two answers never differ. A marker on
 * any other type is stored data claiming to be a render-time fact, which is
 * exactly what this refuses.
 */
export function isUnresolvedInstance(node: ResolvedBlockNode): boolean {
  return (
    node.type === COMPONENT_INSTANCE_TYPE &&
    node.unresolvedComponent !== undefined
  );
}

/**
 * The definitions, shape-repaired ON DEMAND against the same caps the host was.
 *
 * Repair is not defensive tidiness. The resolver asks only that a definition
 * node be a record with a string id, while the repair pass additionally
 * requires a string type and a whole version and DROPS a node failing either —
 * and the reason it does is one this renderer has already paid for: a node
 * whose `type` is an object reaches the unknown-block placeholder, which writes
 * that value into a data attribute and into text, and React throws inside the
 * one component that exists to contain a failure. Inlining an unrepaired
 * definition into a repaired host reintroduces that a level down.
 *
 * Repaired against HEADROOM rather than against the caps themselves, and that
 * is the whole subtlety. The repair pass TRUNCATES what it finds past a limit
 * — silently, because for a stored page truncation is the answer — while the
 * resolver REFUSES an oversized definition and says which instance and why.
 * Repairing at the caps would let the truncation happen first, so a page would
 * publish a component missing part of itself with nothing in
 * `unresolvedInstances` to report it: the silent truncation the resolver was
 * built to replace, reintroduced one layer up.
 *
 * One node and one level of headroom is all it takes. Anything the resolver
 * would accept passes through untouched; anything it would refuse survives
 * repair intact and reaches the refusal that names it.
 *
 * The DEPTH headroom is currently unobservable and is here anyway. It matters
 * exactly when the resolver refuses an over-deep definition rather than
 * returning an empty branch for it — while it truncates, repairing at the cap
 * and repairing above it produce the same tree, so no test can separate them.
 * Splitting the rule to match what is observable today would leave the gap
 * open on the day the refusal arrives, and that gap is silent content loss.
 *
 * ON DEMAND rather than over a set computed up front, and that is not an
 * optimisation. Repairing ahead of the resolver means predicting which
 * definitions it will read, and it is the resolver that decides: an instance's
 * overrides may name a different component than the definition stored, its
 * composition cap stops the chain long before the catalog does, and the nodes
 * it walks are the ones repair itself retained. A separate traversal answering
 * that question disagreed on all three, and each disagreement handed the page
 * `missing` for a definition the caller had supplied. Asking here means there
 * is one answer, given at the moment the definition is actually wanted.
 *
 * Published so the pass that FETCHES definitions can ask the resolver what it
 * would reach through exactly this lookup. Discovery that built its own view
 * of a definition would be predicting the pipeline rather than asking it, and
 * repair is one of the three places the two used to disagree.
 *
 * NOT memoized here, and that is deliberate rather than an omission. The
 * resolver reads the lookup once per component per resolution and holds the
 * answer for the run — it has to, because a lookup is a caller's object and a
 * resolution owes one answer about one component. A second cache on this side
 * would be a second implementation of that guarantee, agreeing on the day it
 * is written; removing it was measured to change nothing.
 */
export function repairingLookup(
  definitions: DefinitionsById,
  limits: DocumentLimits
): ComponentLookup {
  const shapeOnly: DocumentLimits = {
    ...limits,
    maxDepth: limits.maxDepth + 1,
    maxNodes: limits.maxNodes + 1,
  };
  return {
    // Answered from the SUPPLIED map, never from whether `get` produced a
    // document. Presence is what separates "nobody supplied one" from "one was
    // supplied and cannot be read", and the resolver reports those as
    // different reasons with different remedies — publish the component, or
    // repair its stored data.
    has: id => definitions.has(id),
    get: id => {
      const stored = definitions.get(id);
      // `undefined` for an envelope this build cannot read, rather than a
      // repaired shell. The shape pass reads `document.nodes` on its first
      // line, so a `null` or a string here throws before any block boundary
      // exists to contain it — and the resolver, which still sees the id in
      // `has`, reports it as unreadable rather than missing.
      return isReadableEnvelope(stored)
        ? sanitizeDocument(stored, shapeOnly)
        : undefined;
    },
  };
}

/**
 * Whether a definition is a document THIS BUILD can read.
 *
 * The format version is the half nothing else checks. An unreadable envelope
 * refuses the whole HOST document one function up, for the reason given
 * there — nothing below it can be trusted to mean what it says — and a
 * definition gets the same treatment rather than being repaired into shape,
 * because repair would normalise nodes written to a schema this build has
 * never seen.
 *
 * The KIND is deliberately not checked. The engine's resolver asks
 * `isComponentDocument` and reports a page or a region filed under a
 * component's id as unreadable, so asking again would be a second answer to
 * one question — and a second answer is the one that goes stale.
 */
function isReadableEnvelope(definition: unknown): definition is BlockDocument {
  return (
    isPlainRecord(definition) &&
    definition.formatVersion === DOCUMENT_FORMAT_VERSION &&
    Array.isArray(definition.nodes)
  );
}

/** Shared so a page with no bindings allocates no map at all. */
const NO_BOUND_VALUES: ReadonlyMap<string, BoundValues> = new Map();

/** Shared so a page with no components allocates no map at all. */
const EMPTY_DEFINITIONS: DefinitionsById = new Map<string, BlockDocument>();

/**
 * The tree a READER should present, or `null` when it should present none.
 *
 * The all-placeholder rule belongs to reading, not to the pipeline. A page that
 * presents nothing but placeholders is unreadable to a visitor who wanted its
 * content, which is what `null` names here — but the RENDERER must still walk
 * that document, because the placeholders are the markers it draws. A pipeline
 * that answered `null` for it would take those markers away and show an
 * unsupported-format box for a page whose blocks are merely unresolvable.
 *
 * Compared against the tree AFTER gating: a page whose blocks are all
 * condition-gated is legitimately empty, nothing failed, and reporting it as
 * unreadable would show a fallback for a page working exactly as configured.
 *
 * Exported so that every reader applies the SAME rule. More than one entry point
 * now turns stages into a reading view, and a second copy of this comparison
 * would decide differently the first time either half moved.
 */
export function readingViewOf(
  stages: DocumentReadStages
): BlockDocument | null {
  if (stages.deduped.nodes.length > 0 && stages.prepared.nodes.length === 0) {
    return null;
  }
  return stages.prepared;
}

/**
 * The prepared document, for readers that need no intermediate state.
 *
 * Derived from `prepareDocumentReadStages` rather than repeating its passes.
 * Two implementations of one pipeline agree the day they are written and drift
 * after, and the drift is silent because both look correct alone.
 *
 * 🔴 Enough for a reader that only DESCRIBES the page — metadata, a search
 * index, a link preview. A reader that also serves the page's stored STYLESHEET
 * needs `preparePageForRead` instead: the stages hold the fact that decides what
 * that sheet may still be trusted for, and this return value has dropped it.
 */
export function prepareDocumentForRead(
  document: BlockDocument,
  args: PrepareDocumentArgs
): BlockDocument | null {
  const stages = prepareDocumentReadStages(document, args);
  return stages === null ? null : readingViewOf(stages);
}

/**
 * The tree the renderer WALKS: the reading pipeline up to and including the
 * page's bindings, with the nodes it draws as placeholders still in place.
 *
 * For a surface that lists a page's parts beside a picture of the page, such
 * as an editor's outline under a preview. A block the renderer cannot draw —
 * one nothing registers, a failed migration, an instance nothing could
 * resolve — still takes a place on the page as a placeholder, so a list read
 * from `prepareDocumentForRead`, which drops those, would leave a part out and
 * number everything after it against the wrong part of the picture.
 *
 * Not for describing the page to readers: metadata and search indexes want the
 * reading view, which is what a visitor is served.
 *
 * @returns the walked tree, or `null` for an unreadable envelope
 */
export function prepareDocumentAsDrawn(
  document: BlockDocument,
  args: PrepareDocumentArgs
): BlockDocument | null {
  return prepareDocumentReadStages(document, args)?.bound ?? null;
}

/**
 * Whether a preparation held a conditioned block back, so a route has
 * conditions to decide once it reads the entry. Read off the gating pass:
 * it returns its input unchanged when it removed nothing.
 *
 * @internal Shared by this package's route and renderer.
 */
export function holdsBackConditions(
  prepared: PreparedDocument | null
): boolean {
  const record = prepared === null ? undefined : PREPARED.get(prepared);
  return record !== undefined && record.stages.gated !== record.stages.migrated;
}
