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

  it("does not gate on a conditions field that is not a list", () => {
    // Persisted data reaches this compiler whether or not anything validated it.
    const { gated } = compile(
      page([
        node({
          visibility: { conditions: "vip" },
          styles: styles({ color: "red" }),
        }),
      ])
    );

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
