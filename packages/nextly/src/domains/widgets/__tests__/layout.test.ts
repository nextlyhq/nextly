/**
 * What a stored dashboard arrangement may hold, and -- the half that is easy to
 * get backwards -- what it must NOT refuse.
 */
import { describe, expect, it } from "vitest";

import type { WidgetDefinition } from "../definition";
import {
  LAYOUT_SCHEMA_VERSION,
  MAX_PLACEMENTS,
  defaultPlacements,
  layoutSizeProblem,
  visibilityToken,
  mergePreservingHidden,
  partitionPlacements,
  placementProblem,
  readPlacements,
  readStoredLayout,
  serializeLayout,
  type WidgetPlacement,
} from "../layout";

/** A placement that satisfies every rule, for a test to break one field of. */
function placement(
  patch: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "p1",
    widgetId: "core/team",
    order: 0,
    hidden: false,
    ...patch,
  };
}

function widget(patch: Partial<WidgetDefinition>): WidgetDefinition {
  return {
    id: "core/team",
    title: "Team",
    archetype: "custom",
    defaultSize: "full",
    component: "core#TeamSummary",
    ...patch,
  } as WidgetDefinition;
}

describe("placement shape", () => {
  it.each([
    ["a non-object", 42, /must be an object/],
    ["a null", null, /must be an object/],
    ["a blank id", placement({ id: "   " }), /non-empty "id"/],
    ["a missing id", placement({ id: undefined }), /non-empty "id"/],
    ["a blank widgetId", placement({ widgetId: "" }), /non-empty "widgetId"/],
    ["a string order", placement({ order: "1" }), /"order" must be a finite/],
    [
      "a NaN order",
      placement({ order: Number.NaN }),
      /"order" must be a finite/,
    ],
    [
      "an infinite order",
      placement({ order: Number.POSITIVE_INFINITY }),
      /"order" must be a finite/,
    ],
    [
      "a missing hidden",
      placement({ hidden: undefined }),
      /"hidden" must be a boolean/,
    ],
    ["a truthy hidden", placement({ hidden: 1 }), /"hidden" must be a boolean/],
    [
      "a numeric size",
      placement({ size: 3 }),
      /"size", when given, must be a string/,
    ],
    [
      "a numeric height",
      placement({ height: 3 }),
      /"height", when given, must be a string/,
    ],
    [
      "an array config",
      placement({ config: [] }),
      /"config", when given, must be an object/,
    ],
  ])("refuses %s", (_label, value, expected) => {
    const problem = placementProblem(value);
    expect(problem).toBeDefined();
    // The diagnostic is asserted, not merely its presence: several of these
    // fixtures could be refused by a DIFFERENT rule than the one they are here
    // to exercise, and a bare `toBeDefined()` would stay green if the rule
    // under test were deleted.
    expect(problem).toMatch(expected);
  });

  it("accepts a size this core has never heard of", () => {
    // 🔴 THE rule this module exists to get right. `size` is seeded from a
    // widget's `defaultSize`, and that widget may come from a plugin built
    // against a NEWER core -- so a stored layout can legitimately name a size
    // outside `WIDGET_SIZES`. Refusing it here would throw on read and destroy
    // the reader's entire saved dashboard over one card, while the admin that
    // draws it already survives the same value by falling back to `full`.
    expect(placementProblem(placement({ size: "xxl" }))).toBeUndefined();
    expect(placementProblem(placement({ height: "enormous" }))).toBeUndefined();
  });

  it("accepts a widgetId that names nothing", () => {
    // Whether a widget exists is a question about the LIVE registry, asked on
    // every read. Freezing it here would refuse a layout naming a plugin that
    // is merely disabled today.
    expect(
      placementProblem(placement({ widgetId: "gone/away" }))
    ).toBeUndefined();
  });

  it("accepts a negative and a fractional order", () => {
    expect(placementProblem(placement({ order: -5 }))).toBeUndefined();
    expect(placementProblem(placement({ order: 1.5 }))).toBeUndefined();
  });
});

