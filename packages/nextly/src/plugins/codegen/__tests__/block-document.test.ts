import { readFileSync } from "node:fs";

import {
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  MAX_NODES,
  RESERVED_OPERATION_NAMES,
  STYLE_STATES,
  isReservedOperationName,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { blockDocumentJsonSchema, parseBlockDocument } from "../block-document";

/**
 * Run `body` with `fields` reachable through `Object.prototype`.
 *
 * The only way to give an ordinary object an inherited property while leaving
 * it a plain record. Putting the fields on an intermediate prototype changes
 * the object's own prototype, and the survey refuses that as a non-record
 * before the ownership rule is ever asked — so a fixture built that way passes
 * whether or not the rule exists.
 *
 * Non-enumerable, so nothing else that enumerates a plain object during the
 * run sees them, and removed in `finally` so a failing assertion cannot leave
 * the pollution behind for the rest of the file.
 */
function withPrototypeFields(
  fields: Record<string, unknown>,
  body: () => void
): void {
  for (const [key, value] of Object.entries(fields)) {
    Object.defineProperty(Object.prototype, key, {
      value,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  try {
    body();
  } finally {
    for (const key of Object.keys(fields)) {
      delete (Object.prototype as Record<string, unknown>)[key];
    }
  }
}

/** The smallest document the format allows: a page with nothing on it. */
function emptyPage() {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes: [] };
}

/** A node nested inside a slot, so recursion is exercised rather than assumed. */
function nestedPage() {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "outer",
        type: "core/section",
        version: 1,
        props: {},
        slots: {
          default: [
            {
              id: "inner",
              type: "core/text",
              version: 1,
              props: { text: "hi" },
            },
          ],
        },
      },
    ],
  };
}

