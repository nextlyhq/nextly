/**
 * What a stored dashboard arrangement may hold, and -- the half that is easy to
 * get backwards -- what it must NOT refuse.
 */
import { describe, expect, it } from "vitest";

import type { WidgetDefinition } from "../definition";
import {
  DEFAULT_COLUMN_COUNT,
  LAYOUT_SCHEMA_VERSION,
  MAX_CONFIG_DEPTH,
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
    column: 0,
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
      column: 0,
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
      {
        id: "a",
        widgetId: "core/team",
        column: 1,
        order: 0,
        hidden: true,
        size: "md",
      },
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

  it("keeps widgets that state NO order in DECLARATION order", () => {
    // 🔴 The guarantee `defaultOrder` documents: omit it and your card keeps
    // the position it was declared in. `Array.prototype.sort` is stable, so
    // equal elements hold their input order, and the admin's comparator rests
    // on the same property — every widget shipping today states no order, so
    // they all compare equal. Any tie-break, on the id or on anything else,
    // rearranges every default dashboard holding plugin widgets and makes core
    // answer the ordering question differently from the admin.
    const declared = defaultPlacements([
      widget({ id: "core/c" }),
      widget({ id: "core/a" }),
      widget({ id: "core/b" }),
    ]);
    expect(declared.map(p => p.widgetId)).toEqual([
      "core/c",
      "core/a",
      "core/b",
    ]);
    // The control: declaring them in another order gives that order back, so
    // this is the input being preserved rather than a sequence that happens to
    // match. A comparator sorting by id answers "core/a, core/b, core/c" to
    // both, and the first assertion alone cannot tell the two apart.
    const reordered = defaultPlacements([
      widget({ id: "core/b" }),
      widget({ id: "core/c" }),
      widget({ id: "core/a" }),
    ]);
    expect(reordered.map(p => p.widgetId)).toEqual([
      "core/b",
      "core/c",
      "core/a",
    ]);
  });

  it("still lets a STATED order override the declaration order", () => {
    // The control in the other direction: a comparator returning 0 for every
    // pair would preserve declaration order perfectly and ignore the field.
    const placements = defaultPlacements([
      widget({ id: "core/a", defaultOrder: 30 }),
      widget({ id: "core/z", defaultOrder: 10 }),
    ]);
    expect(placements.map(p => p.widgetId)).toEqual(["core/z", "core/a"]);
  });

  it("names each default placement after its widget, so reads are idempotent", () => {
    const once = defaultPlacements([widget({ id: "core/team" })]);
    const twice = defaultPlacements([widget({ id: "core/team" })]);
    expect(once).toEqual(twice);
    expect(once[0].id).toBe("core/team");
  });

  it("leaves room to insert between two neighbours in a column", () => {
    // `order` sequences a COLUMN, not the dashboard, so the two placements to
    // compare are the ones dealt into the same column — which, with the
    // round-robin deal, are DEFAULT_COLUMN_COUNT apart in declared order.
    const placements = defaultPlacements(
      Array.from({ length: DEFAULT_COLUMN_COUNT + 1 }, (_unused, i) =>
        widget({ id: `core/${i}`, defaultOrder: i })
      )
    );
    const first = placements[0];
    const below = placements[DEFAULT_COLUMN_COUNT];
    expect(below.column).toBe(first.column);
    expect(below.order - first.order).toBeGreaterThan(1);
  });

  it("deals the first widgets ACROSS the columns, not down one", () => {
    // 🔴 The property that decides whether a reader sees the widgets that were
    // declared first. Filling column 0 before starting column 1 puts the
    // second-most-important card below the fold on a wide screen while two
    // columns sit empty beside it.
    const placements = defaultPlacements(
      Array.from({ length: DEFAULT_COLUMN_COUNT }, (_unused, i) =>
        widget({ id: `core/${i}`, defaultOrder: i })
      )
    );
    expect(new Set(placements.map(p => p.column)).size).toBe(
      DEFAULT_COLUMN_COUNT
    );
    // 🔴 And `order` stays a GLOBAL sequence rather than restarting per column.
    // Numbering within a column collides across them, and these positions are
    // materialized twice — over the whole registry and over the set a caller
    // may see — so a collision reorders a reader's dashboard the moment they
    // gain a permission.
    expect(new Set(placements.map(p => p.order)).size).toBe(
      DEFAULT_COLUMN_COUNT
    );
  });
});

describe("partitioning by what a reader may see", () => {
  const stored: WidgetPlacement[] = [
    { id: "p2", widgetId: "core/visible", column: 0, order: 20, hidden: false },
    { id: "p1", widgetId: "core/secret", column: 0, order: 10, hidden: false },
    {
      id: "p0",
      widgetId: "core/visible-2",
      column: 0,
      order: 0,
      hidden: false,
    },
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
      [{ id: "p", widgetId: "core/x", column: 0, order: 0, hidden: true }],
      new Set(["core/x"])
    );
    expect(visible).toHaveLength(1);
  });
});

