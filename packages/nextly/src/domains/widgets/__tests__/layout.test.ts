/**
 * What a stored dashboard arrangement may hold, how earlier formats are read,
 * and -- the half that is easy to get backwards -- what it must NOT refuse.
 */
import { describe, expect, it } from "vitest";

import {
  LAYOUT_SCHEMA_VERSION,
  MAX_CONFIG_DEPTH,
  MAX_PLACEMENTS,
  MAX_STORED_PLACEMENTS,
  RETIRED_WIDGETS,
  applyRetirements,
  defaultPlacements,
  layoutSizeProblem,
  mergePreservingHidden,
  partitionPlacements,
  placementProblem,
  readPlacements,
  readStoredLayout,
  resolvePlacementIds,
  serializeLayout,
  visibilityToken,
  type WidgetPlacement,
  type WidgetRetirement,
  type WidgetRetirements,
} from "../layout";

/** A placement that satisfies every rule, for a test to break one field of. */
function placement(
  patch: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "p1",
    widgetId: "core/team",
    width: "half",
    removed: false,
    ...patch,
  };
}

/** A current-format card. */
function card(
  id: string,
  widgetId = `core/${id}`,
  patch: Partial<WidgetPlacement> = {}
): WidgetPlacement {
  return { id, widgetId, width: "full", removed: false, ...patch };
}

/** A stored row of the columns format, as earlier releases wrote it. */
function columnsRow(
  placements: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    schemaVersion: 2,
    columnCount: 3,
    placements,
    ...extra,
  });
}

describe("placement shape", () => {
  it("accepts a placement in the current format", () => {
    expect(placementProblem(placement())).toBeUndefined();
  });

  it("accepts each of the five widths and nothing else", () => {
    for (const width of ["quarter", "third", "half", "twoThirds", "full"]) {
      expect(placementProblem(placement({ width }))).toBeUndefined();
    }
    for (const width of ["sm", "lg", "Full", "", 6, undefined]) {
      expect(placementProblem(placement({ width }))).toMatch(/"width"/);
    }
  });

  it("requires removed to be a boolean", () => {
    expect(placementProblem(placement({ removed: "no" }))).toMatch(/"removed"/);
  });

  it("refuses a placement in the columns format", () => {
    // An admin built before this format sends column, order, hidden and size.
    // It has no width and no removed flag, so it is refused rather than stored
    // half-understood.
    expect(
      placementProblem({
        id: "p1",
        widgetId: "core/team",
        column: 0,
        order: 0,
        hidden: false,
        size: "md",
      })
    ).toMatch(/"width"/);
  });

  it("accepts a widgetId that names nothing", () => {
    // Whether a widget exists is the live registry's question, asked on every
    // read; refusing here would freeze the answer at save time.
    expect(
      placementProblem(placement({ widgetId: "gone/never-was" }))
    ).toBeUndefined();
  });

  it("requires an id and a widget id with real text", () => {
    expect(placementProblem(placement({ id: " " }))).toMatch(/"id"/);
    expect(placementProblem(placement({ widgetId: "" }))).toMatch(/"widgetId"/);
    expect(placementProblem("p1")).toMatch(/object/);
  });
});

describe("reading placements", () => {
  it("keeps only the fields core stores", () => {
    expect(
      readPlacements([
        placement({ config: { range: 7 }, column: 2, extra: "dropped" }),
      ])
    ).toEqual([
      {
        id: "p1",
        widgetId: "core/team",
        width: "half",
        removed: false,
        config: { range: 7 },
      },
    ]);
  });

  it("names the index of the offending placement", () => {
    expect(() =>
      readPlacements([placement(), placement({ width: "wide" })])
    ).toThrow(/placements\[1\]/);
  });

  it("refuses a non-array", () => {
    expect(() => readPlacements({})).toThrow(/must be an array/);
  });
});

describe("reading a stored row", () => {
  it("round-trips what it serialized, in order", () => {
    const placements = [
      card("b", "core/b", { width: "quarter", config: { n: 1 } }),
      card("a", "core/a", { removed: true }),
    ];
    const read = readStoredLayout(serializeLayout(placements));
    expect(read.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION);
    expect(read.placements).toEqual(placements);
    expect(read.unarranged).toBeUndefined();
  });

  it("keeps the unarranged mark through a round trip", () => {
    expect(
      readStoredLayout(serializeLayout([card("a")], false)).unarranged
    ).toBe(true);
  });

  it("throws on a schema version this core did not write", () => {
    for (const schemaVersion of [0, 4, "3", undefined]) {
      expect(() =>
        readStoredLayout(JSON.stringify({ schemaVersion, placements: [] }))
      ).toThrow();
    }
  });

  it("throws on text that is not a JSON object", () => {
    expect(() => readStoredLayout("{not json")).toThrow();
    expect(() => readStoredLayout("[]")).toThrow();
    expect(() => readStoredLayout("null")).toThrow();
  });

  it("throws on a current-format row holding a placement it cannot read", () => {
    expect(() =>
      readStoredLayout(
        JSON.stringify({
          schemaVersion: LAYOUT_SCHEMA_VERSION,
          placements: [placement({ width: "huge" })],
        })
      )
    ).toThrow();
  });
});