describe("reading placements", () => {
  it("keeps only the fields core stores", () => {
    const [read] = readPlacements([
      placement({ config: { a: 1 }, smuggled: "nope" }),
    ]);
    expect(read).toEqual({
      id: "p1",
      widgetId: "core/team",
      order: 0,
      hidden: false,
      config: { a: 1 },
    });
    expect(read).not.toHaveProperty("smuggled");
  });

  it("names the index of the offending placement", () => {
    expect(() =>
      readPlacements([placement(), placement({ order: "x" })])
    ).toThrow(/placements\[1\]/);
  });

  it("refuses a non-array", () => {
    expect(() => readPlacements({})).toThrow(/"placements" must be an array/);
  });
});

describe("reading a stored row", () => {
  it("round-trips what it serialized", () => {
    const placements: WidgetPlacement[] = [
      { id: "a", widgetId: "core/team", order: 0, hidden: true, size: "md" },
    ];
    expect(readStoredLayout(serializeLayout(placements)).placements).toEqual(
      placements
    );
  });

  it.each([
    ["unparseable JSON", "{not json"],
    ["a JSON array", "[]"],
    ["a JSON scalar", "7"],
  ])("throws on %s", (_label, raw) => {
    expect(() => readStoredLayout(raw)).toThrow();
  });

  it("throws on a schema version this core did not write", () => {
    // The ONE closed vocabulary in the module, and legitimate because core
    // wrote the value itself. A higher version means the row came from a newer
    // core and holds fields the next write would silently drop.
    const newer = JSON.stringify({
      schemaVersion: LAYOUT_SCHEMA_VERSION + 1,
      placements: [],
    });
    expect(() => readStoredLayout(newer)).toThrow();
    expect(() =>
      readStoredLayout(JSON.stringify({ placements: [] }))
    ).toThrow();
  });
});

describe("the default arrangement", () => {
  it("follows the declared order and materializes it as finite numbers", () => {
    const placements = defaultPlacements([
      widget({ id: "core/c", defaultOrder: 20 }),
      widget({ id: "core/a", defaultOrder: 0 }),
      widget({ id: "core/b", defaultOrder: 10 }),
    ]);
    expect(placements.map(p => p.widgetId)).toEqual([
      "core/a",
      "core/b",
      "core/c",
    ]);
    // Finite, because `defaultOrder`'s own "unstated" sentinel is
    // POSITIVE_INFINITY, which JSON turns into `null` and the shape rules then
    // refuse -- a layout that could be written and never read.
    for (const p of placements) expect(Number.isFinite(p.order)).toBe(true);
  });

  it("puts a widget that states no order after every widget that does", () => {
    const placements = defaultPlacements([
      widget({ id: "core/unstated" }),
      widget({ id: "core/last", defaultOrder: 9999 }),
    ]);
    expect(placements.map(p => p.widgetId)).toEqual([
      "core/last",
      "core/unstated",
    ]);
    // Asserted HERE and not only in the test above, because this is the one
    // arrangement where the sentinel could leak: a widget stating no order
    // carries POSITIVE_INFINITY through the comparator, and materializing that
    // straight into a placement writes a row JSON turns into `null`. Every
    // widget in the previous test states an order, so its finiteness check
    // cannot see this at all.
    for (const p of placements) expect(Number.isFinite(p.order)).toBe(true);
  });

  it("names each default placement after its widget, so reads are idempotent", () => {
    const once = defaultPlacements([widget({ id: "core/team" })]);
    const twice = defaultPlacements([widget({ id: "core/team" })]);
    expect(once).toEqual(twice);
    expect(once[0].id).toBe("core/team");
  });

  it("leaves room to insert between two neighbours", () => {
    const placements = defaultPlacements([
      widget({ id: "core/a", defaultOrder: 0 }),
      widget({ id: "core/b", defaultOrder: 1 }),
    ]);
    expect(placements[1].order - placements[0].order).toBeGreaterThan(1);
  });
});

