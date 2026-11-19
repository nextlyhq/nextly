import {
  DEFAULT_LIMITS,
  MAX_TOKEN_NAME_LENGTH,
  resolveSiteTokens,
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
  propertyKeysAnywhere,
  usageKeysOf,
  variablesAsked,
  variablesUsing,
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

  it("counts a variable a container names only as its own content width", () => {
    const section = {
      ...box("a"),
      type: "core/section",
      props: { contained: true, contentWidth: ref("content.wide") },
    };
    const usage = tokenUsageOf(doc([section, box("b")]), DEFAULT_LIMITS);
    expect(usage.ids).toEqual(["content.wide"]);
    expect(Object.fromEntries(usage.blocks)).toEqual({ "content.wide": 1 });
  });

  it("counts a container's own width once beside the same variable in its styles", () => {
    const section = {
      ...box("a", at({ maxWidth: ref("content.wide") })),
      props: { contentWidth: ref("content.wide") },
    };
    const usage = tokenUsageOf(doc([section]), DEFAULT_LIMITS);
    expect(Object.fromEntries(usage.blocks)).toEqual({ "content.wide": 1 });
  });

  it("CONTROL: a typed content width names no variable", () => {
    const section = { ...box("a"), props: { contentWidth: "1400px" } };
    expect(tokenUsageOf(doc([section]), DEFAULT_LIMITS).ids).toEqual([]);
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
        usage: { ids: [], properties: [], complete: true, blocks: new Map() },
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

    const using = sharedStylesUsing(
      classes,
      variablesAsked(["color.brand"], undefined)
    );

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
    const using = blockDefaultsUsing(
      blocks,
      variablesAsked(["color.brand", "x"], undefined)
    );
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
      variablesAsked(["color.ink", "space.md"], undefined)
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
        variablesAsked([long], undefined)
      ).size
    ).toBe(0);
  });
});

/** A shadow naming a colour through `var()`, as the shadow builder writes one. */
const shadowOf = (property: string) => `0 1px 2px var(${property})`;

