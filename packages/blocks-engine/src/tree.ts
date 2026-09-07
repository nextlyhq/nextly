/**
 * Pure, immutable, ID-addressed operations over a document's node forest.
 *
 * The document's top level is a plain array of nodes, so every operation works
 * on a `BlockNode[]` and treats "no parent id" as the top level. Every
 * mutation returns a new forest; inputs are never modified. Nodes are always
 * addressed by id — positional addressing exists only as the insertion index
 * within a destination, never as a way to identify a node.
 *
 * These are mechanism, not policy: they enforce structural safety (no cycles,
 * clamped indices, no-op on missing targets) but DELIBERATELY do not enforce
 * author policy. Two invariants are owned elsewhere on purpose:
 * - Author locks (`node.locked`) are enforced by the editor command layer, not
 *   here. System paths — migrations, locale-overlay application, `reidSubtree`,
 *   version restore — must be able to transform locked nodes; a lock check in
 *   these primitives would either block those paths or force a bypass flag onto
 *   every call site. Centralizing the check in the op store is the correct seam.
 * - Node id uniqueness is a document validation invariant, checked by
 *   `validate()` before a document is persisted. Callers build nodes with
 *   `makeNode`/`reidSubtree`, which mint fresh ids, so within a session ids are
 *   unique by construction; a hand-injected duplicate is caught by validation
 *   with a machine-readable path, not silently corrected here.
 *
 * ## Storability is not decided here
 *
 * A stored document can arrive in a state `JSON.stringify` refuses — a value
 * that points back at its owner. Nothing in this module creates one; they come
 * from an import, a restore, or a direct database write.
 *
 * **These primitives never refuse work because the DOCUMENT they were given is
 * already unstorable.** They transform what they can reach and make no claim
 * about whether the result can be saved. One place decides that, once, at the
 * point of writing — `measureBytes` already answers it as
 * `{ exceeded: true, reason: "unwritable" }`, and it answers for the whole
 * class, including values a cycle check cannot see at all: `BigInt`, a
 * function, a getter that throws.
 *
 * The rule earns its keep by being derivable rather than remembered. Three
 * operations previously answered three different ways — rebuild, refuse,
 * preserve — each reasoned correctly from its own case, and the fourth case had
 * nothing to derive an answer from.
 *
 * **Where the line falls, because the two cases look alike from a diff.** A
 * primitive here handles what breaks ITSELF and does not police what breaks a
 * later stage. `expandSlotDefaults` catching a `structuredClone` that THROWS is
 * the first kind: without it the function cannot complete and the call site
 * gets an exception instead of a node. Refusing a value that clones perfectly
 * and is merely unstorable — a nested `Date`, a `BigInt` — would be the second,
 * and is the fourth answer this rule exists to prevent.
 *
 * Stated here rather than only where it was decided, because it reads as an
 * omission from any one call site: a reviewer looking at a clone guard and a
 * missing storability check sees two spellings of one question. It is two
 * questions, and only this module says so.
 *
 * What they DO refuse is an ARGUMENT that would break id-addressing: a subtree
 * carrying a duplicate id, or an id already in the destination. That is a
 * different question. It is about an invariant these primitives depend on to
 * work at all, and it concerns caller-supplied input rather than the state the
 * document was already in.
 *
 * ## What a rebuild keeps, and the one thing it drops
 *
 * Rebuilding preserves everything it cannot interpret — a malformed entry, a
 * slot whose value is not an array, a slot named `__proto__`. An unrelated edit
 * must not be what destroys stored content.
 *
 * A cycle-closing entry is the single exception, and the reason generalises:
 * **it is the one thing in a stored document that cannot round-trip through
 * storage.** `JSON.stringify` refuses it, so it was never readable back and
 * dropping it loses nothing a caller could have saved — while KEEPING it during
 * a rebuild emits the same id twice and makes every lookup ambiguous. A
 * malformed value is the opposite on both counts: it writes, it reads back, and
 * it breaks nothing.
 *
 * So the test is not "did the caller name it" but "could this have been
 * stored". That distinction is why `withoutCycleEdges` is applied to a forest a
 * primitive was ALREADY going to rebuild, and never as a repair pass of its
 * own.
 */
import type { SlotSpec } from "./block";
import type { BlockNode } from "./document";
import { isBlockType, renderedDomId } from "./document";
import { walkForest } from "./forest-walk";
import { remapFragmentBindings, remapFragmentProps } from "./fragment-refs";
import { MAX_DEPTH, MAX_NODES } from "./limits";
import { canNest, canNestInSlot } from "./nesting";
import type { NestingSource } from "./nesting";
import { isPlainRecord } from "./plain-record";
import { isUsableSlotName } from "./registry";
import { defineEntry, ownEntry } from "./safe-record";
import { isConditionGated } from "./visibility";

/** Stable unique node id. `crypto.randomUUID` exists in Node ≥ 20 and browsers. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Build a node with a fresh id. `version` is the block definition's schema version. */
export function makeNode(
  type: string,
  version: number,
  props: Record<string, unknown> = {},
  slots?: Record<string, BlockNode[]>
): BlockNode {
  const node: BlockNode = { id: newId(), type, version, props };
  if (slots) node.slots = slots;
  return node;
}

/**
 * How `expandSlotDefaults` resolves a block type to what it needs to know.
 *
 * A one-method source rather than the registry, matching how the rest of this
 * package takes its inputs: resolving a type differs per caller — the editor
 * asks the global registry, a test supplies a fixture — and the rule applied to
 * the result is the same either way.
 */
export interface SlotDefaultSource {
  get(type: string):
    | {
        version: number;
        slots?: Record<string, SlotSpec>;
        /**
         * The child's own prop defaults, which a seeded child starts with just
         * as a directly inserted one does. Without it a block reached through a
         * parent's declaration arrives with `{}` while the same block chosen
         * from the palette arrives with its defaults — one block with two
         * starting states, decided by how the author happened to create it.
         */
        defaultProps?: object;
        /** The child's own parent restriction, read to refuse an illegal seed. */
        parent?: readonly string[];
      }
    | undefined;
}

/** What {@link SlotDefaultSource} answers with for a type it knows. */
type ResolvedDefinition = NonNullable<ReturnType<SlotDefaultSource["get"]>>;

/**
 * How deep a chain of declared defaults may go.
 *
 * **This bounds THIS function's own recursion; it does not promise the result
 * fits.** The same distinction the node budget below draws, and for the same
 * reason stated at the top of this module: these primitives make no claim about
 * whether what they build can be saved, and one place decides that at the point
 * of writing. A subtree seeded into an already-deep slot can exceed the
 * document's depth once placed, and the op layer refuses it — which is what
 * happens to any oversized insert and is not this function's question. It
 * cannot be this function's question: the insertion point belongs to the
 * caller, and a value expanded here may be placed anywhere or nowhere.
 *
 * `MAX_DEPTH` supplies the ceiling because it is the natural one and inventing
 * a second number would give the same question two answers — the failure this
 * replaced, where a legal nine-deep declaration was truncated by a bound this
 * module had chosen for itself.
 *
 * Less ONE, because the node these children hang from is created by the caller
 * and occupies a level of its own. That removes the case that could never fit
 * WHEREVER it landed; it does not make the remainder fit everywhere.
 *
 * The cycle set is what stops a block seeding itself at any remove, so this
 * bounds only a chain of DISTINCT types.
 */
const MAX_SLOT_DEFAULT_DEPTH = MAX_DEPTH - 1;

