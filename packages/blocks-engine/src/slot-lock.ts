/**
 * What a slot's lock fixes, decided in one place.
 *
 * A block locks one of its slots through `SlotSpec.lock` to fix the children
 * that slot holds. This module is that rule. Validation asks it of every slot
 * in a document it is given definitions for, and anything else deciding
 * whether a slot's children may change has to ask the same functions: two
 * readings of which slots are locked agree only until one of them learns the
 * inheritance below.
 *
 * ## What a lock is measured against
 *
 * The children the slot STARTS with, which are the ones inserting its block
 * creates from the slot's `defaultBlock`. So a lock is a property of a
 * document rather than of an edit: a stored slot holds those children or it
 * does not, and a validator can answer that for any writer from the document
 * alone. A rule about edits would need the version the document replaced, and
 * a write arriving through the API, an import or an agent reaches validation
 * with no previous version at all.
 *
 * Under `"contentOnly"`, a caller that has the document's stored version may
 * hand it in too, and a part the stored version already holds at the same
 * position is then kept rather than refused (`stored-counterparts`). A block's
 * defaults can change after pages store it, and a stored child that nobody
 * changed would otherwise be refused for differing from today's defaults.
 *
 * ## Inheritance
 *
 * A slot that declares no lock takes the lock of the slot its block sits in,
 * so a locked region stays locked all the way down. `false` is a slot
 * declaring itself unlocked, which stops the inheritance, except beneath
 * `"contentOnly"`: a region whose arrangement is fixed would otherwise be
 * reopened by any block placed inside it that declares `false`.
 *
 * @module slot-lock
 */
import type { SlotLock } from "./block";
import type { BlockNode } from "./document";
import { isBlockType } from "./document";
import { isPlainRecord } from "./plain-record";
import { ownEntry } from "./safe-record";
import { positionalCounterparts } from "./stored-counterparts";
import type { SlotDefaultSource } from "./tree";

/** A lock that fixes a slot's children. `false` and no declaration fix nothing. */
export type ActiveSlotLock = Exclude<SlotLock, false>;

/** Every value a slot may declare as its lock. */
const SLOT_LOCKS: ReadonlySet<unknown> = new Set<unknown>([
  "all",
  "insert",
  "contentOnly",
  false,
]);

/**
 * Whether a value is one a slot may declare as its lock.
 *
 * The one predicate registration refuses a declaration with. A definition
 * arriving from JavaScript or JSON never had its type checked, and a value
 * outside this set would otherwise reach {@link effectiveSlotLock}, which reads
 * it as no declaration.
 */
export function isSlotLock(value: unknown): value is SlotLock {
  return SLOT_LOCKS.has(value);
}

/**
 * The lock a slot carries: its own declaration, and the lock of the slot its
 * block sits in.
 *
 * `declared` is read as the definition states it rather than trusted. A value
 * that is not a lock reads as no declaration, the way a malformed `allow` reads
 * as no restriction, because registration is where a malformed value is
 * refused and a definition supplied without registering never met that check.
 *
 * @param declared - the slot's own `lock`, as declared
 * @param inherited - the lock of the slot this slot's block sits in
 * @returns the lock that applies, or undefined when the slot's children are
 *   not fixed
 */
export function effectiveSlotLock(
  declared: unknown,
  inherited: ActiveSlotLock | undefined
): ActiveSlotLock | undefined {
  // First, so nothing a slot inside declares can loosen it.
  if (inherited === "contentOnly") return "contentOnly";
  if (declared === false) return undefined;
  if (
    declared === "all" ||
    declared === "insert" ||
    declared === "contentOnly"
  ) {
    return declared;
  }
  return inherited;
}

/**
 * Whether a locked slot holds exactly the children it starts with.
 *
 * `"all"` and `"contentOnly"` fix the children and their order, so the two
 * lists must agree position by position. `"insert"` fixes which children the
 * slot holds and lets an author reorder them, so the two must hold the same
 * types the same number of times: a slot starting with two cards and a button
 * cannot trade a card for a second button.
 *
 * Compared by TYPE, because that is all a starting child declares. An entry in
 * `defaultBlock` names a block type and never an id, and the props it starts
 * with are the author's to change.
 *
 * @param lock - the lock the slot carries
 * @param held - the type of each child the slot holds, in order; undefined for
 *   a child whose type cannot be read, which no starting child matches
 * @param starting - the types the slot starts with, in order
 */