describe("merging a write with what the writer could not see", () => {
  const invisible: WidgetPlacement[] = [
    {
      id: "hidden-1",
      widgetId: "core/secret",
      column: 0,
      order: 5,
      hidden: false,
    },
  ];

  it("carries the invisible placements through", () => {
    const merged = mergePreservingHidden(
      [{ id: "p1", widgetId: "core/team", column: 0, order: 0, hidden: false }],
      invisible
    );
    expect(merged.map(p => p.widgetId)).toEqual(["core/team", "core/secret"]);
  });

  it("re-keys a carried placement rather than refusing the write", () => {
    // Refusing would answer differently depending on whether a hidden
    // placement happens to hold that id -- an oracle for the existence of a
    // card this caller must not know about.
    const merged = mergePreservingHidden(
      [
        {
          id: "hidden-1",
          widgetId: "core/team",
          column: 0,
          order: 0,
          hidden: false,
        },
      ],
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
      column: 0,
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
        column: 0,
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

describe("declared geometry on a default placement", () => {
  it("carries the widget's size and height", () => {
    // A placement that omits its own size is not a persisted arrangement: the
    // first save would store a row with no `size`, so a later change to the
    // plugin's `defaultSize` silently resizes what the reader was told is
    // their saved layout.
    const [placement] = defaultPlacements([
      widget({ id: "core/a", defaultSize: "md", defaultHeight: "tall" }),
    ]);
    expect(placement.size).toBe("md");
    expect(placement.height).toBe("tall");
  });

  it("omits height when the widget declares none", () => {
    const [placement] = defaultPlacements([widget({ id: "core/a" })]);
    expect(placement).not.toHaveProperty("height");
  });

  it("survives its own round trip", () => {
    // The geometry it seeds must satisfy the shape rules it will be read back
    // through, or the first save writes a row the next read refuses.
    const placements = defaultPlacements([
      widget({ id: "core/a", defaultSize: "lg", defaultHeight: "short" }),
    ]);
    expect(readStoredLayout(serializeLayout(placements)).placements).toEqual(
      placements
    );
  });
});

describe("config nesting", () => {
  /** An object nested `depth` levels deep. */
  function nest(depth: number): Record<string, unknown> {
    let node: Record<string, unknown> = {};
    for (let i = 0; i < depth - 1; i += 1) node = { child: node };
    return node;
  }

  it("accepts ordinary settings", () => {
    expect(
      placementProblem(placement({ config: nest(MAX_CONFIG_DEPTH) }))
    ).toBeUndefined();
  });

  it("refuses a config deeper than the limit", () => {
    expect(
      placementProblem(placement({ config: nest(MAX_CONFIG_DEPTH + 2) }))
    ).toMatch(/nest at most/);
  });

  it("refuses a depth that would crash the serializer", () => {
    // The failure this exists for: `JSON.parse` accepts a structure thousands
    // of levels deep and `JSON.stringify` throws `RangeError` on the same
    // value, so a body under every byte and count limit became an internal 500
    // on the way back out.
    const deep = nest(20_000);
    expect(() => JSON.stringify(deep)).toThrow(RangeError);
    expect(placementProblem(placement({ config: deep }))).toMatch(
      /nest at most/
    );
  });

  it("counts depth through arrays as well as objects", () => {
    let node: unknown = "leaf";
    for (let i = 0; i < MAX_CONFIG_DEPTH + 4; i += 1) node = [node];
    expect(placementProblem(placement({ config: { a: node } }))).toMatch(
      /nest at most/
    );
  });
});

describe("a v1 arrangement survives the move to columns", () => {
  // 🔴 The stored row is a USER'S arrangement, and the reader throws on a
  // version it does not know rather than resetting — so shipping v2 without a
  // migrator turns every saved dashboard into an internal error. Reading a v1
  // row must produce a v2 layout, not a refusal.
  const V1 = JSON.stringify({
    schemaVersion: 1,
    placements: [
      { id: "a", widgetId: "w-a", column: 0, order: 0, hidden: false },
      { id: "b", widgetId: "w-b", column: 0, order: 10, hidden: false },
      { id: "c", widgetId: "w-c", column: 0, order: 20, hidden: true },
    ],
  });

  it("reads a v1 row rather than throwing on its version", () => {
    const layout = readStoredLayout(V1);
    expect(layout.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION);
    expect(layout.placements).toHaveLength(3);
  });

  it("gives every placement a column, and keeps the order the reader saw", () => {
    // The arrangement is the one thing a user actually authored here, so the
    // migration may add a coordinate but must not reorder anything.
    const { placements } = readStoredLayout(V1);
    expect(placements.map(p => p.widgetId)).toEqual(["w-a", "w-b", "w-c"]);
    for (const p of placements) expect(typeof p.column).toBe("number");
  });

  it("keeps a hidden placement hidden across the migration", () => {
    // 🔴 The control. A migration that rebuilt placements from defaults would
    // satisfy both assertions above while silently un-hiding a card the user
    // had put away — the one field whose loss is invisible until it reappears.
    const { placements } = readStoredLayout(V1);
    expect(placements.find(p => p.widgetId === "w-c")?.hidden).toBe(true);
  });
});
