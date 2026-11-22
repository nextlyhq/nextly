/**
 * A block's own CSS class names: the text an author writes, each name judged on
 * its own, refused on save with the name and the reason, carried by the op
 * layer and by every path that copies a block.
 */
import { describe, expect, it } from "vitest";

import {
  checkCssClassNames,
  cssClassNameRefusal,
  renderedCssClassNames,
} from "./css-class-names";
import {
  planConvertToComponent,
  planInsertPattern,
  planSaveAsPattern,
} from "./composition-planners";
import { DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode } from "./document";
import { applyOps } from "./ops";
import { patternDigest } from "./pattern-digest";
import { resolveComponentInstances } from "./resolve-instances";
import { duplicateNode, reidSubtree } from "./tree";
import { validate } from "./validation";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const section = (extra: Partial<BlockNode> = {}): BlockNode => ({
  id: "s",
  type: "core/section",
  version: 1,
  props: { as: "section" },
  ...extra,
});

const anyParent = { parentsOf: () => undefined };

describe("one class name", () => {
  it.each([
    ["promo"],
    ["hero-dark"],
    ["_private"],
    ["-webkit-ish"],
    ["--custom"],
    ["Card2"],
    ["\u00e9t\u00e9"],
    ["nxt-thing"],
    ["box-nx-"],
  ])("accepts %s", name => {
    expect(cssClassNameRefusal(name)).toBeUndefined();
  });

  it.each([
    ["2col", "starts-with-digit", '"2col" starts with a digit'],
    ["-2col", "starts-with-digit", '"-2col" starts with a hyphen and a digit'],
    [".x", "starts-with-dot", '".x" starts with "."'],
    ["#hero", "starts-with-hash", '"#hero" starts with "#"'],
    ["nx-box", "reserved-prefix", '"nx-box" starts with "nx-"'],
    ["NX-Box", "reserved-prefix", '"NX-Box" starts with "nx-"'],
    ["a/b", "invalid-character", '"a/b" holds "/"'],
    ["a.b", "invalid-character", '"a.b" holds "."'],
    ["w:50%", "invalid-character", '"w:50%" holds ":"'],
    [
      "a\u00a0b",
      "invalid-character",
      '"a\u00a0b" holds an invisible character (U+00A0)',
    ],
    ["a\u00d7b", "invalid-character", '"a\u00d7b" holds "\u00d7"'],
    ["-", "only-hyphen", '"-" is only a hyphen'],
  ])("refuses %s (%s), naming it", (name, problem, words) => {
    const refusal = cssClassNameRefusal(name);
    expect(refusal?.problem).toBe(problem);
    expect(refusal?.name).toBe(name);
    expect(refusal?.reason.startsWith(words)).toBe(true);
  });

  it("says why in words an author can act on", () => {
    expect(cssClassNameRefusal("nx-box")?.reason).toBe(
      '"nx-box" starts with "nx-", which Nextly keeps for its own classes.'
    );
    expect(cssClassNameRefusal(".x")?.reason).toBe(
      '".x" starts with ".": write the name without it.'
    );
  });
});

describe("the text of a block's classes", () => {
  it("keeps the valid names beside the refused ones, in order", () => {
    const checked = checkCssClassNames("2col  promo\t.x nx-box\nok");
    expect(checked.valid).toEqual(["promo", "ok"]);
    expect(checked.refused.map(entry => entry.name)).toEqual([
      "2col",
      ".x",
      "nx-box",
    ]);
  });

  it("holds no names when it is empty or only spaces", () => {
    expect(checkCssClassNames("")).toEqual({ valid: [], refused: [] });
    expect(checkCssClassNames("  \n ")).toEqual({ valid: [], refused: [] });
  });

  it("renders only the valid names of a stored value, and nothing for a non-string", () => {
    expect(renderedCssClassNames("promo 2col hero-dark")).toEqual([
      "promo",
      "hero-dark",
    ]);
    expect(renderedCssClassNames(undefined)).toEqual([]);
    expect(renderedCssClassNames(["promo"])).toEqual([]);
    expect(renderedCssClassNames(5)).toEqual([]);
  });
});