describe("a variable named in CSS text, through var()", () => {
  it("records a block's shadow property apart from the $token identities", () => {
    const stored = doc(
      [
        box("a", at({ boxShadow: shadowOf("--site-color-ink") })),
        box("b", at({ color: ref("color.brand") })),
      ],
      { styles: at({ boxShadow: shadowOf("--site-color-page") }) }
    );
    const usage = tokenUsageOf(stored, DEFAULT_LIMITS);
    // `ids` is what a write naming a variable the site lacks is judged by, so
    // a `var()` never reaches it.
    expect(usage.ids).toEqual(["color.brand"]);
    expect(usage.properties).toEqual(["--site-color-ink", "--site-color-page"]);
  });

  it("finds a var() in a structured value and inside a fallback, read decoded", () => {
    const stored = doc([
      box(
        "a",
        at({
          border: { color: "var(--site-a, var(--site-colo\\72))" },
          boxShadow: "0 0 1px v\\61 r(--site-b)",
        })
      ),
    ]);
    expect(tokenUsageOf(stored, DEFAULT_LIMITS).properties).toEqual([
      "--site-a",
      "--site-b",
      "--site-color",
    ]);
  });

  it("records no property a site variable could never be written under", () => {
    const stored = doc([
      box(
        "a",
        at({
          // Capitals, an underscore, a name past every prefix and identity.
          boxShadow: `var(--Site-ink), var(--site_ink), var(--${"x".repeat(400)})`,
        })
      ),
    ]);
    expect(tokenUsageOf(stored, DEFAULT_LIMITS).properties).toEqual([]);
  });

  it("indexes each property under its own key, disjoint from every identity", () => {
    const rows = tokenUsageIndex.derive(
      doc([
        box(
          "a",
          at({
            boxShadow: shadowOf("--site-color-ink"),
            // A stored `$token` spelled like a property's key is no identity
            // a site can define, so it is no row: the two kinds stay apart.
            color: ref("var:--site-color-page"),
            margin: ref("space.4"),
          })
        ),
      ]),
      DEFAULT_LIMITS
    );
    expect(rows).toEqual({
      ids: ["space.4", "var:--site-color-ink"],
      complete: true,
    });
    expect(usageKeysOf({ ids: ["a"], properties: ["--b"] })).toEqual([
      "a",
      "var:--b",
    ]);
  });

  it("asks for each identity and the property the site writes it under", () => {
    expect(variablesAsked(["color.ink", "t-accent"], undefined).keys).toEqual([
      "color.ink",
      "var:--site-color-ink",
      "t-accent",
      "var:--site-t-accent",
    ]);
    // A site's own prefix, and a refused one, which writes under the default.
    expect(variablesAsked(["color.ink"], "--brand-").keys).toEqual([
      "color.ink",
      "var:--brand-color-ink",
    ]);
    expect(variablesAsked(["color.ink"], "--nx-").keys).toEqual([
      "color.ink",
      "var:--site-color-ink",
    ]);
  });

  it("answers both identities a property is written under, and only those", () => {
    // `color.ink-dark` and `color-ink.dark` both write `--site-color-ink-dark`.
    const asked = variablesAsked(
      ["color.ink-dark", "color-ink.dark", "color.ink"],
      undefined
    );
    expect([...asked.identitiesIn(["var:--site-color-ink-dark"])]).toEqual([
      "color.ink-dark",
      "color-ink.dark",
    ]);
    expect([...asked.identitiesIn(["color.ink"])]).toEqual(["color.ink"]);
    expect([...asked.identitiesIn(["var:--site-color-other"])]).toEqual([]);
  });

  it("counts a shared style whose shadow names a colour, under the site's prefix", () => {
    const classes = [
      {
        id: "c-lifted",
        slug: "lifted",
        label: "Lifted",
        styles: at({ boxShadow: shadowOf("--brand-color-ink") }),
      },
    ];
    expect(
      Object.fromEntries(
        sharedStylesUsing(classes, variablesAsked(["color.ink"], "--brand-"))
      )
    ).toEqual({ "color.ink": [{ id: "c-lifted", name: "Lifted" }] });
    // The control: under the default prefix, that property is no colour's.
    expect(
      sharedStylesUsing(classes, variablesAsked(["color.ink"], undefined)).size
    ).toBe(0);
  });

  it("counts a block type whose default shadow names a colour", () => {
    const using = blockDefaultsUsing(
      [
        {
          name: "acme/card",
          baseStyles: at({ boxShadow: shadowOf("--site-color-ink") }),
        },
        { name: "acme/plain", baseStyles: at({ boxShadow: shadowOf("--x") }) },
      ],
      variablesAsked(["color.ink"], undefined)
    );
    expect(Object.fromEntries(using)).toEqual({
      "color.ink": [{ type: "acme/card", label: "Card" }],
    });
  });

  it("counts a shadow variable whose value names a colour, but not itself", () => {
    const tokens = resolveSiteTokens({
      tokens: [
        {
          name: "color.ink",
          kind: "color",
          values: { light: "#111111" },
        },
        {
          id: "t-lift",
          name: "shadow.lift",
          label: "Lift",
          kind: "shadow",
          values: {
            light: shadowOf("--site-color-ink"),
            dark: shadowOf("--site-t-lift"),
          },
        },
      ],
    });
    const using = variablesUsing(
      tokens,
      variablesAsked(["color.ink", "t-lift"], undefined)
    );
    expect(Object.fromEntries(using)).toEqual({
      "color.ink": [{ id: "t-lift", name: "Lift" }],
    });
  });

  it("finds a property in any string a stored value holds, stored JSON included", () => {
    const deep: Record<string, unknown> = { text: shadowOf("--site-deep") };
    let nested = deep;
    // Deeper than any recursive walk would survive.
    for (let level = 0; level < 20_000; level += 1) nested = { inner: nested };
    expect(
      [
        ...propertyKeysAnywhere([
          { content: JSON.stringify({ a: shadowOf("--site-in-json") }) },
          ["plain", shadowOf("--site-in-list"), 42, null],
          nested,
          shadowOf("--Not-a-site-one"),
        ]),
      ].sort()
    ).toEqual(["var:--site-deep", "var:--site-in-json", "var:--site-in-list"]);
  });
});
