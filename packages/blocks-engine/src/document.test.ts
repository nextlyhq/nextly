import { describe, expect, it } from "vitest";

import * as entry from "./index";

import type { BlockDocument, BlockNode } from "./document";
import { renderedDomId, renderedDomIdIn } from "./document";
import {
  COMPONENT_INSTANCE_TYPE,
  isBlockOrigin,
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  isComponentInstance,
  isTokenRef,
} from "./document";
import {
  DEFAULT_MAX_DOCUMENT_BYTES,
  LIMIT_WARNING_RATIO,
  MAX_DEPTH,
  MAX_NODES,
  documentBytes,
} from "./limits";
import { makeNode } from "./tree";

describe("document constants", () => {
  it("pins the format version and the closed kind enum", () => {
    expect(DOCUMENT_FORMAT_VERSION).toBe(1);
    expect(DOCUMENT_KINDS).toEqual([
      "page",
      "pattern",
      "component",
      "region",
      "template",
    ]);
  });

  it("pins the limits the format spec documents", () => {
    expect(MAX_DEPTH).toBe(12);
    expect(MAX_NODES).toBe(5000);
    expect(DEFAULT_MAX_DOCUMENT_BYTES).toBe(2 * 1024 * 1024);
    expect(LIMIT_WARNING_RATIO).toBe(0.8);
  });
});

describe("guards", () => {
  it("isTokenRef accepts only { $token: string }", () => {
    expect(isTokenRef({ $token: "color.primary" })).toBe(true);
    expect(isTokenRef({ token: "color.primary" })).toBe(false);
    expect(isTokenRef("var(--x)")).toBe(false);
    expect(isTokenRef(null)).toBe(false);
    expect(isTokenRef({ $token: 3 })).toBe(false);
  });

  it("isComponentInstance keys on the reserved node type", () => {
    const instance = makeNode(COMPONENT_INSTANCE_TYPE, 1, {
      componentId: "cmp-1",
    });
    expect(isComponentInstance(instance)).toBe(true);
    expect(isComponentInstance(makeNode("core/heading", 1))).toBe(false);
  });
});

describe("JSON round-trip", () => {
  it("a full document survives serialize → parse structurally unchanged", () => {
    // Exercises every envelope feature at once: bindings, styles on both
    // states, breakpoint-keyed values, token refs, visibility, slots.
    const doc: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          ...makeNode(
            "core/section",
            2,
            {},
            {
              children: [
                {
                  ...makeNode("core/heading", 1, { text: "Fallback title" }),
                  bindings: {
                    text: {
                      $bind: "title",
                      source: "entry",
                      fallback: "Untitled",
                      format: { type: "date", options: { dateStyle: "long" } },
                    },
                    // A single-sourced binding names which single via sourceKey.
                    subtitle: {
                      $bind: "tagline",
                      source: "single",
                      sourceKey: "site-settings",
                    },
                  },
                  styles: {
                    base: { base: { color: { $token: "color.text" } } },
                    hover: { base: { color: "#ff0000" } },
                  },
                  visibility: {
                    conditions: [[{ field: "status", op: "eq", value: "vip" }]],
                    devices: { mobile: false },
                  },
                  name: "Hero heading",
                },
              ],
            }
          ),
          classes: ["cls_hero"],
          locked: true,
        },
      ],
      settings: { customCss: ".page { scroll-behavior: smooth; }" },
      assets: { mediaIds: ["media-1"] },
    };

    const parsed = JSON.parse(JSON.stringify(doc)) as BlockDocument;
    expect(parsed).toEqual(doc);
    expect(documentBytes(doc)).toBeGreaterThan(0);
    expect(documentBytes(doc)).toBeLessThan(DEFAULT_MAX_DOCUMENT_BYTES);
  });

  it("documentBytes measures UTF-8 bytes, not string length", () => {
    const ascii: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [makeNode("core/text", 1, { text: "aaaa" })],
    };
    const cjk: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [makeNode("core/text", 1, { text: "字字字字" })],
    };
    // Same JSON string length per character, but CJK is 3 UTF-8 bytes each.
    expect(documentBytes(cjk)).toBeGreaterThan(documentBytes(ascii));
  });
});

