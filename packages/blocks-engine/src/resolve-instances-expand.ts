/**
 * What expanding one instance needs besides the walk: the instance's
 * conditions and devices carried onto its roots, id references relinked, the
 * work budget's savepoints and charges, reading a supplied definition, and the
 * slot content an instance supplies.
 *
 * @module resolve-instances-expand
 */
import {
  type BlockDocument,
  type ComponentDocument,
  DOCUMENT_FORMAT_VERSION,
  isComponentDocument,
  type NodeVisibility,
} from "./document";
import { remapFragmentBindings, remapFragmentProps } from "./fragment-refs";
import { MAX_ENVELOPE_ENTRIES } from "./limits";
import { isPlainRecord } from "./plain-record";
import {
  type InlineContext,
  refundableCount,
  type WorkBudget,
} from "./resolve-instances-clone";
import type {
  ComponentLookup,
  ComponentUnresolvedReason,
  PropExposure,
  ResolvedBlockNode,
} from "./resolve-instances-contract";
import type { ComposedScope, ResolveRun } from "./resolve-instances-run";
import { boundedOwnKeys, defineEntry, ownEntry } from "./safe-record";
import { remapIdReferences } from "./tree";
import { conditionGatesOf, placementGatesOf } from "./visibility";

/** Where an expansion sits, and what the host already composed for it. */
export interface InstancePlacement {
  run: ResolveRun;
  scope: ComposedScope;
  depth: number;
  presupplied?: Record<string, ResolvedBlockNode[]>;
  owner?: string;
  /**
   * For a nested instance in editor mode: which of ITS exposures the host
   * placement's component drives, by the host exposure's id. See
   * {@link relayOf}.
   */
  relay?: ReadonlyMap<string, PropExposure>;
}

/**
 * Carry an instance's visibility conditions onto the roots that replace it,
 * for a resolution that expands conditioned instances (`conditioned:
 * "carry"`). A root shows where the instance would have AND where it would
 * itself, so each of the instance's gates joins the root's own as a gate of
 * its own (`within`), judged separately rather than multiplied into the
 * root's groups: the product of two ORs grows with every nesting level, and
 * past the per-block limit would hide a block whose conditions all hold.
 *
 * An instance gated by a shape nothing can read passes that shape on as a
 * gate, so each root fails closed as the instance would have. A root whose
 * own envelope nothing can read is left as it is, still gated by it.
 */
export function withInstanceConditions(
  roots: ResolvedBlockNode[],
  instance: ResolvedBlockNode
): ResolvedBlockNode[] {
  const carried = conditionGatesOf(instance.visibility);
  if (carried.length === 0) return roots;
  return roots.map(root => {
    const own: unknown = root.visibility;
    if (own !== undefined && own !== null && !isPlainRecord(own)) return root;
    const earlier = isPlainRecord(own) ? placementGatesOf(own) : [];
    const kept: NodeVisibility = root.visibility ?? {};
    // A render-time key, outside the stored visibility's type: only this
    // pass writes it, on the document being drawn.
    const visibility: NodeVisibility = Object.assign({}, kept, {
      within: [...earlier, ...carried],
    });
    return { ...root, visibility };
  });
}

/**
 * Carry an instance's per-breakpoint hiding onto the roots that replace it.
 *
 * `devices` is NOT a gate — `isConditionGated` excludes it deliberately, since
 * per-breakpoint hiding is CSS applied to a node that is always served. So it
 * cannot be handled by leaving the instance standing; it has to travel, or an
 * author who hid a whole component on mobile silently gets it back.
 *
 * Only `false` propagates. The instance may hide what the definition shows; it
 * may not SHOW what the definition hid, because the definition's author made
 * that decision about their own content and an instance saying "visible at
 * mobile" is answering a different question.
 */
