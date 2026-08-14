import { isPlainRecord } from "./plain-record";

/**
 * Bounded serialized-size measurement.
 *
 * A document that stays under the node and depth caps can still hide a single
 * enormous string or an enormous map, so size has to be checked too — and the
 * obvious way to check it is the one that loses. `JSON.stringify` followed by a
 * length comparison materializes the whole hostile input first, which is the
 * allocation the cap exists to prevent.
 *
 * So this counts bytes and stops the moment the budget is passed, never
 * building the string. It lives in its own module, with no imports, because
 * both the canonical validator and the published format checker have to reach
 * exactly this answer: two measurements of "how large is this document" would
 * disagree about which documents are refused, and the disagreement would show
 * up only on the inputs that matter.
 *
 * @module measure-bytes
 */

/**
 * UTF-8 byte length of a string, counted code unit by code unit so a huge
 * string is never materialized into a buffer, stopping once `budget` is passed.
 */
export function utf8ByteLength(s: string, budget: number): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) {
      // Serialized size counts JSON escaping. Backspace, tab, newline, form
      // feed, and carriage return have two-byte short escapes; other control
      // characters expand to a six-byte \uXXXX; quote and backslash are two.
      if (
        code === 0x08 ||
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0c ||
        code === 0x0d
      ) {
        bytes += 2;
      } else if (code < 0x20) bytes += 6;
      else if (code === 0x22 || code === 0x5c) bytes += 2;
      else bytes += 1;
    } else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A high surrogate is a 4-byte code point only when a low surrogate
      // follows. A lone one is not valid UTF-8 and serializes as a six-byte
      // \uXXXX escape, and must not consume the next unit.
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6; // lone low surrogate → \uXXXX
    } else bytes += 3;
    if (bytes > budget) return bytes;
  }
  return bytes;
}

/** Whether a non-object value survives a round trip through JSON unchanged. */
function isSerializableScalar(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && !(value === 0 && 1 / value < 0);
  }
  return (
    typeof value === "string" || typeof value === "boolean" || value === null
  );
}

/**
 * Whether `JSON.stringify` WRITES this value or omits it entirely.
 *
 * Distinct from {@link isSerializableScalar}, which asks whether the value
 * survives unchanged. These three are not written at all: a record property
 * holding one loses its key as well as its value, and an array position holding
 * one becomes `null`. Counting them as four bytes in a record over-counted a
 * key that storage never receives.
 */
function serializesAs(value: unknown): boolean {
  return (
    value !== undefined &&
    typeof value !== "function" &&
    typeof value !== "symbol"
  );
}

/**
 * A value as `JSON.stringify` will SEE it: through `toJSON` when one exists.
 *
 * The hook runs before the writer decides anything else, including whether the
 * value can be written at all — so a `Date` is a 26-byte quoted timestamp
 * rather than the empty object its own enumerable fields describe, and a hook
 * returning `undefined` drops the member entirely. A counter that walks the
 * original object disagrees with the writer on both the size and the drop.
 */
function asSerialized(value: unknown, key: string): unknown {
  // Retrieved ONCE, then tested and invoked, because `JSON.stringify` reads the
  // property a single time and calls whatever that read produced. Reading it
  // twice — once to type-test, once to call — lets an accessor hand back a
  // different function each time: a hook returning a 2 KB serializer on the
  // first read and an empty one on the second measured 101 bytes for a value
  // the writer emits at 2,101, and the cap passed it.
  // Objects and BigInt ONLY, which is exactly what the writer probes. Looking
  // the hook up on a primitive BOXES it, so an environment defining
  // `Number.prototype.toJSON` — or `String`'s, or `Boolean`'s — made every
  // number in the document run an inherited hook that `JSON.stringify` never
  // calls. The document was then reported unserializable and refused, while the
  // writer emitted it unchanged.
  const probed = typeof value === "object" || typeof value === "bigint";
  if (!probed || value === null) return value;
  const hook = (value as { toJSON?: unknown }).toJSON;
  return typeof hook === "function"
    ? (hook as (this: unknown, key: string) => unknown).call(value, key)
    : value;
}

export type ByteMeasurement =
  | { bytes: number; exceeded: false }
  | { bytes: number; exceeded: true; reason: "over-limit" | "unwritable" };

/**
 * A value `JSON.stringify` REFUSES, rather than writes or drops.
 *
 * The third thing the writer can do with a value, and the one this counter had
 * no way to express: `undefined`, functions and symbols are DROPPED
 * ({@link serializesAs}); everything else is written; and a BigInt makes
 * `JSON.stringify` throw. Counting it as an ordinary value reports
 * `measureBytes({ x: 1n }, 100)` as fitting in 6 bytes while the writer refuses
 * the whole document.
 *
 * The boxed form is included because `Object(1n)` is a BigInt OBJECT, so
 * `typeof` reports `"object"` and the walk would treat it as an ordinary record
 * with no own keys — two bytes for a value that cannot be written at all.
 *
 * How that boxed form is detected is stated at the check itself, because the
 * cheap-looking alternatives are all wrong in ways that are not visible from
 * here.
 */
