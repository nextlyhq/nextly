/**
 * Node-local rules held out of the sheet when the node can be pruned at read time.
 *
 * A page's stylesheet is compiled when the document is SAVED; a condition is decided when the
 * page is READ. One pre-compiled string therefore carries rules for nodes a reader will remove,
 * and any `url(...)` inside them, publishing the assets of a block whose markup is withheld.
 *
 * The alternative a reader is left with otherwise is withholding the whole sheet, which makes one
 * conditioned node render an entire page unstyled.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, NodeStyles } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";

const styles = (values: Record<string, unknown>): NodeStyles =>
  ({ base: { base: values } }) as unknown as NodeStyles;

const node = (extra: Record<string, unknown>, id = "n1") => ({
  id,
  type: "core/box",
  version: 1,
  props: {},
  ...extra,
});

const page = (nodes: unknown[]) =>
  ({ formatVersion: 1, kind: "page", nodes }) as unknown as BlockDocument;

const compile = (
  document: BlockDocument,
  blockBases: Record<string, NodeStyles> = {}
) =>
  compilePageCss(document, {
    breakpoints: FIXTURE_BREAKPOINTS,
    namedClasses: [],
    blockBases,
  } as never);

/** A node gated on an entry field, which is what a reader prunes. */
const conditioned = (extra: Record<string, unknown>, id = "n1") =>
  node(
    {
      visibility: { conditions: [[{ field: "tier", op: "eq", value: "vip" }]] },
      ...extra,
    },
    id
  );

describe("a node the reader may prune", () => {
  it("keeps its own rules out of the sheet", () => {
    const { css, gated } = compile(
      page([conditioned({ styles: styles({ color: "red" }) })])
    );

    // The leak this exists to stop: a colour, or the URL beside it, published for a block the
    // reader will not render.
    expect(css).not.toContain("color: red");
    expect(gated?.n1).toContain("color: red");
  });

  it("leaves its block type's base rules in the sheet", () => {
    // Those come from the block definition, not from anything an author gated, and an
    // unconditional node of the same type needs them.
    const { css, gated } = compile(
      page([conditioned({ styles: styles({ color: "red" }) }), node({}, "n2")]),
      { "core/box": styles({ color: "green" }) }
    );

    expect(css).toContain("color: green");
    expect(gated?.n1).not.toContain("color: green");
  });

  it("does not affect a node beside it", () => {
    const { css, gated } = compile(
      page([
        conditioned({ styles: styles({ color: "red" }) }),
        node({ styles: styles({ color: "blue" }) }, "n2"),
      ])
    );

    expect(css).toContain("color: blue");
    expect(css).not.toContain("color: red");
    expect(Object.keys(gated ?? {})).toEqual(["n1"]);
  });
});