describe("block document schema", () => {
  it("accepts a document nested through a slot", () => {
    // The recursion is the part a hand-written schema gets wrong, so the
    // fixture nests rather than testing a flat page and inferring the rest.
    expect(parseBlockDocument(nestedPage()).success).toBe(true);
  });

  it("accepts every kind the engine declares", () => {
    // Iterated from the engine's own list: a test naming the kinds would pass
    // unchanged after one was added, which is the case it exists to catch.
    for (const kind of DOCUMENT_KINDS) {
      expect(
        parseBlockDocument({ ...emptyPage(), kind }).success,
        `kind "${kind}" should be accepted`
      ).toBe(true);
    }
  });

  it("accepts every style state the engine declares", () => {
    for (const state of STYLE_STATES) {
      const doc = {
        ...emptyPage(),
        nodes: [
          {
            id: "a",
            type: "core/text",
            version: 1,
            props: {},
            styles: { [state]: { base: { color: "red" } } },
          },
        ],
      };
      expect(
        parseBlockDocument(doc).success,
        `state "${state}" should be accepted`
      ).toBe(true);
    }
  });

  it("rejects a kind outside the closed vocabulary", () => {
    expect(parseBlockDocument({ ...emptyPage(), kind: "layout" }).success).toBe(
      false
    );
  });

  it("rejects a format version it was not written for", () => {
    // The field exists so a reader can tell whether it understands the file.
    // Accepting an unknown version would answer that question wrongly.
    expect(
      parseBlockDocument({ ...emptyPage(), formatVersion: 2 }).success
    ).toBe(false);
  });

  it("requires a version on every node", () => {
    const doc = {
      ...emptyPage(),
      nodes: [{ id: "a", type: "core/text", props: {} }],
    };
    expect(parseBlockDocument(doc).success).toBe(false);
  });

  it("requires sourceKey when a binding reads a single", () => {
    const withKey = {
      ...emptyPage(),
      nodes: [
        {
          id: "a",
          type: "core/text",
          version: 1,
          props: {},
          bindings: {
            text: { $bind: "title", source: "single", sourceKey: "hero" },
          },
        },
      ],
    };
    const withoutKey = {
      ...emptyPage(),
      nodes: [
        {
          id: "a",
          type: "core/text",
          version: 1,
          props: {},
          bindings: { text: { $bind: "title", source: "single" } },
        },
      ],
    };
    expect(parseBlockDocument(withKey).success).toBe(true);
    // A single addressed by nothing resolves to nothing at read time; failing
    // here names the document, which is the only place the slug can be fixed.
    expect(parseBlockDocument(withoutKey).success).toBe(false);
  });

  it("refuses sourceKey on a source that has no single to name", () => {
    // Refused rather than stripped. An object schema drops what it does not
    // declare, so the permissive version would parse this, return a document
    // with the key quietly gone, and hand the caller a value the engine
    // rejects — two answers to one question, with the sanitizing one hiding
    // the disagreement.
    const doc = {
      ...emptyPage(),
      nodes: [
        {
          id: "a",
          type: "core/text",
          version: 1,
          props: {},
          bindings: {
            text: { $bind: "title", source: "entry", sourceKey: "hero" },
          },
        },
      ],
    };
    const result = parseBlockDocument(doc);
    expect(result.success).toBe(false);
  });

  it("keeps a token reference intact instead of tidying it", () => {
    // A token-shaped value carrying an extra key is invalid, and the engine
    // says so. Modelling the token shape here made this branch match first and
    // return a clean reference, repairing the document on its way past and
    // taking the engine's diagnostic with it.
    const doc = {
      ...emptyPage(),
      nodes: [
        {
          id: "a",
          type: "core/text",
          version: 1,
          props: {},
          styles: {
            base: { base: { color: { $token: "brand.primary", extra: true } } },
          },
        },
      ],
    };
    const result = parseBlockDocument(doc);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const styles = result.data.nodes[0]!.styles as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(styles.base!.base!.color).toEqual({
      $token: "brand.primary",
      extra: true,
    });
  });

  it("preserves a field it does not know about", () => {
    // The format is additive-open: a new optional field needs no migration, so
    // an older release meeting one must hand it back rather than drop it. The
    // default object behaviour strips silently, which would lose
    // forward-compatible data in any validate-then-save flow.
    const doc = {
      ...emptyPage(),
      nodes: [
        {
          id: "a",
          type: "core/text",
          version: 1,
          props: {},
          fieldFromALaterRelease: "keep me",
        },
      ],
    };
    const result = parseBlockDocument(doc);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(
      (result.data.nodes[0] as unknown as Record<string, unknown>)
        .fieldFromALaterRelease
    ).toBe("keep me");
  });

  it("preserves later-release fields inside a binding and its format", () => {
    // The same additive-open guarantee, asserted at the deepest point the
    // format nests rather than at the top. A field added to a later release can
    // arrive anywhere, and an object that strips it two levels down loses it as
    // completely as one that strips it at the root — while a test that only
    // looks at the node would report the guarantee intact.
    const doc = {
      ...emptyPage(),
      nodes: [
        {
          id: "a",
          type: "core/text",
          version: 1,
          props: {},
          bindings: {
            title: {
              $bind: "title",
              source: "entry",
              future: "keep me",
              format: { type: "currency", currency: "USD", futureOpt: "also" },
            },
          },
        },
      ],
    };

    const result = parseBlockDocument(doc);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const binding = (
      result.data.nodes[0] as unknown as {
        bindings: Record<string, Record<string, unknown>>;
      }
    ).bindings.title!;
    expect(binding.future).toBe("keep me");
    expect((binding.format as Record<string, unknown>).futureOpt).toBe("also");
  });

  it("still refuses a sourceKey the format does not allow there", () => {
    // The companion to the test above, and the reason opening these objects is
    // not simply "accept everything". `sourceKey` is DECLARED as never on this
    // branch, so it is refused rather than passed through: an open object
    // carries what it does not know about, not what it knows is wrong.
    const doc = {
      ...emptyPage(),
      nodes: [
        {
          id: "a",
          type: "core/text",
          version: 1,
          props: {},
          bindings: { title: { $bind: "t", source: "entry", sourceKey: "x" } },
        },
      ],
    };
    expect(parseBlockDocument(doc).success).toBe(false);
  });

  it("rejects a document wider than the node cap without parsing it", () => {
    // A shallow document can still be enormous, and the depth bound does not
    // see it: a flat array of nodes never nests, so it passed the guard and
    // `safeParse` then walked and CLONED the whole forest before succeeding.
    // The cap has to be applied to the count, before the parse.
    const doc = {
      ...emptyPage(),
      nodes: Array.from({ length: MAX_NODES + 1 }, (_unused, index) => ({
        id: `n${index}`,
        type: "core/text",
        version: 1,
        props: {},
      })),
    };

    const result = parseBlockDocument(doc);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.join(" ")).toContain("more nodes");
  });

  it("counts nodes nested in slots toward the same cap", () => {
    // The positive control for the walk rather than for the cap. Counting only
    // the top-level array would pass this test's fixture at every size, so a
    // document whose bulk lives in slots would be bounded by nothing — and the
    // check above could not tell the difference.
    const branching = (depth: number): Record<string, unknown> => ({
      id: `n${depth}`,
      type: "core/text",
      version: 1,
      props: {},
      slots:
        depth === 0
          ? undefined
          : {
              children: Array.from({ length: 80 }, () => branching(depth - 1)),
            },
    });

    // 1 + 80 + 6400 per root, over 3 roots: past the cap, nested, and well
    // inside the depth limit so this can only fail on the count.
    const doc = { ...emptyPage(), nodes: [0, 1, 2].map(() => branching(2)) };

    const result = parseBlockDocument(doc);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.join(" ")).toContain("more nodes");
  });

  it("keeps prototype-named prop keys exactly as JSON produced them", () => {
    // `JSON.parse` creates `__proto__` and `constructor` as ordinary own
    // properties, and a block may legitimately name a prop either. Rebuilding a
    // record cannot represent the first — assigning that key sets a prototype
    // instead of creating a property — and rejects the second, so both are
    // checked in place and handed back untouched.
    const doc = JSON.parse(
      '{"formatVersion":1,"kind":"page","nodes":[{"id":"a","type":"core/text","version":1,"props":{"__proto__":{"polluted":true},"constructor":"c","ok":1}}]}'
    ) as unknown;

    const result = parseBlockDocument(doc);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const props = result.data.nodes[0]!.props;
    expect(Object.getOwnPropertyNames(props).sort()).toEqual([
      "__proto__",
      "constructor",
      "ok",
    ]);
    // The own key is data, not a prototype assignment: nothing leaked onto
    // Object.prototype on the way through.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects a document that serializes past the byte cap", () => {
    // Neither tree bound sees this: one node, no nesting, and a props record
    // large enough that parsing it is the expensive act. Size is the only
    // property that separates it from a legal document.
    const props: Record<string, string> = {};
    for (let index = 0; index < 60_000; index += 1) {
      props[`k${index}`] = "x".repeat(40);
    }
    const doc = {
      ...emptyPage(),
      nodes: [{ id: "a", type: "core/text", version: 1, props }],
    };

    const result = parseBlockDocument(doc);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.join(" ")).toContain("serializes to more");
  });

  it("reports a value it cannot serialize rather than throwing", () => {
    // A cycle is not JSON and cannot have come from a stored document, so the
    // caller has passed something this entry point exists to refuse. Letting
    // the serializer throw would crash the process doing the checking.
    const cyclic: Record<string, unknown> = { id: "a" };
    cyclic.self = cyclic;
    const doc = {
      ...emptyPage(),
      nodes: [{ id: "a", type: "core/text", version: 1, props: cyclic }],
    };

    expect(() => parseBlockDocument(doc)).not.toThrow();
    expect(parseBlockDocument(doc).success).toBe(false);
  });

  it("refuses a value JSON cannot represent, however deeply nested", () => {
    // A plain record holding a BigInt satisfies every structural check and then
    // throws on the way to storage. A nested Date or Map is worse than a throw:
    // it becomes a string or `{}` silently, so the document read back is not
    // the one that was validated.
    const cases: Array<[string, unknown]> = [
      ["a BigInt", 1n],
      ["a function", () => undefined],
      ["a symbol", Symbol("s")],
      ["a Date", new Date()],
      ["a Map", new Map()],
      // These three are not throws but silent REWRITES, which is the worse
      // half: JSON omits an undefined property and writes null for a non-finite
      // number, so the stored document differs from the one that validated.
      ["undefined", undefined],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      // Finite, and still rewritten: JSON writes `-0` as `0`, so the number
      // read back is a different number and nothing reports the change.
      ["negative zero", -0],
    ];

    for (const [label, offending] of cases) {
      const doc = {
        ...emptyPage(),
        nodes: [
          {
            id: "a",
            type: "core/text",
            version: 1,
            props: { nested: { deeper: offending } },
          },
        ],
      };
      const result = parseBlockDocument(doc);
      expect(result.success, `${label} should be refused`).toBe(false);
    }
  });

  it("refuses a node whose required fields are inherited", () => {
    // The schema reads properties directly, so an inherited value satisfies it,
    // while `JSON.stringify` writes only own properties and the survey walks
    // only own names. Without this the three disagree: the node parses, and
    // storage receives `{}`.
    //
    // Supplied from `Object.prototype` rather than from an intermediate object,
    // and that is the whole fixture. A node built on a custom prototype is
    // refused by the survey before the ownership rule is consulted — its
    // prototype is neither `Object.prototype` nor null, so it is not a plain
    // record — which means the assertion below would hold with the rule deleted.
    withPrototypeFields(
      { id: "a", type: "core/text", version: 1, props: {} },
      () => {
        const node = {};
        // The precondition, asserted rather than assumed: the values really do
        // resolve, so the refusal is of inheritance and not of an empty node.
        expect((node as { id?: string }).id).toBe("a");

        const doc = { ...emptyPage(), nodes: [node] };
        expect(parseBlockDocument(doc).success).toBe(false);
      }
    );
  });

  it("refuses a node whose OPTIONAL field is inherited", () => {
    // The same defect wearing an optional field's clothes, and listing the
    // required names could not see it: `name` is not required, so nothing
    // demanded it be owned, while the parsed value reads back `"inherited"` and
    // storage receives a node with no name at all.
    withPrototypeFields({ name: "inherited" }, () => {
      const node = { id: "a", type: "core/text", version: 1, props: {} };
      expect((node as { name?: string }).name).toBe("inherited");

      const doc = { ...emptyPage(), nodes: [node] };
      expect(parseBlockDocument(doc).success).toBe(false);
    });
  });

  it("refuses an inherited field belonging to a NESTED shape", () => {
    // `$bind` is declared by the binding schema, not by the node or the
    // envelope. A check that named those two shapes covered the fields it could
    // see and left every nested one open: a binding of `{}` parsed, read back
    // `$bind` through the prototype, and persisted as `{}`.
    //
    // This is the reason the field set is derived from the published JSON
    // Schema rather than listed — the list was complete for the shapes whoever
    // wrote it happened to think of.
    withPrototypeFields({ $bind: "title" }, () => {
      const node = {
        id: "a",
        type: "core/text",
        version: 1,
        props: {},
        bindings: { text: {} },
      };
      expect((node.bindings.text as { $bind?: string }).$bind).toBe("title");

      const doc = { ...emptyPage(), nodes: [node] };
      expect(parseBlockDocument(doc).success).toBe(false);
    });
  });

  it("says nothing about an optional field that is simply absent", () => {
    // The separating control. A rule phrased over DECLARED fields rather than
    // resolved ones would refuse every node that omits an optional field, which
    // is nearly all of them.
    const doc = {
      ...emptyPage(),
      nodes: [{ id: "a", type: "core/text", version: 1, props: {} }],
    };
    expect(Object.hasOwn(doc.nodes[0]!, "name")).toBe(false);
    expect(parseBlockDocument(doc).success).toBe(true);
  });

  it("still accepts a node that owns its fields", () => {
    // The control. A check that refused every node would satisfy the assertion
    // above while rejecting every real document.
    const doc = {
      ...emptyPage(),
      nodes: [{ id: "a", type: "core/text", version: 1, props: {} }],
    };
    expect(parseBlockDocument(doc).success).toBe(true);
  });

  it("refuses a sparse node array instead of walking past its holes", () => {
    // A hole is not an absent child, it is a malformed document. `map`
    // preserves holes, so the walk would pop `undefined`, treat it as an
    // ordinary non-object and continue — reporting a document valid whose node
    // list has gaps in it.
    const sparse: unknown[] = [];
    sparse[3] = { id: "a", type: "core/text", version: 1, props: {} };
    const doc = { ...emptyPage(), nodes: sparse };

    expect(parseBlockDocument(doc).success).toBe(false);
  });

  it("refuses a prototype-named key on the closed style-state axis", () => {
    // The opposite consequence to an unknown key on an OPEN record. A style
    // state axis is closed, so `__proto__` is not a state the format permits —
    // dropping it silently reports the document valid while it still carries a
    // key the engine rejects.
    const doc = JSON.parse(
      '{"formatVersion":1,"kind":"page","nodes":[{"id":"a","type":"core/text","version":1,"props":{},"styles":{"__proto__":{"base":{"color":"red"}}}}]}'
    ) as unknown;

    expect(parseBlockDocument(doc).success).toBe(false);
  });

  it("still accepts every state the engine declares", () => {
    // The positive control for the check above: a closed-key check that refused
    // everything would pass that test while breaking every real document.
    for (const state of STYLE_STATES) {
      const doc = {
        ...emptyPage(),
        nodes: [
          {
            id: "a",
            type: "core/text",
            version: 1,
            props: {},
            styles: { [state]: { base: { color: "red" } } },
          },
        ],
      };
      expect(parseBlockDocument(doc).success, state).toBe(true);
    }
  });

  it("accepts a node version above the definition registration cap", () => {
    // That cap bounds what a block DEFINITION may declare at registration. A
    // stored node written by a newer definition is a case the engine handles
    // deliberately, so refusing it here would be a false rejection of a
    // document the engine accepts.
    const doc = {
      ...emptyPage(),
      nodes: [{ id: "a", type: "core/text", version: 9999, props: {} }],
    };
    expect(parseBlockDocument(doc).success).toBe(true);
  });

  it("reports a document nested past the limit instead of crashing", () => {
    // The schema is self-referential, so a long enough slot chain walks the
    // call stack and raises RangeError before any validation runs. This entry
    // point exists for documents produced elsewhere, so that input is hostile
    // by assumption and must come back as invalid, not as a dead process.
    let node: Record<string, unknown> = {
      id: "leaf",
      type: "core/text",
      version: 1,
      props: {},
    };
    for (let i = 0; i < 5000; i += 1) {
      node = {
        id: `n${i}`,
        type: "core/section",
        version: 1,
        props: {},
        slots: { default: [node] },
      };
    }

    const result = parseBlockDocument({ ...emptyPage(), nodes: [node] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.join(" ")).toContain("nests deeper");
  });

  it("leaves unknown style properties alone", () => {
    // The property catalog is additive-open, so a schema that enumerated
    // today's properties would refuse documents the moment the catalog grew.
    const doc = {
      ...emptyPage(),
      nodes: [
        {
          id: "a",
          type: "core/text",
          version: 1,
          props: {},
          styles: { base: { base: { somePropertyAddedLater: "8px" } } },
        },
      ],
    };
    expect(parseBlockDocument(doc).success).toBe(true);
  });
});

