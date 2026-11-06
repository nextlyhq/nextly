import {
  DEFAULT_LIMITS,
  MAX_TOKEN_NAME_LENGTH,
  tokenNamingProblem,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { deriveUsageRows, reconcileUsage } from "./class-usage-reconcile";
import {
  blockDefaultsUsing,
  sharedStylesUsing,
  tokenUsageIndex,
  tokenUsageOf,
  UNDETERMINED_TOKEN_ID,
} from "./token-usage";

const box = (id: string, styles?: unknown, children?: unknown[]) => ({
  id,
  type: "core/box",
  version: 1,
  props: {},
  ...(styles === undefined ? {} : { styles }),
  ...(children === undefined ? {} : { slots: { children } }),
});
const doc = (nodes: unknown[], settings?: unknown) => ({
  formatVersion: 1,
  kind: "page",
  nodes,
  ...(settings === undefined ? {} : { settings }),
});
const at = (values: Record<string, unknown>) => ({ base: { base: values } });
const ref = (identity: string) => ({ $token: identity });

describe("which variables a stored document uses", () => {
  it("names each variable once, counting the blocks that use it", () => {
    const stored = doc([
      box("a", at({ color: ref("color.brand") })),
      box("b", { hover: { base: { color: ref("color.brand") } } }, [
        box("c", at({ padding: ref("space.4"), margin: ref("space.4") })),
      ]),
    ]);

    const usage = tokenUsageOf(stored, DEFAULT_LIMITS);

    expect({
      ids: usage.ids,
      complete: usage.complete,
      blocks: Object.fromEntries(usage.blocks),
    }).toEqual({
      ids: ["color.brand", "space.4"],
      complete: true,
      // One block counts once however many of its values name the variable.
      blocks: { "color.brand": 2, "space.4": 1 },
    });
  });

  it("reads a reference nested inside a structured value", () => {
    const stored = doc([
      box(
        "a",
        at({
          border: { width: "1px", color: ref("color.line") },
          boxShadow: { offset: { x: ref("space.1") } },
        })
      ),
    ]);

    expect(tokenUsageOf(stored, DEFAULT_LIMITS).ids).toEqual([
      "color.line",
      "space.1",
    ]);
  });

  it("reads the document's own settings.styles, which belong to no block", () => {
    const stored = doc([box("a")], {
      styles: at({ background: ref("color.ground") }),
    });

    const usage = tokenUsageOf(stored, DEFAULT_LIMITS);

    expect({ ids: usage.ids, blocks: usage.blocks.size }).toEqual({
      ids: ["color.ground"],
      blocks: 0,
    });
  });

  it("reads a document stored as JSON text", () => {
    const stored = JSON.stringify(doc([box("a", at({ color: ref("c.x") }))]));

    expect(tokenUsageOf(stored, DEFAULT_LIMITS).ids).toEqual(["c.x"]);
  });

  it("says it could NOT read a document past the node cap", () => {
    // Both halves together: `ids: []` alone is also what a document using no
    // variable answers, and the flag is what tells the two apart.
    const stored = doc([
      ...Array.from({ length: 6 }, (_, i) => box(`n${i}`)),
      box("late", at({ color: ref("color.brand") })),
    ]);

    const usage = tokenUsageOf(stored, { ...DEFAULT_LIMITS, maxNodes: 5 });

    expect({ ids: usage.ids, complete: usage.complete }).toEqual({
      ids: [],
      complete: false,
    });
  });

  it("records no reference longer than any identity the engine writes", () => {
    const long = "a".repeat(MAX_TOKEN_NAME_LENGTH + 1);
    const stored = doc([
      box("a", at({ color: ref(long), margin: ref(UNDETERMINED_TOKEN_ID) })),
      box("b", at({ color: ref("a".repeat(MAX_TOKEN_NAME_LENGTH)) })),
    ]);

    expect(tokenUsageOf(stored, DEFAULT_LIMITS).ids).toEqual([
      "a".repeat(MAX_TOKEN_NAME_LENGTH),
    ]);
  });

  it("treats a value that is not a document as using nothing, readably", () => {
    for (const stored of [undefined, null, 42, "not json", {}, doc([])]) {
      expect({ stored, usage: tokenUsageOf(stored, DEFAULT_LIMITS) }).toEqual({
        stored,
        usage: { ids: [], complete: true, blocks: new Map() },
      });
    }
  });
});

describe("the marker a document that cannot be read whole is recorded by", () => {
  const subject = {
    scope: "collection" as const,
    entity: "pages",
    entityKey: "p1",
    field: "content",
    locale: "",
    variant: "published" as const,
  };

  it("is an identity the engine refuses to write", () => {
    expect(
      tokenNamingProblem({ name: "x", id: UNDETERMINED_TOKEN_ID })
    ).toEqual(expect.objectContaining({ field: "id" }));
  });

  it("stands in for the whole document when the read is cut short", () => {
    const stored = doc([
      ...Array.from({ length: 6 }, (_, i) => box(`n${i}`)),
      box("late", at({ color: ref("color.brand") })),
    ]);

    const derived = deriveUsageRows(tokenUsageIndex, subject, stored, {
      ...DEFAULT_LIMITS,
      maxNodes: 5,
    });

    expect(derived).toEqual({
      complete: false,
      undetermined: { ...subject, tokenId: UNDETERMINED_TOKEN_ID },
    });
    expect(tokenUsageIndex.isMarker(tokenUsageIndex.markerFor(subject))).toBe(
      true
    );
    expect(
      tokenUsageIndex.isMarker(tokenUsageIndex.rowFor(subject, "color.brand"))
    ).toBe(false);
  });

  it("reconciles a document's rows by the identity they record", () => {
    const stored = [
      { ...tokenUsageIndex.rowFor(subject, "color.old"), id: "r1" },
      { ...tokenUsageIndex.rowFor(subject, "color.brand"), id: "r2" },
    ];
    const derived = [
      tokenUsageIndex.rowFor(subject, "color.brand"),
      tokenUsageIndex.rowFor(subject, "space.4"),
    ];

    const { insert, remove } = reconcileUsage(
      tokenUsageIndex,
      subject,
      derived,
      stored
    );

    expect({ inserted: insert.map(row => row.tokenId), remove }).toEqual({
      inserted: ["space.4"],
      remove: ["r1"],
    });
  });

  it("asks the database for references by the identity column alone", () => {
    expect({
      one: tokenUsageIndex.whereReferencing("color.brand"),
      many: tokenUsageIndex.whereReferencingAny(["a", "b"]),
      marker: tokenUsageIndex.whereUndetermined(),
      readBack: tokenUsageIndex.readOwn({ tokenId: "color.brand" }),
      unreadable: tokenUsageIndex.readOwn({ tokenId: 7 }),
    }).toEqual({
      one: { tokenId: { equals: "color.brand" } },
      many: { tokenId: { in: ["a", "b"] } },
      marker: { tokenId: { equals: UNDETERMINED_TOKEN_ID } },
      readBack: { tokenId: "color.brand" },
      unreadable: null,
    });
  });
});

describe("which shared styles use a variable", () => {
  it("names each style whose own styles reference it, applied or not", () => {
    const classes = [
      {
        id: "c-card",
        slug: "card",
        label: "Card",
        styles: at({ color: ref("color.brand") }),
      },
      {
        id: "c-hero",
        slug: "hero",
        styles: at({ border: { color: ref("color.brand") } }),
      },
      { id: "c-plain", slug: "plain", styles: at({ color: "#000" }) },
      {
        id: "c-other",
        slug: "other",
        styles: at({ color: ref("color.other") }),
      },
      "not an entry",
    ];

    const using = sharedStylesUsing(classes, new Set(["color.brand"]));

    expect(Object.fromEntries(using)).toEqual({
      "color.brand": [
        { id: "c-card", name: "Card" },
        { id: "c-hero", name: "hero" },
      ],
    });
  });
});

describe("the block types whose own default styles name a variable", () => {
  it("finds a reference in a structured value under any state, by type order, named by the editor's label", () => {
    const blocks = [
      {
        name: "acme/card",
        baseStyles: {
          hover: { md: { boxShadow: { color: { $token: "color.brand" } } } },
        },
      },
      {
        name: "acme/button",
        editor: { label: "Call to action" },
        baseStyles: at({ color: { $token: "color.brand" } }),
      },
      { name: "acme/plain", baseStyles: at({ color: "#fff" }) },
      { name: "acme/bare" },
    ];
    const using = blockDefaultsUsing(blocks, new Set(["color.brand", "x"]));
    expect(using.get("color.brand")).toEqual([
      { type: "acme/button", label: "Call to action" },
      { type: "acme/card", label: "Card" },
    ]);
    // Only the identities asked about, and none no block names.
    expect([...using.keys()]).toEqual(["color.brand"]);
  });

  it("finds a reference in a part's default styles and in the child gap, which the compiler writes too", () => {
    const using = blockDefaultsUsing(
      [
        {
          name: "acme/figure",
          parts: {
            caption: { baseStyles: at({ color: { $token: "color.ink" } }) },
            broken: null,
          },
        },
        { name: "acme/stack", childGap: { $token: "space.md" } },
        // The controls: a literal gap, and a part with no default styles.
        { name: "acme/row", childGap: "1rem", parts: { cell: {} } },
      ],
      new Set(["color.ink", "space.md"])
    );
    expect(using.get("color.ink")).toEqual([
      { type: "acme/figure", label: "Figure" },
    ]);
    expect(using.get("space.md")).toEqual([
      { type: "acme/stack", label: "Stack" },
    ]);
  });

  it("skips a reference too long to name a variable, as every other walk does", () => {
    const long = "t".repeat(MAX_TOKEN_NAME_LENGTH + 1);
    expect(
      blockDefaultsUsing(
        [{ name: "acme/x", baseStyles: at({ color: { $token: long } }) }],
        new Set([long])
      ).size
    ).toBe(0);
  });
});