export function withInstanceDevices(
  roots: ResolvedBlockNode[],
  instance: ResolvedBlockNode
): ResolvedBlockNode[] {
  // `isPlainRecord`, not `!== undefined`. A stored `visibility: null` is read
  // as UNGATED by `isConditionGated`, so a null envelope reaches this line on
  // the successful path and a direct property read throws — turning a
  // resolvable page into an exception.
  const envelope = instance.visibility;
  if (!isPlainRecord(envelope)) return roots;
  const devices = envelope.devices;
  if (!isPlainRecord(devices)) return roots;
  const hidden = boundedOwnKeys(devices, MAX_ENVELOPE_ENTRIES);
  if (hidden === null || hidden.length === 0) return roots;

  return roots.map(root => rootHiddenOn(root, devices, hidden));
}

/**
 * One definition root, carrying whatever the instance hides.
 *
 * The envelope is sorted into three cases, and they are three because
 * `isConditionGated` reads them as three:
 *
 * - **absent or `null`** — ungated to that predicate, so the flags merge into
 *   a fresh envelope. Refusing `null` here would silently drop the hiding an
 *   author asked for.
 * - **a plain record** — ungated or not on its own terms, and the flags merge
 *   into a copy of it.
 * - **anything else**, a string or an array — read as GATED, because an author
 *   wrote a restriction nothing can parse. Left exactly as it is. Rebuilding
 *   it as a record carrying only `devices` produces an envelope that same
 *   predicate calls unconditional, and the node is then served — the failure
 *   this whole function exists to prevent, reintroduced by the repair.
 */
function rootHiddenOn(
  root: ResolvedBlockNode,
  devices: Record<string, unknown>,
  hidden: readonly string[]
): ResolvedBlockNode {
  const own = root.visibility;
  const merged = mergeableDevices(own);
  if (merged === null) return root;
  if (!hideEach(merged, devices, hidden)) return root;
  return {
    ...root,
    visibility: {
      ...(own ?? {}),
      devices: merged as Record<string, boolean>,
    },
  };
}

/**
 * The device map to merge into, or `null` when the envelope must not be
 * touched at all.
 *
 * `null` is the third case above: an envelope `isConditionGated` reads as
 * gated, which this must leave exactly as it found.
 */
function mergeableDevices(
  own: NodeVisibility | null | undefined
): Record<string, unknown> | null {
  if (own !== undefined && own !== null && !isPlainRecord(own)) return null;
  return isPlainRecord(own?.devices) ? { ...own.devices } : {};
}

/**
 * Write the instance's per-breakpoint setting into the map, reporting whether
 * anything moved.
 *
 * BOTH values travel, not only `false`, and that is the correction: hiding
 * INHERITS to narrower breakpoints until a `true` ends the band. So
 * `{ tablet: false, mobile: true }` means "hidden from tablet down to mobile,
 * shown again at mobile", and copying only the `false` hides the component
 * everywhere below tablet — further than the author asked, from a rule meant
 * to be conservative.
 *
 * A `true` is still refused where the definition's own map says `false` at
 * that same breakpoint, so an instance cannot re-show what the component's
 * author explicitly hid.
 *
 * The residual gap is stated rather than hidden: a definition that hid a WIDER
 * breakpoint hides the narrower ones by inheritance rather than by an entry,
 * so an instance's band-ending `true` can end that inherited band too.
 * Closing it needs the breakpoints in order, and this module has no style
 * context by design — the engine is the place where composition is pure. The
 * alternative, dropping every `true`, corrupts every bounded band, which is
 * the ordinary way responsive visibility is authored.
 */
function hideEach(
  merged: Record<string, unknown>,
  devices: Record<string, unknown>,
  named: readonly string[]
): boolean {
  let changed = false;
  for (const id of named) {
    const wanted = ownEntry(devices, id);
    if (typeof wanted !== "boolean") continue;
    if (wanted && ownEntry(merged, id) === false) continue;
    if (ownEntry(merged, id) === wanted) continue;
    defineEntry(merged, id, wanted);
    changed = true;
  }
  return changed;
}

/**
 * Point the inlined tree's id REFERENCES at where those ids ended up.
 *
 * A second pass, after every node has been minted, because a node may
 * reference an id defined on one the walk had not reached yet — rewriting
 * during the copy would leave every forward reference pointing at the
 * original. `aria-labelledby` and `aria-describedby` are how a control is
 * named and described to a screen reader, and a reference to an id that no
 * longer exists is ignored in silence: the element simply loses its name,
 * visibly to nobody who is not using assistive technology.
 */
