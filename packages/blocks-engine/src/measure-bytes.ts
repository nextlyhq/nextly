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
  // Functions are probed too. The writer runs the hook BEFORE deciding whether
  // to omit anything, so a function carrying one is not simply dropped:
  // measured, `f.toJSON = () => ({kept:1})` writes `{"a":{"kept":1}}`, and
  // `f.toJSON = () => 1n` makes `JSON.stringify` throw. Treating every function
  // as dropped therefore both under-counts a value the writer emits and reports
  // a storable document where the writer refuses.
  //
  // Primitives stay out, and the reason is the opposite one: looking a hook up
  // on a primitive BOXES it, so an environment defining `Number.prototype.toJSON`
  // — or `String`'s, or `Boolean`'s — would make every number in the document
  // run an inherited hook that `JSON.stringify` never calls, and the document
  // was then refused while the writer emitted it unchanged.
  const probed =
    typeof value === "object" ||
    typeof value === "bigint" ||
    typeof value === "function";
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
  // WHY the value is not in hand, because the three answers differ. A genuinely
  // absent key is a fact the walk has measured — an array hole costs the four
  // bytes JSON writes for it, a missing record key costs nothing. An accessor
  // or a descriptor read that threw is the walk DECLINING to look, so whatever
  // is behind it went uncounted and the totals become lower bounds.
  | { present: false; reason: "absent" | "accessor" | "threw" };

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
    return { present: false, reason: "threw" };
  }
  if (descriptor === undefined) return { present: false, reason: "absent" };
  // The descriptor is what makes this read safe, and it is not what makes it
  // FAITHFUL. A Proxy's `get` trap can return something other than the target's
  // descriptor value, so a data descriptor does not guarantee the writer sees
  // the same value this does — and nothing available here separates the two,
  // since the separating observation IS `[[Get]]`. `DocumentSurvey.complete`
  // states that limit rather than pretending to guard it.
  // A GETTER is what this refuses to run. A setter-only property has no getter,
  // so an ordinary read returns `undefined` without invoking anything — which is
  // exactly what `JSON.stringify` reads, and it then drops the key. Treating it
  // as unreadable made a document the walk had read perfectly well report that
  // the validator refused to look at it.
  if (descriptor.get !== undefined) {
    return { present: false, reason: "accessor" };
  }
  if (descriptor.set !== undefined) {
    return {
      present: true,
      value: undefined,
      enumerable: descriptor.enumerable === true,
    };
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
/**
 * Whether a failed own-key reflection also leaves the document with no stored
 * form.
 *
 * `JSON.stringify` enumerates a record's own keys through the same internal
 * operation this walk uses, so a key list that cannot be read here is one the
 * writer cannot read either — the document is unwritable as well as unreadable.
 *
 * An ARRAY is exempt: the writer takes its length and its indices and never
 * enumerates own keys, so it can still produce a stored form from a value whose
 * key list throws.
 *
 * A structural-only branch is exempt too. There the bytes were taken from a
 * `toJSON` replacement while the ORIGINAL tree is walked for depth and node
 * count, so the traps failing here belong to a tree the writer never visits.
 * Calling that unwritable would report no stored form for a document that has
 * one.
 */
function keyFailureRefusesWriter(
  isArray: boolean,
  structuralOnly: boolean | undefined
): boolean {
  return !isArray && structuralOnly !== true;
}

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
   * `readonly` on the PROPERTY as well as its members. Freezing the inner
   * object leaves `survey.limits = {...}` legal, and a walk reading the
   * replacement would be bounded by numbers this survey never enforced — which
   * is the whole point of publishing the snapshot.
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
  readonly limits: Readonly<SurveyLimits>;
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

  /**
   * `JSON.stringify` THROWS on this document, so it has no stored form at all.
   *
   * Measured rather than assumed: only a BigInt (boxed or not) and a circular
   * reference do this. Every other shape {@link unserializable} covers is
   * written after being changed, so a caller that refuses on this flag refuses
   * exactly the documents that cannot be persisted.
   */
  unwritable: boolean;

  /**
   * `JSON.stringify` WRITES this document but does not reproduce it.
   *
   * An array hole and an `undefined` element become `null`, `-0` becomes `0`,
   * a symbol-keyed or `undefined` member loses its key, a non-index array
   * property is dropped, and a `toJSON` substitution replaces the value. The
   * document has a stored form; it is not this one.
   *
   * Separate from {@link unwritable} because the two want different reports. A
   * document refused as having no stored form when it has one sends its author
   * to look for a value that is not there.
   */
  lossy: boolean;

  /**
   * The walk DECLINED to read something, so `bytes`, `nodes` and `depth` are
   * lower bounds rather than totals.
   *
   * An accessor is the ordinary case: reading it would run document-supplied
   * code, which this walk exists to avoid, so whatever it would have returned
   * went uncounted. A descriptor read or a reflection call that threw is the
   * same situation arrived at differently.
   *
   * Nothing about the writer. `JSON.stringify` invokes an accessor happily, so
   * such a document may well be storable — it is this measurement that is
   * incomplete, and a caller about to walk the same document itself is the one
   * that needs to know.
   */
  unreadable: boolean;

  /**
   * Whether `bytes`, `nodes` and `depth` are totals rather than lower bounds,
   * FOR ANY VALUE A BLOCK DOCUMENT CAN HOLD.
   *
   * The scope is load-bearing rather than a hedge. This walk reads property
   * DESCRIPTORS so that measuring a document never runs code the document
   * supplies; `JSON.stringify` reads through `[[Get]]`. For a value `JSON.parse`
   * can produce — which is what storage returns and what the editor builds —
   * those two reads agree, and every case where they diverge and this walk can
   * SEE the divergence sets a flag that clears this field.
   *
   * They can also diverge invisibly. A Proxy whose `get` trap returns more than
   * its own descriptor holds is indistinguishable from a plain record by every
   * test available here: the descriptor reports the target's value, the
   * prototype is `Object.prototype`, and the tag reads `[object Object]`.
   * Measured, one claiming a single character writes 1,000,014. Separating that
   * from an honest record requires invoking `[[Get]]`, which is the one thing
   * this function exists not to do — so it is stated rather than guarded, and
   * the guarantee is scoped to the values the API's own type can carry.
   *
   * The question a caller actually has before doing bounded work of its own,
   * derived here so it has one implementation. A caller re-deriving it has to
   * enumerate every way the walk can stop short — the three caps and
   * {@link unreadable} — and will not learn about a fourth.
   */
  complete: boolean;

  /**
   * Whether the walk VISITED every member, regardless of what it made of them.
   *
   * Narrower than {@link complete} by exactly one term. `complete` answers "are
   * these numbers the writer's totals?", and a document whose byte count is
   * merely {@link approximate} — a node hook returning a replacement — fails
   * that while having been read from end to end.
   *
   * The distinction decides whether a caller may do its own per-value work.
   * That work is bounded by what the walk reached, so an approximate count
   * bounds it exactly as well as an exact one; a walk that STOPPED — refused a
   * member, or passed a cap and returned early — bounds nothing.
   *
   * Published rather than left to the caller because the two questions are one
   * character apart at the call site and the wrong one fails OPEN: skipping
   * per-value checks silently drops real issues on a document nothing was wrong
   * with. `complete` is derived FROM this, so a new way to stop short sets this
   * and both stay correct.
   */
  traversed: boolean;
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
 * A limit, validated as one that can actually bound a walk.
 *
 * Published because more than one walk is held to these numbers and they have
 * to agree about what counts as a bound. A helper that accepts what
 * {@link surveyDocument} rejects reports success on a document the gate refuses
 * to measure at all — and it does so having walked the whole thing, which is
 * the resource bound gone as well as the verdict wrong.
 *
 * A PRIMITIVE NUMBER, then the deliberately supported infinities. Testing for
 * `NaN` alone was not enough: `Number.isNaN(undefined)` is false, and so is
 * `Number.isNaN("wat")`, while every later `>` comparison coerces both to `NaN`
 * and is false in turn. A JavaScript caller omitting a bound therefore removed
 * it and was told the document fitted.
 *
 * `Infinity` is deliberately NOT rejected: an infinite byte limit is the
 * supported way to ask for an exact count.
 *
 * Throws rather than refusing, because a limit is the CALLER's own
 * configuration rather than the untrusted document — the same reason the survey
 * throws for it — and a caller cannot be told about a bad bound through a list
 * of issues describing a document.
 */
export function boundedLimit(
  limit: number,
  name: string,
  subject: string
): number {
  if (typeof limit !== "number" || Number.isNaN(limit)) {
    throw new RangeError(
      `${subject}: ${name} must be a number, and ${String(limit)} would remove the bound it exists to impose.`
    );
  }
  return limit;
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
  const bounded = (limit: number, name: string): number =>
    boundedLimit(limit, name, "surveyDocument");
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
  // TWO accumulators, because the writer can fail in two ways that call for
  // different answers, and one flag covering both makes the wider one speak for
  // the narrower. `JSON.stringify` THROWS on a BigInt and on a cycle, so such a
  // document has no stored form at all; it WRITES every other shape here and
  // merely changes it — an array hole and an `undefined` element become `null`,
  // `-0` becomes `0`, a dropped member loses its key. Reporting the second as
  // the first tells an author their content cannot be stored when it can.
  let unwritable = false;
  let lossy = false;
  // The walk declined to READ something, so `bytes`, `nodes` and `depth` are
  // lower bounds rather than totals. Distinct from the two above, which are
  // statements about the writer on a document this walk measured in full: a
  // caller that must bound its own traversal needs to know the measurement
  // stopped short, and cannot learn that from a value being unwritable.
  let unreadable = false;
  // The walk counted a value the WRITER will not emit, so `bytes` describes a
  // different document from the one that gets stored. Distinct from the three
  // above: nothing was refused and nothing is missing, the number simply is not
  // the writer's. It feeds `complete`, because the guarantee that field makes is
  // about the numbers rather than about the document.
  let approximate = false;
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
  // return site asserting its own verdict would be a second implementation of
  // the same question. Two implementations agree on the day they are written
  // and a break in either leaves the other producing the expected result, so
  // the pair is untestable one site at a time.
  //
  // `deepest` and `nodes` are advanced immediately before the check that ends
  // the walk, so reading them here reports the same breach the exit detected
  // rather than a stale one.
  const done = (): DocumentSurvey => {
    const traversed =
      !unreadable &&
      bytes <= maxBytes &&
      deepest <= maxDepth &&
      nodes <= maxNodes;
    return {
      limits: enforced,
      unwritable,
      lossy,
      unreadable,
      // DERIVED from every way the walk can stop short, so a new one is covered
      // here the moment it sets its own flag. A caller asking "did this visit
      // everything?" must not have to re-list the reasons it might not have.
      //
      // The caps belong here because the counter RETURNS once a budget is passed,
      // so exceeding one is a stop rather than a verdict about a document that
      // was read whole.
      traversed,
      // DERIVED FROM `traversed`, one term narrower: the numbers are the writer's
      // only if the walk both reached everything AND counted what will be
      // written. Restating the stop conditions here instead would let a new one
      // set `traversed` and leave this answering the old question.
      complete: traversed && !approximate,
      bytes,
      tooLarge: bytes > maxBytes,
      tooDeep: deepest > maxDepth,
      tooManyNodes: nodes > maxNodes,
      // DERIVED, never accumulated alongside. It is the published union of ALL
      // THREE questions above, and computing it separately would let a value set
      // one of them without setting this.
      //
      // `unreadable` belongs in it, and leaving it out is fail-OPEN rather than a
      // narrowing: `measureBytes` refuses on this field, so a document the walk
      // declined to read would come back `exceeded: false` and be accepted by a
      // caller that asks nothing else. The published contract already named this
      // case — "an accessor that threw" — so excluding it would also be a silent
      // change to what the field means.
      unserializable: unwritable || lossy || unreadable,
      nodes,
      depth: deepest,
    };
  };

  /** Account for a value that cannot contain others. */
  const takeScalar = (held: unknown): boolean => {
    bytes += scalarBytes(held, maxBytes - bytes);
    if (refusedByWriter(held)) unwritable = true;
    else if (!isSerializableScalar(held)) lossy = true;
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
              lossy = true;
              break;
            }
          }
        } catch {
          unreadable = true;
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
      // An accessor, or a descriptor read that threw, is the walk declining to
      // look rather than a key that is not there. Whatever it holds went
      // uncounted, so the totals stop being totals — while a genuinely absent
      // key is fully accounted for, as the four bytes JSON writes for an array
      // hole or as nothing at all for a missing record key.
      if (!member.present && member.reason !== "absent") {
        unreadable = true;
        // A descriptor read that THREW is not only the walk declining to look.
        // `JSON.stringify` consults the same trap to decide whether the key is
        // enumerable, so it throws too and the document has no stored form —
        // unlike an accessor, which the writer invokes happily.
        if (member.reason === "threw") unwritable = true;
      }

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
        if (substituted) lossy = true;
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
        lossy = true;
        // A hook that THREW is not the same skip as a member the writer merely
        // drops. `JSON.stringify` calls the same hook and propagates the same
        // throw, so the document has no stored form; and the value behind it
        // was never measured, so nothing downstream is bounded by these totals.
        if (threw) {
          unwritable = true;
          unreadable = true;
        }

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
            // Structure is what this subtree is walked for; its bytes are the
            // hidden value's rather than anything the writer emits, so the
            // total stops describing the stored document.
            approximate = true;
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
      if (placement === "refused") lossy = true;
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
      // Bytes then describe the ORIGINAL while the writer emits the
      // replacement, and the two can differ by any amount in either direction —
      // measured, a node whose hook returns a 2 KB string surveys at 97 bytes
      // against 2,046 written. The document is refused either way, but `bytes`
      // is published and `complete` is a claim ABOUT it, so the claim has to be
      // withdrawn rather than resting on the refusal.
      if (structural && substituted) approximate = true;

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
          // So a substituted structural member is walked as the ORIGINAL,
          // once, and its bytes are the original's rather than the
          // replacement's. The substitution sets `lossy`, so the document is
          // refused; the size it was refused with is not the size it would
          // have been stored at, which is why the survey stops calling itself
          // complete.
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
        // `JSON.stringify` calls the same hook and propagates the same throw,
        // so the document has no stored form — the identical situation to a
        // member hook throwing, which is why both flags are set here as they
        // are there. `unreadable` too, because the value was abandoned and
        // whatever it held went uncounted.
        unwritable = true;
        unreadable = true;
        continue;
      }
      // Same substitution rule as a member's, and the same structural rule:
      // the caps describe the document a caller holds, so a root hook returning
      // something shallower is refused and then IGNORED for the walk. Following
      // it let a 5,001-node document present an empty forest, count zero nodes,
      // and pass a 5,000 cap.
      if (value !== frame.value) {
        lossy = true;
        // Counted from the ORIGINAL, deliberately, so a hook returning
        // something shallower cannot present a smaller forest than the document
        // holds. The cost is that `bytes` is then the original's size and the
        // writer emits the replacement's, and the two can differ by any amount
        // in either direction — so the number stops being a measurement of what
        // gets stored, and must not be reported as one.
        approximate = true;
        value = frame.value;
      }
      if (!serializesAs(value)) {
        // Nothing at all is written for a root the writer drops.
        lossy = true;
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
    if (refusedByWriter(value)) unwritable = true;

    if (onPath.has(value)) {
      // Its own ancestor, so descending would not terminate. The walk stops
      // either way and the totals become lower bounds.
      //
      // Whether the WRITER throws is a different question, and on a
      // structural-only branch the answer is no. That branch exists because a
      // `toJSON` replacement was taken for the bytes while the original tree is
      // still walked for depth and node count — so the cycle being followed here
      // is in a tree `JSON.stringify` never visits, and the replacement it does
      // visit may be perfectly writable. The substitution has already recorded
      // itself as a rewrite; calling it unwritable would report a document with
      // no stored form when it has one.
      if (frame.structuralOnly !== true) unwritable = true;
      unreadable = true;
      continue;
    }

    // `Array.isArray` reads the brand through a proxy and throws only when that
    // proxy has been revoked; it runs no trap otherwise. It comes FIRST because
    // it decides which branch runs, and because every key reflection below has
    // to classify its own failure differently for an array than for a record.
    //
    // Every reflection in this walk is wrapped: the walk is a precondition for
    // parsing untrusted input, so a trap must not take down the process doing
    // the checking.
    let isArray: boolean;
    try {
      isArray = Array.isArray(value);
    } catch {
      unreadable = true;
      continue;
    }

    // Reflection on a Proxy runs caller-supplied traps, which can throw.
    try {
      if (Object.getOwnPropertySymbols(value).length > 0) lossy = true;
    } catch {
      if (keyFailureRefusesWriter(isArray, frame.structuralOnly)) {
        unwritable = true;
      }
      unreadable = true;
      continue;
    }

    // `length` is an own property, so a proxy can throw from reading it.
    let length = -1;
    if (isArray) {
      const lengthMember = readMember(value, "length");
      if (!lengthMember.present && lengthMember.reason !== "absent") {
        unreadable = true;
      }
      length =
        lengthMember.present && typeof lengthMember.value === "number"
          ? lengthMember.value
          : -1;
      if (length < 0) {
        unreadable = true;
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
    // A probe that THREW observed nothing, so it cannot support a claim about
    // the prototype. `JSON.stringify` never consults `getPrototypeOf`, so a
    // proxy that throws only from that trap still writes its ordinary form —
    // a proxy over `{ a: 1 }` still produces `{"a":1}`. Reporting it as lossy
    // would claim storage rewrites a document storage round-trips exactly.
    if (shape.threw) {
      unreadable = true;
      continue;
    }
    if (!shape.plain) {
      lossy = true;
      // And the bytes are not the writer's. A non-plain object is walked for the
      // own properties it carries, while `JSON.stringify` writes whatever its
      // own rules produce — it UNBOXES `new Number(1)` to `1` and `new
      // String("ab")` to `"ab"`, neither of which is the enumerable shape
      // measured here. The size a caller gets would describe an object the
      // writer never emits, so the totals stop being totals.
      approximate = true;
    }

    // Own property NAMES rather than `for...in`. Both cost the same for a
    // record, and this sees the non-enumerable keys `for...in` cannot — which
    // matters because the two readers must agree: `JSON.stringify` omits a
    // non-enumerable property while the schema's direct property access still
    // sees it.
    let names: string[];
    try {
      names = Object.getOwnPropertyNames(value);
    } catch {
      // The second reflection through `[[OwnPropertyKeys]]` on this value. A
      // stateful trap can admit the symbol probe above and refuse this one, so
      // both sites classify the failure rather than only the first to run.
      if (keyFailureRefusesWriter(isArray, frame.structuralOnly)) {
        unwritable = true;
      }
      unreadable = true;
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