/**
 * How many nodes one expansion may create, and why a depth bound is not enough.
 *
 * The depth bound limits how DEEP a declaration reaches; it says nothing about
 * how WIDE. Ten children at each of eight levels is a legal set of declarations
 * and about a hundred million nodes, every one of them minting a UUID — enough
 * to exhaust the heap before anything downstream is asked a question.
 *
 * **This bounds THIS function's own allocation; it does not enforce a document
 * limit.** The distinction is the one stated at the top of this module: these
 * primitives make no claim about whether their result can be saved, and one
 * place decides that at the point of writing. A host running a lower cap gets
 * a subtree its op layer refuses, which is what happens to any oversized insert
 * and is not this function's question.
 *
 * `MAX_NODES` supplies the ceiling because it is the natural one and inventing
 * a second number would give the same question two answers. Less ONE, because
 * the node these children hang from is created by the caller and is not charged
 * here — spending the whole cap on children alone yields a subtree of
 * `MAX_NODES + 1` that could never fit whatever the caller does.
 */
const MAX_SLOT_DEFAULT_NODES = MAX_NODES - 1;

/**
 * The nesting rules as they read from a block-definition source.
 *
 * DERIVED from the one source this function already holds rather than taken as
 * a second parameter, for the reason `registrySlotSource` is derived from
 * `registryBlockSource`: two readings of one set of definitions agree only
 * until one of them changes. The RULE stays in `nesting.ts` — this supplies it
 * the same declarations the expansion is reading, so a seed is judged by
 * exactly the predicate that judges an author's own drag.
 */
function nestingFrom(definitions: SlotDefaultSource): NestingSource {
  return {
    parentsOf: type => definitions.get(type)?.parent,
    slotAllowOf: (parentType, slot) => {
      const slots = definitions.get(parentType)?.slots;
      return slots === undefined ? undefined : ownEntry(slots, slot)?.allow;
    },
  };
}

/**
 * The children a freshly placed block of `type` starts with, ready for
 * `makeNode`'s `slots` argument.
 *
 * This is the layer that makes a declared default safe. A block declares its
 * starting children by TYPE (`SlotSpec.defaultBlock`), and every node is minted
 * here through `makeNode` — so each call produces ids that have never existed,
 * and two parents expanded from one declaration cannot repeat each other's.
 * Holding the children as stored nodes instead would make that collision the
 * default behaviour rather than an unreachable one.
 *
 * Answers `undefined`, not an empty record, when nothing is to be created.
 * `makeNode` writes a `slots` key only when one is supplied, so `undefined`
 * leaves a container carrying no `slots` at all — which is what an empty
 * container is, and what the editor's own emptiness check reads.
 *
 * A declared child is expanded RECURSIVELY, so a container that declares its
 * own starting children arrives with them whether an author inserted it from
 * the palette or a parent's declaration seeded it. The alternative makes a
 * block's declaration depend on how it was reached, which is the one thing a
 * declaration should not do.
 *
 * Four things are deliberately skipped rather than refused, because a block
 * definition is code this package does not own and a bad entry in one must not
 * make the block unplaceable:
 * - an entry whose type the source cannot resolve contributes no child, since
 *   a node of an unregistered type renders as a placeholder the author did not
 *   ask for and cannot repair;
 * - an entry the nesting rules refuse contributes no child, because seeding it
 *   would build a document that the editor's own validation then reports as
 *   invalid — a block that is illegal to drag in must not arrive by being
 *   declared;
 * - an entry naming a type already being expanded contributes no child, which
 *   is what stops a declaration that cycles from recurring forever;
 * - a slot left with no children by any of those is omitted entirely, so a
 *   container never claims a slot it did not fill.
 *
 * The SHAPE of `defaultBlock` is not re-checked here. `registry.ts` refuses a
 * malformed one at registration with an actionable message, for the same reason
 * and in the same place it refuses a malformed `allow`: a reader that guards
 * every field it touches turns a boot-time error a plugin author can fix into a
 * silent difference in behaviour they cannot.
 */
export function expandSlotDefaults(
  type: string,
  definitions: SlotDefaultSource,
  nesting?: NestingSource
): Record<string, BlockNode[]> | undefined {
  return expandFrom(
    type,
    definitions,
    // The CALLER's rules when it has any, so a seeded child is judged by the
    // same source that decided what the palette would offer. A caller holding
    // its own nesting source and getting the registry's here would filter the
    // palette by one rule set and populate the insert by another.
    nesting ?? nestingFrom(definitions),
    new Set([type]),
    0,
    { remaining: MAX_SLOT_DEFAULT_NODES }
  );
}

/**
 * One level of {@link expandSlotDefaults}, carrying what recursion needs.
 *
 * `ancestors` holds the types already being expanded on this path rather than
 * every type seen anywhere, so two sibling slots may each seed the same child —
 * which is a shape an author would draw — while a type that reaches itself may
 * not.
 */
function expandFrom(
  type: string,
  definitions: SlotDefaultSource,
  nesting: NestingSource,
  ancestors: ReadonlySet<string>,
  depth: number,
  budget: { remaining: number }
): Record<string, BlockNode[]> | undefined {
  if (depth >= MAX_SLOT_DEFAULT_DEPTH) return undefined;
  // A plain record, not merely "not undefined". `slots: null` reaches
  // `Object.entries(null)` as a TypeError, and a supplied definition never
  // passed registration — the same reason the entries below are checked. The
  // enclosing map arrives through exactly the source its contents do.
  const declaredSlots = definitions.get(type)?.slots;
  if (!isPlainRecord(declaredSlots)) return undefined;

  const expanded: Record<string, BlockNode[]> = {};
  let filledAnySlot = false;

  for (const [slotName, spec] of Object.entries(declaredSlots)) {
    // Registration refuses a slot named for an `Object.prototype` member, and
    // registration is not the only way a definition reaches here: a supplied
    // definition the registry does not hold never passed that check. Filling
    // such a slot materialises a key `assertNodeShape` then rejects, so the op
    // is refused and the author's click does nothing, silently. The SAME
    // predicate answers here, so the two paths cannot disagree about a name.
    if (!isUsableSlotName(slotName)) continue;
    const children = childrenForSlot(spec?.defaultBlock, {
      type,
      slotName,
      definitions,
      nesting,
      ancestors,
      depth,
      budget,
    });
    // A slot whose declaration produced nothing is omitted entirely, so a
    // container never claims a slot it did not fill.
    if (children.length === 0) continue;
    // `defineEntry` rather than assignment: a slot name is chosen by whichever
    // package defined the block, so it is not a string this package controls,
    // and assigning to `__proto__` would create no key while replacing the
    // record's prototype.
    defineEntry(expanded, slotName, children);
    filledAnySlot = true;
  }

  return filledAnySlot ? expanded : undefined;
}

/** What one slot's declaration expands to, with every refused entry dropped. */
function childrenForSlot(
  declared: SlotSpec["defaultBlock"],
  context: {
    readonly type: string;
    readonly slotName: string;
    readonly definitions: SlotDefaultSource;
    readonly nesting: NestingSource;
    readonly ancestors: ReadonlySet<string>;
    readonly depth: number;
    readonly budget: { remaining: number };
  }
): BlockNode[] {
  // The SHAPE is checked here and not only at registration, because
  // registration is no longer the only way a definition reaches this function.
  // `blockSourceFor` deliberately admits a caller-supplied definition the
  // registry does not hold, so a host or fixture declaration never passes
  // `registerBlocks` at all — and a non-array reaching the loop below throws
  // `TypeError: declared is not iterable` at the author's click.
  if (!Array.isArray(declared)) return [];
  const children: BlockNode[] = [];
  for (const entry of declared) {
    const child = childForEntry(entry, context);
    if (child !== null) children.push(child);
  }
  return children;
}

/**
 * One declared entry as a node, or `null` where it must not be created.
 *
 * Separate from the slot loop because it answers a different question: the loop
 * decides which slots get filled, this decides whether one declaration may
 * become a child at all. Each `null` below is a distinct refusal, and keeping
 * them together is what lets the loop above read as the shape it builds.
 */