export function holdsStartingChildren(
  lock: ActiveSlotLock,
  held: readonly (string | undefined)[],
  starting: readonly string[]
): boolean {
  if (held.length !== starting.length) return false;
  if (lock !== "insert") {
    return held.every((type, index) => type === starting[index]);
  }
  const unmatched = new Map<string, number>();
  for (const type of starting) {
    unmatched.set(type, (unmatched.get(type) ?? 0) + 1);
  }
  // The lengths already agree, so when every held child consumes one starting
  // child of its own type, no starting child is left over.
  return held.every(type => {
    if (type === undefined) return false;
    const left = unmatched.get(type) ?? 0;
    if (left === 0) return false;
    unmatched.set(type, left - 1);
    return true;
  });
}

/**
 * The parts of a node besides its props that `"contentOnly"` fixes: its design
 * (`styles`, `classes`, `customCss`), what its root element carries (`cssId`,
 * `attributes`), when it is shown (`visibility`), and its own lock (`locked`).
 * Its layer `name` is not among them, because the page never draws it: it is
 * the editor's label for the block.
 */
const PINNED_PARTS = [
  "styles",
  "classes",
  "cssId",
  "attributes",
  "visibility",
  "customCss",
  "locked",
] as const;

/**
 * The props a block declares as content, which `"contentOnly"` leaves
 * editable: the ones whose schema says `role: "content"`, as a WordPress block
 * attribute does. A block that declares none has nothing editable there.
 *
 * Read without trusting the declaration's shape, for the reason
 * {@link effectiveSlotLock} reads `declared` that way.
 */
export function contentPropsOf(props: unknown): ReadonlySet<string> {
  const content = new Set<string>();
  if (!isPlainRecord(props)) return content;
  for (const [name, schema] of Object.entries(props)) {
    if (isPlainRecord(schema) && schema.role === "content") content.add(name);
  }
  return content;
}

/**
 * What a child of a `"contentOnly"` slot changed besides its content, measured
 * against the child it started as.
 *
 * Measured against the STARTING child, which is the child inserting the block
 * creates, and not against an earlier version of the document: a write through
 * the API, an import or an agent arrives with no earlier version, and a rule
 * about edits would let such a write store any design it liked. A caller with
 * the stored version measures against its counterpart as well, and counts as
 * changed only what differs from both.
 *
 * A version ahead of the baseline's and `migrationFailed` count too: either
 * makes the renderer draw a placeholder in the block's place. An older version
 * does not, since reading migrates it.
 *
 * @param held - the stored child
 * @param starting - the child it is measured against
 * @param content - the props its block declares as content
 * @returns each change, worded for an issue message; empty when only content
 *   changed
 */
export function nonContentChanges(
  held: Record<string, unknown>,
  starting: Record<string, unknown>,
  content: ReadonlySet<string>
): string[] {
  const changes = changedNotContent(held.props, starting.props, content).map(
    name => `prop "${name}"`
  );
  // A binding replaces a prop's value with data, so binding a prop that is not
  // content changes the design as surely as setting it does.
  for (const name of changedNotContent(
    held.bindings,
    starting.bindings,
    content
  )) {
    changes.push(`the binding on "${name}"`);
  }
  for (const part of PINNED_PARTS) {
    if (!sameValue(emptyAsAbsent(held[part]), emptyAsAbsent(starting[part]))) {
      changes.push(part);
    }
  }
  return [...changes, ...renderStateChanges(held, starting)];
}

/** The keys of two records, other than content, whose values differ. */
function changedNotContent(
  held: unknown,
  starting: unknown,
  content: ReadonlySet<string>
): string[] {
  const a = recordOrEmpty(held);
  const b = recordOrEmpty(starting);
  return [...unionOfKeys(a, b)].filter(
    name => !content.has(name) && !sameValue(a[name], b[name])
  );
}

/** What changed about whether the block renders, rather than how. */
function renderStateChanges(
  held: Record<string, unknown>,
  starting: Record<string, unknown>
): string[] {
  const changes: string[] = [];
  if (isAheadOf(held.version, starting.version)) changes.push("version");
  if ((held.migrationFailed === true) !== (starting.migrationFailed === true)) {
    changes.push("migrationFailed");
  }
  return changes;
}

/**
 * Whether a node's version is one its baseline's is not, other than an older
 * one, which reading migrates forward.
 */
function isAheadOf(version: unknown, baseline: unknown): boolean {
  if (version === baseline) return false;
  return !(
    typeof version === "number" &&
    typeof baseline === "number" &&
    version < baseline
  );
}

/**
 * A child of a `"contentOnly"` slot with everything but its content put back
 * as it started: the parts {@link nonContentChanges} compares, so the result
 * has none of them left. Its id, name and content props are its own.
 *
 * @param held - the child as it is
 * @param starting - the child it started as
 * @param content - the props its block declares as content
 */