describe("what counts as gated", () => {
  it("does not gate a node that only hides per breakpoint", () => {
    // `devices` is presentation on a node that IS served; conditions decide whether it is served
    // at all. Conflating them would hold back rules a reader always needs.
    const { css, gated } = compile(
      page([
        node({
          visibility: { devices: { tablet: false } },
          styles: styles({ color: "red" }),
        }),
      ])
    );

    expect(gated).toBeUndefined();
    expect(css).toContain("color: red");
  });

  it("does not gate on an empty condition list, which declares nothing", () => {
    const { gated } = compile(
      page([
        node({
          visibility: { conditions: [] },
          styles: styles({ color: "red" }),
        }),
      ])
    );

    expect(gated).toBeUndefined();
  });

  it("GATES on a conditions field that is not a list", () => {
    // Persisted data reaches this compiler whether or not anything validated it, and an
    // unreadable restriction is still an author restricting the node. Leaving its rules in the
    // sheet publishes the colour — and any `url(...)` beside it — for a block the renderer
    // withholds, which is the leak the gate exists to prevent.
    const { css, gated } = compile(
      page([
        node({
          visibility: { conditions: "vip" },
          styles: styles({ color: "red" }),
        }),
      ])
    );

    expect(css).not.toContain("color: red");
    expect(gated?.n1).toContain("color: red");
  });

  it.each([
    ["conditions is an object", { conditions: {} }],
    ["the envelope is a string", "hidden"],
    ["the envelope is an array", ["tier"]],
  ])("gates when %s", (_label, visibility) => {
    // Each of these answers `undefined` to a property read for `conditions`, so a predicate that
    // read the field without first checking the envelope resolved them to "no gate" — the one
    // answer a shape neither side can understand must never produce.
    const { css, gated } = compile(
      page([node({ visibility, styles: styles({ color: "red" }) })])
    );

    expect(css).not.toContain("color: red");
    expect(gated?.n1).toContain("color: red");
  });

  it("does not gate when conditions is explicitly null", () => {
    // A positive control for the rows above: `null` is a readable absence, not an unreadable
    // shape, so it must stay ungated. Without it the block above would pass just as well against
    // a predicate that gated everything it was handed.
    const { css, gated } = compile(
      page([
        node({
          visibility: { conditions: null },
          styles: styles({ color: "red" }),
        }),
      ])
    );

    expect(css).toContain("color: red");
    expect(gated).toBeUndefined();
  });
});

describe("a document that gates nothing", () => {
  it("omits the field rather than returning an empty object", () => {
    // So a caller cannot read "this document gates nothing" as "this compiler does not gate".
    const compiled = compile(
      page([node({ styles: styles({ color: "red" }) })])
    );

    expect(compiled.gated).toBeUndefined();
    expect("gated" in compiled).toBe(false);
  });
});

describe("appending a gated entry to the sheet", () => {
  it("reproduces exactly the sheet the node would have had", () => {
    // What a reader does: take `css`, append the entries whose nodes survived. The result has to
    // be what an ungated compile of the same document produces, byte for byte — which is also
    // the determinism guarantee for every document that gates nothing.
    const gatedRun = compile(
      page([conditioned({ styles: styles({ color: "red" }) })])
    );
    const ungated = compile(page([node({ styles: styles({ color: "red" }) })]));

    const reassembled = [gatedRun.css, gatedRun.gated?.n1 ?? ""]
      .filter(part => part !== "")
      .join("\n");

    expect(reassembled).toBe(ungated.css);
  });

  describe("agrees with the renderer about what an empty group means", () => {
    // Storage is an OR of ANDs. An AND of nothing is satisfied, so ONE empty group satisfies the
    // whole OR whatever the other groups hold — the renderer's `isUnconditional` ends in
    // `groups.some(g => g.length === 0)`. A compiler that counts groups instead of looking inside
    // them holds back the rules of a node the renderer serves to everyone, and the page renders
    // that node unstyled with nothing reporting it.
    const PRED = { field: "tier", op: "eq", value: "vip" };
    const OTHER = { field: "status", op: "eq", value: "on" };

    const compileWith = (conditions: unknown) =>
      compile(
        page([
          node({
            visibility: { conditions },
            styles: styles({ color: "red" }),
          }),
        ])
      );

    it.each([
      ["no groups at all", [], true],
      ["one empty group", [[]], true],
      // The row that separates SOME from ALL: under "gated unless ALL groups are empty" this
      // node is gated by the compiler and shown by the renderer, which is the original defect
      // wearing a different shape. It is the only row here that an ALL implementation fails.
      ["an empty group beside a real one", [[], [PRED]], true],
      ["two real groups", [[PRED], [OTHER]], false],
      ["one real group", [[PRED]], false],
    ])(
      "%s: rules stay in the sheet = %s",
      (_label, conditions, staysInSheet) => {
        const { css, gated } = compileWith(conditions);

        expect(css.includes("color: red")).toBe(staysInSheet);
        expect(gated?.n1 === undefined).toBe(staysInSheet);
      }
    );
  });

  it("carries its own at-rule, so an entry can be appended on its own", () => {
    // Serialized separately, a narrow-breakpoint rule has to open its own `@media` — a reader
    // appends the entry without having read what came before it.
    const { gated } = compile(
      page([
        conditioned({
          styles: {
            base: { tablet: { color: "red" } },
          } as unknown as NodeStyles,
        }),
      ])
    );

    expect(gated?.n1).toContain("@media");
    expect(gated?.n1).toContain("color: red");
  });
});