type EntryContext = {
  readonly type: string;
  readonly slotName: string;
  readonly definitions: SlotDefaultSource;
  readonly nesting: NestingSource;
  readonly ancestors: ReadonlySet<string>;
  readonly depth: number;
  readonly budget: { remaining: number };
};

/**
 * The entry's resolved type and definition, or `null` for any reason it must
 * not become a child.
 *
 * Every refusal lives here and none of them in the construction below, so the
 * two questions stay apart: whether this declaration MAY become a child, and
 * what that child is. Each `null` is a distinct reason, and the comments name
 * the failure each one prevents rather than restating the condition.
 */
function resolvedEntry(
  entry: unknown,
  context: EntryContext
): { type: string; definition: ResolvedDefinition } | null {
  const { definitions, nesting, ancestors, budget } = context;
  // Checked before the definition is even resolved: once the budget is spent
  // nothing further can be built, so the cheapest possible refusal is the right
  // one.
  if (budget.remaining <= 0) return null;
  // An entry is not trusted to BE an entry. A sparse array yields `undefined`
  // here — `Array.prototype.every` skips a hole while `for...of` visits it, so
  // a declaration validated by the first is read by the second — and an
  // unregistered supplied definition never passed any shape check at all.
  if (!isPlainRecord(entry)) return null;
  const type = entry.type;
  if (!isBlockType(type)) return null;
  const definition = definitions.get(type);
  // A node of an unregistered type renders as a placeholder the author did not
  // ask for and cannot repair.
  if (definition === undefined) return null;
  // Both halves of the nesting rule, because `block.ts` is explicit that
  // neither implies the other: the child says where it belongs, the slot says
  // what it holds, and a seed has to satisfy both to be a placement the author
  // could have made themselves.
  if (!canNest(type, context.type, nesting).allowed) return null;
  if (!canNestInSlot(type, context.type, context.slotName, nesting).allowed) {
    return null;
  }
  // Already being expanded on this path, so creating it again would not
  // terminate.
  if (ancestors.has(type)) return null;
  return { type, definition };
}

function childForEntry(
  entry: unknown,
  context: EntryContext
): BlockNode | null {
  const { definitions, nesting, ancestors, depth, budget } = context;
  const resolved = resolvedEntry(entry, context);
  if (resolved === null) return null;
  const { type, definition } = resolved;

  // The child's own defaults UNDERNEATH the entry's values, so a seeded child
  // starts where a directly inserted one starts and the declaration overrides
  // only what it actually names.
  //
  // Deep-copied, because the declaration and the definition both outlive every
  // block expanded from them: handing out either object would let an edit to
  // one inserted block reach back into the definition, and through it every
  // block expanded from it afterwards. A shallow copy is not enough, because a
  // declared value may be an array or a nested object.
  // `isPlainRecord` judges the prototype, not the contents, so a declared prop
  // holding a function or a symbol is a plain object that `structuredClone`
  // refuses with a `DataCloneError`. Uncaught, that throws at the author's
  // click rather than anywhere a plugin author would see it. The child is
  // dropped instead, which is what every other unusable entry here does — a
  // container arriving without one declared child is a state the editor
  // already renders, and a thrown insert is not.
  let props: Record<string, unknown>;
  try {
    props = structuredClone({
      ...(definition.defaultProps ?? {}),
      ...(isPlainRecord(entry) && isPlainRecord(entry.props)
        ? entry.props
        : {}),
    });
  } catch {
    return null;
  }

  // Spent BEFORE recursing, so a child's own declared children are drawn from
  // what remains after it rather than from the budget its parent saw.
  budget.remaining -= 1;
  return makeNode(
    type,
    // The CHILD's own schema version, never the parent's: a node stamped with
    // its parent's version is read by the migration runner as older or newer
    // than it is, and gets upgrade steps meant for a different block.
    definition.version,
    props,
    expandFrom(
      type,
      definitions,
      nesting,
      new Set([...ancestors, type]),
      depth + 1,
      budget
    )
  );
}

/** Where an insert or move lands: a parent's slot, or the top level when `parentId` is absent. */
export interface TreePosition {
  parentId?: string;
  /** Required when `parentId` is set; ignored for top-level positions. */
  slot?: string;
  index: number;
}

/** How a caller narrows the walk. */
export interface WalkOptions {
  /** Reported as the parent of the top-level nodes. */
  parent?: BlockNode;
  /**
   * Stop after reading this many entries.
   *
   * ENTRIES, not nodes visited: a forest can begin with a long run of nulls or
   * primitives that never reach the callback, and a bound counting callbacks
   * cannot see them. Reading is the work being bounded, and `selectNodes`
   * bounds the same quantity so a caller reasons about one budget.
   *
   * A bound the caller applies in its own callback is not this either: the
   * callback can decline to do work, but the walk has already reached every
   * remaining entry. This ends the traversal.
   */
  maxNodes?: number;
  /**
   * Called for each node skipped because it is its own ancestor.
   *
   * The walk is the only place that knows — detecting a cycle is a property of
   * having traversed — so it reports rather than leaving each caller to find
   * out by traversing again. Readers ignore this and keep walking; a WRITER has
   * to refuse, because a cycle it accepts becomes a forest that later recursive
   * operations cannot traverse at all.
   */
  onCycle?: (node: BlockNode) => void;
}

/**
 * The third argument in either of its accepted forms.
 *
 * `walkNodes` published a bare `parent` here before it took options, and a
 * caller compiled against that signature passes a node. Rejecting it is not an
 * option a type can enforce at runtime: the property lookup would simply miss
 * and every top-level callback would receive `undefined` as its parent, which
 * is a wrong answer rather than an error. The two shapes have no property in
 * common, so `id` separates them exactly.
 */
function toWalkOptions(
  third: BlockNode | WalkOptions | undefined
): WalkOptions {
  if (third === undefined) return {};
  return "id" in third ? { parent: third } : third;
}