describe("the frozen contract", () => {
  it("matches the committed schema exactly", () => {
    // The compile-time assertions pin which FIELDS exist. They cannot see a
    // field whose type or requiredness changed while its name stayed — which
    // is the change that silently reinterprets every stored document, because
    // the type, the schema, the validator and the fixtures can all move
    // together and stay self-consistent.
    //
    // The committed schema is the outside reference that cannot move with
    // them. It is a file rather than an inline snapshot on purpose: a format
    // change then appears in the diff as an explicit edit to the format,
    // where the decision about a `formatVersion` bump and a migration has to be
    // made rather than assumed.
    //
    // If this fails, the format changed. Regenerate the fixture ONLY after
    // deciding that the change is compatible, or that it comes with a version
    // bump. Updating it to make the test pass is the one response that turns
    // this from a control into a formality.
    const committed = JSON.parse(
      readFileSync(
        new URL("./__fixtures__/block-document.schema.json", import.meta.url),
        "utf8"
      )
    ) as Record<string, unknown>;

    expect(blockDocumentJsonSchema()).toEqual(committed);
  });

  it("reserves the operation names the format spec publishes", () => {
    // Read from the engine rather than listed here: a copy in the test would
    // agree on the day it was written and then certify whichever list stopped
    // being maintained.
    expect([...RESERVED_OPERATION_NAMES]).toEqual([
      "saveAsPattern",
      "saveAsComponent",
      "convertToComponent",
      "detachComponent",
    ]);
    expect(isReservedOperationName("saveAsPattern")).toBe(true);
    expect(isReservedOperationName("insert")).toBe(false);
  });

  it("documents every reserved name in the format spec", () => {
    // A reservation nobody can look up is not a reservation. The spec page is
    // the only place an outside implementer meets these names, so a name added
    // to the engine and not to the page would be reserved in private.
    const spec = readFileSync(
      new URL(
        "../../../../../../docs/api-reference/block-document-format.mdx",
        import.meta.url
      ),
      "utf8"
    );
    for (const name of RESERVED_OPERATION_NAMES) {
      expect(spec, `"${name}" should appear in the format spec`).toContain(
        name
      );
    }
  });
});

describe("published JSON schema", () => {
  it("describes the recursive node shape by reference", () => {
    // A schema that unrolled the recursion would describe a fixed depth and
    // silently refuse anything deeper, so the $ref is the assertion.
    const schema = blockDocumentJsonSchema();
    expect(JSON.stringify(schema)).toContain("$ref");
  });

  it("carries the closed vocabularies it was derived from", () => {
    const text = JSON.stringify(blockDocumentJsonSchema());
    for (const kind of DOCUMENT_KINDS) {
      expect(
        text,
        `kind "${kind}" should reach the published schema`
      ).toContain(`"${kind}"`);
    }
  });
});