/** The three optional fields a relink can rewrite, plus the one it always does. */
interface RelinkedFields {
  attributes: ResolvedBlockNode["attributes"];
  props: Record<string, unknown>;
  bindings: ResolvedBlockNode["bindings"];
  slots: ResolvedBlockNode["slots"];
}

/**
 * One node with its rewritten fields, leaving ABSENT ones absent.
 *
 * Spread conditionally, the way `relinkOne` does for the same three fields.
 * `{ ...node, bindings }` writes the key even when the value is `undefined`,
 * and a key holding `undefined` is a value JSON cannot carry — `applyOp`
 * refuses a whole insert for one. That went unnoticed while this output was
 * only ever rendered; a resolved tree is now also what a detached instance is
 * stored from, and an ordinary node with no attributes came out of here
 * carrying `attributes: undefined`.
 *
 * Its own function so the walk that calls it stays inside the complexity the
 * gate allows.
 */
function relinked(
  node: ResolvedBlockNode,
  fields: RelinkedFields
): ResolvedBlockNode {
  const { attributes, props, bindings, slots } = fields;
  return {
    ...node,
    props,
    ...(attributes === undefined ? {} : { attributes }),
    ...(bindings === undefined ? {} : { bindings }),
    ...(slots === undefined ? {} : { slots }),
  };
}

export function withRemappedIdReferences(
  roots: ResolvedBlockNode[] | null,
  ctx: InlineContext
): ResolvedBlockNode[] | null {
  if (roots === null || ctx.domIds.size === 0) return roots;
  const rewrite = (nodes: ResolvedBlockNode[]): ResolvedBlockNode[] =>
    nodes.map(node => {
      // DEFINITION-owned nodes only, and the walk stops at anything else. An
      // unmarked node is slot content the page supplied, so its references
      // address the page's own ids — rewriting them against this definition's
      // map redirects a working relationship at a node the author never
      // named. Its descendants are page content too, and any component nested
      // among them was rewritten by its own expansion with its own map, so
      // descending would rewrite those a second time.
      if (node.instanceOf === undefined) return node;
      const attributes = isPlainRecord(node.attributes)
        ? remapIdReferences(node.attributes, ctx.domIds)
        : node.attributes;
      const props = remapFragmentProps(node.props, ctx.domIds) as Record<
        string,
        unknown
      >;
      // The BOUND form of the same field, for the same reason: a bound `href`
      // renders `bindings.href.fallback` when its source is empty, so a
      // fallback left behind points at an id this composition has re-minted.
      const bindings = remapFragmentBindings(
        node.bindings,
        ctx.domIds
      ) as ResolvedBlockNode["bindings"];
      const slots = isPlainRecord(node.slots)
        ? rewriteSlots(node.slots)
        : node.slots;
      if (
        attributes === node.attributes &&
        slots === node.slots &&
        props === node.props &&
        bindings === node.bindings
      ) {
        return node;
      }
      return relinked(node, { attributes, props, bindings, slots });
    });
  const rewriteSlots = (
    slots: Record<string, ResolvedBlockNode[]>
  ): Record<string, ResolvedBlockNode[]> => {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const name of Object.keys(slots)) {
      const children = ownEntry(slots, name);
      if (!Array.isArray(children)) {
        defineEntry(next, name, children);
        continue;
      }
      const rewritten = rewrite(children);
      if (rewritten !== children) changed = true;
      defineEntry(next, name, rewritten);
    }
    return changed ? (next as Record<string, ResolvedBlockNode[]>) : slots;
  };
  return rewrite(roots);
}

/** Everything one speculative expansion may have to give back. */
interface Savepoint {
  budget: number;
  unresolved: number;
  minted: number;
  mintedDomIds: number;
  loopsClosed: number;
}

/** Where the run stood before an instance was attempted. */
export function savepoint(run: ResolveRun): Savepoint {
  return {
    budget: run.budget,
    unresolved: run.unresolved.length,
    minted: run.minted.length,
    mintedDomIds: run.mintedDomIds.length,
    loopsClosed: run.loopsClosed.length,
  };
}