/** Whether an entry is a value this walk can treat as a node. */
function isWalkableNode(node: unknown): node is BlockNode {
  // `Array.isArray` is checked SEPARATELY because `typeof [] === "object"`, so
  // the type test alone hands an array to `fn` as though it were a node. Every
  // caller then reads its fields as `undefined` rather than failing: an
  // id-uniqueness check sees `undefined` and compares it against other
  // `undefined`s, a class reader finds no classes, a renderer finds no type.
  // Silence in each case, from a value none of them can act on.
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

/**
 * Depth-first visit over the forest: each node, then its slots' children in
 * order.
 *
 * The forest reaches here from persisted data whether or not anything validated
 * it — the blocks field admits any value whose `nodes` is an array — so an entry
 * may be `null` or a primitive, and a slot's children may not be an array at
 * all. Those are skipped rather than reported, because a walk has nobody to
 * report to: a caller that needs to know an entry was unreadable is asking a
 * validation question, and validation is where that answer lives. Skipping also
 * matches what the renderer does with the same shapes, so a reader counting
 * references here agrees with what the page actually applies.
 *
 * Iterative rather than recursive, because the forest's DEPTH is bounded by
 * nothing that has run before this. `MAX_DEPTH` is a validation rule, and a
 * document arrives whether or not validation ever passed on it — measured, a
 * chain about ten thousand deep exited a recursive walk with
 * `RangeError: Maximum call stack size exceeded`, no cycle involved.
 *
 * A node is skipped when it is already ON THE PATH from the root to itself,
 * which is what a cycle is. That is deliberately narrower than skipping every
 * node seen anywhere: the same node OBJECT placed in two different slots is not
 * a cycle, and a walk that visited it once would report a subtree containing one
 * duplicated id as containing none — which is exactly the question
 * `insertionIsUnsafe` asks this walk, and the answer that would let `insertNode`
 * build a forest addressing two positions by one id.
 */
export function walkNodes(
  nodes: BlockNode[],
  fn: (node: BlockNode, parent: BlockNode | undefined) => void,
  parent?: BlockNode
): void;
export function walkNodes(
  nodes: BlockNode[],
  fn: (node: BlockNode, parent: BlockNode | undefined) => void,
  options?: WalkOptions
): void;
export function walkNodes(
  nodes: BlockNode[],
  fn: (node: BlockNode, parent: BlockNode | undefined) => void,
  third?: BlockNode | WalkOptions
): void {
  const options = toWalkOptions(third);
  const limit = options.maxNodes ?? Number.POSITIVE_INFINITY;
  if (limit <= 0) return;

  let read = 0;
  walkForest(nodes, entry => {
    // Every entry READ spends the budget, not every entry that turned out to be
    // a node. Reading is the work being bounded, so a forest beginning with a
    // long run of nulls would otherwise be traversed in full while the budget
    // sat untouched — the callback never fires, and a bound counting callbacks
    // cannot see it. `selectNodes` bounds the same quantity for the same reason.
    read += 1;
    if (!isWalkableNode(entry.node)) return read >= limit ? "stop" : "skip";

    // The shared walk does not descend into a node already on the path, so an
    // entry reported twice at the same identity is the cycle closing. Reported
    // rather than silently skipped: a READER tolerates one, a WRITER has to
    // refuse, and the walk is the only place that knows.
    if (entry.cycle) {
      options.onCycle?.(entry.node);
      return read >= limit ? "stop" : "skip";
    }

    fn(entry.node, entry.parent ?? options.parent);
    return read >= limit ? "stop" : "descend";
  });
}

/** Find a node anywhere in the forest by id. */
export function findNode(
  nodes: BlockNode[],
  id: string
): BlockNode | undefined {
  let found: BlockNode | undefined;
  walkForest(nodes, entry => {
    // Persisted forests reach here unvalidated, so an entry may be `null` or a
    // primitive and reading `id` off one throws.
    if (!isWalkableNode(entry.node)) return "skip";
    if (entry.node.id === id) {
      found = entry.node;
      // Abandons the walk with the stack unread. A recursive search noticed a
      // cycle only AFTER descending to the repeated ancestor, so a cycle longer
      // than the call stack exhausted it before the guard ever ran — machine
      // depth was the real bound, not the guard.
      return "stop";
    }
    return "descend";
  });
  return found;
}

/** A found node's placement: its parent (undefined at top level), slot, and index. */
export interface NodeLocation {
  parent?: BlockNode;
  slot?: string;
  index: number;
}

/** Locate a node's parent, slot, and index; undefined when the id is absent. */
export function locateNode(
  nodes: BlockNode[],
  id: string
): NodeLocation | undefined {
  // Read defensively at every step. This is a stored document and nothing here
  // has validated it — a slot may hold `null` instead of an array, and a list
  // may hold a hole — so an entry is asked for its id rather than assumed to
  // have one. It matters because ONE damaged node anywhere in the forest would
  // otherwise throw, and the caller looking for a completely unrelated
  // selection elsewhere in the document gets a crash instead of an answer.
  const topIndex = nodes.findIndex(node => node?.id === id);
  if (topIndex !== -1) return { index: topIndex };
  let found: NodeLocation | undefined;
  walkNodes(nodes, node => {
    if (found || !node.slots) return;
    for (const [slot, children] of Object.entries(node.slots)) {
      if (!Array.isArray(children)) continue;
      const index = children.findIndex(child => child?.id === id);
      if (index !== -1) {
        found = { parent: node, slot, index };
        return;
      }
    }
  });
  return found;
}

/**
 * One step of an immutable rebuild: a source list being read, or a node whose
 * slots are now built and can be assembled.
 *
 * `close` sits BELOW its slot frames, so it is reached only after every
 * descendant has been rebuilt — which is what makes this a post-order walk
 * without recursion. Depth then costs a frame rather than a stack level, and
 * these primitives run on documents nothing validated.
 */
type BuildTask =
  | { kind: "read"; source: readonly unknown[]; index: number; out: unknown[] }
  | {
      kind: "close";
      source: unknown;
      mapped: BlockNode;
      built: Map<string, BlockNode[]>;
      out: unknown[];
    };

/**
 * Queue each of a node's slots for rebuilding, recording where each result goes.
 *
 * A slot whose stored value is not an array is left OUT of `built`, which is how
 * `assembleSlots` knows to keep it exactly as it was.
 */
function queueSlotRebuilds(
  stack: BuildTask[],
  mapped: BlockNode,
  built: Map<string, BlockNode[]>
): void {
  const names = Object.keys(mapped.slots ?? {});
  // Reversed so the first slot is rebuilt first.
  for (let i = names.length - 1; i >= 0; i -= 1) {
    const name = names[i];
    if (name === undefined) continue;
    const children = mapped.slots?.[name];
    if (!Array.isArray(children)) continue;
    const into: BlockNode[] = [];
    built.set(name, into);
    stack.push({ kind: "read", source: children, index: 0, out: into });
  }
}

/**
 * Immutably rebuild the forest, applying `fn` to every node.
 *
 * Three things it must not do, each learned from getting one of them wrong:
 *
 * A node reached through itself is DROPPED from its parent's list, not kept as
 * a childless copy. Keeping it returns a forest carrying that node's id twice —
 * `parent -> child -> parent` rebuilt as `[parent, child, parent]` — which makes
 * every id lookup ambiguous and fails the validation the repair was for. The
 * entry that closes the cycle is the one that cannot exist in a finite tree, so
 * it is the one that goes.
 *
 * A malformed ENTRY is passed through untouched rather than mapped. `fn` is
 * written for nodes and reads `id` off what it is given, so handing it a `null`
 * throws — and a caller editing an unrelated field has no business failing over
 * a neighbour it never named.
 *
 * A malformed SLOT VALUE is preserved exactly. Replacing it with an empty array
 * would let any unrelated edit silently destroy stored content that a caller
 * may still need to read or repair, which is a worse outcome than the throw it
 * replaced: the throw was loud and lost nothing.
 *
 * Published because those three are exactly what a caller rewriting one field
 * across a stored forest gets wrong, and each was learned here rather than
 * guessed. A planner stripping a lock or a provenance record wrote its own walk
 * and inherited none of them; the rule is that a forest rewrite is this
 * function with a different `fn`, not a new traversal.
 */
export function mapForest(
  nodes: BlockNode[],
  fn: (node: BlockNode) => BlockNode
): BlockNode[] {
  if (!Array.isArray(nodes)) return nodes;
  const rebuilt: unknown[] = [];
  const onPath = new Set<unknown>();
  const stack: BuildTask[] = [
    { kind: "read", source: nodes, index: 0, out: rebuilt },
  ];

  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (top === undefined) break;

    if (top.kind === "close") {
      stack.pop();
      onPath.delete(top.source);
      top.out.push(assembleSlots(top.mapped, top.built));
      continue;
    }
    if (top.index >= top.source.length) {
      stack.pop();
      continue;
    }
    const entry = top.source[top.index];
    top.index += 1;

    if (!isWalkableNode(entry)) {
      top.out.push(entry);
      continue;
    }
    // The cycle closes here: this entry is its own ancestor, so it is omitted.
    if (onPath.has(entry)) continue;

    const mapped = fn(entry);
    // Anything that is not a slots RECORD is passed through untouched, not just
    // `undefined`. A stored `slots: null` — or a primitive — has no entries to
    // enumerate, and sending it on would replace it with `{}`: stored content
    // rewritten by an edit that named a different node. The recursive rebuild
    // this replaced kept such a node as it was, and losing that was a
    // regression rather than a change of policy.
    if (!isSlotsRecord(mapped.slots)) {
      top.out.push(mapped);
      continue;
    }

    onPath.add(entry);
    // A Map, not a record. Slot NAMES come from unvalidated stored data, and a
    // plain object answers for keys it never had: `built["constructor"]`
    // resolves `Object.prototype.constructor`, so a malformed slot deliberately
    // left out of this set would come back as a function and be dropped by
    // serialization — the stored value destroyed by an unrelated edit, which is
    // the exact loss preserving it was meant to prevent.
    const built = new Map<string, BlockNode[]>();
    stack.push({ kind: "close", source: entry, mapped, built, out: top.out });
    queueSlotRebuilds(stack, mapped, built);
  }

  return rebuilt as BlockNode[];
}

