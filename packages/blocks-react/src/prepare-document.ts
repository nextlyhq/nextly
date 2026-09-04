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
 * 7. **Known placeholders**, whose subtrees the renderer replaces wholesale. A
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
  COMPONENT_INSTANCE_TYPE,
  componentIdsIn,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  isPlainRecord,
  migrateDocument,
  resolveComponentInstances,
} from "@nextlyhq/blocks-engine";
import type {
  BlockDocument,
  DefinitionsById,
  DocumentLimits,
  MigratedNode,
  ResolvedBlockNode,
  ResolvedDocument,
  StyleCompileContext,
  UnresolvedInstance,
} from "@nextlyhq/blocks-engine";

import type { BlockResolver } from "./resolver";
import { migrationSourceFor } from "./resolver";
import { dedupeNodeIds, sanitizeDocument } from "./sanitize";
import { pruneHiddenNodes } from "./visibility";

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
  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document)
  ) {
    return null;
  }
  if (document.formatVersion !== DOCUMENT_FORMAT_VERSION) return null;

  const limits = args.limits ?? args.styleContext?.limits ?? DEFAULT_LIMITS;
  const sanitized = sanitizeDocument(document, limits);
  const composed = resolveComponentInstances(
    sanitized,
    repairedDefinitions(sanitized, args.definitions, limits),
    { limits }
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
  const gated = pruneHiddenNodes(doc);
  const visible = dedupeNodeIds(gated, node =>
    rendersOwnMarkup(node, args.resolver)
  );
  const prepared = pruneKnownPlaceholders(visible, args.resolver);
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
    sanitized,
    resolved: composed.document,
    referencedComponents: composed.referenced,
    unresolvedInstances: composed.unresolved,
    migrated: doc,
    rewritten,
    gated,
    deduped: visible,
    prepared,
  };
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
function isUnresolvedInstance(node: ResolvedBlockNode): boolean {
  return (
    node.type === COMPONENT_INSTANCE_TYPE &&
    node.unresolvedComponent !== undefined
  );
}

/**
 * The definitions, shape-repaired against the same caps the host was.
 *
 * Not defensive tidiness. The resolver asks only that a definition node be a
 * record with a string id, while the repair pass additionally requires a
 * string type and a whole version and DROPS a node failing either — and the
 * reason it does is one this renderer has already paid for: a node whose
 * `type` is an object reaches the unknown-block placeholder, which writes that
 * value into a data attribute and into text, and React throws inside the one
 * component that exists to contain a failure. Inlining an unrepaired
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
 * Returns the SAME map when every definition was already sound, so the
 * ordinary page allocates nothing — `sanitizeDocument` returns its input when
 * it repaired nothing, which is what makes the comparison meaningful.
 */
function repairedDefinitions(
  host: BlockDocument,
  definitions: DefinitionsById | undefined,
  limits: DocumentLimits
): DefinitionsById {
  if (definitions === undefined || definitions.size === 0)
    return EMPTY_DEFINITIONS;

  const wanted = referencedIds(host, definitions, limits);
  if (wanted.size === 0) return EMPTY_DEFINITIONS;

  const shapeOnly: DocumentLimits = {
    ...limits,
    maxDepth: limits.maxDepth + 1,
    maxNodes: limits.maxNodes + 1,
  };
  const repaired = new Map<string, BlockDocument>();
  for (const id of wanted) {
    const definition = definitions.get(id);
    // PASSED THROUGH unrepaired rather than omitted. The shape pass reads
    // `document.nodes` on its first line, so a `null` or a string here throws
    // before any block boundary exists to contain it — but omitting it makes
    // the reference read as one nobody supplied, and the resolver's reasons
    // distinguish that from a definition supplied and unreadable. Handing the
    // value straight to the resolver lets it say which.
    //
    // A record that merely LOOKS like a document is the sharper case: repair
    // turns an absent `nodes` into an empty array, so the instance composes
    // successfully to nothing and its whole region disappears with no marker.
    //
    // Passing through rather than omitting is currently unobservable — the
    // resolver reports both an absent and an unreadable definition the same
    // way — and is done anyway, because the reasons it reports distinguish
    // them the moment it can, and omitting here would make that distinction
    // unreachable from this layer for good.
    if (!isPlainRecord(definition) || !Array.isArray(definition.nodes)) {
      repaired.set(id, definition as BlockDocument);
      continue;
    }
    repaired.set(id, sanitizeDocument(definition, shapeOnly));
  }
  return repaired;
}

/**
 * The definitions this document can actually reach, transitively.
 *
 * Repairing the whole map was work proportional to the site's entire component
 * catalog on every render, paid even by a page that references nothing — and an
 * unbounded catalog multiplies the per-definition node cap into unbounded
 * request work. Only what the page reaches is repaired.
 *
 * Transitive because a component may hold another, and the closure is taken
 * over the SUPPLIED map: nothing here fetches, so a definition the caller did
 * not hand over is simply not reached and its reference resolves as missing.
 * Bounded by the map's own size, since no id outside it can enter the set.
 */
function referencedIds(
  host: BlockDocument,
  definitions: DefinitionsById,
  limits: DocumentLimits
): Set<string> {
  const wanted = new Set<string>();
  const pending = componentIdsIn(host.nodes, limits.maxNodes);
  while (pending.length > 0 && wanted.size <= definitions.size) {
    const id = pending.pop();
    if (id === undefined || wanted.has(id)) continue;
    wanted.add(id);
    const definition = definitions.get(id);
    if (!isPlainRecord(definition) || !Array.isArray(definition.nodes))
      continue;
    for (const nested of componentIdsIn(definition.nodes, limits.maxNodes)) {
      pending.push(nested);
    }
  }
  return wanted;
}

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