describe("a node under a gated ancestor", () => {
  const conditions = [[{ field: "tier", op: "eq", value: "vip" }]];

  const nested = (parentConditioned: boolean) =>
    page([
      {
        ...node({
          styles: styles({ color: "red" }),
          slots: {
            default: [node({ styles: styles({ color: "blue" }) }, "child")],
          },
        }),
        ...(parentConditioned ? { visibility: { conditions } } : {}),
      },
    ]);

  it("POSITIVE CONTROL: an unconditioned parent leaves both in the sheet", () => {
    // Without this row the assertions below would pass against a compiler that emitted no
    // descendant rules at all, which is the way this exact measurement first went wrong.
    const { css, gated } = compile(nested(false));

    expect(css).toContain("color: red");
    expect(css).toContain("color: blue");
    expect(gated).toBeUndefined();
  });

  it("holds the DESCENDANT's rules out of the sheet too", () => {
    // A reader prunes whole subtrees: a conditioned container takes its children with it. Judging
    // each node by its own conditions leaves the child's rules — and any `url(...)` in them — in a
    // sheet served to everyone while the child's markup is withheld.
    const { css, gated } = compile(nested(true));

    expect(css).not.toContain("color: red");
    expect(css).not.toContain("color: blue");
    expect(gated?.n1).toContain("color: red");
    expect(gated?.child).toContain("color: blue");
  });
});

describe("a node id that collides with an object's own prototype", () => {
  it("still gets its own entry", () => {
    // A node id is author data and `__proto__` is a legal one. Assigning it on an ordinary object
    // runs the inherited setter instead of creating an own property, so the entry vanishes,
    // `Object.keys` stays empty, and the field is omitted as though the page gated nothing — a
    // reader then treats a fresh artifact as one compiled before the split and withholds the WHOLE
    // sheet, so every visible sibling loses its styling too.
    const { css, gated } = compile(
      page([
        node(
          {
            visibility: {
              conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
            },
            styles: styles({ color: "red" }),
          },
          "__proto__"
        ),
        node({ styles: styles({ color: "blue" }) }, "sibling"),
      ])
    );

    expect(Object.keys(gated ?? {})).toEqual(["__proto__"]);
    expect(gated?.["__proto__"]).toContain("color: red");
    expect(css).not.toContain("color: red");
    // The sibling is unaffected, which is what the omitted field would have cost it.
    expect(css).toContain("color: blue");
  });
});

describe("the trace of a document that gates a node", () => {
  const traced = (document: BlockDocument) =>
    compilePageCss(document, {
      breakpoints: FIXTURE_BREAKPOINTS,
      namedClasses: [],
      blockBases: {},
      trace: true,
    } as never);

  it("records only what the returned sheet contains", () => {
    // The trace is the record of the cascade a reader received. A gated node's declarations leave
    // `css`, so leaving them in the trace would describe declarations the browser never got — and
    // at an interleaved position the separately appended entry does not occupy either.
    const { css, trace } = traced(
      page([
        conditioned({ styles: styles({ color: "red" }) }),
        node({ styles: styles({ color: "blue" }) }, "n2"),
      ])
    );

    const traced_ = JSON.stringify(trace ?? []);
    // Positive control: the surviving node IS traced, so an empty trace cannot pass this.
    expect(traced_).toContain("blue");
    expect(css).toContain("color: blue");
    expect(traced_).not.toContain("red");
  });
});