/** Whether a node's `slots` is a record this rebuild can enumerate. */
function isSlotsRecord(slots: unknown): slots is Record<string, BlockNode[]> {
  // `Array.isArray` separately, because `typeof [] === "object"` and an array
  // of slots is malformed rather than empty.
  return typeof slots === "object" && slots !== null && !Array.isArray(slots);
}

/** Put the rebuilt slots back on a node, keeping any slot that was not rebuilt. */
function assembleSlots(
  mapped: BlockNode,
  built: Map<string, BlockNode[]>
): BlockNode {
  const slots: Record<string, BlockNode[]> = {};
  for (const [name, original] of Object.entries(mapped.slots ?? {})) {
    // A slot absent from `built` held something this rebuild could not walk.
    // Keeping the stored value is the point: an unrelated edit must not be the
    // thing that destroys it.
    const value = built.get(name) ?? original;
    // DEFINED rather than assigned — the write-side twin of reading through a
    // `Map` above. `safe-record` carries why; it is shared because fixing this
    // one site left three others in the package with the plain-assignment form.
    defineEntry(slots, name, value);
  }
  return { ...mapped, slots };
}

/** Clamp an insertion index into a list's valid range. */
function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

/**
 * True if inserting `node` into `nodes` would produce a forest the primitives
 * can no longer address or traverse.
 *
 * Three ways, and they are rejected together because the consequence is the
 * same: the incoming subtree carries a duplicate id WITHIN itself, one of its
 * ids already lives in the destination forest, or it contains a CYCLE.
 *
 * Collapsing duplicate incoming ids into the set would let an internally
 * malformed subtree through and corrupt id-addressing after insertion.
 *
 * The cycle is asked of the walk rather than looked for here. `walkNodes` is
 * cycle-TOLERANT by design — a reader counting classes or measuring a document
 * must answer rather than fail — so a cycle is invisible in what it visits, and
 * a guard reading only the visits would call a cyclic subtree clean. What the
 * walk reports is therefore the only account of it, and a second traversal
 * written here to look again would be a second definition of the same thing.
 *
 * This refuses an incoming ARGUMENT, which is why it survives the rule that
 * these primitives do not refuse an already-unstorable document: a cyclic
 * subtree handed in by a caller ADDS a cycle to a forest that may not have had
 * one, rather than declining to work on damage that was already there.
 */
function checkInsertion(
  nodes: BlockNode[],
  node: BlockNode
): { unsafe: boolean; destinationCyclic: boolean } {
  const incoming = new Set<string>();
  let internalDuplicate = false;
  let cyclic = false;
  walkNodes(
    [node],
    n => {
      if (incoming.has(n.id)) internalDuplicate = true;
      incoming.add(n.id);
    },
    {
      onCycle: () => {
        cyclic = true;
      },
    }
  );
  if (cyclic || internalDuplicate) {
    return { unsafe: true, destinationCyclic: false };
  }
  let overlapsForest = false;
  let destinationCyclic = false;
  // Taken from the walk this already performs. The destination's own state is
  // needed to keep the two insertion paths in agreement, and asking for it
  // separately would be a second traversal answering a question this one has
  // already passed through.
  walkNodes(
    nodes,
    n => {
      if (incoming.has(n.id)) overlapsForest = true;
    },
    {
      onCycle: () => {
        destinationCyclic = true;
      },
    }
  );
  return { unsafe: overlapsForest, destinationCyclic };
}

/** A node, unchanged. The rebuild is the point; `mapForest` does the rest. */
function identity(node: BlockNode): BlockNode {
  return node;
}

/**
 * Rebuild a forest, dropping any entry that closes a cycle.
 *
 * Named because two callers need it for the same reason and neither is
 * transforming anything: a cycle-closing entry is the one thing in a stored
 * document that CANNOT round-trip through storage — `JSON.stringify` refuses
 * it — so a rebuild that omits it destroys nothing a caller could ever have
 * saved. That is what separates it from a malformed slot value, which is
 * preserved exactly: a strange value still writes and reads back, so dropping
 * one would lose real content.
 */
function withoutCycleEdges(nodes: BlockNode[]): BlockNode[] {
  return mapForest(nodes, identity);
}

/**
 * Insert a node at a position. Returns the forest unchanged (the no-op contract
 * used across these primitives) when the target is invalid: an unknown parent
 * id, a slot position missing its slot, or a node that would break id
 * uniqueness — a subtree with an internal duplicate id, or an id that already
 * lives in the forest. The uniqueness guard is what makes the primitive safe:
 * re-inserting an existing node would corrupt id-addressing and, for a
 * self/descendant target, make `mapForest` recurse into the object just
 * inserted. Callers duplicating content pass a `reidSubtree` clone.
 */
export function insertNode(
  nodes: BlockNode[],
  node: BlockNode,
  at: TreePosition
): BlockNode[] {
  const check = checkInsertion(nodes, node);
  if (check.unsafe) return nodes;
  if (at.parentId === undefined) {
    // Rebuilt rather than copied when the destination carries a cycle, so both
    // insertion paths answer the same way. The path below reaches `mapForest`,
    // which drops a cycle-closing entry as it rebuilds; a plain array copy here
    // does not, so the same operation left the cycle in place for a top-level
    // target and removed it for a nested one — one primitive with two answers,
    // decided by where the caller happened to point it.
    const base = check.destinationCyclic ? withoutCycleEdges(nodes) : nodes;
    const next = [...base];
    next.splice(clampIndex(at.index, next.length), 0, node);
    return next;
  }
  const { parentId, slot, index } = at;
  if (slot === undefined) return nodes;
  if (!findNode(nodes, parentId)) return nodes;
  return mapForest(nodes, current => {
    if (current.id !== parentId) return current;
    const slots = { ...(current.slots ?? {}) };
    // Read and written through `safe-record`, because `slot` is a name from
    // outside this module and both halves fail on it independently. Reading
    // `slots["__proto__"]` on a record without that key yields
    // `Object.prototype` rather than `undefined`, so `?? []` does not fire and
    // the spread throws; writing it invokes the prototype setter and stores
    // nothing. Fixing either one alone leaves the other.
    const children = [...(ownEntry(slots, slot) ?? [])];
    children.splice(clampIndex(index, children.length), 0, node);
    defineEntry(slots, slot, children);
    return { ...current, slots };
  });
}

/**
 * Remove a node (and its subtree) wherever it lives, including the top level.
 * Returns the original forest reference untouched when the id is absent, so a
 * no-op delete never produces a spurious new tree for change-tracking callers.
 */
export function removeNode(nodes: BlockNode[], id: string): BlockNode[] {
  if (!findNode(nodes, id)) return nodes;
  const withoutTop = nodes.filter(node => node.id !== id);
  return mapForest(withoutTop, node => {
    if (!node.slots) return node;
    // `Object.fromEntries` rather than a loop assigning into a fresh object.
    // Slot names come from stored data, and the loop form drops a `__proto__`
    // slot — an edit that named a DIFFERENT node silently deleting stored
    // content. `fromEntries` defines each key, so it keeps one. See
    // `safe-record` for the two spellings that do not.
    const slots = Object.fromEntries(
      Object.entries(node.slots).map(([name, children]) => [
        name,
        children.filter(child => child.id !== id),
      ])
    );
    return { ...node, slots };
  });
}