describe("the bounds a writer must honour are reachable from the entry", () => {
  // Every one of these SILENTLY discards stored input past its limit: a class
  // over `MAX_NAMED_CLASS_NAME_LENGTH` is rejected whole, a breakpoint over
  // `MAX_BREAKPOINT_ID_LENGTH` is dropped, definitions past
  // `MAX_BREAKPOINTS_PER_AXIS` and entries past `MAX_NAMED_CLASSES` are never
  // read, and one record wider than `MAX_SCANNED_KEYS` stops being enumerated.
  //
  // A store validating on write can only refuse what the compiler will not read
  // if it can SEE the rule. The package's export map exposes `.` and `./format`
  // and nothing else, so a constant that lives in a module without being
  // re-exported is unreachable — and a consumer then accepts a value that
  // satisfies the published type and loses every style keyed to it.
  //
  // Asserted as a set rather than one at a time because the defect is an
  // omission: `MAX_BREAKPOINT_ID_LENGTH` was added beside its sibling and not
  // re-exported, which no test in this package could see.
  it("exposes every limit that discards input rather than reporting it", () => {
    const bounds: Record<string, unknown> = {
      MAX_BREAKPOINTS_PER_AXIS: entry.MAX_BREAKPOINTS_PER_AXIS,
      MAX_BLOCK_TYPE_LENGTH: entry.MAX_BLOCK_TYPE_LENGTH,
      MAX_BREAKPOINT_ID_LENGTH: entry.MAX_BREAKPOINT_ID_LENGTH,
      MAX_NAMED_CLASSES: entry.MAX_NAMED_CLASSES,
      MAX_NAMED_CLASS_NAME_LENGTH: entry.MAX_NAMED_CLASS_NAME_LENGTH,
      MAX_SCANNED_KEYS: entry.MAX_SCANNED_KEYS,
      MAX_VALUE_LENGTH: entry.MAX_VALUE_LENGTH,
    };

    for (const [name, value] of Object.entries(bounds)) {
      expect(typeof value, `${name} is not exported from the entry`).toBe(
        "number"
      );
    }
  });
});

describe("the block-type predicate", () => {
  // Three gates decide whether a string is a block type: registration
  // (`isBlockName`), document validation (`isNodeType`) and compilation. One
  // accepting what another rejects is not a cosmetic inconsistency — a block
  // that registers and validates while the compiler omits its defaults renders
  // without the look it declared, and nothing reports why.
  //
  // They agree by construction, because each calls this one function, and the
  // requirement is that they keep doing so. A second implementation of the
  // grammar agrees with this one wherever it is exercised and diverges only at
  // the edges, so the boundary cases below are what a divergence shows up in.
  const cases: [string, string, boolean][] = [
    ["a namespaced slug", "core/heading", true],
    [
      "a slug at the cap",
      `core/${"a".repeat(entry.MAX_BLOCK_TYPE_LENGTH - 5)}`,
      true,
    ],
    [
      "a slug one past the cap",
      `core/${"a".repeat(entry.MAX_BLOCK_TYPE_LENGTH - 4)}`,
      false,
    ],
    ["no namespace", "heading", false],
    ["a trailing slash", "core/columns/", false],
    ["uppercase", "Core/Heading", false],
  ];

  it.each(cases)(
    "agrees across all three gates on %s",
    (_what, value, want) => {
      expect(entry.isBlockType(value), "isBlockType").toBe(want);
      expect(entry.isNodeType(value), "isNodeType").toBe(want);
      expect(entry.isBlockName(value), "isBlockName").toBe(want);
    }
  );

  it("puts the cap where the boundary cases say it is", () => {
    // The pair above only means something if the two lengths really straddle
    // the cap, which is a property of the fixtures rather than of the code.
    expect(`core/${"a".repeat(entry.MAX_BLOCK_TYPE_LENGTH - 5)}`).toHaveLength(
      entry.MAX_BLOCK_TYPE_LENGTH
    );
    expect(`core/${"a".repeat(entry.MAX_BLOCK_TYPE_LENGTH - 4)}`).toHaveLength(
      entry.MAX_BLOCK_TYPE_LENGTH + 1
    );
  });
});