function refusedByWriter(value: unknown): boolean {
  if (typeof value === "bigint") return true;
  if (typeof value !== "object" || value === null) return false;
  // The internal slot, and NOTHING else. Every cheaper test asks the value a
  // question, and a value in a block document is untrusted input:
  //
  // - `Symbol.toStringTag` is an ordinary writable property, so the tag both
  //   over-reports — `{ [Symbol.toStringTag]: "BigInt", x: 1 }` is written as
  //   `{"x":1}` — and runs a document-supplied getter that `JSON.stringify`
  //   never runs, since it ignores symbol keys entirely.
  // - Reading that tag's DESCRIPTOR instead avoids the getter and still
  //   executes a Proxy's `getOwnPropertyDescriptor` trap. Measured: an empty
  //   proxy whose trap throws only for `Symbol.toStringTag` is written as `{}`
  //   by the writer while the probe raises out of a function contracted to
  //   report rather than throw.
  // - The prototype chain cannot decide it either. Measured:
  //   `setPrototypeOf(Object(1n), Object.prototype)` is still refused by the
  //   writer, so a prototype filter reports a storable document that the
  //   writer then rejects — the counter and the writer disagreeing, which is
  //   the one thing this function exists to prevent.
  //
  // `BigInt.prototype.valueOf` reads an internal slot: measured against a Proxy
  // logging every trap, it triggers none, and it cannot be spoofed by any
  // property the document sets. It costs a thrown exception per non-BigInt
  // object, which is the price of asking a question the value cannot answer
  // dishonestly; the count is bounded by the byte cap that admits those objects
  // in the first place.
  try {
    BigInt.prototype.valueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

/** Serialized size of a non-object value, bounded like everything else here. */
function scalarBytes(value: unknown, budget: number): number {
  if (typeof value === "string") return 2 + utf8ByteLength(value, budget);
  if (typeof value === "number") {
    // `NaN` and the infinities are WRITTEN, as `null`. `String` renders them as
    // three and eight characters, so reading the length would disagree with the
    // writer for exactly the numbers the format refuses.
    return Number.isFinite(value) ? String(value).length : 4;
  }
  if (typeof value === "boolean") return String(value).length;
  // `null`, and the values JSON cannot hold at all; four bytes is what `null`
  // costs, and the rest are refused by the flag rather than counted.
  return 4;
}

/**
 * Estimate a document's serialized byte size, aborting as soon as `limit` is
 * passed and WITHOUT materializing the full JSON string — so a document that
 * stays under the node/depth caps but hides a huge string cannot force a giant
 * allocation before being rejected. Iterative, so deep nesting cannot overflow.
 * When the walk completes under the limit, `bytes` counts every byte JSON would
 * emit — braces, brackets, quotes, colons and separating commas — so a document
 * measured under the cap really is under it. When `exceeded` is true it stopped
 * early and `bytes` is a lower bound.
 */
/**
 * The outcome of reaching for one member of a container.
 *
 * `absent` covers both refusals: a member that could not be read, and one whose
 * descriptor says reading it would run caller-supplied code. Neither yields a
 * value, and both mean the document cannot be stored as it stands.
 */
type Member =
  | { present: true; value: unknown; enumerable: boolean }
  | { present: false };

/**
 * Read one member of an object or array, without running anything.
 *
 * Object properties and array elements are the same question — reach for a key,
 * safely, and find out whether what comes back is data — and answering it in two
 * places is how a guard comes to exist on one path and not the other. Both
 * loops call this.
 *
 * The descriptor is what makes it safe: it reports an accessor WITHOUT
 * invoking it, so a getter is refused rather than executed. Invoking one to
 * discover it exists is the risk itself, and its return value is not what
 * storage would hold. Reflection can also throw — a proxy trap runs
 * caller-supplied code — so the lookup is guarded too.
 */
function readMember(container: object, key: string | number): Member {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(container, String(key));
  } catch {
    return { present: false };
  }
  if (descriptor === undefined) return { present: false };
  if (descriptor.get !== undefined || descriptor.set !== undefined) {
    return { present: false };
  }
  return {
    present: true,
    value: descriptor.value as unknown,
    enumerable: descriptor.enumerable === true,
  };
}

/**
 * Whether a value is a plain record, tolerating a hostile prototype lookup.
 *
 * `Object.getPrototypeOf` runs a proxy's `getPrototypeOf` trap, which is
 * caller-supplied code and can throw. A walk that is a precondition for parsing
 * untrusted input must not let that escape.
 */
function isPlainRecordSafely(value: object): {
  plain: boolean;
  threw: boolean;
} {
  try {
    return { plain: isPlainRecord(value), threw: false };
  } catch {
    return { plain: false, threw: true };
  }
}

/**
 * What a member of this container becomes, and at what nesting level.
 *
 * The two places a document's own tree continues are `nodes` on the envelope
 * and `slots` on a node; everything else is data whatever it holds. Deciding
 * this from the CONTAINER's kind rather than from the member's is what keeps an
 * array of nodes distinguishable from a node, so the caps describe the document
 * rather than the shape of its encoding.
 *
 * A slot named `__proto__` is refused: it survives JSON as an ordinary own key
 * while every consumer that rebuilds a record by assignment drops it, so its
 * children would go unchecked while the document read as valid.
 */
function memberPlacement(
  container: FrameKind,
  depth: number,
  key: string,
  isRoot: boolean
): { kind: FrameKind; depth: number } | "refused" {
  // An array of nodes holds nodes, at the level the array itself carries.
  if (container === "nodeList") return { kind: "node", depth };
  // A node's `slots` is the map whose values are the next level's node lists.
  if (container === "node") {
    return key === "slots"
      ? { kind: "slotMap", depth }
      : { kind: "value", depth };
  }
  // Each slot in that map holds a node list one level deeper.
  if (container === "slotMap") {
    if (key === "__proto__") return "refused";
    return { kind: "nodeList", depth: depth + 1 };
  }
  // The ENVELOPE's `nodes` starts the tree. Identity, not depth: an additive
  // top-level field is also at depth zero, so testing depth alone classified
  // `{ future: { nodes: [...] } }` as the document's own tree and let ordinary
  // content inflate the node and depth caps.
  if (isRoot && key === "nodes") return { kind: "nodeList", depth: 1 };
  return { kind: "value", depth };
}

/**
 * Everything one pass over an untrusted document can establish.
 *
 * Depth, node count, serialized size, JSON-representability and read safety are
 * five questions about the same tree, and one traversal answers all of them.
 * Splitting them across separate walks means each grows its own defensive
 * logic, and a property added to one is silently absent from the other:
 * reading a value safely, terminating on a cycle and refusing what JSON
 * rewrites are not questions about SIZE, they are questions about traversing
 * hostile input, and they belong to whatever does the traversing.
 *
 * The stack is explicit so deep nesting cannot overflow, every bound stops the
 * walk at its first breach, and no branch reads a value it has not guarded.
 */
export interface DocumentSurvey {
  /**
   * The bounds this survey ENFORCED, snapshotted before the walk began.
   *
   * Published because a caller that goes on to walk the same document must
   * bound its own work by the same numbers. Reading them again from the limits
   * object asks a question that has already been answered, and can be answered
   * differently the second time: an accessor returning a small bound for the
   * check and a large one afterwards leaves the caller's walk unbounded while
   * this survey's verdict says the document was refused.
   *
   * `Readonly<SurveyLimits>` rather than a second interface of the same three
   * members: the shape a caller passes IN and the shape it reads back OUT are
   * the same three bounds, and two names for them would drift and would ask a
   * reader to work out which is which. `readonly` because the object is frozen,
   * so a type permitting assignment would describe a runtime `TypeError` as
   * legal.
   *
   * Primitive numbers, because `bounded` rejects anything else — so a consumer
   * of this field cannot be handed an accessor at one remove.
   */
  limits: Readonly<SurveyLimits>;
  /** Serialized size in bytes; a lower bound once `tooLarge` is set. */
  bytes: number;
  /** The byte cap was passed. */
  tooLarge: boolean;
  /** Nodes nest deeper through slots than the cap allows. */
  tooDeep: boolean;
  /** More nodes than the cap allows. */
  tooManyNodes: boolean;
  /**
   * Nodes counted, and the deepest node reached.
   *
   * Published because the walk already knows them and a caller that needs the
   * NUMBERS rather than the verdicts would otherwise re-derive them — which is
   * the duplicate structural walk this survey exists to remove, reappearing on
   * the other side of the boundary. `countNodes` and `treeDepth` answer the
   * same question by a second traversal with its own idea of what a node is.
   *
   * Both are LOWER BOUNDS once any limit was breached, because the walk stops
   * at the first breach rather than finishing to produce a total nobody asked
   * for.
   */
  nodes: number;
  depth: number;
  /**
   * The value holds something JSON does not preserve: a BigInt, a function, a
   * symbol, a symbol-keyed property, `undefined`, a non-finite number, `-0`, an
   * object that is not a plain record, an accessor that threw, or a CIRCULAR
   * reference — one that is its own ancestor.
   *
   * A repeated reference that is NOT circular is legal and is not reported:
   * `JSON.stringify` duplicates the subtree, so two siblings pointing at one
   * object serialize fine and are counted once per occurrence. Saying
   * "repeated" here described the opposite of what the walk does, on a
   * contract published through `/format`.
   *
   * Also the two shapes JSON rewrites rather than refuses, which are easy to
   * miss because nothing throws: an array HOLE, which comes back as `null`, and
   * a non-index own property on an array, which is dropped entirely.
   */
  unserializable: boolean;
}

export interface SurveyLimits {
  maxBytes: number;
  maxDepth: number;
  maxNodes: number;
}

/**
 * A frame carries its own node depth so the slot tree is measured by the same
 * pass that measures bytes. Depth 0 means "not a node" — a props value, a style
 * bucket, an array element that is not a child. Only values reached through
 * `nodes` or a node's `slots` carry a depth, which is what makes the depth and
 * count bounds describe the document's structure rather than its data.
 */
type FrameKind =
  /** A marker that closes a subtree, removing its root from the active path. */
  | "leave"
  /** A container part-way through its members, resumed after each subtree. */
  | "members"
  /** Ordinary data: props, styles, an attribute map, an array of strings. */
  | "value"
  /** An array whose elements are nodes: the envelope's `nodes`, a slot's children. */
  | "nodeList"
  /** A node's `slots` map, whose values are node lists one level deeper. */
  | "slotMap"
  /** A node itself; the only frame that counts toward the node and depth caps. */
  | "node";

interface Frame {
  value: unknown;
  kind: FrameKind;
  /** Nesting level of the node this frame belongs to; 0 outside the tree. */
  depth: number;
  /**
   * Iteration state for a `members` frame.
   *
   * `names` is present for a record and absent for an array, where the index IS
   * the key and holding one string per position is an allocation proportional
   * to a length the document never has to pay for in content.
   *
   * `keyed` says whether JSON writes `"key":` before each member, and picks
   * between those two iterations. `emitted` records whether an earlier member
   * of THIS container produced output, so the separating comma is counted from
   * what was written rather than from the iteration index — a skipped member
   * would otherwise leave a comma with nothing on one side of it.
   */
  names?: string[];
  length?: number;
  index?: number;
  containerKind?: FrameKind;
  keyed?: boolean;
  emitted?: boolean;
  /** The value has already been through `toJSON`; do not run the hook twice. */
  normalized?: boolean;
  /**
   * This value sits inside something the WRITER never reaches, so no `toJSON`
   * anywhere beneath it may run: the walk is here for the caps and for what the
   * schema will read, not to reproduce a serialization that will not happen.
   * Inherited by every frame pushed from one carrying it.
   */
  structuralOnly?: boolean;
}

/**
 * The array index a property name denotes, or -1 if it denotes none.
 *
 * `JSON.stringify` emits positions `0..length-1` and nothing else, so a name is
 * an element exactly when it is the CANONICAL decimal form of such a position.
 * `"01"`, `"1e2"`, `" 1"` and `"-0"` all convert to a number and none of them
 * is an index — round-tripping through `String` is what separates them, and
 * they are properties JSON drops rather than elements it writes.
 */
function arrayIndexOf(name: string, length: number): number {
  const index = Number(name);
  if (!Number.isInteger(index) || index < 0 || index >= length) return -1;
  return String(index) === name ? index : -1;
}

export function surveyDocument(
  root: unknown,
  limits: SurveyLimits
): DocumentSurvey {
  // A NaN limit removes every bound silently, because each cap is a `>`
  // comparison and every comparison against NaN is false. Measured:
  // `measureBytes("x".repeat(1_000_000), NaN)` walked the whole string and
  // returned `exceeded: false` — the walk reporting success while having no
  // bound at all, which is the worst of the two failure directions.
  //
  // Infinity is deliberately NOT rejected: an infinite byte limit is the
  // supported way to ask for an exact count, and the walk terminates there on
  // the cycle set rather than on the cap.
  const bounded = (limit: number, name: string): number => {
    // A PRIMITIVE NUMBER, then the deliberately supported infinities. Testing
    // for `NaN` alone was not enough: `Number.isNaN(undefined)` is false, and so
    // is `Number.isNaN("wat")`, while every later `>` comparison coerces both to
    // `NaN` and is false in turn. A JavaScript caller omitting a bound therefore
    // removed it and was told the document fitted.
    if (typeof limit !== "number" || Number.isNaN(limit)) {
      throw new RangeError(
        `surveyDocument: ${name} must be a number, and ${String(limit)} would remove the bound it exists to impose.`
      );
    }
    return limit;
  };
  // SNAPSHOT the validated numbers. Validating and then re-reading `limits.*`
  // through the walk lets an accessor or proxy answer `100` to the check and
  // `undefined` afterwards, and a document-supplied hook can mutate a shared
  // plain object mid-walk — either way the quota that was verified is not the
  // one enforced. Measured: a 10,000-byte string traversed in full and returned
  // `tooLarge: false` after `maxBytes` passed validation.
  const maxBytes = bounded(limits.maxBytes, "maxBytes");
  const maxDepth = bounded(limits.maxDepth, "maxDepth");
  const maxNodes = bounded(limits.maxNodes, "maxNodes");
  // Built once and shared by every survey this walk returns, so a caller cannot
  // be handed two objects that disagree, and frozen because the bound a caller
  // reads must be the one that was enforced rather than one a later reader set.
  const enforced: Readonly<SurveyLimits> = Object.freeze<SurveyLimits>({
    maxBytes,
    maxDepth,
    maxNodes,
  });

  let bytes = 0;
  let unserializable = false;
  let nodes = 0;
  let deepest = 0;

  // Objects on the CURRENT PATH, not every object seen. A repeated reference
  // that is not a cycle is legal JSON — the serializer duplicates the subtree —
  // so skipping it undercounts: two nodes sharing one props object measured
  // half the real size and passed a cap the document exceeded. Only a reference
  // that is its own ancestor cannot be serialized at all, and only that one
  // must stop the walk.
  const onPath = new Set<object>();
  const stack: Frame[] = [{ value: root, kind: "value", depth: 0 }];

  // The ONE place a verdict is decided. Every exit below returns this, and none
  // of them overrides a field.
  //
  // Each verdict is a comparison the walk's own counters already answer, so a
  // return site that asserted its own verdict would be a second implementation
  // of the same question: the two agree on the day they are written, and a
  // break in either leaves the other producing the expected result. That is not
  // hypothetical here — a single-site break in the byte verdict left the walk
  // returning the right answer from the other site.
  //
  // `deepest` and `nodes` are advanced immediately before the check that ends
  // the walk, so reading them here reports the same breach the exit detected
  // rather than a stale one.
  const done = (): DocumentSurvey => ({
    limits: enforced,
    bytes,
    tooLarge: bytes > maxBytes,
    tooDeep: deepest > maxDepth,
    tooManyNodes: nodes > maxNodes,
    unserializable,
    nodes,
    depth: deepest,
  });

  /** Account for a value that cannot contain others. */
  const takeScalar = (held: unknown): boolean => {
    bytes += scalarBytes(held, maxBytes - bytes);
    if (!isSerializableScalar(held) || refusedByWriter(held)) {
      unserializable = true;
    }
    return bytes > maxBytes;
  };

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) continue;

    // A leave marker closes the subtree it was pushed with, so `onPath` holds
    // ancestors only. Pushed BEFORE the children, so it pops after them.
    if (frame.kind === "leave") {
      onPath.delete(frame.value as object);

      // An array's own properties that are NOT positions, which JSON drops on
      // the way to storage while the schema reads them straight back off the
      // caller's value.
      //
      // `for...in` rather than `Object.getOwnPropertyNames`, and the difference
      // is memory: the name list holds one string per position, so a
      // two-million-element array allocated hundreds of megabytes of keys to
      // answer a yes-or-no question. This holds one key at a time and stops at
      // the first name that is not an index — which name it is does not matter.
      //
      // What it does not see is a NON-ENUMERABLE own property, which JSON also
      // drops. Detecting that needs the full name list, so it is not detected;
      // it cannot arise from `JSON.parse`, which produces enumerable properties
      // only. Written down rather than implied, because a gap that is stated
      // can be closed later and a silent one reads as coverage.
      if (frame.length !== undefined) {
        const array = frame.value as object;
        try {
          for (const name in array) {
            // OWN properties only. `for...in` walks the prototype chain, and an
            // inherited name is not something this array carries — JSON ignores
            // it whether or not the chain has it, so treating one as a dropped
            // property refused every document in a process where anything had
            // put an enumerable property on `Object.prototype`.
            if (!Object.prototype.hasOwnProperty.call(array, name)) continue;
            if (arrayIndexOf(name, frame.length) < 0) {
              unserializable = true;
              break;
            }
          }
        } catch {
          unserializable = true;
        }
      }
      continue;
    }

    // ONE member at a time, for records and arrays alike.
    //
    // The continuation is pushed BEFORE the child, so the child's entire
    // subtree is measured before this container is asked for its next member.
    // Enumerating a whole container first is not free even though a reference
    // costs nothing to hold: asking for a member runs the container's own code
    // — a descriptor trap can fabricate a fresh object per request — so a
    // thousand members are materialized before the cap looks at any of them.
    if (frame.kind === "members") {
      const container = frame.value as object;
      const index = frame.index ?? 0;
      const keyed = frame.keyed === true;
      // A record iterates its own names; an array iterates its POSITIONS, so no
      // string is held per element. The two differ in what JSON writes for a
      // member it cannot find, which is the branch below.
      const total = keyed ? (frame.names?.length ?? 0) : (frame.length ?? 0);
      if (index >= total) continue;

      const key = keyed ? frame.names![index] : String(index);
      const member = readMember(container, key);

      // Enumerability decides whether the writer ever LOOKS at this member, and
      // on a record it does not: `JSON.stringify` skips a non-enumerable
      // property without reading its value, so its `toJSON` is never called.
      // Normalizing first ran document-supplied code the serializer would not
      // have run, which turns a hidden property into a way to execute something
      // expensive or stateful inside a precondition. An array index is the
      // opposite case — JSON writes it whatever its enumerability — so the rule
      // is the record's alone.
      const hidden = keyed && member.present && !member.enumerable;

      // `toJSON` next, because that is what the writer writes. A value defining
      // it is serialized as whatever it returns rather than as the fields it
      // happens to carry, and the hook can also return something JSON omits —
      // so both the size and the drop are decided here.
      const structuralOnly = frame.structuralOnly === true;
      let held: unknown = member.present ? member.value : undefined;
      let threw = false;
      let substituted = false;
      if (member.present && !hidden && !structuralOnly) {
        try {
          held = asSerialized(member.value, key);
        } catch {
          // The hook is caller-supplied code. It throwing is a fact about the
          // value, not an error in the checker.
          threw = true;
        }
        // A hook that CHANGED the value is the silent-rewrite case this walk
        // exists to catch, and the two questions it raises have different
        // answers. Size must be measured from what the writer emits — a `Date`
        // is a 26-byte quoted timestamp, not the empty object its own fields
        // describe — while representability must report that the document read
        // back is not the document that was validated. So the bytes come from
        // the normalized value and the flag comes from the substitution.
        substituted = held !== member.value;
        if (substituted) unserializable = true;
      }

      // A hidden record property is one the schema's direct read would see and
      // storage would not, so it is refused rather than silently ignored.
      const skipped = !member.present || threw || hidden || !serializesAs(held);

      // Read BEFORE the continuation is pushed, so `emitted` carries this
      // member's outcome; the continuation still goes on the stack ahead of the
      // child, which is what keeps the subtree measured before the container is
      // asked for its next descriptor.
      stack.push({
        ...frame,
        index: index + 1,
        emitted: frame.emitted === true || !skipped,
      });

      if (skipped) {
        unserializable = true;

        // A skipped member is still a member, and the caps still have to
        // describe it. Refusing a member says what STORAGE will do with it; it
        // says nothing about the work the schema will do reading it, and the
        // caps exist to bound that work.
        //
        // Two shapes make the difference concrete:
        //
        //  - a HOLE in a node list is a position the structural helpers count,
        //    so omitting it makes this walk disagree with `countNodes` and
        //    `treeDepth` — a chain ending in a hole measures one node and one
        //    level short, and a sparse `Array(5001)` never reaches the cap;
        //  - a NON-ENUMERABLE own property is invisible to the writer and fully
        //    visible to the schema's direct read, so a hidden `nodes` array of
        //    5,001 valid nodes measures as zero nodes and 33 bytes while the
        //    validator walks every one of them.
        const hiddenPlacement = memberPlacement(
          frame.containerKind ?? "value",
          frame.depth,
          key,
          container === root
        );
        if (hiddenPlacement !== "refused" && hiddenPlacement.kind === "node") {
          nodes += 1;
          if (hiddenPlacement.depth > deepest) deepest = hiddenPlacement.depth;
          if (hiddenPlacement.depth > maxDepth) {
            return done();
          }
          if (nodes > maxNodes) return done();
        }

        // A hidden value is not readable by the writer but IS readable by the
        // schema, so its size has to be surveyed rather than assumed to be
        // nothing. Only a value we actually hold can be walked: an absent
        // member or a throwing hook leaves nothing to descend into.
        if (hidden && member.present && typeof member.value === "object") {
          if (member.value !== null && hiddenPlacement !== "refused") {
            stack.push({
              value: member.value,
              kind: hiddenPlacement.kind,
              depth: hiddenPlacement.depth,
              normalized: true,
              // The whole subtree is walked for STRUCTURE only. The writer never
              // reaches any of it, so running a `toJSON` beneath it would
              // execute document-supplied code the serializer does not — the
              // same reason the hidden member's own hook is not run. Carried
              // down rather than applied once, or an ordinary node one level in
              // would have its hook invoked.
              structuralOnly: true,
            });
          }
        }

        // A position JSON cannot read still occupies one: it writes `null`
        // there, four bytes. A record's missing key costs nothing, because JSON
        // writes nothing for it — which is why this is the array branch only.
        if (!keyed) {
          bytes += 4;
          if (bytes > maxBytes) return done();
        }
        continue;
      }

      if (keyed) {
        bytes +=
          utf8ByteLength(key, maxBytes) + 3 + (frame.emitted === true ? 1 : 0);
        if (bytes > maxBytes) return done();
      }

      const placement = memberPlacement(
        frame.containerKind ?? "value",
        frame.depth,
        key,
        container === root
      );
      // A refused PLACEMENT is a fact about the key, not permission to stop
      // looking. Skipping the value left everything beneath it unmeasured: ten
      // valid nodes under a slot named `__proto__` were counted as zero nodes
      // and zero bytes, so a document over both caps reported neither, and the
      // schema then walked the subtree the caps existed to refuse. The refusal
      // is recorded and the walk continues into the value at the placement the
      // key would have had.
      if (placement === "refused") unserializable = true;
      const reached =
        placement === "refused"
          ? { kind: "nodeList" as FrameKind, depth: frame.depth + 1 }
          : placement;

      // STRUCTURE is counted from the document, never from a `toJSON`
      // replacement. The caps describe the tree a caller holds and the
      // validator will walk; a hook returning something shallower would
      // otherwise account for the replacement and leave the real tree
      // unmeasured. Measured: a document of 5,001 nodes whose root hook returns
      // an empty forest counted zero nodes, passed a 5,000 cap, and was then
      // validated in full.
      //
      // Bytes still come from the replacement, because that is what the writer
      // emits. The two answers differ only for a document already refused as
      // unserializable by the substitution itself, so no accepted document is
      // measured from anything but itself.
      const structural =
        reached.kind === "node" ||
        reached.kind === "nodeList" ||
        reached.kind === "slotMap";
      const descend = structural && substituted ? member.value : held;

      if (typeof descend === "object" && descend !== null) {
        stack.push({
          value: descend,
          kind: reached.kind,
          depth: reached.depth,
          structuralOnly,
          // ALWAYS normalized, including when we deliberately kept the
          // original for structural accounting. Marking it unnormalized made
          // the later frame invoke the hook a SECOND time, with the root key
          // `""` rather than the member key the writer passes — and then
          // discard the replacement anyway. A node hook ran twice and a
          // document serializing to 3,105 bytes surveyed as 96.
          //
          // So a substituted structural member is walked as the ORIGINAL, once,
          // and its bytes are the original's rather than the replacement's.
          // That is a deliberate inexactness confined to a document already
          // refused: a substitution sets `unserializable`, which `validate()`
          // reports as `document-unwritable`, so no accepted document is ever
          // measured this way.
          normalized: true,
        });
      } else if (typeof held === "object" && held !== null) {
        stack.push({
          value: held,
          kind: reached.kind,
          depth: reached.depth,
          normalized: true,
        });
      } else {
        // A malformed entry in a node list is still an entry. Accounting for it
        // as a scalar and never opening a `node` frame let a list of primitives
        // pass every structural bound, leaving the schema to walk what the caps
        // exist to refuse.
        if (reached.kind === "node") {
          // A malformed entry occupies a position, so it counts toward BOTH
          // bounds. Counting it as a node while leaving depth alone made a
          // chain ending in `null` measure the right number of nodes at the
          // wrong depth, and disagree with `treeDepth`.
          nodes += 1;
          if (reached.depth > deepest) deepest = reached.depth;
          if (reached.depth > maxDepth) return done();
          if (nodes > maxNodes) return done();
        }
        if (takeScalar(held)) return done();
      }
      continue;
    }

    // The ROOT arrives here unnormalized; every other value went through the
    // hook as its container's member. `JSON.stringify` passes `""` as the key
    // at the top level, and a hook that reads it behaves differently for
    // `undefined` — so the key it is given has to be the one the writer gives.
    let value: unknown = frame.value;
    if (frame.normalized !== true && frame.structuralOnly !== true) {
      try {
        value = asSerialized(value, "");
      } catch {
        unserializable = true;
        continue;
      }
      // Same substitution rule as a member's, and the same structural rule:
      // the caps describe the document a caller holds, so a root hook returning
      // something shallower is refused and then IGNORED for the walk. Following
      // it let a 5,001-node document present an empty forest, count zero nodes,
      // and pass a 5,000 cap.
      if (value !== frame.value) {
        unserializable = true;
        value = frame.value;
      }
      if (!serializesAs(value)) {
        // Nothing at all is written for a root the writer drops.
        unserializable = true;
        continue;
      }
    }
    const { kind, depth } = frame;

    if (kind === "node") {
      nodes += 1;
      if (depth > deepest) deepest = depth;
      if (depth > maxDepth) return done();
      if (nodes > maxNodes) return done();
    }

    if (typeof value !== "object" || value === null) {
      if (takeScalar(value)) return done();
      continue;
    }

    // A value the WRITER refuses, asked of objects as well as scalars. A boxed
    // BigInt is an object, and one whose prototype has been replaced looks like
    // an ordinary empty record to a prototype test while `JSON.stringify` still
    // throws on it — so the slot has to be consulted here, not only where
    // scalars are counted.
    if (refusedByWriter(value)) unserializable = true;

    if (onPath.has(value)) {
      // Its own ancestor. `JSON.stringify` throws here, and descending would
      // not terminate.
      unserializable = true;
      continue;
    }

    // Reflection on a Proxy runs caller-supplied traps, which can throw. This
    // walk is a precondition for parsing untrusted input, so a trap must not
    // take down the process doing the checking.
    try {
      if (Object.getOwnPropertySymbols(value).length > 0) unserializable = true;
    } catch {
      unserializable = true;
      continue;
    }

    // `Array.isArray` reads the brand through a proxy and throws when that
    // proxy has been revoked, so the one reflection left unguarded here was the
    // one that decides which branch runs. Every other reflection in this walk
    // is wrapped; this was not, and an exception from it escaped a function
    // whose whole contract is to return a verdict rather than raise.
    let isArray: boolean;
    try {
      isArray = Array.isArray(value);
    } catch {
      unserializable = true;
      continue;
    }

    // `length` is an own property, so a proxy can throw from reading it.
    let length = -1;
    if (isArray) {
      const lengthMember = readMember(value, "length");
      length =
        lengthMember.present && typeof lengthMember.value === "number"
          ? lengthMember.value
          : -1;
      if (length < 0) {
        unserializable = true;
        continue;
      }
    }

    onPath.add(value);
    stack.push({
      value,
      kind: "leave",
      depth: 0,
      // Set for an array, and read on the way out to look for own properties
      // JSON drops. Deferred rather than done here for two reasons that point
      // the same way: a cap breach inside the array returns before this runs at
      // all, and enumerating a hostile container's keys up front is the eager
      // reflection the member loop exists to avoid.
      length: isArray ? length : undefined,
    });

    if (isArray) {
      // Brackets and the separating commas, which `length` alone fixes: JSON
      // writes one element per position whether or not that position is
      // present.
      bytes += 2 + Math.max(0, length - 1);
      if (bytes > maxBytes) return done();

      // Every position costs at least one more byte — the shortest thing JSON
      // can write at one is a single digit, and a hole costs four — so an array
      // whose length alone outruns the remaining budget is refused here, before
      // anything is spent per position. Without this bound the walk did work
      // proportional to `length` for an array it was always going to reject.
      if (bytes + length > maxBytes) {
        bytes += length;
        return done();
      }

      stack.push({
        value,
        kind: "members",
        depth,
        length,
        index: 0,
        containerKind: kind,
        structuralOnly: frame.structuralOnly,
      });
      continue;
    }

    const shape = isPlainRecordSafely(value);
    if (!shape.plain) unserializable = true;
    if (shape.threw) continue;

    // Own property NAMES rather than `for...in`. Both cost the same for a
    // record, and this sees the non-enumerable keys `for...in` cannot — which
    // matters because the two readers must agree: `JSON.stringify` omits a
    // non-enumerable property while the schema's direct property access still
    // sees it.
    let names: string[];
    try {
      names = Object.getOwnPropertyNames(value);
    } catch {
      unserializable = true;
      continue;
    }

    bytes += 2; // braces
    if (bytes > maxBytes) return done();

    stack.push({
      value,
      kind: "members",
      depth,
      names,
      index: 0,
      containerKind: kind,
      keyed: true,
      structuralOnly: frame.structuralOnly,
    });
  }

  return done();
}