/**
 * Move a node to a new position. Moves that would create a cycle (into the
 * node itself or its own subtree) or reference a missing node/parent return
 * the forest unchanged.
 */
export function moveNode(
  nodes: BlockNode[],
  id: string,
  to: TreePosition
): BlockNode[] {
  const moving = findNode(nodes, id);
  if (!moving) return nodes;
  if (to.parentId !== undefined) {
    // A slot position must name its slot; without this guard the remove below
    // would succeed and the re-insert would no-op, silently losing the node.
    if (to.slot === undefined) return nodes;
    // Cycle guard: the destination parent must not be the node or inside it.
    if (to.parentId === id || findNode([moving], to.parentId)) return nodes;
    if (!findNode(nodes, to.parentId)) return nodes;
  }
  const without = removeNode(nodes, id);
  // Rebuilt before it is re-inserted, because the subtree came out of the
  // DOCUMENT rather than from the caller. `checkInsertion` refuses a cyclic
  // argument to stop a caller adding a cycle to a healthy forest, and a node
  // extracted from a document that was already cyclic is not that — refusing it
  // meant a damaged block could never be moved, which is the one thing an
  // author might do to get it out of the way.
  const [relocated] = withoutCycleEdges([moving]);
  const next = insertNode(without, relocated ?? moving, to);
  // The move must be atomic. If the re-insert refused — which happens only when
  // the moving subtree is itself already malformed (an internal duplicate id) —
  // `insertNode` returns the `without` forest unchanged; committing that would
  // drop the subtree. Fall back to the original forest so a bad document is
  // left as-is rather than losing content.
  return next === without ? nodes : next;
}

/** Deep-clone a subtree, assigning fresh ids to every node (copy/paste, patterns). */
export function reidSubtree(node: BlockNode): BlockNode {
  // Rebuilt through the shared walk rather than by recursing here. It already
  // knows how to drop a cycle-closing entry, leave a malformed slot alone and
  // keep depth off the call stack, and a second traversal written here would be
  // a second set of answers to the same three questions.
  const [rebuilt] = mapForest([node], reidOne);
  return rebuilt ?? node;
}

/**
 * What re-identifying a subtree produced, when the caller needs to follow it.
 *
 * {@link reidSubtree} drops a copy's DOM ids, which is right when the copy is
 * all anyone will look at. It is wrong when the subtree REFERS to itself: a
 * link inside a saved pattern pointing at `#pricing` resolves to a node in the
 * same pattern, and dropping the target's id leaves the copy carrying a link to
 * nowhere — worse, to whatever `#pricing` the destination page happens to own.
 *
 * So the ids are remapped rather than dropped, and both maps are handed back.
 * The engine cannot rewrite the references itself: a link's target lives in a
 * block's props, and which prop holds one is a property of the block's
 * definition rather than of the document format.
 */
export interface ReidentifiedSubtree {
  /** The rebuilt subtree. */
  node: BlockNode;
  /** Every node's old id → its new one. */
  nodeIds: ReadonlyMap<string, string>;
  /**
   * Every DOM id the subtree carried → its replacement.
   *
   * Keyed by the id as written. A subtree that already used one id on two nodes
   * is malformed — validation reports it as a duplicate — and appears here once,
   * mapped to the first replacement minted.
   */
  domIds: ReadonlyMap<string, string>;
}

/**
 * What a re-identification does with the DOM ids it copies.
 *
 * Two words rather than a boolean, because the call site is where this is read
 * and `true` at a call site says nothing about which way it points.
 *
 * - `{ avoid }` — mint only the ids the destination ALREADY holds, and carry
 *   the rest verbatim. For an INSERT, which is the only caller that can name
 *   what it is landing among.
 * - `"keep"` — carry every id across and record none as moved. For a run being
 *   lifted into a document of its OWN, which is every SAVE: nothing is placed
 *   beside anything, so nothing can collide.
 * - `"remint"` — mint every id unconditionally. For a copier that cannot see
 *   its destination, which is composition inlining a definition into an
 *   instance without reading the host.
 *
 * A DOM id is authored content — someone typed `hero`, and it appears in a URL
 * fragment, a stylesheet and the attribute panel — so it is rewritten only when
 * keeping it would put two elements on a page answering to one id. `{ avoid }`
 * exists because `"remint"` was doing it always: inserting into a page holding
 * no `hero` still produced `hero-e75f55fb`, and feeding that back through a
 * save grew the id by nine characters every cycle without bound.
 */
export type DomIdPolicy =
  | "remint"
  | "keep"
  | {
      /** The DOM ids the destination already carries, folded as HTML folds them. */
      readonly avoid: ReadonlySet<string>;
    };

/** A re-identified FOREST, and the two maps describing what moved. */
export interface ReidentifiedForest {
  /** The rebuilt roots, in the order they were given. */
  nodes: BlockNode[];
  /** Every node's old id → its new one, across every root. */
  nodeIds: ReadonlyMap<string, string>;
  /**
   * Every DOM id the forest carried → its replacement, across every root.
   *
   * EMPTY under {@link DomIdPolicy} `"keep"`, which is the honest record rather
   * than an omission: nothing moved, so nothing needs following. A caller
   * checking this map against a destination is asking which ids this copy
   * introduces, and identity entries would answer that question wrongly.
   */
  domIds: ReadonlyMap<string, string>;
}

/**
 * Deep-clone a FOREST with fresh ids, KEEPING its internal references usable.
 *
 * The same rebuild as {@link reidSubtree}, differing in what happens to a DOM
 * id: dropped there, and here either minted afresh and recorded or carried
 * across untouched, as {@link DomIdPolicy} says. Dropping is the one answer
 * neither caller can use. Two copies of one pattern on a page must not emit the
 * same HTML `id`, and a copy's internal anchor must still reach its own target
 * — and an id that is simply gone satisfies neither.
 *
 * The minted id is DERIVED from the original (`pricing` becomes
 * `pricing-<suffix>`) rather than freshly random, because it is a value authors
 * read and write: it appears in a URL fragment, in a stylesheet and in the
 * attribute panel. A UUID would be unique and unusable.
 *
 * ## Why a forest, and not one root at a time
 *
 * A saved selection is a contiguous RUN of siblings, so the document it becomes
 * holds several roots, and re-identifying them with one call each is not the
 * same operation. Each call can only see the subtree it was handed, so its
 * `domIds` records that subtree's ids and nothing else — and a reference that
 * crosses from one root to another finds no entry, and is left pointing at the
 * ORIGINAL element. For `aria-labelledby` and `aria-describedby` that means the
 * copy silently loses its accessible name, a failure invisible to everyone who
 * does not use assistive technology. Re-identifying the roots TOGETHER is what
 * makes the second pass see every id, so the guarantee is a property of this
 * function rather than of each caller remembering not to loop.
 *
 * Uniqueness is guaranteed WITHIN the returned forest, not against the document
 * it is going into — this function is given a forest and cannot see anything
 * else. A caller inserting into a page it can read should check
 * {@link ReidentifiedForest.domIds} against that page.
 *
 * ## Minting is for a copy that lands BESIDE its original
 *
 * That is the whole reason for it, so what a caller answers is which ids its
 * destination already holds. `"keep"` is for the one landing among nothing: a
 * run lifted out of a page to become a document of its OWN. `{ avoid }` is for
 * one that can name what is there. Minting where neither says to is not merely
 * unnecessary, it is wrong in three ways that were measured rather than
 * argued.
 *
 * A DOM id is authored content: someone typed `hero`, and it appears in a URL
 * fragment, a stylesheet and the attribute panel. Storing `hero-3ee4a0d4` puts
 * a value in the library that no author wrote and every author sees.
 *
 * It is not idempotent. Save the same selection twice and the two stored copies
 * differ, so anything fingerprinting content — `patternDigest` keeps `cssId`
 * deliberately, because a copy derives from it — reports a change nobody made.
 * A staleness signal that fires without cause teaches authors to dismiss the
 * one that means something.
 *
 * And it accumulates. Save, insert, save over the source, insert again: the id
 * grew by nine characters every cycle, `hero` to
 * `hero-3ee4a0d4-fb48e67c-1118df3b` and on, with no bound.
 */