describe("renderedDomId: which of a node's two spellings reaches the page", () => {
  const bare = (extra: Record<string, unknown>) =>
    ({
      id: "n",
      type: "core/box",
      version: 1,
      props: {},
      ...extra,
    }) as BlockNode;

  it("prefers a non-empty cssId, which overwrites the bag", () => {
    expect(
      renderedDomId(bare({ cssId: "actual", attributes: { id: "hero" } }))
    ).toBe("actual");
  });

  it("treats an EMPTY string cssId as shadowing, emitting nothing reachable", () => {
    // The renderer sets `id=""`, which no anchor, label or selector reaches —
    // and the bag's value is overwritten, so it does not render either.
    expect(
      renderedDomId(bare({ cssId: "", attributes: { id: "hero" } }))
    ).toBeUndefined();
  });

  it("lets the bag through when cssId is NOT a string", () => {
    // The renderer normalises a non-string cssId to undefined
    // (`typeof node.cssId === "string" ? node.cssId : undefined`) and only then
    // decides whether to overwrite — so the bag is what renders. Reading this
    // as "any cssId shadows" costs a real duplicate id on the page.
    expect(
      renderedDomId(bare({ cssId: null, attributes: { id: "hero" } }))
    ).toBe("hero");
    expect(renderedDomId(bare({ cssId: 7, attributes: { id: "hero" } }))).toBe(
      "hero"
    );
  });

  it("folds the attribute name, because HTML does", () => {
    expect(renderedDomId(bare({ attributes: { ID: "hero" } }))).toBe("hero");
  });

  it("lets a trailing EMPTY case variant overwrite an earlier one", () => {
    // The renderer lowercases each key and assigns in turn, so
    // `{ id: "hero", ID: "" }` leaves the element with `id=""`. Skipping the
    // empty one keeps `hero` and reports an id that does not render — which
    // then makes a copy rename itself away from an id nothing owns.
    expect(
      renderedDomId(bare({ attributes: { id: "hero", ID: "" } }))
    ).toBeUndefined();
  });

  it("lets a trailing NON-empty variant win too", () => {
    // The control. "Ignore empty values entirely" passes the case above only by
    // accident; "last one wins, whatever it holds" is the rule.
    expect(renderedDomId(bare({ attributes: { id: "", ID: "hero" } }))).toBe(
      "hero"
    );
  });

  it("reads a bag the RENDERER would read, not only a plain record", () => {
    // The renderer does `Object.entries(attributes)` on any non-array object,
    // so a class instance with an own `id` puts that id on the page. Narrowing
    // to a plain record reported no id, and an insert then kept an incoming id
    // the destination was already rendering.
    class Bag {
      id = "hero";
    }
    expect(renderedDomId(bare({ attributes: new Bag() }))).toBe("hero");
    // Still absent for the shapes the renderer treats as absent.
    expect(renderedDomIdIn(null)).toBeUndefined();
    expect(renderedDomIdIn(["id"])).toBeUndefined();
  });

  it("asks the bag alone the same way", () => {
    // The narrower question a surface asks when it needs to know whether an
    // empty bag id would SHADOW something.
    expect(renderedDomIdIn({ id: "hero", ID: "" })).toBe("");
    expect(renderedDomIdIn({ id: "", ID: "hero" })).toBe("hero");
    expect(renderedDomIdIn(null)).toBeUndefined();
    expect(renderedDomIdIn(["id"])).toBeUndefined();
  });

  it("reports none when the node spells none", () => {
    expect(renderedDomId(bare({}))).toBeUndefined();
    expect(renderedDomId(bare({ attributes: { id: "" } }))).toBeUndefined();
  });
});

describe("a provenance record's rename map", () => {
  const base = { from: "pattern" as const, id: "p1", digest: "d1" };

  it("accepts a record with no rename map", () => {
    // The migration path, and the control for every refusal below: a record
    // written before this field existed is still whole.
    expect(isBlockOrigin(base)).toBe(true);
  });

  it("accepts a well-formed map", () => {
    expect(
      isBlockOrigin({ ...base, renamed: { pricing: "pricing-a1b2" } })
    ).toBe(true);
  });

  it.each([
    ["not a record", "pricing"],
    ["an array", ["pricing"]],
    ["null", null],
    ["a non-string original", { pricing: 3 }],
    ["an empty original", { pricing: "" }],
    ["an empty current id", { "": "pricing" }],
  ])("refuses %s", (_name, renamed) => {
    // A half-record is read as "these are the originals" and puts back an id
    // that was never there, which is worse than having no record at all — the
    // same reason a pattern origin without a digest is refused.
    expect(isBlockOrigin({ ...base, renamed })).toBe(false);
  });

  it("ignores a rename map on a component record", () => {
    // That arm severs a link deliberately and restores nothing, so it has no
    // such field; an extra member is not what makes a record whole.
    expect(isBlockOrigin({ from: "component", id: "c1" })).toBe(true);
  });
});
