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
 * Everything one pass over an untrusted document can establish.
 *
 * There used to be two walks: this one for size, and a separate structural
 * guard for depth and node count. They visited the same tree, asked different
 * questions, and each carried its own defensive logic — so every property added
 * to one was missing from the other, and four rounds of review found exactly
 * that, one property at a time. Reading a value safely, terminating on a cycle,
 * refusing what JSON rewrites: none of those are questions about SIZE, they are
 * questions about traversing hostile input, and there is one traversal now.
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
}

export function surveyDocument(
  root: unknown,
  limits: SurveyLimits
): DocumentSurvey {
  let bytes = 0;
  let unserializable = false;
  let nodes = 0;

  // Every object reached, not only those on the current path. A repeated
  // reference is not a cycle in general, but it IS a document that changes
  // under storage: `JSON.stringify` duplicates a shared subtree and throws on a
  // true cycle, so in both cases the document read back is not the one that was
  // validated. Flagging both here also terminates the walk on a cycle
  // INDEPENDENTLY of the byte cap, which is the property a size bound cannot
  // provide — a cyclic document of small values never reaches the cap.
  const seen = new WeakSet<object>();

  const stack: Frame[] = [{ value: root, kind: "value", depth: 0 }];

  const done = (): DocumentSurvey => ({
    bytes,
    tooLarge: bytes > limits.maxBytes,
    tooDeep: false,
    tooManyNodes: nodes > limits.maxNodes,
    unserializable,
  });

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) continue;
    const { value, kind, depth } = frame;

    // Only a NODE counts. The array holding nodes and the map holding those
    // arrays are structure, not content, and counting them would make the caps
    // describe the shape of the encoding rather than the size of the document.
    if (kind === "node") {
      nodes += 1;
      if (depth > limits.maxDepth) return { ...done(), tooDeep: true };
      if (nodes > limits.maxNodes) return { ...done(), tooManyNodes: true };
    }

    if (typeof value !== "object" || value === null) {
      bytes += scalarBytes(value, limits.maxBytes - bytes);
      if (!isSerializableScalar(value)) unserializable = true;
      if (bytes > limits.maxBytes) return { ...done(), tooLarge: true };
      continue;
    }

    // A second visit means the document is a graph rather than a tree.
    if (seen.has(value)) {
      unserializable = true;
      continue;
    }
    seen.add(value);

    // Symbol-keyed own properties are dropped by JSON without a word. Cheap on
    // both objects and arrays; the NAMED equivalent on an array is the same
    // class and is deliberately not detected, because `Object.keys` allocates a
    // string per index — measured at over two seconds on an array this walk
    // otherwise rejects in milliseconds.
    if (Object.getOwnPropertySymbols(value).length > 0) unserializable = true;

    if (Array.isArray(value)) {
      bytes += 2 + Math.max(0, value.length - 1);
      if (bytes > limits.maxBytes) return { ...done(), tooLarge: true };

      // Elements are measured as the walk reaches them, exactly as object
      // values are. Pushing the whole array first is lazy in nothing: a
      // million-element array of large strings would be resident before the cap
      // was consulted a second time.
      // A node list's elements are nodes; any other array's elements are data.
      const elementKind: FrameKind = kind === "nodeList" ? "node" : "value";
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], kind: elementKind, depth });
      }
      continue;
    }

    if (!isPlainRecord(value)) unserializable = true;
    bytes += 2; // braces
    if (bytes > limits.maxBytes) return { ...done(), tooLarge: true };

    let properties = 0;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;

      bytes +=
        utf8ByteLength(key, limits.maxBytes) + 3 + (properties > 0 ? 1 : 0);
      properties += 1;
      if (bytes > limits.maxBytes) return { ...done(), tooLarge: true };

      // An enumerable accessor is caller-supplied code and can throw. This walk
      // is a precondition for parsing untrusted input, so an exception escaping
      // it crashes the process doing the checking — the outcome the bounds exist
      // to prevent, arriving through the bounds themselves.
      let held: unknown;
      try {
        held = (value as Record<string, unknown>)[key];
      } catch {
        unserializable = true;
        continue;
      }

      // The two places the document's own tree continues: `nodes` on the
      // envelope, and `slots` on a node. Everything else is data whatever it
      // holds. Reached by OWN key, so a `slots` inherited through a prototype is
      // not mistaken for the node's children, while one written as an own
      // `__proto__` key is walked like any other own property — the case a
      // dotted read (`node.slots`) gets wrong in both directions.
      let childKind: FrameKind = "value";
      let childDepth = depth;
      if (kind === "value" && depth === 0 && key === "nodes") {
        childKind = "nodeList";
        childDepth = 1;
      } else if (kind === "node" && key === "slots") {
        childKind = "slotMap";
      } else if (kind === "slotMap") {
        childKind = "nodeList";
        childDepth = depth + 1;
        // A slot NAMED `__proto__` is refused. `JSON.parse` makes it an ordinary
        // own key, so it survives storage — but every consumer that rebuilds a
        // record by assignment drops it, including the published schema's own
        // validator, so its children would go unchecked while the document read
        // as valid. Slot names are chosen by a block definition, so forbidding
        // one reserved word costs an author nothing; leaving it costs a silent
        // hole in the only structure the format nests through.
        if (key === "__proto__") unserializable = true;
      }

      if (typeof held === "object" && held !== null) {
        stack.push({ value: held, kind: childKind, depth: childDepth });
      } else {
        bytes += scalarBytes(held, limits.maxBytes - bytes);
        if (!isSerializableScalar(held)) unserializable = true;
        if (bytes > limits.maxBytes) return { ...done(), tooLarge: true };
      }
    }
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