export function reidForestWithMap(
  nodes: BlockNode[],
  domIdPolicy: DomIdPolicy = "remint"
): ReidentifiedForest {
  const nodeIds = new Map<string, string>();
  const domIds = new Map<string, string>();

  // A node the renderer prunes puts NO id on the page, so none of its ids may
  // be rewritten: renaming one and following every reference to it leaves a
  // visible sibling's `#hero` pointing at a minted id nothing owns, where
  // before it reached the destination's own `hero`.
  const hidden = hiddenSubtreeNodes(nodes);
  const rebuilt = mapForest(nodes, original =>
    reidOneKeepingReferences(original, nodeIds, domIds, domIdPolicy, hidden)
  );
  // A SECOND pass, because a node may reference an id defined on a node the
  // first had not reached yet. Without it a copied `aria-labelledby` points at
  // the original's id, so the copy loses its accessible name — the same gap
  // composition has, closed the same way.
  const linked = mapForest(rebuilt, copy => relinkOne(copy, domIds));
  return { nodes: linked, nodeIds, domIds };
}

/**
 * One copied node, with every reference to a re-minted id following the copy.
 *
 * Both halves matter and only one of them is markup. `aria-labelledby` lives in
 * `attributes`; a link's target lives in `props` as `href: "#pricing"`, and a
 * copy that moves the id without the link leaves the anchor resolving to
 * nothing. Applied HERE rather than left to each caller, because the caller
 * that forgets does not fail — it stores a document that renders, validates and
 * quietly points somewhere else.
 */
function relinkOne(
  copy: BlockNode,
  domIds: ReadonlyMap<string, string>
): BlockNode {
  // `isPlainRecord`, not `!== undefined`. A persisted `attributes: null` is
  // content the first pass deliberately carries through untouched, and handing
  // it to the remapper enumerates null and throws — a rebuild that destroys a
  // node because of a field on a different one.
  const attributes = isPlainRecord(copy.attributes)
    ? remapIdReferences(copy.attributes, domIds)
    : copy.attributes;
  // See `fragment-refs` for why a copier may rewrite a prop it has no schema
  // for: only a whole string of `#` plus an id THIS copy minted is touched, and
  // nothing but a reference to the copy's own target can spell that.
  const props = remapFragmentProps(copy.props, domIds) as BlockNode["props"];
  // And the BOUND form of the same field. A bound `href` keeps its literal in
  // `bindings.href.fallback`, which is what renders when the source is empty —
  // so leaving it behind makes the link work until the data does not, which is
  // the one case the fallback exists for.
  const bindings = remapFragmentBindings(
    copy.bindings,
    domIds
  ) as BlockNode["bindings"];
  // Every remapper returns its input unchanged when nothing matched, so an
  // ordinary node is returned as it stands rather than reallocated.
  if (
    attributes === copy.attributes &&
    props === copy.props &&
    bindings === copy.bindings
  ) {
    return copy;
  }
  // Spread CONDITIONALLY. `{ ...copy, bindings }` writes the key even when the
  // value is `undefined`, and a key holding `undefined` is a value JSON cannot
  // carry — `applyOp` refuses the whole insert for it. An ordinary node has no
  // `bindings`, so any copy that relinked anything at all produced an op group
  // the apply then rejected, and the planner's dry run promised an insert that
  // could not happen.
  return {
    ...copy,
    ...(attributes === undefined ? {} : { attributes }),
    ...(props === undefined ? {} : { props }),
    ...(bindings === undefined ? {} : { bindings }),
  };
}

/**
 * One subtree, re-identified — {@link reidForestWithMap} for a single root.
 *
 * Delegates rather than repeating the two passes, so the singular and the
 * plural cannot drift into disagreeing about what a copy is.
 *
 * It takes no {@link DomIdPolicy}, and the honest reason is that nothing in the
 * product calls this. Measured: every occurrence outside this file is a test,
 * the package entry, or a comment in `resolve-instances.ts` citing it as an
 * analogy — composition keeps a `domIds` memo of its own and re-identifies to
 * deterministic scoped ids rather than random ones, and a save works on a RUN
 * of siblings and reaches for the forest form. Adding the parameter would be
 * offering an option to nobody. Whether a published helper with no caller
 * should stay is a separate question from this one.
 */
export function reidSubtreeWithMap(node: BlockNode): ReidentifiedSubtree {
  const { nodes, nodeIds, domIds } = reidForestWithMap([node]);
  return { node: nodes[0] ?? node, nodeIds, domIds };
}

/** One node, re-identified, with its DOM id remapped rather than removed. */
function reidOneKeepingReferences(
  node: BlockNode,
  nodeIds: Map<string, string>,
  domIds: Map<string, string>,
  domIdPolicy: DomIdPolicy,
  hidden: ReadonlySet<BlockNode>
): BlockNode {
  const { slots, ...own } = node;
  const copy: BlockNode = { ...structuredClone(own), id: newId() };
  if (typeof node.id === "string") nodeIds.set(node.id, copy.id);

  // `mintDomId` is asked once per distinct ORIGINAL id, so a subtree whose two
  // nodes carry the same DOM id maps both to one replacement. That preserves
  // the document's own meaning: the pair pointed at one target before, and a
  // reference to it still reaches one target after.
  const remap = (value: string): string => {
    const existing = domIds.get(value);
    if (existing !== undefined) return existing;
    const minted = mintDomId(value, copy.id);
    domIds.set(value, minted);
    return minted;
  };

  // An id that is NOT minted contributes no entry to `domIds`, which is the
  // honest record: nothing moved, so the relink pass that follows has nothing
  // to rewrite and every reference still names the id it named. Identity
  // entries would say the same thing less clearly and make a caller checking
  // the map against its destination report collisions it is not introducing.
  //
  // Only the id this node RENDERS is a candidate. A node can spell two and
  // emits one, and minting the shadowed spelling is worse than pointless: the
  // relink pass then rewrites every reference to it, so a link that deliberately
  // reached an element in the DESTINATION now names a minted id nothing renders
  // at all. Both spellings move together when they carry the same value, since
  // the memo maps one original to one replacement — so the node still spells a
  // single id afterwards.
  const rendered = hidden.has(node) ? undefined : renderedDomId(node);
  const moves = (value: string): boolean =>
    value === rendered &&
    (domIdPolicy === "remint" ||
      (domIdPolicy !== "keep" && domIdPolicy.avoid.has(value)));

  if (
    typeof copy.cssId === "string" &&
    copy.cssId !== "" &&
    moves(copy.cssId)
  ) {
    copy.cssId = remap(copy.cssId);
  }
  if (copy.attributes) {
    copy.attributes = Object.fromEntries(
      Object.entries(copy.attributes).map(([key, value]) =>
        key.toLowerCase() === "id" &&
        typeof value === "string" &&
        value !== "" &&
        moves(value)
          ? [key, remap(value)]
          : [key, value]
      )
    );
  }

  if (slots !== undefined) copy.slots = slots;
  return copy;
}