describe("a columns-format row becomes one ordered list", () => {
  // Three columns, two rows. Positions were announced row by row: across the
  // tops of the columns, then the next row down.
  const stored = [
    { id: "c0r1", widgetId: "w/a", column: 0, order: 10, hidden: false },
    { id: "c2r0", widgetId: "w/b", column: 2, order: 0, hidden: false },
    { id: "c1r1", widgetId: "w/c", column: 1, order: 10, hidden: true },
    { id: "c0r0", widgetId: "w/d", column: 0, order: 0, hidden: false },
    { id: "c1r0", widgetId: "w/e", column: 1, order: 0, hidden: false },
  ];

  it("orders the cards across the tops of the columns, then the next row", () => {
    expect(
      readStoredLayout(columnsRow(stored)).placements.map(p => p.id)
    ).toEqual(["c0r0", "c1r0", "c2r0", "c0r1", "c1r1"]);
  });

  it("keeps every card, its id and its widget", () => {
    const read = readStoredLayout(columnsRow(stored)).placements;
    expect(read).toHaveLength(stored.length);
    expect(new Set(read.map(p => `${p.id}=${p.widgetId}`))).toEqual(
      new Set(stored.map(p => `${p.id}=${p.widgetId}`))
    );
  });

  it("keeps a hidden card as a removed one", () => {
    const read = readStoredLayout(columnsRow(stored)).placements;
    expect(read.find(p => p.id === "c1r1")?.removed).toBe(true);
    expect(read.filter(p => p.removed)).toHaveLength(1);
  });

  it("maps each stored size to the width of the same span", () => {
    const sizes = ["sm", "md", "lg", "xl", "full"];
    const read = readStoredLayout(
      columnsRow(
        sizes.map((size, order) => ({
          id: size,
          widgetId: "w/a",
          column: 0,
          order,
          hidden: false,
          size,
        }))
      )
    ).placements;
    expect(read.map(p => p.width)).toEqual([
      "quarter",
      "third",
      "half",
      "twoThirds",
      "full",
    ]);
  });

  it("reads a missing or unknown size as full", () => {
    const read = readStoredLayout(
      columnsRow([
        { id: "none", widgetId: "w/a", column: 0, order: 0, hidden: false },
        {
          id: "odd",
          widgetId: "w/b",
          column: 0,
          order: 1,
          hidden: false,
          size: "xxl",
        },
      ])
    ).placements;
    expect(read.map(p => p.width)).toEqual(["full", "full"]);
  });

  it("depends only on the stored text, never on what a widget declares now", () => {
    // `readStoredLayout` is handed no widget at all: there is nothing for a
    // widget's current default to reach it through, so the same row reads the
    // same way whatever the widgets declare. Two reads agree exactly.
    const raw = columnsRow(stored);
    expect(readStoredLayout(raw)).toEqual(readStoredLayout(raw));
  });

  it("keeps every card's settings, and drops column, order and height", () => {
    const read = readStoredLayout(
      columnsRow([
        {
          id: "x",
          widgetId: "w/a",
          column: 1,
          order: 3,
          hidden: false,
          size: "lg",
          height: "tall",
          config: { range: 30, nested: { a: [1, 2] } },
        },
      ])
    ).placements;
    expect(read).toEqual([
      {
        id: "x",
        widgetId: "w/a",
        width: "half",
        removed: false,
        config: { range: 30, nested: { a: [1, 2] } },
      },
    ]);
  });

  it("keeps a columns-format row's unarranged mark", () => {
    expect(
      readStoredLayout(columnsRow(stored, { unarranged: true })).unarranged
    ).toBe(true);
    expect(readStoredLayout(columnsRow(stored)).unarranged).toBeUndefined();
  });

  it("reads a placement with no column as the first column", () => {
    const read = readStoredLayout(
      columnsRow([
        { id: "b", widgetId: "w/b", column: 1, order: 0, hidden: false },
        { id: "a", widgetId: "w/a", order: 0, hidden: false },
      ])
    ).placements;
    expect(read.map(p => p.id)).toEqual(["a", "b"]);
  });

  it("converts once: converting the converted row changes nothing", () => {
    const once = readStoredLayout(columnsRow(stored));
    const twice = readStoredLayout(serializeLayout(once.placements));
    expect(twice.placements).toEqual(once.placements);
  });
});