/**
 * Charge one entry to the caller's work allowance, or report that it is spent.
 *
 * Never given back, which is what separates it from `budget`: the node budget
 * measures what the composed document may still hold, so an abandoned expansion
 * and a node an override hides return their charge to it. The work of cloning
 * them was done either way, and an allowance that refunded it would let the same
 * refused expansion be attempted again for nothing.
 */
function spendWork(run: ResolveRun): boolean {
  const work = run.work;
  if (work === undefined) return true;
  if (workSpent(run)) return false;
  work.left -= 1;
  return true;
}

/** Whether the caller supplied a work allowance and it has run out. */
export function workSpent(run: ResolveRun): boolean {
  return run.work !== undefined && run.work.left <= 0;
}

/**
 * Charge one definition entry to the node budget and the caller's allowance
 * together, or report that either is spent.
 *
 * The node budget is asked first, and an entry it refuses is charged to neither:
 * the clone stops there without examining it.
 */
export function chargeEntry(run: ResolveRun): boolean {
  if (run.budget <= 0 || !spendWork(run)) return false;
  run.budget -= 1;
  return true;
}

/**
 * Charge one slot-prepass entry to the pass's own bound and the caller's
 * allowance together, or report that either is spent.
 *
 * The pass's bound is the one a node an override hides gives back; the allowance
 * is not, for the reason {@link spendWork} gives.
 */
export function chargePrepassEntry(work: WorkBudget, run: ResolveRun): boolean {
  if (work.left <= 0 || !spendWork(run)) return false;
  work.left -= 1;
  return true;
}

/**
 * Undo a whole attempted expansion.
 *
 * All three, not the budget alone. A nested instance refused INSIDE an
 * expansion that is itself then refused has already reported itself, and that
 * report names a scoped id no node in the returned document carries — a
 * diagnostic about a tree the reader never receives, which is worse than
 * silence because a surface will offer the author a remedy for it. The minted
 * ids go back for the same reason: an id reserved for a node that does not
 * exist pushes a later, real node onto a disambiguated spelling.
 *
 * `referenced` is deliberately NOT rolled back. Its consumer is cache tagging,
 * and this page's render DID read that definition — a change to it can change
 * whether this instance fits the budget at all, so the page has to regenerate.
 * A tag list trimmed to what survived is the list that never recovers.
 */
export function rollback(run: ResolveRun, mark: Savepoint): void {
  run.budget = mark.budget;
  run.unresolved.length = mark.unresolved;
  for (let i = run.minted.length - 1; i >= mark.minted; i -= 1) {
    run.taken.delete(run.minted[i]);
  }
  run.minted.length = mark.minted;
  for (let i = run.mintedDomIds.length - 1; i >= mark.mintedDomIds; i -= 1) {
    const id = run.mintedDomIds[i];
    run.takenDomIds.delete(id);
    // The record of what it was derived from goes back with the claim itself.
    // An abandoned expansion leaves the ORIGINAL instance standing, so a rename
    // it had begun to make describes nothing in the returned document — and a
    // consumer reversing the map would rewrite a reference using a mapping for
    // an id nothing renders. Released here rather than in a pass of its own,
    // keyed on the same list, so the two cannot come to disagree about what was
    // given back.
    run.renamedDomIds.delete(id);
  }
  run.mintedDomIds.length = mark.mintedDomIds;
}

/**
 * The definition to inline here, or why this instance cannot be.
 *
 * One value rather than a verdict the caller then re-reads, because the lookup
 * is a caller's object and nothing in its contract makes it pure. Validating
 * one `get` and expanding a second means the document that was checked is not
 * the document that is used — and the source that FETCHES is the one least
 * likely to answer twice the same way. Reasons are strings and definitions are
 * records, so the two are told apart without an envelope per instance.
 */
export function definitionFor(
  componentId: string,
  run: DefinitionReader,
  scope: ComposedScope
): ComponentDocument | ComponentUnresolvedReason {
  if (scope.onPath.has(componentId)) return "cycle";
  if (scope.depth >= run.maxComposedDepth) return "composed-depth";
  const seen = run.definitionsRead.get(componentId);
  if (seen !== undefined) return seen;
  const answer = readDefinition(componentId, run);
  run.definitionsRead.set(componentId, answer);
  return answer;
}