/**
 * Attributes whose VALUE is an id, or a whitespace-separated list of ids.
 *
 * Remapping a `cssId` without these breaks every relationship built on it:
 * `aria-labelledby` and `aria-describedby` are how a control is NAMED and
 * DESCRIBED to a screen reader, and a reference to an id that no longer exists
 * is silently ignored — the element simply loses its name. That failure is
 * invisible to everyone who does not use assistive technology, which is why it
 * is listed as data here rather than left to each copier to remember.
 *
 * Single-id and list-valued attributes are not separated, because the rewrite
 * does not need them to be: a single id is a one-token list, and splitting on
 * whitespace handles both without a second table to keep in step.
 *
 * Lowercase, and compared after folding, because HTML attribute names are
 * case-insensitive and a stored `aria-labelledBy` addresses the same thing.
 */
export const ID_REFERENCE_ATTRIBUTES: readonly string[] = [
  // HTML
  "for",
  "form",
  "list",
  "headers",
  "itemref",
  "popovertarget",
  "anchor",
  // ARIA
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
];

const ID_REFERENCE_SET = new Set(ID_REFERENCE_ATTRIBUTES);

/**
 * An IDREFS value as its tokens, with the separators gone.
 *
 * The single statement of what such a value MEANS: a list of ids, where runs of
 * whitespace are one separator and a leading or trailing one is nothing. Every
 * parser reads `"hero   label"` and `"hero label"` as the same two references,
 * and {@link remapIdReferences} writes both back as the second.
 *
 * Published because a second reader now depends on that being true rather than
 * merely doing the same thing: a fingerprint of what a copy carries has to
 * normalise exactly where the copier normalises, and a parallel `split`
 * elsewhere would agree until one of them changed.
 */
export function idReferenceTokens(value: string): string[] {
  return value.split(/\s+/).filter(token => token !== "");
}

/**
 * Point a node's id REFERENCES at wherever those ids ended up.
 *
 * Applied as a second pass, after every id has been minted, and that ordering
 * is the whole reason it is a separate function: a node may reference an id
 * defined on a node the walk has not reached yet, so rewriting during the copy
 * would leave every forward reference pointing at the original.
 *
 * A token with no entry in the map is left ALONE rather than dropped. It
 * addresses something outside the copied subtree — an element the host page
 * owns, or one the application renders — and rewriting or removing it would
 * break a relationship that was working.
 *
 * Returns the SAME record when nothing referenced anything, so the ordinary
 * node allocates nothing.
 */
export function remapIdReferences(
  attributes: Record<string, string>,
  domIds: ReadonlyMap<string, string>
): Record<string, string> {
  if (domIds.size === 0) return attributes;
  let changed = false;
  const next: Record<string, string> = {};
  for (const name of Object.keys(attributes)) {
    const value = ownEntry(attributes, name);
    if (
      typeof value !== "string" ||
      !ID_REFERENCE_SET.has(name.toLowerCase())
    ) {
      defineEntry(next, name, value as string);
      continue;
    }
    // Token by token, through the one spelling of what an IDREFS list IS.
    const mapped = idReferenceTokens(value).map(
      token => domIds.get(token) ?? token
    );
    const rewritten = mapped.join(" ");
    if (rewritten !== value) changed = true;
    defineEntry(next, name, rewritten);
  }
  return changed ? next : attributes;
}

/**
 * Every node inside a subtree the renderer will prune, by identity.
 *
 * Gating is INHERITED: `pruneHiddenNodes` drops a gated node with everything
 * under it, so an ungated child of a gated parent does not reach the page
 * either. Asking `isConditionGated` of each node alone answers about that child
 * and gets it wrong.
 *
 * Shared, because two different questions need the same answer and got it
 * separately once already — which DOM ids a document has in use, and which of a
 * copy's ids may be rewritten. When those disagree, a copy renames an id nobody
 * renders and every reference to it follows the rename to nothing.
 *
 * Keyed on identity rather than on `id`, because a malformed document can spell
 * one id on two nodes and this is asked of the objects being walked.
 */
export function hiddenSubtreeNodes(
  nodes: readonly BlockNode[]
): ReadonlySet<BlockNode> {
  const hidden = new Set<BlockNode>();
  const seen = new Map<BlockNode, boolean>();
  walkNodes([...nodes], (node, parent) => {
    const inherited = parent !== undefined && seen.get(parent) === true;
    const gated = inherited || isConditionGated(node);
    seen.set(node, gated);
    if (gated) hidden.add(node);
  });
  return hidden;
}

/**
 * A replacement DOM id, derived from the original.
 *
 * The suffix comes from the node's NEW id, so the same original inside two
 * copies of one pattern produces two different replacements — which is the
 * collision the remap exists to avoid. Trimmed to keep the result readable in a
 * URL fragment; the full node id is not needed for uniqueness within a subtree
 * that has exactly one node per new id.
 *
 * Exported because a second copier now exists. Composition inlines one
 * definition into every instance of it, which duplicates the definition's
 * `cssId` and `attributes.id` exactly as pattern insert duplicates a subtree's
 * — and a document may legitimately hold both, so the two must agree on what a
 * replacement looks like or one page carries two spellings of the same rule.
 * The COPY policy is shared; the id policy is not, because these ids are
 * derived and `reidSubtree`'s are random.
 */
export function mintDomId(original: string, newNodeId: string): string {
  return `${original}-${newNodeId.replace(/-/g, "").slice(0, 8)}`;
}

/** One node's own fields, freshly identified. Slots are the rebuild's job. */
function reidOne(node: BlockNode): BlockNode {
  // Clone only this node's own fields; descendants are cloned as the rebuild
  // reaches them, so cloning `slots` here too would deep-copy them twice.
  const { slots, ...own } = node;
  const copy: BlockNode = { ...structuredClone(own), id: newId() };
  // A re-id'd node is a distinct element: it must not carry the original's DOM
  // id, or the two would emit duplicate HTML `id` attributes. The id can arrive
  // two ways — the dedicated `cssId` field and the custom-attributes escape
  // hatch (`attributes.id`, matched case-insensitively) — so drop both.
  delete copy.cssId;
  if (copy.attributes) {
    const attributes = Object.fromEntries(
      Object.entries(copy.attributes).filter(
        ([key]) => key.toLowerCase() !== "id"
      )
    );
    if (Object.keys(attributes).length > 0) copy.attributes = attributes;
    else delete copy.attributes;
  }
  // Handed back so the rebuild knows this node HAS slots to descend into; it
  // replaces them with the rebuilt lists.
  if (slots !== undefined) copy.slots = slots;
  return copy;
}

/** Insert a re-id'd copy of a node immediately after the original. */
export function duplicateNode(nodes: BlockNode[], id: string): BlockNode[] {
  const found = findNode(nodes, id);
  if (!found) return nodes;
  // No check that the forest can be serialized. This once refused outright when
  // any part of the forest was cyclic, which made it the only primitive that
  // declined work because of a defect elsewhere in the document — see the
  // storability note on this module.
  //
  // The clone is safe on its own terms regardless: `reidSubtree` rebuilds it
  // without the edge that closes a cycle, so what gets inserted is acyclic even
  // when its source was not.
  const location = locateNode(nodes, id);
  if (!location) return nodes;
  return insertNode(nodes, reidSubtree(found), {
    parentId: location.parent?.id,
    slot: location.slot,
    index: location.index + 1,
  });
}

/**
 * Patch a node's own fields. `id`, `type`, and `slots` are not patchable here:
 * ids are immutable, type changes are conversions with their own semantics,
 * and children change through insert/remove/move.
 */
export function updateNode(
  nodes: BlockNode[],
  id: string,
  patch: Partial<Omit<BlockNode, "id" | "type" | "slots">>
): BlockNode[] {
  if (!findNode(nodes, id)) return nodes;
  return mapForest(nodes, node =>
    node.id === id ? { ...node, ...patch } : node
  );
}