describe("partitioning by what a reader may see", () => {
  const stored: WidgetPlacement[] = [
    { id: "p2", widgetId: "core/visible", order: 20, hidden: false },
    { id: "p1", widgetId: "core/secret", order: 10, hidden: false },
    { id: "p0", widgetId: "core/visible-2", order: 0, hidden: false },
  ];

  it("returns the visible half sorted by order", () => {
    const { visible } = partitionPlacements(
      stored,
      new Set(["core/visible", "core/visible-2"])
    );
    expect(visible.map(p => p.id)).toEqual(["p0", "p2"]);
  });

  it("returns the invisible half rather than discarding it", () => {
    // The half a whole-snapshot PUT has to carry back. Discarding it here is
    // how a reader loses a card permanently by opening the dashboard once
    // while a permission of theirs was narrowed.
    const { invisible } = partitionPlacements(
      stored,
      new Set(["core/visible", "core/visible-2"])
    );
    expect(invisible.map(p => p.widgetId)).toEqual(["core/secret"]);
  });

  it("keeps a hidden placement visible to its owner", () => {
    // `hidden` is the reader's own choice to put a card away, so it must come
    // back to them -- otherwise nothing could ever put it back.
    const { visible } = partitionPlacements(
      [{ id: "p", widgetId: "core/x", order: 0, hidden: true }],
      new Set(["core/x"])
    );
    expect(visible).toHaveLength(1);
  });
});

describe("merging a write with what the writer could not see", () => {
  const invisible: WidgetPlacement[] = [
    { id: "hidden-1", widgetId: "core/secret", order: 5, hidden: false },
  ];

  it("carries the invisible placements through", () => {
    const merged = mergePreservingHidden(
      [{ id: "p1", widgetId: "core/team", order: 0, hidden: false }],
      invisible
    );
    expect(merged.map(p => p.widgetId)).toEqual(["core/team", "core/secret"]);
  });

  it("re-keys a carried placement rather than refusing the write", () => {
    // Refusing would answer differently depending on whether a hidden
    // placement happens to hold that id -- an oracle for the existence of a
    // card this caller must not know about.
    const merged = mergePreservingHidden(
      [{ id: "hidden-1", widgetId: "core/team", order: 0, hidden: false }],
      invisible
    );
    expect(merged).toHaveLength(2);
    expect(new Set(merged.map(p => p.id)).size).toBe(2);
    // The carried placement survives with all of its own content intact.
    const carried = merged.find(p => p.widgetId === "core/secret");
    expect(carried).toMatchObject({ order: 5, hidden: false });
    expect(carried?.id).not.toBe("hidden-1");
  });
});

describe("the size ceiling", () => {
  it("accepts an ordinary layout", () => {
    expect(layoutSizeProblem(defaultPlacements([widget({})]))).toBeUndefined();
  });

  it("refuses more placements than a dashboard could mean", () => {
    const many = Array.from({ length: MAX_PLACEMENTS + 1 }, (_, i) => ({
      id: `p${i}`,
      widgetId: "core/team",
      order: i,
      hidden: false,
    }));
    expect(layoutSizeProblem(many)).toMatch(/at most 200 placements/);
  });

  it("measures BYTES, not characters", () => {
    // MySQL's TEXT limit is bytes, and a `config` of CJK or emoji is three to
    // four times its own `.length`. A layout that passes a character count and
    // fails a byte count is the one that truncates on one dialect.
    const wide = [
      {
        id: "p",
        widgetId: "core/team",
        order: 0,
        hidden: false,
        config: { note: "\u{1F600}".repeat(9000) },
      },
    ];
    expect(JSON.stringify(wide).length).toBeLessThan(32 * 1024);
    expect(layoutSizeProblem(wide)).toMatch(/bytes/);
  });
});

describe("the visibility token", () => {
  it("depends on the set, not the order it was registered in", () => {
    // A hot reload re-registers the same widgets in a different order. If that
    // moved the token, every write would be refused with nothing changed.
    expect(visibilityToken(["b", "a"])).toBe(visibilityToken(["a", "b"]));
  });

  it("moves when a widget becomes visible or stops being", () => {
    const before = visibilityToken(["core/a"]);
    expect(visibilityToken(["core/a", "core/gated"])).not.toBe(before);
    expect(visibilityToken([])).not.toBe(before);
  });

  it("does not carry the ids it was built from", () => {
    // It is echoed to the client, and the id list is the one thing this
    // endpoint must never hand back -- it names every widget the caller may see.
    const token = visibilityToken(["core/secret-project"]);
    expect(token).not.toContain("secret");
    expect(token.length).toBeLessThan(20);
  });
});