/**
 * What answering "which definition does this id name here" needs of a run.
 *
 * Named apart from {@link ResolveRun} so the roots query in
 * `resolve-instances-roots` can ask the same question with the same four refusals — cycle, composition cap,
 * missing, unreadable — without a budget, ids or a forest to compose into.
 * A run satisfies it as it is.
 */
export interface DefinitionReader {
  definitions: ComponentLookup;
  maxComposedDepth: number;
  definitionsRead: Map<string, ComponentDocument | ComponentUnresolvedReason>;
}

/**
 * What the lookup says about one component, asked once per run.
 *
 * Split from the scope checks above so that only the id-dependent half is
 * remembered: a component refused for a cycle at one position is perfectly
 * resolvable at another, and caching that refusal would withhold it there.
 */
function readDefinition(
  componentId: string,
  run: DefinitionReader
): ComponentDocument | ComponentUnresolvedReason {
  // ABSENT from the map is `missing` — nobody supplied one, and the remedy is
  // to publish or restore it. A value that IS supplied and cannot be read is a
  // document fault, so it takes `unreadable`: offering the publish remedy for
  // corrupt component data sends an author to the wrong screen, which is the
  // whole reason these reasons are a closed list rather than a message.
  // Every read below is a caller's: the lookup is an object this module was
  // handed, and the document it returns came from an import, a script or a
  // database. A `kind` that computes itself and throws took the caller's error
  // out of `resolveComponentInstances`, which promises a classification and a
  // closed list of reasons — and out of every planner built on it.
  //
  // `unreadable` is the answer this function already declares for exactly this:
  // "a value that IS supplied and cannot be read is a document fault". Nothing
  // new is being invented, only made reachable.
  try {
    return readSuppliedDefinition(componentId, run);
  } catch {
    return "unreadable";
  }
}

/** The lookup's answer for one component, read as the caller supplied it. */
function readSuppliedDefinition(
  componentId: string,
  run: DefinitionReader
): ComponentDocument | ComponentUnresolvedReason {
  if (!run.definitions.has(componentId)) return "missing";
  // Read ONCE and carried out, so expansion never asks again: the lookup is a
  // caller's object and nothing in its contract makes it pure, so validating
  // one `get` and expanding a second means the document that was checked is
  // not the document that is used.
  return readableDefinition(run.definitions.get(componentId)) ?? "unreadable";
}

/**
 * A supplied definition as this resolver reads it, or nothing when it cannot.
 *
 * The one rule for what a lookup's answer has to be before it is inlined.
 * Published because a surface that draws from the same lookup — the editor's
 * inspector for a selected instance — has to refuse exactly what the canvas
 * refuses: accepting more would offer editable rows for a component the page
 * shows as a placeholder, and read a list of nodes that is not one as though
 * it were.
 *
 * A structural check is not the discrimination. `DefinitionsById` is keyed to
 * `BlockDocument`, so a page, a region or a template satisfies "has a nodes
 * array" and would be inlined as though it were a component — content from
 * another document appearing inside this one, with its exposed properties and
 * slots meaning nothing. The kind is what the engine already publishes an
 * answer for. And the FORMAT, on the same read: `unreadable` already means "an
 * envelope this build does not understand", and a definition written in a
 * format this build cannot interpret would otherwise be inlined regardless, so
 * a surface that persists what it inlines wrote content read under the wrong
 * rules into a page.
 */
export function readableDefinition(
  supplied: BlockDocument | undefined
): ComponentDocument | undefined {
  if (!isPlainRecord(supplied) || !Array.isArray(supplied.nodes)) {
    return undefined;
  }
  if (!isComponentDocument(supplied)) return undefined;
  if (supplied.formatVersion !== DOCUMENT_FORMAT_VERSION) return undefined;
  return supplied;
}

/**
 * Keep the instance node, marked with why it is still standing.
 *
 * Kept rather than dropped so the editor has something to attach "publish this
 * component" to, and so a reader can tell a page that lost a region from one
 * that never had it. Its stored slot content travels with it untouched: a
 * placeholder draws no children, and rewriting content that is not being shown
 * would be an edit made by a failure.
 */