export function withStartingDesign(
  held: Record<string, unknown>,
  starting: Record<string, unknown>,
  content: ReadonlySet<string>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...held };
  next.props = keepContent(held.props, starting.props, content);
  const bindings = keepContent(held.bindings, starting.bindings, content);
  if (Object.keys(bindings).length > 0) next.bindings = bindings;
  else delete next.bindings;
  for (const part of [...PINNED_PARTS, "migrationFailed"]) {
    if (starting[part] === undefined) delete next[part];
    else next[part] = starting[part];
  }
  if (isAheadOf(held.version, starting.version)) {
    next.version = starting.version;
  }
  return next;
}

/** A record's content entries as held, and every other entry as it started. */
function keepContent(
  held: unknown,
  starting: unknown,
  content: ReadonlySet<string>
): Record<string, unknown> {
  const own = recordOrEmpty(held);
  const next: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(recordOrEmpty(starting))) {
    if (!content.has(name)) next[name] = value;
  }
  for (const [name, value] of Object.entries(own)) {
    if (content.has(name)) next[name] = value;
  }
  return next;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function unionOfKeys(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Set<string> {
  return new Set([...Object.keys(a), ...Object.keys(b)]);
}

/**
 * An empty list or record read as no value. An editor that clears a block's
 * classes may store `[]` where an insert stored nothing, and the two draw the
 * same block.
 */
function emptyAsAbsent(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 0) return undefined;
  if (isPlainRecord(value) && Object.keys(value).length === 0) return undefined;
  return value;
}

/** Whether two stored values are the same value, compared structurally. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return sameList(a, b);
  if (!isPlainRecord(a) || !isPlainRecord(b)) return false;
  return [...unionOfKeys(a, b)].every(key => sameValue(a[key], b[key]));
}

/** Whether two values are lists holding the same values in the same order. */
function sameList(a: unknown, b: unknown): boolean {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((entry, index) => sameValue(entry, b[index]))
  );
}

/**
 * What a child changed besides content from its starting child AND from every
 * stored counterpart: a part equal to any one of them is kept, not changed.
 */
function changesFromEvery(
  child: Record<string, unknown>,
  starting: Record<string, unknown>,
  kept: readonly Readonly<Record<string, unknown>>[],
  content: ReadonlySet<string>
): string[] {
  let changes = nonContentChanges(child, starting, content);
  for (const baseline of kept) {
    if (changes.length === 0) break;
    const also = new Set(nonContentChanges(child, baseline, content));
    changes = changes.filter(change => also.has(change));
  }
  return changes;
}

/**
 * The lock a container's slot passes to the children beneath it.
 *
 * Only a slot the container's type DECLARES has a lock to pass. Children stored
 * under a slot the block never declares are not drawn, so there is no
 * arrangement of theirs for a lock to protect.
 */
export function slotLockOf(
  definitions: SlotDefaultSource | undefined,
  containerType: string | undefined,
  slot: string,
  inherited: ActiveSlotLock | undefined
): ActiveSlotLock | undefined {
  if (definitions === undefined || containerType === undefined) {
    return undefined;
  }
  const declared = declaredSlotsOf(definitions, containerType);
  const spec = declared === undefined ? undefined : ownEntry(declared, slot);
  if (spec === undefined) return undefined;
  return effectiveSlotLock(lockDeclaredBy(spec), inherited);
}

/** A type's declared slots, when the source holds a usable declaration. */
function declaredSlotsOf(
  definitions: SlotDefaultSource,
  type: string
): Record<string, unknown> | undefined {
  const slots: unknown = definitions.get(type)?.slots;
  return isPlainRecord(slots) ? slots : undefined;
}

/** The lock one slot declaration states, read without trusting its shape. */
function lockDeclaredBy(spec: unknown): unknown {
  return isPlainRecord(spec) ? spec.lock : undefined;
}

/** A stored child's type, or undefined when it has none to read. */
export function typeOfChild(child: unknown): string | undefined {
  return isPlainRecord(child) && typeof child.type === "string"
    ? child.type
    : undefined;
}

/** One way a node's locked slot breaks its lock. */
export type LockBreak =
  | {
      /** The slot does not hold the blocks it starts with. */
      readonly kind: "membership";
      readonly slot: string;
      readonly lock: ActiveSlotLock;
      /** Whether the node stores the slot at all. */
      readonly stored: boolean;
      readonly starting: readonly string[];
      readonly held: readonly unknown[];
    }
  | {
      /** A child of a `"contentOnly"` slot changed something besides content. */
      readonly kind: "content";
      readonly slot: string;
      readonly index: number;
      readonly childType: string;
      readonly changes: readonly string[];
      readonly content: ReadonlySet<string>;
    };