describe("validation of a node's cssClasses", () => {
  const issuesOf = (cssClasses: unknown, mode: "strict" | "forgiving") =>
    validate(page([section({ cssClasses } as Partial<BlockNode>)]), {
      mode,
      breakpoints: FIXTURE_BREAKPOINTS,
    });

  it.each(["strict", "forgiving"] as const)(
    "accepts valid names in %s mode",
    mode => {
      expect(issuesOf("promo hero-dark", mode)).toEqual([]);
      expect(issuesOf("", mode)).toEqual([]);
    }
  );

  it.each(["strict", "forgiving"] as const)(
    "refuses invalid names in %s mode with an error naming each one",
    mode => {
      const issues = issuesOf("2col .x nx-box ok", mode);
      expect(issues).toHaveLength(1);
      const [issue] = issues;
      expect(issue).toMatchObject({
        path: "/nodes/0/cssClasses",
        code: "invalid-css-classes",
        severity: "error",
      });
      expect(issue!.message).toContain('"2col" starts with a digit');
      expect(issue!.message).toContain('".x" starts with "."');
      expect(issue!.message).toContain('"nx-box" starts with "nx-"');
      expect(issue!.message).not.toContain('"ok"');
    }
  );

  it("refuses a value that is not text", () => {
    expect(issuesOf(["promo"], "forgiving")).toMatchObject([
      {
        path: "/nodes/0/cssClasses",
        code: "invalid-css-classes",
        severity: "error",
      },
    ]);
  });

  it("names a bounded number of refused names, saying how many more", () => {
    const many = Array.from({ length: 30 }, (_, i) => `${i}x`).join(" ");
    const [issue] = issuesOf(many, "strict");
    expect(issue!.message).toContain('"0x"');
    expect(issue!.message).not.toContain('"29x"');
    expect(issue!.message).toContain("And 25 more");
  });

  it("leaves a document written before the field valid and unchanged", () => {
    const before = page([section({ name: "Hero", cssId: "hero" })]);
    const copy = structuredClone(before);
    expect(
      validate(copy, { mode: "strict", breakpoints: FIXTURE_BREAKPOINTS })
    ).toEqual([]);
    expect(copy).toEqual(before);
    expect(copy.nodes[0]).not.toHaveProperty("cssClasses");
  });
});

describe("the op layer", () => {
  it("sets the field by an update and clears it by unsetting it", () => {
    const set = applyOps(page([section()]), [
      { kind: "update", id: "s", patch: { cssClasses: "promo hero-dark" } },
    ]).document;
    expect(set.nodes[0]!.cssClasses).toBe("promo hero-dark");

    const cleared = applyOps(set, [
      { kind: "update", id: "s", patch: {}, unset: ["cssClasses"] },
    ]).document;
    expect(cleared.nodes[0]).not.toHaveProperty("cssClasses");
  });

  it("undoes setting it", () => {
    const result = applyOps(page([section()]), [
      { kind: "update", id: "s", patch: { cssClasses: "promo" } },
    ]);
    const undone = applyOps(result.document, result.inverses).document;
    expect(undone.nodes[0]).not.toHaveProperty("cssClasses");
  });

  it("refuses an update that sets it to anything but text", () => {
    expect(() =>
      applyOps(page([section()]), [
        {
          kind: "update",
          id: "s",
          patch: { cssClasses: ["promo"] } as unknown as BlockNode,
        },
      ])
    ).toThrow();
  });
});

describe("every path that copies a block carries its classes", () => {
  const classed = section({ cssClasses: "promo hero-dark" });

  it("a duplicate", () => {
    const after = duplicateNode([classed], "s");
    expect(after).toHaveLength(2);
    expect(after[1]!.id).not.toBe("s");
    expect(after[1]!.cssClasses).toBe("promo hero-dark");
  });

  it("a copy given new ids", () => {
    expect(reidSubtree(classed).cssClasses).toBe("promo hero-dark");
  });

  it("a saved section, and the copy inserted from it", () => {
    const saved = planSaveAsPattern(
      page([classed]),
      ["s"],
      { collection: "patterns", fields: { title: "Hero", slug: "hero" } },
      anyParent
    ).create?.document as BlockDocument;
    expect(saved.nodes[0]!.cssClasses).toBe("promo hero-dark");

    const insert = planInsertPattern(
      page([]),
      { id: "hero-pattern", document: saved },
      { index: 0 },
      anyParent
    );
    const placed = (insert.pageOps ?? []).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    expect(placed).toHaveLength(1);
    expect(placed[0]!.cssClasses).toBe("promo hero-dark");
  });

  it("a saved section's digest, so a class change reads as a change", () => {
    expect(patternDigest([classed])).not.toBe(patternDigest([section()]));
    expect(patternDigest([section()])).toBe(
      patternDigest([structuredClone(section())])
    );
  });

  it("a component made from the block, and each placement drawn from it", () => {
    const plan = planConvertToComponent(
      page([classed]),
      ["s"],
      { collection: "components", fields: { title: "Hero", slug: "hero" } },
      "def-1",
      {},
      anyParent
    );
    const definition = plan.create?.document as BlockDocument;
    expect(definition.nodes[0]!.cssClasses).toBe("promo hero-dark");

    const placedPage = applyOps(page([classed]), plan.pageOps ?? []).document;
    const resolved = resolveComponentInstances(placedPage, {
      has: id => id === "def-1",
      get: id => (id === "def-1" ? definition : undefined),
    });
    expect(resolved.document.nodes[0]!.cssClasses).toBe("promo hero-dark");
  });
});
