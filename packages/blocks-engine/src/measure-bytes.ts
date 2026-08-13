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

/** Serialized size of a non-object value, bounded like everything else here. */
function scalarBytes(value: unknown, budget: number): number {
  if (typeof value === "string") return 2 + utf8ByteLength(value, budget);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).length;
  }
  // `null`, `undefined`, and the values JSON cannot hold; four bytes is what
  // `null` costs, and the others are refused by the flag rather than counted.
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
  /** Serialized size in bytes; a lower bound once `tooLarge` is set. */
  bytes: number;
  /** The byte cap was passed. */
  tooLarge: boolean;
  /** Nodes nest deeper through slots than the cap allows. */
  tooDeep: boolean;
  /** More nodes than the cap allows. */
  tooManyNodes: boolean;
  /**
   * The value holds something JSON does not preserve: a BigInt, a function, a
   * symbol, a symbol-keyed property, `undefined`, a non-finite number, `-0`, an
   * object that is not a plain record, an accessor that threw, or a repeated
   * reference.
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
   * `names` is the member list for a record AND for an array. Both containers
   * have to answer the same question — which own properties does JSON actually
   * emit — and an array that walked `0..length-1` instead could not see a
   * non-index own property, which JSON silently drops.
   *
   * `keyed` says whether JSON writes `"key":` before each member, which is the
   * only respect in which the two containers differ here. `emitted` records
   * whether an earlier member of THIS container produced output, so the
   * separating comma is counted from what was written rather than from the
   * iteration index — a skipped member would otherwise leave a comma with
   * nothing on one side of it.
   */
  names?: string[];
  index?: number;
  containerKind?: FrameKind;
  keyed?: boolean;
  emitted?: boolean;
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
  let bytes = 0;
  let unserializable = false;
  let nodes = 0;

  // Objects on the CURRENT PATH, not every object seen. A repeated reference
  // that is not a cycle is legal JSON — the serializer duplicates the subtree —
  // so skipping it undercounts: two nodes sharing one props object measured
  // half the real size and passed a cap the document exceeded. Only a reference
  // that is its own ancestor cannot be serialized at all, and only that one
  // must stop the walk.
  const onPath = new Set<object>();
  const stack: Frame[] = [{ value: root, kind: "value", depth: 0 }];

  const done = (): DocumentSurvey => ({
    bytes,
    tooLarge: bytes > limits.maxBytes,
    tooDeep: false,
    tooManyNodes: nodes > limits.maxNodes,
    unserializable,
  });

  /** Account for a value that cannot contain others. */
  const takeScalar = (held: unknown): boolean => {
    bytes += scalarBytes(held, limits.maxBytes - bytes);
    if (!isSerializableScalar(held)) unserializable = true;
    return bytes > limits.maxBytes;
  };

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) continue;

    // A leave marker closes the subtree it was pushed with, so `onPath` holds
    // ancestors only. Pushed BEFORE the children, so it pops after them.
    if (frame.kind === "leave") {
      onPath.delete(frame.value as object);
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
      const names = frame.names ?? [];
      if (index >= names.length) continue;

      const keyed = frame.keyed === true;
      const key = names[index];
      const member = readMember(container, key);

      // Enumerability means different things to the serializer on the two
      // containers. `JSON.stringify` omits a non-enumerable RECORD property —
      // so the schema, which reads directly, would see a field storage drops —
      // but it serializes an array element by index regardless. Applying the
      // record rule to both refused documents JSON handles correctly.
      const skipped = !member.present || (keyed && !member.enumerable);

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
        continue;
      }

      if (keyed) {
        bytes +=
          utf8ByteLength(key, limits.maxBytes) +
          3 +
          (frame.emitted === true ? 1 : 0);
        if (bytes > limits.maxBytes) return { ...done(), tooLarge: true };
      }

      const held = member.value;
      const placement = memberPlacement(
        frame.containerKind ?? "value",
        frame.depth,
        key,
        container === root
      );
      if (placement === "refused") {
        unserializable = true;
        continue;
      }

      if (typeof held === "object" && held !== null) {
        stack.push({
          value: held,
          kind: placement.kind,
          depth: placement.depth,
        });
      } else {
        // A malformed entry in a node list is still an entry. Accounting for it
        // as a scalar and never opening a `node` frame let a list of primitives
        // pass every structural bound, leaving the schema to walk what the caps
        // exist to refuse.
        if (placement.kind === "node") {
          nodes += 1;
          if (nodes > limits.maxNodes) return { ...done(), tooManyNodes: true };
        }
        if (takeScalar(held)) return { ...done(), tooLarge: true };
      }
      continue;
    }

    const { value, kind, depth } = frame;

    if (kind === "node") {
      nodes += 1;
      if (depth > limits.maxDepth) return { ...done(), tooDeep: true };
      if (nodes > limits.maxNodes) return { ...done(), tooManyNodes: true };
    }

    if (typeof value !== "object" || value === null) {
      if (takeScalar(value)) return { ...done(), tooLarge: true };
      continue;
    }

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

    onPath.add(value);
    stack.push({ value, kind: "leave", depth: 0 });

    if (Array.isArray(value)) {
      // `length` is an own property, so a proxy can throw from reading it.
      const lengthMember = readMember(value, "length");
      const length =
        lengthMember.present && typeof lengthMember.value === "number"
          ? lengthMember.value
          : -1;
      if (length < 0) {
        unserializable = true;
        continue;
      }
      // Brackets and the separating commas, which `length` alone fixes: JSON
      // writes one element per position whether or not that position is
      // present. Counted BEFORE the names are enumerated, so an array too large
      // to store is refused without materializing a key list for it.
      bytes += 2 + Math.max(0, length - 1);
      if (bytes > limits.maxBytes) return { ...done(), tooLarge: true };

      // Own NAMES rather than the positions `0..length-1`, because the two
      // differ in both directions and JSON treats each difference differently.
      // A position with no property is a HOLE, which JSON writes as `null`; a
      // name that is not a position is a property JSON DROPS. Walking positions
      // saw neither: the holes cost nothing and the extra properties were
      // invisible, so an array measured smaller than it serializes and one
      // carrying a field storage discards was reported as storage-preserving.
      let names: string[];
      try {
        names = Object.getOwnPropertyNames(value);
      } catch {
        unserializable = true;
        continue;
      }

      const elements: string[] = [];
      for (const name of names) {
        if (arrayIndexOf(name, length) >= 0) {
          elements.push(name);
        } else if (name !== "length") {
          // `length` is the one own property JSON omits by design. Anything
          // else here is data the caller can read back from the value it passed
          // in and will not find in storage.
          unserializable = true;
        }
      }

      // Every position without a property serializes as `null`, four bytes
      // each. A sparse array is legal input to `JSON.stringify` and it is the
      // one shape where the emitted size is driven by what is ABSENT.
      const holes = length - elements.length;
      if (holes > 0) {
        unserializable = true;
        bytes += holes * 4;
        if (bytes > limits.maxBytes) return { ...done(), tooLarge: true };
      }

      stack.push({
        value,
        kind: "members",
        depth,
        names: elements,
        index: 0,
        containerKind: kind,
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
    if (bytes > limits.maxBytes) return { ...done(), tooLarge: true };

    stack.push({
      value,
      kind: "members",
      depth,
      names,
      index: 0,
      containerKind: kind,
      keyed: true,
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
export function measureBytes(
  root: unknown,
  limit: number
): { bytes: number; exceeded: boolean; unserializable: boolean } {
  const survey = surveyDocument(root, {
    maxBytes: limit,
    // The byte question is being asked, so the structural bounds must not stop
    // the walk early and report a smaller size than the document really has.
    maxDepth: Number.MAX_SAFE_INTEGER,
    maxNodes: Number.MAX_SAFE_INTEGER,
  });
  return {
    bytes: survey.bytes,
    exceeded: survey.tooLarge,
    unserializable: survey.unserializable,
  };
}