describe("a flat first-format row becomes one ordered list", () => {
  const raw = (placements: Array<Record<string, unknown>>) =>
    JSON.stringify({ schemaVersion: 1, placements });

  it("reads it rather than throwing on its version", () => {
    expect(() => readStoredLayout(raw([]))).not.toThrow();
  });

  it("keeps the order the reader saw", () => {
    const read = readStoredLayout(
      raw([
        { id: "c", widgetId: "w/c", order: 20, hidden: false },
        { id: "a", widgetId: "w/a", order: 0, hidden: true, size: "sm" },
        { id: "b", widgetId: "w/b", order: 10, hidden: false },
      ])
    ).placements;
    expect(read.map(p => p.id)).toEqual(["a", "b", "c"]);
    expect(read[0]).toMatchObject({ removed: true, width: "quarter" });
  });

  it("goes through the columns reading first, ties included", () => {
    // Four cards at one order: the columns format dealt them across three
    // columns (0, 1, 2, 0), and reading those rows across puts the fourth
    // beside the first. Kept step for step, so a row reads as it always did.
    const read = readStoredLayout(
      raw(
        ["a", "b", "c", "d"].map(id => ({
          id,
          widgetId: `w/${id}`,
          order: 0,
          hidden: false,
        }))
      )
    ).placements;
    expect(read.map(p => p.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("is never read as unarranged", () => {
    expect(
      readStoredLayout(
        JSON.stringify({ schemaVersion: 1, placements: [], unarranged: true })
      ).unarranged
    ).toBeUndefined();
  });
});

describe("retired widgets", () => {
  // Shaped on the catalogue's own retirements: generated count and health
  // cards become Count for their collection; Collections and Singles become
  // one Content card.
  const count: WidgetRetirement = {
    successor: "core/count",
    identity: placement => String(placement.config?.collection ?? ""),
    allowedWidths: ["quarter", "third", "half", "twoThirds"],
  };
  const content: WidgetRetirement = {
    successor: "core/content",
    allowedWidths: ["half", "twoThirds", "full"],
  };
  const retirements: WidgetRetirements = new Map([
    ["gen/count", count],
    ["gen/health", count],
    ["core/collections", content],
    ["core/singles", content],
  ]);
  const of = (collection: string) => ({ collection });

  it("leaves a current-format row with nothing to map exactly as it was", () => {
    const placements = [card("a"), card("b")];
    expect(applyRetirements(placements, retirements)).toBe(placements);
  });

  it("maps a retired widget to its successor, keeping the card", () => {
    const read = readStoredLayout(
      serializeLayout([
        card("x", "core/collections", { width: "half", removed: true }),
        card("y"),
      ]),
      retirements
    ).placements;
    expect(read).toEqual([
      card("x", "core/content", { width: "half", removed: true }),
      card("y"),
    ]);
  });

  it("maps in a row of every format", () => {
    const v1 = JSON.stringify({
      schemaVersion: 1,
      placements: [
        { id: "x", widgetId: "core/singles", order: 0, hidden: false },
      ],
    });
    const v2 = columnsRow([
      { id: "x", widgetId: "core/singles", column: 0, order: 0, hidden: false },
    ]);
    const v3 = serializeLayout([card("x", "core/singles")]);
    for (const raw of [v1, v2, v3]) {
      expect(readStoredLayout(raw, retirements).placements[0]?.widgetId).toBe(
        "core/content"
      );
    }
  });

  it("merges cards that become the same successor for the same collection, and only those", () => {
    const merged = applyRetirements(
      [
        card("posts-count", "gen/count", { config: of("posts") }),
        card("products-health", "gen/health", { config: of("products") }),
        card("posts-health", "gen/health", { config: of("posts") }),
      ],
      retirements
    );
    expect(merged.map(p => [p.id, p.widgetId, p.config])).toEqual([
      ["posts-count", "core/count", of("posts")],
      ["products-health", "core/count", of("products")],
    ]);
  });

  it("gives a merged card the first card's id, position and settings, and the larger width the successor allows", () => {
    const merged = applyRetirements(
      [
        card("lead"),
        card("first", "gen/count", { width: "quarter", config: of("posts") }),
        card("between"),
        // Full is wider still, but Count does not allow it: two thirds wins.
        card("second", "gen/health", { width: "full", config: of("posts") }),
        card("third", "gen/count", { width: "twoThirds", config: of("posts") }),
      ],
      retirements
    );
    expect(merged).toEqual([
      card("lead"),
      card("first", "core/count", { width: "twoThirds", config: of("posts") }),
      card("between"),
    ]);
  });

  it("keeps the widest carried width when the successor allows none of them", () => {
    // A successor allowing only a quarter, and two cards of other widths, the
    // narrower FIRST: keeping the first card's width, or any one card's,
    // gives half, and only the widest-carried rule gives full. The merged card
    // keeps the reader's widest choice, as every stored card keeps a width its
    // widget stops allowing: the admin draws it at the nearest allowed width,
    // and the choice returns if the successor allows it again. Picking an
    // allowed width here would be a second nearest-width rule beside the
    // admin's.
    const quarterOnly: WidgetRetirement = {
      ...count,
      allowedWidths: ["quarter"],
    };
    const merged = applyRetirements(
      [
        card("first", "gen/count", { width: "half", config: of("posts") }),
        card("second", "gen/health", { width: "full", config: of("posts") }),
      ],
      new Map<string, WidgetRetirement>([
        ["gen/count", quarterOnly],
        ["gen/health", quarterOnly],
      ])
    );
    expect(merged.map(p => [p.id, p.widgetId, p.width])).toEqual([
      ["first", "core/count", "full"],
    ]);
  });

  it("merges into a successor card the layout already holds, which keeps everything it had", () => {
    const existing = card("content", "core/content", {
      width: "twoThirds",
      config: { tab: "singles" },
    });
    const merged = applyRetirements(
      [
        // Retired, and BEFORE the existing card: the existing one still keeps
        // its own id and position.
        card("cols", "core/collections", { width: "full" }),
        card("mid"),
        existing,
        card("sing", "core/singles", { width: "half" }),
      ],
      retirements
    );
    expect(merged).toEqual([card("mid"), existing]);
  });

  it("merges into the first of several matching successor cards, leaving the others", () => {
    // A widget may be placed more than once with other settings: two Count
    // cards for Posts already stand, and a retired Posts health card joins the
    // first of them in the order. The second is not touched.
    const first = card("first", "core/count", {
      removed: true,
      config: { ...of("posts"), filter: "drafts" },
    });
    const second = card("second", "core/count", {
      removed: true,
      config: { ...of("posts"), filter: "published" },
    });
    const merged = applyRetirements(
      [first, second, card("health", "gen/health", { config: of("posts") })],
      retirements
    );
    expect(merged).toEqual([{ ...first, removed: false }, second]);
  });

  it("takes the removed state from the cards in the merge, not from the matching card left out of it", () => {
    // 🔴 The separating case. The first Count card and the retired card were
    // both removed; the second Count card is visible but takes no part in the
    // merge. Judging "every card removed" across all three would bring the
    // first card back, an extra card nobody asked for.
    const first = card("first", "core/count", {
      removed: true,
      config: { ...of("posts"), filter: "drafts" },
    });
    const second = card("second", "core/count", {
      config: { ...of("posts"), filter: "published" },
    });
    const merged = applyRetirements(
      [
        first,
        second,
        card("health", "gen/health", { removed: true, config: of("posts") }),
      ],
      retirements
    );
    expect(merged).toEqual([first, second]);
  });

  it("removes a merged card only when every card merged into it was removed", () => {
    const merge = (cols: boolean, sing: boolean, existing?: boolean) =>
      applyRetirements(
        [
          card("cols", "core/collections", { removed: cols }),
          card("sing", "core/singles", { removed: sing }),
          ...(existing === undefined
            ? []
            : [card("content", "core/content", { removed: existing })]),
        ],
        retirements
      ).find(p => p.widgetId === "core/content")?.removed;
    for (const cols of [true, false]) {
      for (const sing of [true, false]) {
        expect(merge(cols, sing)).toBe(cols && sing);
        for (const existing of [true, false]) {
          expect(merge(cols, sing, existing)).toBe(cols && sing && existing);
        }
      }
    }
  });

  it("merges either way round, the first in the order winning", () => {
    const colsFirst = applyRetirements(
      [card("cols", "core/collections"), card("sing", "core/singles")],
      retirements
    );
    const singFirst = applyRetirements(
      [card("sing", "core/singles"), card("cols", "core/collections")],
      retirements
    );
    expect(colsFirst.map(p => p.id)).toEqual(["cols"]);
    expect(singFirst.map(p => p.id)).toEqual(["sing"]);
  });

  it("follows a chain of retirements to the widget that exists now", () => {
    // Retired in one release, its successor retired again in a later one: a
    // row nobody saved in between still reaches the current widget, once.
    const chain: WidgetRetirements = new Map<string, WidgetRetirement>([
      ["core/old", { successor: "core/replacement" }],
      [
        "core/replacement",
        {
          successor: "core/current",
          settings: placement => ({ ...placement.config, migrated: true }),
        },
      ],
    ]);
    const read = readStoredLayout(
      serializeLayout([card("x", "core/old", { config: { k: 1 } })]),
      chain
    );
    expect(read.placements).toEqual([
      card("x", "core/current", { config: { k: 1, migrated: true } }),
    ]);
    // Reading the result again changes nothing.
    expect(
      readStoredLayout(serializeLayout(read.placements), chain).placements
    ).toEqual(read.placements);
  });

  it("stops at a cycle in the map rather than looping", () => {
    const cycle: WidgetRetirements = new Map<string, WidgetRetirement>([
      ["core/a", { successor: "core/b" }],
      ["core/b", { successor: "core/a" }],
    ]);
    const mapped = applyRetirements([card("x", "core/a")], cycle);
    expect(mapped).toHaveLength(1);
    expect(["core/a", "core/b"]).toContain(mapped[0]?.widgetId);
  });

  it("maps the same row the same way every time, and a mapped row maps to itself", () => {
    const raw = columnsRow([
      { id: "a", widgetId: "core/singles", column: 1, order: 0, hidden: true },
      {
        id: "b",
        widgetId: "core/collections",
        column: 0,
        order: 0,
        hidden: false,
      },
    ]);
    const first = readStoredLayout(raw, retirements);
    expect(readStoredLayout(raw, retirements)).toEqual(first);
    expect(
      readStoredLayout(serializeLayout(first.placements), retirements)
        .placements
    ).toEqual(first.placements);
    // Row-major: "b" (column 0) comes first and keeps its id.
    expect(first.placements).toEqual([card("b", "core/content")]);
  });
});

describe("the default arrangement", () => {
  it("follows the declared order", () => {
    const placements = defaultPlacements([
      { id: "w/c", defaultOrder: 30 },
      { id: "w/a", defaultOrder: 10 },
      { id: "w/b", defaultOrder: 20 },
    ]);
    expect(placements.map(p => p.widgetId)).toEqual(["w/a", "w/b", "w/c"]);
  });

  it("puts a widget that states no order after every widget that does", () => {
    const placements = defaultPlacements([
      { id: "w/none" },
      { id: "w/huge", defaultOrder: Number.MAX_VALUE },
      { id: "w/first", defaultOrder: -5 },
    ]);
    expect(placements.map(p => p.widgetId)).toEqual([
      "w/first",
      "w/huge",
      "w/none",
    ]);
  });

  it("keeps widgets that state NO order in declaration order", () => {
    const ids = ["w/d", "w/b", "w/a", "w/c"];
    expect(
      defaultPlacements(ids.map(id => ({ id }))).map(p => p.widgetId)
    ).toEqual(ids);
  });

  it("names each default placement after its widget, so reads are identical", () => {
    const placements = defaultPlacements([{ id: "w/a" }, { id: "w/b" }]);
    expect(placements.map(p => p.id)).toEqual(["w/a", "w/b"]);
    expect(defaultPlacements([{ id: "w/a" }, { id: "w/b" }])).toEqual(
      placements
    );
  });

  it("places each card at its widget's default width, or full", () => {
    expect(
      defaultPlacements([
        { id: "w/a", defaultWidth: "quarter" },
        { id: "w/b" },
      ]).map(p => [p.width, p.removed])
    ).toEqual([
      ["quarter", false],
      ["full", false],
    ]);
  });

  it("survives its own round trip", () => {
    const placements = defaultPlacements([
      { id: "w/a", defaultWidth: "third" },
    ]);
    expect(readStoredLayout(serializeLayout(placements)).placements).toEqual(
      placements
    );
  });
});

describe("partitioning by what a reader may see", () => {
  const row = [card("a"), card("hidden1"), card("b"), card("hidden2")];
  const visible = new Set(["core/a", "core/b"]);

  it("returns the visible half in the arrangement's order", () => {
    expect(
      partitionPlacements(
        [card("b"), card("x"), card("a")],
        visible
      ).visible.map(p => p.id)
    ).toEqual(["b", "a"]);
  });

  it("returns the invisible half rather than discarding it", () => {
    expect(partitionPlacements(row, visible).invisible.map(p => p.id)).toEqual([
      "hidden1",
      "hidden2",
    ]);
  });

  it("keeps a removed card visible to its owner", () => {
    expect(
      partitionPlacements([card("a", "core/a", { removed: true })], visible)
        .visible
    ).toHaveLength(1);
  });
});

describe("merging a write with the cards the writer could not see", () => {
  const visible = new Set(["core/a", "core/b", "core/c"]);

  it("puts each carried card back after the card it followed", () => {
    // Stored: a, H1, b, H2, c. The writer moves c to the front. H1 still
    // follows a and H2 still follows b, wherever they went.
    const stored = [card("a"), card("H1"), card("b"), card("H2"), card("c")];
    const merged = mergePreservingHidden(
      [card("c"), card("a"), card("b")],
      stored,
      visible
    );
    expect(merged.map(p => p.id)).toEqual(["c", "a", "H1", "b", "H2"]);
  });

  it("keeps carried cards that came before every visible card at the start", () => {
    const merged = mergePreservingHidden(
      [card("b"), card("a")],
      [card("H0"), card("a"), card("b")],
      visible
    );
    expect(merged.map(p => p.id)).toEqual(["H0", "b", "a"]);
  });

  it("puts a carried card whose neighbour was not sent at the end", () => {
    const merged = mergePreservingHidden(
      [card("b")],
      [card("a"), card("H1"), card("b"), card("H2")],
      visible
    );
    expect(merged.map(p => p.id)).toEqual(["b", "H2", "H1"]);
  });

  it("carries every card back, settings and all", () => {
    const hidden = card("H", "core/h", {
      width: "quarter",
      removed: true,
      config: { k: "v" },
    });
    const merged = mergePreservingHidden(
      [card("a")],
      [card("a"), hidden],
      visible
    );
    expect(merged).toContainEqual(hidden);
  });

  it("re-keys a carried card rather than refusing the write", () => {
    const merged = mergePreservingHidden(
      [card("same", "core/a")],
      [card("same", "core/hidden")],
      visible
    );
    expect(merged).toHaveLength(2);
    expect(new Set(merged.map(p => p.id)).size).toBe(2);
    // The caller's card keeps its id; the carried one (first in the stored
    // row, so still first) is the one re-keyed.
    expect(merged).toEqual([
      card("same~2", "core/hidden"),
      card("same", "core/a"),
    ]);
  });

  it("drops the latest carried cards past the stored ceiling, never the caller's", () => {
    const submitted = Array.from({ length: MAX_PLACEMENTS }, (_, i) =>
      card(`v${i}`, "core/a")
    );
    const hidden = Array.from({ length: MAX_STORED_PLACEMENTS }, (_, i) =>
      card(`h${i}`, "core/h")
    );
    const merged = mergePreservingHidden(submitted, hidden, visible);
    expect(merged).toHaveLength(MAX_STORED_PLACEMENTS);
    expect(merged.filter(p => p.widgetId === "core/a")).toHaveLength(
      MAX_PLACEMENTS
    );
    expect(merged.some(p => p.id === "h0")).toBe(true);
    expect(merged.some(p => p.id === `h${MAX_STORED_PLACEMENTS - 1}`)).toBe(
      false
    );
  });
});

describe("the size ceiling", () => {
  it("accepts an ordinary layout", () => {
    expect(layoutSizeProblem([card("a"), card("b")])).toBeUndefined();
  });

  it("refuses more placements than a dashboard could mean", () => {
    const many = Array.from({ length: MAX_PLACEMENTS + 1 }, (_, i) =>
      card(`p${i}`)
    );
    expect(layoutSizeProblem(many)).toMatch(/at most/);
  });

  it("measures BYTES, not characters", () => {
    // A multi-byte payload under the character count but over the byte limit.
    const wide = "\u{1F600}".repeat(9000);
    expect(
      layoutSizeProblem([card("a", "core/a", { config: { wide } })])
    ).toMatch(/bytes/);
  });
});

describe("the visibility token", () => {
  it("depends on the sets, not the order they were registered in", () => {
    expect(visibilityToken(["a", "b"], ["x"])).toBe(
      visibilityToken(["b", "a"], ["x"])
    );
  });

  it("moves when a widget becomes visible or stops being", () => {
    expect(visibilityToken(["a"], [])).not.toBe(
      visibilityToken(["a", "b"], [])
    );
  });

  it("moves when a shortcut's gate is gained or lost, with the widgets unchanged", () => {
    expect(visibilityToken(["a"], [])).not.toBe(visibilityToken(["a"], ["g"]));
  });

  it("cannot mistake a held gate for a widget id", () => {
    expect(visibilityToken(["x"], [])).not.toBe(visibilityToken([], ["x"]));
  });

  it("does not carry the ids it was built from", () => {
    const token = visibilityToken(["core/secret-widget"], []);
    expect(token).not.toContain("secret");
    expect(token).toHaveLength(16);
  });
});

describe("config nesting", () => {
  const nested = (depth: number): Record<string, unknown> => {
    let value: Record<string, unknown> = {};
    for (let i = 1; i < depth; i += 1) value = { next: value };
    return value;
  };

  it("accepts ordinary settings", () => {
    expect(
      placementProblem(placement({ config: { range: 7 } }))
    ).toBeUndefined();
  });

  it("accepts settings exactly at the limit", () => {
    expect(
      placementProblem(placement({ config: nested(MAX_CONFIG_DEPTH) }))
    ).toBeUndefined();
  });

  it("refuses a config deeper than the limit", () => {
    expect(
      placementProblem(placement({ config: nested(MAX_CONFIG_DEPTH + 1) }))
    ).toMatch(/nest/);
  });

  it("refuses a depth that would crash the serializer", () => {
    expect(placementProblem(placement({ config: nested(20_000) }))).toMatch(
      /nest/
    );
  });

  it("counts depth through arrays as well as objects", () => {
    let value: unknown = [];
    for (let i = 0; i < MAX_CONFIG_DEPTH + 1; i += 1) value = [value];
    expect(placementProblem(placement({ config: { list: value } }))).toMatch(
      /nest/
    );
  });
});

describe("two placements may not share an id", () => {
  it("names the id that repeats", () => {
    expect(
      resolvePlacementIds([card("a"), card("b"), card("a", "core/c")]).duplicate
    ).toBe("a");
  });

  it("says nothing about a set whose ids are all distinct, or an empty one", () => {
    expect(
      resolvePlacementIds([card("a"), card("b")]).duplicate
    ).toBeUndefined();
    expect(resolvePlacementIds([]).duplicate).toBeUndefined();
  });

  it("answers the refusal and the repair in ONE pass", () => {
    const answer = resolvePlacementIds([card("a"), card("a", "core/two")]);
    expect(answer.duplicate).toBe("a");
    expect(new Set(answer.placements.map(p => p.id)).size).toBe(2);
    expect(answer.rekeyed).toEqual(["a"]);
  });

  it("leaves the FIRST holder of the id untouched, and the repeat's fields but its id", () => {
    const repeat = card("a", "core/two", {
      width: "third",
      removed: true,
      config: { n: 1 },
    });
    const answer = resolvePlacementIds([card("a"), repeat]);
    expect(answer.placements[0]).toEqual(card("a"));
    expect(answer.placements[1]).toEqual({ ...repeat, id: "a~2" });
  });

  it("gives a repeat the SAME id every time it resolves the same set", () => {
    // 🔴 What makes resolving on read safe: a freshly minted id would differ
    // on every read, so a client round-tripping what it was handed would
    // submit an id the server no longer knows.
    const input = [card("a"), card("a", "core/two")];
    expect(resolvePlacementIds(input).placements).toEqual(
      resolvePlacementIds(input).placements
    );
  });

  it("steps past an id that is already taken rather than colliding with it", () => {
    const answer = resolvePlacementIds([
      card("a"),
      card("a~2", "core/two"),
      card("a", "core/three"),
    ]);
    expect(new Set(answer.placements.map(p => p.id)).size).toBe(3);
  });

  it("resolves against a seed of ids claimed elsewhere, without changing the seed", () => {
    const seed = new Set(["a"]);
    const answer = resolvePlacementIds([card("a")], seed);
    expect(answer.placements[0]?.id).not.toBe("a");
    expect(answer.duplicate).toBe("a");
    expect([...seed]).toEqual(["a"]);
  });
});

describe("resolving a repeat cannot disclose a hidden placement", () => {
  const visibleIds = new Set(["core/seen"]);
  const seen = card("shared", "core/seen");
  const unseen = card("shared", "core/hidden");

  it("hands the visible placement the SAME id whether or not a hidden one shares it", () => {
    // 🔴 Resolved across the whole row, the hidden placement (which comes
    // first) would claim "shared" and the visible one would come back re-keyed
    // whenever it existed -- an answer about a card the caller may not know of.
    const withHidden = partitionPlacements([unseen, seen], visibleIds).visible;
    const withoutHidden = partitionPlacements([seen], visibleIds).visible;
    expect(withHidden).toEqual(withoutHidden);
    expect(withHidden[0]?.id).toBe("shared");
  });

  it("still keeps the ids WITHIN each half distinct", () => {
    expect(
      new Set(
        partitionPlacements([seen, seen], visibleIds).visible.map(p => p.id)
      ).size
    ).toBe(2);
    expect(
      new Set(
        partitionPlacements([unseen, unseen], visibleIds).invisible.map(
          p => p.id
        )
      ).size
    ).toBe(2);
  });
});

describe("a stored row that holds one id twice", () => {
  const collided = [card("same", "core/first"), card("same", "core/second")];

  it("is read WITHOUT being rewritten, and the repeat is reported", () => {
    // The resolution belongs to `partitionPlacements`, which knows what this
    // caller may see. This layer only reports, so the row is findable in a log.
    const read = readStoredLayout(serializeLayout(collided));
    expect(read.placements.map(p => p.id)).toEqual(["same", "same"]);
    expect(read.duplicatePlacementIds).toEqual(["same"]);
  });

  it("CONTROL: a sound row reports nothing", () => {
    expect(
      readStoredLayout(serializeLayout([card("a"), card("b")]))
        .duplicatePlacementIds
    ).toBeUndefined();
  });

  it("reports a repeat in a row of an earlier format too", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      placements: [
        { id: "same", widgetId: "core/first", order: 0, hidden: false },
        { id: "same", widgetId: "core/second", order: 1, hidden: false },
      ],
    });
    expect(readStoredLayout(raw).duplicatePlacementIds).toEqual(["same"]);
  });
});

describe("Unpublished changes retires into Needs attention", () => {
  // The production map, so these hold for the row this release ships.
  const read = (placements: WidgetPlacement[]) =>
    readStoredLayout(serializeLayout(placements), RETIRED_WIDGETS).placements;

  it("converts a stored card in place, keeping its id, position, width and removal", () => {
    expect(
      read([
        card("a"),
        card("pending", "core/pending-edits", {
          width: "quarter",
          removed: true,
        }),
        card("b"),
      ])
    ).toEqual([
      card("a"),
      // The quarter is kept as stored; the admin draws it at a third, the
      // nearest width Needs attention allows.
      card("pending", "core/needs-attention", {
        width: "quarter",
        removed: true,
      }),
      card("b"),
    ]);
  });

  it("merges into a Needs attention card the layout already holds, which keeps its id, position, width and settings", () => {
    expect(
      read([
        card("pending", "core/pending-edits", { width: "full" }),
        card("attention", "core/needs-attention", {
          width: "third",
          config: { note: "kept" },
        }),
      ])
    ).toEqual([
      card("attention", "core/needs-attention", {
        width: "third",
        config: { note: "kept" },
      }),
    ]);
  });

  it("keeps a merged card unless every card merged into it was removed", () => {
    const merged = read([
      card("pending", "core/pending-edits", { removed: true }),
      card("attention", "core/needs-attention", { removed: false }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.removed).toBe(false);
    const bothRemoved = read([
      card("pending", "core/pending-edits", { removed: true }),
      card("attention", "core/needs-attention", { removed: true }),
    ]);
    expect(bothRemoved[0]?.removed).toBe(true);
  });

  it("merges two converted cards into the first, at the larger width Needs attention allows", () => {
    expect(
      read([
        card("first", "core/pending-edits", { width: "quarter" }),
        card("between"),
        card("second", "core/pending-edits", { width: "half" }),
      ])
    ).toEqual([
      card("first", "core/needs-attention", { width: "half" }),
      card("between"),
    ]);
  });

  it("changes nothing on a second read of a converted layout", () => {
    const once = read([card("pending", "core/pending-edits")]);
    // Converted by the first read, or "unchanged by the second" would hold
    // for a map that converts nothing.
    expect(once.map(placement => placement.widgetId)).toEqual([
      "core/needs-attention",
    ]);
    expect(read(once)).toEqual(once);
  });
});

describe("Collections, Singles and the per-Single cards retire into Content", () => {
  // The production map, so these hold for the rows this release converts.
  const read = (placements: WidgetPlacement[]) =>
    readStoredLayout(serializeLayout(placements), RETIRED_WIDGETS).placements;
  const CONTENT = "core/content";

  it("makes one Content card at the first one's position, whichever came first", () => {
    expect(
      read([
        card("a"),
        card("cols", "core/collections"),
        card("b"),
        card("sing", "core/singles"),
      ])
    ).toEqual([card("a"), card("cols", CONTENT), card("b")]);
    // 🔴 Singles first: kept as an existing successor, Content would have
    // stood at Collections' place instead.
    expect(
      read([
        card("sing", "core/singles"),
        card("a"),
        card("cols", "core/collections"),
      ])
    ).toEqual([card("sing", CONTENT), card("a")]);
  });

  it("takes the larger width Content allows, and keeps the widest when it allows none", () => {
    expect(
      read([
        card("cols", "core/collections", { width: "half" }),
        card("sing", "core/singles", { width: "twoThirds" }),
      ])[0]?.width
    ).toBe("twoThirds");
    expect(
      read([
        card("cols", "core/collections", { width: "quarter" }),
        card("sing", "core/singles", { width: "third" }),
      ])[0]?.width
    ).toBe("third");
  });

  for (const [cols, sing] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    it(`is removed only if both were (Collections removed: ${cols}, Singles removed: ${sing})`, () => {
      for (const order of [
        [
          card("cols", "core/collections", { removed: cols }),
          card("sing", "core/singles", { removed: sing }),
        ],
        [
          card("sing", "core/singles", { removed: sing }),
          card("cols", "core/collections", { removed: cols }),
        ],
      ]) {
        const merged = read(order);
        expect(merged).toHaveLength(1);
        expect(merged[0]?.removed).toBe(cols && sing);
      }
    });
  }

  it("merges into a Content card the layout already holds, which keeps its id, position, width and settings", () => {
    expect(
      read([
        card("cols", "core/collections", { width: "full" }),
        card("content", CONTENT, { width: "half", config: { note: "kept" } }),
        card("sing", "core/singles", { removed: true }),
      ])
    ).toEqual([
      card("content", CONTENT, { width: "half", config: { note: "kept" } }),
    ]);
  });

  it("turns a per-Single card into Content, merging it, without its settings", () => {
    expect(
      read([
        card("home", "single/home-status", { config: { limit: 3 } }),
        card("about", "single/about-status", { width: "half" }),
        card("a"),
      ])
    ).toEqual([card("home", CONTENT), card("a")]);
    expect(
      read([card("content", CONTENT), card("home", "single/home-status")])
    ).toEqual([card("content", CONTENT)]);
  });

  it("leaves a card that only looks like a per-Single one, and the generated collection cards, as they are", () => {
    const kept = [
      card("near", "single/home-statuses"),
      card("posts", "collection/posts-count"),
    ];
    expect(read(kept)).toEqual(kept);
  });

  it("changes nothing on a second read of a converted layout", () => {
    const once = read([
      card("sing", "core/singles"),
      card("home", "single/home-status"),
      card("cols", "core/collections"),
    ]);
    expect(once.map(placement => placement.widgetId)).toEqual([CONTENT]);
    expect(read(once)).toEqual(once);
  });
});

describe("the checklist and the sample-content offer retire into Get started", () => {
  const SEED = "core/seed-demo-content";
  const CHECKLIST = "core/onboarding-checklist";
  const STARTED = "core/get-started";

  /** One stored row holding both old cards, in each format a release wrote. */
  function rowsHolding(
    first: { id: string; widgetId: string; removed: boolean },
    second: { id: string; widgetId: string; removed: boolean }
  ): Record<string, string> {
    const old = [first, second];
    return {
      v1: JSON.stringify({
        schemaVersion: 1,
        placements: [
          ...old.map((c, order) => ({
            id: c.id,
            widgetId: c.widgetId,
            order,
            hidden: c.removed,
          })),
          { id: "team", widgetId: "core/team", order: 2, hidden: false },
        ],
      }),
      v2: columnsRow([
        ...old.map((c, order) => ({
          id: c.id,
          widgetId: c.widgetId,
          column: 0,
          order,
          hidden: c.removed,
        })),
        {
          id: "team",
          widgetId: "core/team",
          column: 0,
          order: 2,
          hidden: false,
        },
      ]),
      v3: serializeLayout([
        ...old.map(c => card(c.id, c.widgetId, { removed: c.removed })),
        card("team", "core/team"),
      ]),
    };
  }

  const read = (raw: string) =>
    readStoredLayout(raw, RETIRED_WIDGETS).placements;

  for (const [firstWidget, secondWidget] of [
    [SEED, CHECKLIST],
    [CHECKLIST, SEED],
  ] as const) {
    it(`becomes one full-width card with the first card's id and place (${firstWidget} first)`, () => {
      const rows = rowsHolding(
        { id: "first", widgetId: firstWidget, removed: false },
        { id: "second", widgetId: secondWidget, removed: false }
      );
      for (const [format, raw] of Object.entries(rows)) {
        const placements = read(raw);
        expect(
          placements.map(p => [p.id, p.widgetId]),
          format
        ).toEqual([
          ["first", STARTED],
          ["team", "core/team"],
        ]);
        expect(placements[0]?.width, format).toBe("full");
      }
    });
  }

  for (const [seedRemoved, checklistRemoved] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    it(`starts removed when either card was (sample content removed: ${seedRemoved}, checklist removed: ${checklistRemoved})`, () => {
      // 🔴 Removed only if BOTH were, the default rule, brought back a card a
      // reader had dismissed: every saved row holds both old cards, and the
      // sample-content offer could not be removed at all.
      const expected = seedRemoved || checklistRemoved;
      for (const order of [
        [
          { id: "s", widgetId: SEED, removed: seedRemoved },
          { id: "c", widgetId: CHECKLIST, removed: checklistRemoved },
        ],
        [
          { id: "c", widgetId: CHECKLIST, removed: checklistRemoved },
          { id: "s", widgetId: SEED, removed: seedRemoved },
        ],
      ] as const) {
        for (const [format, raw] of Object.entries(
          rowsHolding(order[0], order[1])
        )) {
          const started = read(raw).filter(p => p.widgetId === STARTED);
          expect(started, format).toHaveLength(1);
          expect(started[0]?.removed, format).toBe(expected);
        }
      }
    });
  }

  it("leaves the default rule, removed only if every card was, to every other retirement", () => {
    const merged = readStoredLayout(
      serializeLayout([
        card("pending", "core/pending-edits", { removed: true }),
        card("attention", "core/needs-attention", { removed: false }),
      ]),
      RETIRED_WIDGETS
    ).placements;
    expect(merged.map(p => p.removed)).toEqual([false]);
  });
});