/**
 * Every way a node's locked slots break their locks: the one judgement of
 * locks, which validation and the composition both ask.
 *
 * Asked of every slot the node's type DECLARES rather than only the ones it
 * stores. Removing a slot's last child can leave no slot stored at all, and
 * that is exactly the arrangement a lock refuses when the slot starts with
 * something.
 *
 * @param node - the node whose slots are judged
 * @param inherited - the lock of the slot the node sits in
 * @param definitions - the block definitions, for each slot's declaration
 * @param startingChildren - the children an insert of `type` starts `slot`
 *   with, which the caller may cache
 * @param counterparts - the node as the document's stored forms hold it in
 *   this place, whose locked slots' children a `"contentOnly"` lock lets it
 *   keep; empty where there is no stored version to keep
 */
export function slotLockBreaks(
  node: unknown,
  inherited: ActiveSlotLock | undefined,
  definitions: SlotDefaultSource,
  startingChildren: (type: string, slot: string) => readonly BlockNode[],
  counterparts: readonly Readonly<Record<string, unknown>>[] = []
): LockBreak[] {
  if (!isPlainRecord(node) || !isBlockType(node.type)) return [];
  const type = node.type;
  const declared = declaredSlotsOf(definitions, type);
  if (declared === undefined) return [];
  const stored = isPlainRecord(node.slots) ? node.slots : undefined;
  const breaks: LockBreak[] = [];
  for (const [slot, spec] of Object.entries(declared)) {
    const lock = effectiveSlotLock(lockDeclaredBy(spec), inherited);
    if (lock === undefined) continue;
    const children = stored === undefined ? undefined : ownEntry(stored, slot);
    // A slot value that is not an array is `invalid-slots`, which the node
    // check reports, and there are no children in it to compare.
    if (children !== undefined && !Array.isArray(children)) continue;
    breaks.push(
      ...oneSlotBreaks(
        {
          slot,
          lock,
          children,
          startingNodes: startingChildren(type, slot),
          counterparts,
        },
        definitions
      )
    );
  }
  return breaks;
}

/** How one locked slot breaks its lock, if it does. */
function oneSlotBreaks(
  at: {
    slot: string;
    lock: ActiveSlotLock;
    children: readonly unknown[] | undefined;
    startingNodes: readonly BlockNode[];
    counterparts: readonly Readonly<Record<string, unknown>>[];
  },
  definitions: SlotDefaultSource
): LockBreak[] {
  const held: readonly unknown[] = at.children ?? [];
  const starting = at.startingNodes.map(child => child.type);
  // The lengths first, so a slot holding far more children than it starts
  // with is refused without reading every one of them.
  const holds =
    held.length === starting.length &&
    holdsStartingChildren(at.lock, held.map(typeOfChild), starting);
  if (!holds) {
    return [
      {
        kind: "membership",
        slot: at.slot,
        lock: at.lock,
        stored: at.children !== undefined,
        starting,
        held,
      },
    ];
  }
  return at.lock === "contentOnly" ? contentBreaks(at, held, definitions) : [];
}

/**
 * Each child of a `"contentOnly"` slot that changed anything besides its
 * content, compared with the starting child in its own position, and with
 * what the stored forms keep in that position where the caller has them.
 *
 * Reached only once the slot holds its starting children in their order. The
 * children's own slots are judged when their node is: they inherit
 * `"contentOnly"`, which nothing beneath it can loosen.
 */
function contentBreaks(
  at: {
    slot: string;
    startingNodes: readonly BlockNode[];
    counterparts: readonly Readonly<Record<string, unknown>>[];
  },
  held: readonly unknown[],
  definitions: SlotDefaultSource
): LockBreak[] {
  const { slot, startingNodes } = at;
  const breaks: LockBreak[] = [];
  held.forEach((child, index) => {
    const starting = startingNodes[index];
    if (!isPlainRecord(child) || starting === undefined) return;
    const content = contentPropsOf(definitions.get(starting.type)?.props);
    const kept = positionalCounterparts(
      at.counterparts,
      slot,
      index,
      starting.type
    );
    const changes = changesFromEvery(
      child,
      starting as unknown as Record<string, unknown>,
      kept,
      content
    );
    if (changes.length > 0) {
      breaks.push({
        kind: "content",
        slot,
        index,
        childType: starting.type,
        changes,
        content,
      });
    }
  });
  return breaks;
}