/**
 * Serialized size alone, for callers that only need the byte question.
 *
 * A thin view over {@link surveyDocument} rather than a second walk: the
 * canonical validator asks only about size, and giving it its own traversal is
 * how the two implementations that this replaced came to disagree.
 */
export function measureBytes(root: unknown, limit: number): ByteMeasurement {
  const survey = surveyDocument(root, {
    maxBytes: limit,
    // The byte question is being asked, so the structural bounds must not stop
    // the walk early and report a smaller size than the document really has.
    maxDepth: Number.MAX_SAFE_INTEGER,
    maxNodes: Number.MAX_SAFE_INTEGER,
  });
  // `exceeded` stays ONE boolean meaning "refused", with `reason` saying why.
  // Two independent flags read as tidier and are the more dangerous surface: a
  // caller asking only `exceeded` compiles, passes, and quietly stops refusing
  // documents that have no stored form at all.
  //
  // Over-limit is reported ahead of unwritable for a document that is both,
  // because the byte verdict is what gates the precise walk downstream. Losing
  // it to the other cause is what lets an unbounded traversal run. Which of the
  // two a doubly-invalid document reports is otherwise decided by the order the
  // walk happens to reach them, which no caller can predict; making that
  // order-independent among enqueued siblings is the pending-stack scan, filed
  // with the walk's redesign.
  if (survey.tooLarge) {
    return { bytes: survey.bytes, exceeded: true, reason: "over-limit" };
  }
  if (survey.unserializable) {
    return { bytes: survey.bytes, exceeded: true, reason: "unwritable" };
  }
  return { bytes: survey.bytes, exceeded: false };
}
