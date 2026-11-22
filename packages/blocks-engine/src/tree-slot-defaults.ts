/**
 * A block's default slot content, expanded from its definition: the source a
 * definition is read from, how deep and how many nodes the defaults may
 * reach, and the nested defaults they carry.
 *
 * @module tree-slot-defaults
 */
import type { PropSchema, SlotSpec } from "./block";
import type { ContentModelDeclaration } from "./content-model";
import { type BlockNode, isBlockType } from "./document";
import { MAX_DEPTH, MAX_NODES } from "./limits";
import { canNest, canNestInSlot, type NestingSource } from "./nesting";
import { isPlainRecord } from "./plain-record";
import { isUsableSlotName } from "./registry";
import { defineEntry, ownEntry } from "./safe-record";
import { makeNode } from "./tree-edits";

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
        /**
         * The child's prop schemas, read for the props it declares as
         * content, which a `"contentOnly"` slot leaves editable.
         */
        props?: Partial<Record<string, PropSchema>>;
        /**
         * What the block is as HTML content for a set of props, read by the
         * placement rule. Typed loosely because the answer is read through
         * `resolveContentModel`, which checks it rather than trusting it.
         */
        contentModel?: ContentModelDeclaration;
        /** Whether these props draw nothing, read by the placement rule. */
        rendersNothing?: (props: never) => boolean;
        /** The label an author knows the block by, read to word a refusal. */
        editor?: { readonly label?: string };
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
 * reason stated at the top of `tree.ts`: these primitives make no claim about
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
 * limit.** The distinction is the one stated at the top of `tree.ts`: these
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