export function refuse(
  run: ResolveRun,
  instance: ResolvedBlockNode,
  componentId: string,
  reason: ComponentUnresolvedReason
): ResolvedBlockNode {
  run.unresolved.push({ instanceId: instance.id, componentId, reason });
  if (reason === "cycle" && !run.loopsClosed.includes(componentId)) {
    run.loopsClosed.push(componentId);
  }
  return { ...instance, unresolvedComponent: reason };
}

/** Record a definition this resolution read, once. */
export function noteReference(run: ResolveRun, componentId: string): void {
  if (run.referencedSeen.has(componentId)) return;
  run.referencedSeen.add(componentId);
  run.referenced.push(componentId);
}

/**
 * The instance's own slot content, PICKED and not composed.
 *
 * The name says whose content this is, not what state it is in, so the state
 * has to be said here: what comes back is stored nodes. `placedContent`
 * composes them, and only once the node they are bound for has survived —
 * content aimed at a gated or overridden-away target is discarded, and
 * composing it first spends the page's budget on a tree nobody receives, mints
 * ids for it, and records the components inside it as read and as
 * unresolvable.
 *
 * Composed in the OUTER scope when it is composed, because this content
 * belongs to the page rather than to the component: a component nested in it
 * is nested in the page, not one level further into the composition, and
 * re-identifying it would move page nodes to ids the editor cannot address.
 */
export function suppliedSlots(
  instance: ResolvedBlockNode,
  definition: ComponentDocument,
  run: ResolveRun
): Record<string, ResolvedBlockNode[]> | undefined {
  const slots = instance.slots;
  if (!isPlainRecord(slots)) return undefined;
  return exposedSlotContent(slots, definition, run);
}

/**
 * The instance's slot content, narrowed to the slots the definition still has.
 *
 * Narrowed BEFORE it is resolved, which is the whole point. An author who
 * removed an exposed slot leaves every instance holding content under a key
 * nothing will insert; resolving it first spends the page's node budget on a
 * tree nobody receives, mints ids for it, and records a diagnostic naming a
 * node absent from the returned document — so a large enough orphan can refuse
 * the visible instance that contains it.
 *
 * The content is KEPT in the stored instance regardless. This decides what a
 * render walks, not what an author owns: re-exposing the slot must bring the
 * content back.
 */
function exposedSlotContent(
  slots: Record<string, ResolvedBlockNode[]>,
  definition: ComponentDocument,
  run: ResolveRun
): Record<string, ResolvedBlockNode[]> | undefined {
  const exposed = isPlainRecord(definition.slots) ? definition.slots : {};
  const ids = boundedOwnKeys(exposed, MAX_ENVELOPE_ENTRIES);
  refundDiscardedSlots(slots, new Set(ids ?? []), run);
  if (ids === null || ids.length === 0) return undefined;

  const wanted: Record<string, ResolvedBlockNode[]> = {};
  let any = false;
  for (const id of ids) {
    const content = ownEntry(slots, id);
    if (content === undefined) continue;
    any = true;
    defineEntry(wanted, id, content);
  }
  return any ? wanted : undefined;
}

/**
 * Give back the budget charged for slot content this composition discards.
 *
 * The host survey counts every node the document holds and the budget is what
 * is LEFT under the cap after it, so content under a slot the definition no
 * longer exposes is charged for and then dropped — and the page is refused
 * room for a component whose result would have fitted. Refunded here rather
 * than subtracted in the survey because only the definition knows which keys
 * survive, and the survey runs before any definition is read.
 *
 * The savepoint covers it. If the instance is then refused, its stored slots
 * travel with it into the result, and the refund is rolled back along with
 * everything else so those nodes stay charged exactly as they should.
 */
function refundDiscardedSlots(
  slots: Record<string, ResolvedBlockNode[]>,
  kept: ReadonlySet<string>,
  run: ResolveRun
): void {
  for (const name of Object.keys(slots)) {
    if (kept.has(name)) continue;
    const children = ownEntry(slots, name);
    if (!Array.isArray(children)) continue;
    run.budget += refundableCount(children);
  }
}
