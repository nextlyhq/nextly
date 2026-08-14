import { describe, expect, it } from "vitest";

import { countNodes, treeDepth } from "./limits";
import { measureBytes, surveyDocument } from "./measure-bytes";

/**
 * The counter's whole purpose is to answer the question `JSON.stringify` would
 * answer without building the string. So the test is that agreement, asserted
 * byte for byte rather than approximately: a counter that is merely close is a
 * counter that accepts documents over the cap, and the cap is the only thing
 * between a hostile document and an unbounded allocation.
 */
function pageWith(props: Record<string, unknown>) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "a", type: "core/text", version: 1, props }],
  };
}

function realBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * A length-3 array holding values at `filled` and holes everywhere else.
 *
 * Built by assigning into a bare `Array(3)` rather than by `delete`-ing from a
 * literal, so the holes are genuine absent positions in every engine rather
 * than whatever a literal with elisions happens to produce.
 */
function sparse(filled: number[]): unknown[] {
  const array = new Array<unknown>(3);
  for (const index of filled) array[index] = index;
  return array;
}

/** A dense array carrying an own property that is not an index. */
function withExtra(): unknown[] {
  const array: unknown[] = [1, 2];
  Object.defineProperty(array, "extra", {
    value: "dropped",
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return array;
}

/**
 * Whether the counter refused the value because it has no stored form.
 *
 * `measureBytes` reports one `exceeded` boolean with a `reason`, so "is this
 * unwritable" is a narrowing rather than a field. Written once here so each
 * test asks the question rather than restating the union.
 */
function unwritable(value: unknown, limit = Number.MAX_SAFE_INTEGER): boolean {
  const measured = measureBytes(value, limit);
  return measured.exceeded && measured.reason === "unwritable";
}

describe("the three things the writer can do", () => {
  const LIMITS = { maxBytes: 1_000_000, maxDepth: 12, maxNodes: 5_000 };

  it("refuses a document it could not read, through measureBytes too", () => {
    // The published `unserializable` is what `measureBytes` refuses on, and
    // `packages/builder/src/ops.ts` asks it nothing else — so a walk that
    // declined to read something must reach that field, or an operation accepts
    // a value that fails to save. Excluding it is fail-OPEN rather than a
    // narrowing, which is why this asserts the refusal rather than the flag.
    const hostile = new Proxy(
      { a: 1 },
      {
        ownKeys() {
          throw new Error("no");
        },
      }
    );

    const survey = surveyDocument(hostile, LIMITS);
    expect(survey.unreadable).toBe(true);
    expect(survey.complete).toBe(false);
    expect(survey.unserializable).toBe(true);

    expect(measureBytes(hostile, 1_000_000).exceeded).toBe(true);
    // And `JSON.stringify` agrees the document has no stored form, which is
    // what makes accepting it the wrong answer rather than a lenient one.
    expect(() => JSON.stringify(hostile)).toThrow();
  });

  it("treats a member hook that throws as unwritable, not merely rewritten", () => {
    // `JSON.stringify` calls the same hook and propagates the same throw, so
    // this document has no stored form; and the value behind the hook was never
    // measured, so the totals are lower bounds. Reporting it as a rewrite says
    // the document can be stored and that these numbers are trustworthy, and
    // neither is true.
    const doc = {
      a: {
        toJSON() {
          throw new Error("no");
        },
      },
    };

    const survey = surveyDocument(doc, LIMITS);
    expect(survey.unwritable).toBe(true);
    expect(survey.complete).toBe(false);
    expect(() => JSON.stringify(doc)).toThrow();
  });

  it("treats a ROOT hook that throws as unwritable, not merely unread", () => {
    // The same situation as a member hook throwing, one level up, and it was
    // the level that kept reporting the wrong verdict. `JSON.stringify` calls
    // the hook on the value it is handed first of all, so a throw here has no
    // stored form for exactly the same reason.
    const doc = {
      toJSON() {
        throw new Error("no");
      },
    };

    const survey = surveyDocument(doc, LIMITS);
    expect(survey.unwritable).toBe(true);
    expect(survey.complete).toBe(false);
    expect(() => JSON.stringify(doc)).toThrow();
  });

  it("does not call a survey complete when bytes are not the writer's", () => {
    // A node hook returning a replacement is walked as the ORIGINAL, so a
    // shallower replacement cannot present a smaller forest than the document
    // holds. The cost is that `bytes` is then the original's size while the
    // writer emits the replacement's, and the gap runs in the dangerous
    // direction: measured, 97 surveyed against 2,046 written, so a caller
    // trusting the number accepts a document past a cap it has broken.
    const node = {
      id: "n1",
      type: "core/text",
      version: 1,
      props: {},
      toJSON() {
        return "x".repeat(2000);
      },
    };
    const doc = { formatVersion: 1, kind: "page", nodes: [node] };

    const survey = surveyDocument(doc, LIMITS);
    expect(survey.complete).toBe(false);
    expect(survey.bytes).toBeLessThan(JSON.stringify(doc)!.length);

    // The other direction, so this cannot pass by reporting every document
    // incomplete: an ordinary node is complete and its bytes are exact.
    const plain = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/text", version: 1, props: {} }],
    };
    const exact = surveyDocument(plain, LIMITS);
    expect(exact.complete).toBe(true);
    expect(exact.bytes).toBe(JSON.stringify(plain)!.length);
  });

  it("refuses what the descriptor read cannot measure the writer's way", () => {
    // The walk reads descriptors so validating never runs document code; the
    // writer reads through [[Get]] and applies its own rules. Where those two
    // diverge and the walk CAN see it, the totals stop being totals rather than
    // being reported as exact.
    //
    // Boxed primitives are the visible case: JSON unboxes them, so the
    // enumerable object shape measured here is not what gets stored.
    const boxedNumber = { a: new Number(12345) };
    const boxedString = { a: new String("abcdef") };
    expect(surveyDocument(boxedNumber, LIMITS).complete).toBe(false);
    expect(surveyDocument(boxedString, LIMITS).complete).toBe(false);
    expect(surveyDocument(boxedString, LIMITS).bytes).not.toBe(
      JSON.stringify(boxedString)!.length
    );

    // And the control, so this cannot pass by refusing everything: an ordinary
    // value is complete and its bytes are exact.
    const plain = { a: 12345 };
    const exact = surveyDocument(plain, LIMITS);
    expect(exact.complete).toBe(true);
    expect(exact.bytes).toBe(JSON.stringify(plain)!.length);
  });

  it("reads a setter-only property instead of refusing it", () => {
    // Only a GETTER runs document code. A setter-only property has none, so an
    // ordinary read returns `undefined` without invoking anything — which is
    // what `JSON.stringify` reads before dropping the key. Calling it
    // unreadable reported that the validator refused to look at a document it
    // had measured exactly.
    const doc: Record<string, unknown> = { b: 1 };
    Object.defineProperty(doc, "a", { enumerable: true, set() {} });

    const survey = surveyDocument(doc, LIMITS);
    expect(survey.unreadable).toBe(false);
    expect(survey.complete).toBe(true);
    expect(survey.bytes).toBe(JSON.stringify(doc)!.length);
  });

  it("separates a document JSON rewrites from one it refuses", () => {
    // The distinction the whole split exists for, asserted against the writer
    // rather than against an expectation of it.
    const sparse: unknown[] = [];
    sparse[1] = "b";

    const rewritten = surveyDocument({ a: sparse }, LIMITS);
    expect(rewritten.lossy).toBe(true);
    expect(rewritten.unwritable).toBe(false);
    expect(rewritten.complete).toBe(true);
    expect(JSON.stringify({ a: sparse })).toBe('{"a":[null,"b"]}');

    const refused = surveyDocument({ a: 1n }, LIMITS);
    expect(refused.unwritable).toBe(true);
    expect(() => JSON.stringify({ a: 1n })).toThrow();
  });
});

describe("measureBytes", () => {
  it("counts exactly what JSON.stringify emits", () => {
    const cases: Array<[string, unknown]> = [
      ["empty props", pageWith({})],
      ["one prop", pageWith({ a: 1 })],
      ["two props, so a separating comma exists", pageWith({ a: 1, b: 2 })],
      ["nested objects", pageWith({ a: { b: { c: "d" } } })],
      ["arrays of objects", pageWith({ a: [{ b: 1 }, { c: 2 }, {}] })],
      ["mixed scalars", pageWith({ a: null, b: true, c: 1.5, d: "x" })],
      ["escapes", pageWith({ a: 'quote " backslash \\ newline \n tab \t' })],
      ["control characters", pageWith({ a: "" })],
      ["multibyte", pageWith({ a: "héllo — 世界 \u{1f389}" })],
      ["keys needing escapes", pageWith({ 'a"b': 1, "c\\d": 2 })],
      ["a hole, which JSON writes as null", pageWith({ a: sparse([0, 2]) })],
      ["leading and trailing holes", pageWith({ a: sparse([1]) })],
      ["every position a hole", pageWith({ a: new Array(4) })],
      ["a non-index property JSON drops", pageWith({ a: withExtra() })],
    ];

    for (const [label, value] of cases) {
      expect(measureBytes(value, Number.MAX_SAFE_INTEGER).bytes, label).toBe(
        realBytes(value)
      );
    }
  });

  it("counts the comma between every pair of properties", () => {
    // The case the omission hid behind: one byte per property is invisible on a
    // small document and decides the verdict on a large one. At 170,000 empty
    // props the real size is over the 2 MiB cap while an undercounting measure
    // reported it comfortably under, so the document was accepted.
    const props: Record<string, string> = {};
    for (let index = 0; index < 170_000; index += 1) props[`k${index}`] = "";
    const document = pageWith(props);

    const real = realBytes(document);
    expect(real).toBeGreaterThan(2 * 1024 * 1024);
    expect(measureBytes(document, Number.MAX_SAFE_INTEGER).bytes).toBe(real);
    expect(measureBytes(document, 2 * 1024 * 1024).exceeded).toBe(true);
  });

  it("counts the null a hole serializes as, so holes reach the cap", () => {
    // The mirror of the missing comma, and it hides in the opposite place: the
    // bytes come from positions that hold NOTHING, so a walk over the values
    // present finds an almost empty array. 600,000 holes cost four bytes each
    // in storage and were measured as zero.
    const document = pageWith({ a: new Array(600_000) });

    const real = realBytes(document);
    expect(real).toBeGreaterThan(2 * 1024 * 1024);
    expect(measureBytes(document, Number.MAX_SAFE_INTEGER).bytes).toBe(real);
    expect(measureBytes(document, 2 * 1024 * 1024).exceeded).toBe(true);
  });

  it("keeps counting inside a slot whose key is refused", () => {
    // A refused KEY is a fact about the key, not permission to stop looking.
    // `JSON.parse` produces `__proto__` as an ordinary own property, so a
    // document can hide a subtree under one — and skipping the value meant the
    // nodes beneath it were counted as zero and the bytes as none, so a
    // document over both caps reported neither and the schema then walked
    // exactly what the caps existed to refuse.
    const hidden = Array.from({ length: 10 }, (_, index) => ({
      id: `h${index}`,
      type: "core/text",
      version: 1,
      props: { text: "x".repeat(100) },
    }));
    // Parsed from TEXT. Writing `{ __proto__: hidden }` as a literal sets the
    // prototype instead of creating a property, so the fixture would carry no
    // such key and the test would pass without ever reaching the mechanism.
    // `JSON.parse` is the thing that produces it as an ordinary own property,
    // which is also why a stored document can contain one.
    const slots = JSON.parse(
      `{"__proto__": ${JSON.stringify(hidden)}}`
    ) as Record<string, unknown>;
    // The precondition: it really is an own key rather than a prototype
    // assignment, which is the only reason the walk can reach it at all.
    expect(Object.hasOwn(slots, "__proto__")).toBe(true);

    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "a", type: "core/section", version: 1, props: {}, slots }],
    };

    const survey = surveyDocument(document, {
      maxBytes: 1000,
      maxDepth: 12,
      maxNodes: 2,
    });

    // Refused for the key AND bounded for what it hid.
    expect(survey.unserializable).toBe(true);
    expect(survey.tooManyNodes || survey.tooLarge).toBe(true);
  });

  it("counts the document's own structure, not a toJSON replacement's", () => {
    // The caps exist to bound what a caller holds and the validator will walk.
    // A hook returning something shallower let the replacement be accounted for
    // while the real tree went unmeasured: 5,001 nodes presenting an empty
    // forest counted zero, passed a 5,000 cap, and were then validated in full.
    const nodes = Array.from({ length: 5001 }, (_, index) => ({
      id: `n${index}`,
      type: "core/text",
      version: 1,
      props: {},
    }));
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes,
      toJSON: () => ({ formatVersion: 1, kind: "page", nodes: [] }),
    };
    // The precondition: the writer really would emit the empty forest, so this
    // is a document whose declared size and stored size disagree.
    expect(JSON.parse(JSON.stringify(document)).nodes).toEqual([]);

    const survey = surveyDocument(document, {
      maxBytes: Number.MAX_SAFE_INTEGER,
      maxDepth: 12,
      maxNodes: 5000,
    });

    expect(survey.tooManyNodes).toBe(true);
    expect(survey.unserializable).toBe(true);
  });

  it("agrees with countNodes and treeDepth, which answer the same question", () => {
    // Three implementations of "how many nodes, how deep" exist: this survey,
    // and the engine's `countNodes`/`treeDepth`, which the builder's cap checks
    // still call. Until the builder derives its answers from the survey, this
    // is what stops the two drifting — a divergence would otherwise be visible
    // only on the documents that sit between them, which is exactly when nobody
    // is looking.
    const leaf = (id: string) => ({
      id,
      type: "core/text",
      version: 1,
      props: {},
    });
    const cases: Array<[string, { nodes: unknown[] }]> = [
      ["empty", { nodes: [] }],
      ["flat", { nodes: [leaf("a"), leaf("b"), leaf("c")] }],
      [
        "nested through slots",
        {
          nodes: [
            {
              ...leaf("root"),
              type: "core/section",
              slots: {
                left: [leaf("l1"), leaf("l2")],
                right: [
                  {
                    ...leaf("mid"),
                    type: "core/section",
                    slots: { inner: [leaf("deep")] },
                  },
                ],
              },
            },
          ],
        },
      ],
    ];

    for (const [label, forest] of cases) {
      const survey = surveyDocument(
        { formatVersion: 1, kind: "page", ...forest },
        {
          maxBytes: Number.MAX_SAFE_INTEGER,
          maxDepth: Number.MAX_SAFE_INTEGER,
          maxNodes: Number.MAX_SAFE_INTEGER,
        }
      );
      const nodes = forest.nodes as Parameters<typeof countNodes>[0];
      expect(survey.nodes, `${label}: node count`).toBe(countNodes(nodes));
      expect(survey.depth, `${label}: depth`).toBe(treeDepth(nodes));
    }
  });

  it("counts a hole in a node list as a node, like the structural helpers do", () => {
    // A hole is a malformed CHILD, not an absent one, and `countNodes` counts
    // it. Omitting it made the survey disagree with the helpers it replaces — a
    // chain ending in a hole surveyed one node and one level short, and a
    // sparse node array never reached the node cap at all.
    const sparseChildren = new Array<unknown>(3);
    sparseChildren[0] = {
      id: "present",
      type: "core/text",
      version: 1,
      props: {},
    };
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "root",
          type: "core/section",
          version: 1,
          props: {},
          slots: { children: sparseChildren },
        },
      ],
    };

    const survey = surveyDocument(document, {
      maxBytes: Number.MAX_SAFE_INTEGER,
      maxDepth: Number.MAX_SAFE_INTEGER,
      maxNodes: Number.MAX_SAFE_INTEGER,
    });

    // root, plus three positions of which two are holes.
    expect(survey.nodes).toBe(4);
    expect(survey.depth).toBe(2);
    expect(survey.unserializable).toBe(true);
  });

  it("reaches the node cap through a sparse node list", () => {
    const survey = surveyDocument(
      { formatVersion: 1, kind: "page", nodes: new Array<unknown>(5001) },
      { maxBytes: Number.MAX_SAFE_INTEGER, maxDepth: 12, maxNodes: 5000 }
    );
    expect(survey.tooManyNodes).toBe(true);
  });

  it("surveys a hidden value instead of looking away from it", () => {
    // A non-enumerable own property is skipped by the WRITER and still read by
    // the schema, so refusing it and stopping left what it hides outside every
    // bound: 5,001 nodes behind a hidden `nodes` surveyed as zero nodes, and
    // validation then walked them anyway.
    const nodes = Array.from({ length: 5001 }, (_, index) => ({
      id: `n${index}`,
      type: "core/text",
      version: 1,
      props: {},
    }));
    const document: Record<string, unknown> = {
      formatVersion: 1,
      kind: "page",
    };
    Object.defineProperty(document, "nodes", {
      value: nodes,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    // The precondition: the writer really does drop it, so this is the hidden
    // case rather than an ordinary one.
    expect(JSON.stringify(document)).not.toContain("n0");

    const survey = surveyDocument(document, {
      maxBytes: Number.MAX_SAFE_INTEGER,
      maxDepth: 12,
      maxNodes: 5000,
    });

    expect(survey.unserializable).toBe(true);
    expect(survey.tooManyNodes).toBe(true);
  });

  it("refuses a NaN limit rather than silently dropping every bound", () => {
    // Every cap is a `>` comparison and every comparison against NaN is false,
    // so a NaN limit removes the bounds while the walk reports success.
    expect(() => measureBytes("x".repeat(1000), Number.NaN)).toThrow(
      RangeError
    );
    expect(() =>
      surveyDocument({}, { maxBytes: 100, maxDepth: Number.NaN, maxNodes: 100 })
    ).toThrow(RangeError);

    // Infinity stays supported: it is how an exact count is requested, and the
    // walk terminates on the cycle set rather than on the cap.
    expect(() =>
      measureBytes({ a: 1 }, Number.POSITIVE_INFINITY)
    ).not.toThrow();
  });

  it("runs no toJSON anywhere beneath a hidden value", () => {
    // The writer never reaches a non-enumerable property, so nothing under it is
    // serialized — and running a hook down there would execute
    // document-supplied code the serializer does not, inside a precondition.
    // The no-hook mode has to travel the whole subtree, not just the member it
    // started at.
    let calls = 0;
    const node = {
      id: "n1",
      type: "core/text",
      version: 1,
      props: {},
      toJSON() {
        calls += 1;
        return { id: "n1", type: "core/text", version: 1, props: {} };
      },
    };
    const document: Record<string, unknown> = {
      formatVersion: 1,
      kind: "page",
    };
    Object.defineProperty(document, "nodes", {
      value: [node],
      enumerable: false,
      writable: true,
      configurable: true,
    });
    // The precondition: the writer really does drop the whole branch.
    expect(JSON.stringify(document)).not.toContain("n1");

    const survey = surveyDocument(document, {
      maxBytes: Number.MAX_SAFE_INTEGER,
      maxDepth: 12,
      maxNodes: 5000,
    });

    expect(calls).toBe(0);
    // Still counted, so the caps describe what the schema will read.
    expect(survey.nodes).toBe(1);
    expect(survey.unserializable).toBe(true);
  });

  it("counts depth for a malformed scalar in a node list", () => {
    // A present scalar occupies a position exactly as a hole does, so it counts
    // toward BOTH bounds. Counting it as a node while leaving depth alone made
    // a chain ending in `null` disagree with `treeDepth`.
    let inner: unknown = null;
    for (let level = 0; level < 3; level += 1) {
      inner = {
        id: `n${level}`,
        type: "core/section",
        version: 1,
        props: {},
        slots: { children: [inner] },
      };
    }
    const document = { formatVersion: 1, kind: "page", nodes: [inner] };

    const survey = surveyDocument(document, {
      maxBytes: Number.MAX_SAFE_INTEGER,
      maxDepth: Number.MAX_SAFE_INTEGER,
      maxNodes: Number.MAX_SAFE_INTEGER,
    });

    const forest = document.nodes as Parameters<typeof countNodes>[0];
    expect(survey.nodes).toBe(countNodes(forest));
    expect(survey.depth).toBe(treeDepth(forest));
  });

  it("refuses a bound that is not a number at all", () => {
    // `Number.isNaN(undefined)` is false, and so is `Number.isNaN("wat")`, while
    // every later comparison coerces both to NaN and is false in turn — so a
    // caller omitting a bound removed it and was told the document fitted.
    expect(() =>
      measureBytes("x".repeat(1000), undefined as unknown as number)
    ).toThrow(RangeError);
    expect(() =>
      measureBytes("x".repeat(1000), "wat" as unknown as number)
    ).toThrow(RangeError);
    expect(() =>
      surveyDocument(
        {},
        {
          maxBytes: 100,
          maxDepth: undefined as unknown as number,
          maxNodes: 100,
        }
      )
    ).toThrow(RangeError);
  });

  it("does not probe toJSON on a primitive, as the writer does not", () => {
    // `JSON.stringify` looks the hook up only on objects and BigInt. Looking it
    // up on a number BOXES the number, so an environment defining
    // `Number.prototype.toJSON` made every numeric member run an inherited hook
    // the writer never calls — and the document was then refused while the
    // writer emitted it unchanged.
    const numberProto = Number.prototype as unknown as Record<string, unknown>;
    let calls = 0;
    Object.defineProperty(numberProto, "toJSON", {
      value() {
        calls += 1;
        return "hooked";
      },
      writable: true,
      configurable: true,
    });
    try {
      const document = { formatVersion: 1, kind: "page", nodes: [] };
      // The precondition: the writer really does ignore it.
      expect(JSON.stringify(document)).toBe(
        '{"formatVersion":1,"kind":"page","nodes":[]}'
      );
      const before = calls;

      const survey = measureBytes(document, Number.MAX_SAFE_INTEGER);

      expect(calls).toBe(before);
      expect(survey.exceeded).toBe(false);
      expect(survey.bytes).toBe(realBytes(document));
    } finally {
      delete numberProto.toJSON;
    }
  });

  it("enforces the limits it validated, not the ones re-read later", () => {
    // Validating a bound and then re-reading it through the walk lets an
    // accessor answer once for the check and differently afterwards, so the
    // quota verified is not the quota enforced.
    let reads = 0;
    const limits = {
      get maxBytes() {
        reads += 1;
        return reads === 1 ? 100 : Number.MAX_SAFE_INTEGER;
      },
      maxDepth: 12,
      maxNodes: 5000,
    };

    const survey = surveyDocument({ a: "x".repeat(10_000) }, limits);

    // The bound that passed validation was 100, so that is the one that must
    // decide the verdict.
    expect(survey.tooLarge).toBe(true);
  });

  it("runs a structural member's toJSON exactly once", () => {
    // Keeping the ORIGINAL for structural counting must not also mean re-running
    // the hook on it. Marking the pushed value unnormalized did exactly that:
    // the hook ran a second time, with the root key `""` instead of the member
    // key the writer passes, and the replacement was then discarded anyway — so
    // a document serializing to 3,105 bytes surveyed as 96 under a 1,000-byte
    // cap.
    let calls = 0;
    const keys: string[] = [];
    const node = {
      id: "root",
      type: "core/section",
      version: 1,
      props: { pad: "x".repeat(3000) },
      toJSON(key: string) {
        calls += 1;
        keys.push(key);
        return { id: "root", type: "core/section", version: 1, props: {} };
      },
    };

    surveyDocument(
      { formatVersion: 1, kind: "page", nodes: [node] },
      { maxBytes: 1000, maxDepth: 12, maxNodes: 5000 }
    );

    expect(calls).toBe(1);
    // The writer passes the member key, never the root key, for a nested value.
    expect(keys).toEqual(["0"]);
  });

  it("counts a node's own subtree, not its toJSON replacement's", () => {
    // The same rule one level down, where the substitution is on a member
    // rather than the root.
    const children = Array.from({ length: 5001 }, (_, index) => ({
      id: `c${index}`,
      type: "core/text",
      version: 1,
      props: {},
    }));
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "root",
          type: "core/section",
          version: 1,
          props: {},
          slots: { children },
          toJSON: () => ({
            id: "root",
            type: "core/section",
            version: 1,
            props: {},
          }),
        },
      ],
    };

    const survey = surveyDocument(document, {
      maxBytes: Number.MAX_SAFE_INTEGER,
      maxDepth: 12,
      maxNodes: 5000,
    });

    expect(survey.tooManyNodes).toBe(true);
    expect(survey.unserializable).toBe(true);
  });

  it("reads a toJSON hook once, as the writer does", () => {
    // `JSON.stringify` retrieves the property once and calls what it got.
    // Reading it twice — once to type-test, once to invoke — lets an accessor
    // return a different function each time, so the hook that is MEASURED is
    // not the hook that RUNS.
    // The FIRST read returns the large serializer, later reads an empty one,
    // which is the direction that matters: a walk reading twice type-tests the
    // large hook and then invokes the small one, measuring far less than the
    // writer emits. The reverse ordering would over-count, which is safe.
    //
    // `bytes` cannot be compared against `JSON.stringify` here, because the
    // writer's own read would be a THIRD one and would see the empty hook. The
    // read count and the measured size are the two halves instead.
    let reads = 0;
    const value = {
      get toJSON() {
        reads += 1;
        const payload = reads === 1 ? "x".repeat(2000) : "";
        return () => payload;
      },
    };

    const survey = measureBytes(
      pageWith({ a: value }),
      Number.MAX_SAFE_INTEGER
    );

    expect(reads).toBe(1);
    expect(survey.bytes).toBeGreaterThan(2000);
  });

  it("does not run a hidden record property's toJSON", () => {
    // `JSON.stringify` skips a non-enumerable property without reading its
    // value, so its hook never runs. Normalizing before checking enumerability
    // executed document-supplied code the serializer would never reach, which
    // turns a hidden property into a way to run something expensive or stateful
    // inside a precondition.
    let invoked = 0;
    const props: Record<string, unknown> = { visible: 1 };
    Object.defineProperty(props, "hidden", {
      value: {
        toJSON() {
          invoked += 1;
          return "ran";
        },
      },
      enumerable: false,
      writable: true,
      configurable: true,
    });

    const survey = measureBytes(pageWith(props), Number.MAX_SAFE_INTEGER);

    expect(invoked).toBe(0);
    // Still refused: the schema's direct read would see a field storage drops.
    expect(survey.exceeded && survey.reason === "unwritable").toBe(true);
  });

  it("refuses an over-long array without enumerating its keys", () => {
    // Brackets and commas alone are not the floor. Every position costs at
    // least one more byte, so an array can pass a bracket-and-comma check and
    // still be impossible to store — and the walk used to enumerate one string
    // per position before finding that out, which turned a document too large
    // to accept into hundreds of megabytes of keys.
    //
    // The counters are what separate the implementations, because every version
    // returns `tooLarge`: only the cost differs.
    //
    // `descriptors` is the sharper of the two. A walk that accepts the array
    // and discovers the overflow one position at a time reads a descriptor per
    // element; one that rejects it from `length` reads exactly the one that
    // told it the length.
    //
    // `ownKeys` covers the other half, which is memory rather than work: one
    // call is the symbol check every object pays, and a second would be a key
    // list built for an array that cannot be stored. Measured at two million
    // positions, that list moved resident memory from 94 MB to 366 MB.
    let descriptors = 0;
    let ownKeys = 0;
    const watched = new Proxy(new Array(1000).fill(0), {
      getOwnPropertyDescriptor(target, key) {
        descriptors += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      ownKeys(target) {
        ownKeys += 1;
        return Reflect.ownKeys(target);
      },
    });

    // Chosen so the brackets and commas (1001) fit the budget and the positions
    // (1000 more) cannot. A bound that only counted the separators would walk
    // on.
    const survey = surveyDocument(watched, {
      maxBytes: 1500,
      maxDepth: 12,
      maxNodes: 5000,
    });

    expect(survey.tooLarge).toBe(true);
    expect(descriptors).toBe(1);
    expect(ownKeys).toBe(1);
  });

  it("refuses an array carrying a property JSON would drop", () => {
    // The array reads back from the caller's own value with `extra` on it and
    // returns from storage without it. Nothing throws and the size is right,
    // so the byte count cannot be what reports this.
    const document = pageWith({ a: withExtra() });
    const survey = measureBytes(document, Number.MAX_SAFE_INTEGER);

    expect(survey.bytes).toBe(realBytes(document));
    expect(survey.exceeded && survey.reason === "unwritable").toBe(true);

    // The control: the same array without the extra property is accepted, so
    // the refusal is of the property rather than of arrays in general.
    expect(unwritable(pageWith({ a: [1, 2] }))).toBe(false);
  });

  it("does not read an INHERITED name as a property the array carries", () => {
    // The scan for dropped properties uses `for...in`, which walks the
    // prototype chain. An inherited name is not something the array holds:
    // JSON ignores it either way, so reporting it refused every document in a
    // process where anything had put an enumerable property on
    // `Object.prototype` — which a library doing so makes true for the whole
    // process, not for the document.
    const polluted = Object.prototype as unknown as Record<string, unknown>;
    polluted.customCss = ".from-prototype{}";
    try {
      const document = pageWith({ a: [1, 2] });
      // The precondition: the name really is visible through the chain, so a
      // pass here is the own-ness filter working rather than the pollution
      // failing to take effect.
      expect("customCss" in ([1, 2] as unknown as object)).toBe(true);

      expect(unwritable(document)).toBe(false);
    } finally {
      delete polluted.customCss;
    }
  });

  it("treats a name that merely looks like an index as a dropped property", () => {
    // `JSON.stringify` emits positions 0..length-1 and nothing else, so these
    // are properties it discards — and each converts to a number, which is why
    // a numeric test rather than a canonical one would have admitted them.
    for (const name of ["01", "1e1", " 1", "-0", "1.0", "4294967296"]) {
      const array: unknown[] = [1, 2];
      Object.defineProperty(array, name, {
        value: "dropped",
        enumerable: true,
        writable: true,
        configurable: true,
      });
      const survey = measureBytes(
        pageWith({ a: array }),
        Number.MAX_SAFE_INTEGER
      );
      expect(survey.exceeded && survey.reason === "unwritable", name).toBe(
        true
      );
      expect(survey.bytes, name).toBe(realBytes(pageWith({ a: array })));
    }
  });

  it("stops at the limit instead of measuring the whole input", () => {
    // A lower bound is all `bytes` promises once `exceeded` is set; what
    // matters is that it stopped, which is the property the cap buys.
    const huge = pageWith({ a: "x".repeat(5_000_000) });
    const result = measureBytes(huge, 1024);
    expect(result.exceeded).toBe(true);
    expect(result.bytes).toBeLessThan(5_000_000);
  });

  it("terminates on a cycle independently of the byte limit", () => {
    // `JSON.stringify` throws here. The walk is a precondition for parsing
    // untrusted input, so it has to report rather than crash the caller.
    //
    // The earlier version terminated because the cycle drove the byte count
    // past the cap, which is termination by accident: a cyclic document of
    // small values under a large cap would have run forever. Termination now
    // comes from the repeated reference itself, so this asserts `unserializable`
    // rather than `exceeded` — and deliberately uses a limit the document never
    // approaches, which the previous implementation could not have survived.
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const document = pageWith(cyclic);

    expect(() => measureBytes(document, 10_000_000)).not.toThrow();
    const result = measureBytes(document, 10_000_000);
    expect(result.exceeded && result.reason === "unwritable").toBe(true);
  });

  it("counts a repeated subtree once per occurrence", () => {
    // A shared reference is legal JSON: the serializer DUPLICATES the subtree.
    // Counting it once undercounts by exactly the copy storage will add, which
    // is how a document over the cap can measure under it.
    const shared = { text: "x".repeat(1000) };
    const document = pageWith({ a: shared, b: shared });

    expect(measureBytes(document, Number.MAX_SAFE_INTEGER).bytes).toBe(
      realBytes(document)
    );
    expect(unwritable(document)).toBe(false);
  });

  it("refuses an accessor without invoking it", () => {
    // A getter's return value is not what storage holds, and running it to find
    // that out is the risk itself: it is caller-supplied code reached while
    // checking input that is untrusted by definition. The descriptor says a
    // property is an accessor without evaluating anything.
    let invoked = 0;
    const hostile: Record<string, unknown> = { ok: 1 };
    Object.defineProperty(hostile, "computed", {
      enumerable: true,
      get() {
        invoked += 1;
        return "x".repeat(100_000);
      },
    });

    expect(unwritable(hostile, 2 * 1024 * 1024)).toBe(true);
    expect(invoked).toBe(0);
  });

  it("asks for one member at a time, records and arrays alike", () => {
    // Counts DESCRIPTOR requests, which is the operation the walk performs.
    // An earlier version of this counted `get` traps and stayed green for a
    // walk that enumerated every member first, because the reader never
    // triggers `get` at all — a control that measured an operation its subject
    // does not use.
    //
    // Asking for a member runs the container's own code, so a descriptor trap
    // can fabricate a fresh object per request. Enumerating a whole container
    // before measuring anything therefore materializes all of it under a cap
    // meant to refuse exactly that.
    const probe = (size: number) => {
      let descriptors = 0;
      const target: Record<string, unknown> = {};
      for (let index = 0; index < size; index += 1) target[`k${index}`] = index;
      const observed = new Proxy(target, {
        getOwnPropertyDescriptor(t, key) {
          descriptors += 1;
          return {
            configurable: true,
            enumerable: true,
            value: { big: "x".repeat(100_000) },
          };
        },
      });
      const result = measureBytes({ items: observed }, 2 * 1024 * 1024);
      return { descriptors, exceeded: result.exceeded };
    };

    const record = probe(1_000);
    expect(record.exceeded).toBe(true);
    // 2 MiB / 100 KB is about 21 members. An eager pass asks for all 1,000.
    expect(record.descriptors).toBeLessThan(200);

    let elements = 0;
    const backing = Array.from({ length: 1_000 }, () => 0);
    const observedArray = new Proxy(backing, {
      getOwnPropertyDescriptor(t, key) {
        // `length` must answer truthfully, or the walk refuses the array
        // before it iterates and this fixture never reaches the loop it is
        // testing — a control satisfied by the subject declining to run.
        if (typeof key !== "string" || !/^[0-9]+$/.test(key)) {
          return Reflect.getOwnPropertyDescriptor(t, key);
        }
        elements += 1;
        return {
          configurable: true,
          enumerable: true,
          value: { big: "x".repeat(100_000) },
        };
      },
    });
    expect(
      measureBytes({ items: observedArray }, 2 * 1024 * 1024).exceeded
    ).toBe(true);
    expect(elements).toBeLessThan(200);
  });

  it("refuses an indexed accessor without invoking it", () => {
    // The array counterpart of the object case. Both go through one reader, so
    // a guard cannot hold on one path and not the other — which is why the
    // reader exists rather than two matching checks.
    let invoked = 0;
    const array: unknown[] = [1];
    Object.defineProperty(array, "0", {
      enumerable: true,
      configurable: true,
      get() {
        invoked += 1;
        return "x".repeat(100_000);
      },
    });

    expect(unwritable({ items: array }, 2 * 1024 * 1024)).toBe(true);
    expect(invoked).toBe(0);
  });

  it("survives a hostile prototype lookup", () => {
    // `Object.getPrototypeOf` runs a proxy's trap, which is caller-supplied
    // code. A walk that is a precondition for parsing untrusted input must
    // report rather than let the exception escape.
    const hostile = new Proxy(
      { a: 1 },
      {
        getPrototypeOf() {
          throw new Error("trap");
        },
      }
    );

    expect(() => measureBytes({ nested: hostile }, 1024)).not.toThrow();
    expect(unwritable({ nested: hostile }, 1024)).toBe(true);
  });

  it("counts own properties only", () => {
    // The walk uses `for...in`, which reaches the prototype chain. An inherited
    // property is not serialized, so counting one would overstate the size and
    // could refuse a document that fits.
    const parent = { inherited: "x".repeat(1000) };
    const child = Object.create(parent) as Record<string, unknown>;
    child.own = 1;
    expect(measureBytes(child, Number.MAX_SAFE_INTEGER).bytes).toBe(
      realBytes(child)
    );
  });
});
