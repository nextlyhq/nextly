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
  const retirements = new Map([
    ["core/old-one", "core/new"],
    ["core/old-two", "core/new"],
  ]);

  it("leaves a current-format row with nothing to map exactly as it was", () => {
    const placements = [card("a"), card("b")];
    expect(applyRetirements(placements, retirements)).toBe(placements);
  });

  it("maps a retired widget to its successor, keeping the card", () => {
    const read = readStoredLayout(
      serializeLayout([
        card("x", "core/old-one", {
          width: "half",
          removed: true,
          config: { k: 1 },
        }),
        card("y"),
      ]),
      retirements
    ).placements;
    expect(read).toEqual([
      card("x", "core/new", { width: "half", removed: true, config: { k: 1 } }),
      card("y"),
    ]);
  });

  it("maps in a row of every format", () => {
    const v1 = JSON.stringify({
      schemaVersion: 1,
      placements: [
        { id: "x", widgetId: "core/old-one", order: 0, hidden: false },
      ],
    });
    const v2 = columnsRow([
      { id: "x", widgetId: "core/old-one", column: 0, order: 0, hidden: false },
    ]);
    const v3 = serializeLayout([card("x", "core/old-one")]);
    for (const raw of [v1, v2, v3]) {
      expect(readStoredLayout(raw, retirements).placements[0]?.widgetId).toBe(
        "core/new"
      );
    }
  });

  it("makes two cards retired into one successor one card, the first winning", () => {
    const merged = applyRetirements(
      [
        card("lead"),
        card("first", "core/old-two", { width: "half", config: { a: 1 } }),
        card("between"),
        card("second", "core/old-one", { width: "quarter", config: { b: 2 } }),
      ],
      retirements
    );
    expect(merged).toEqual([
      card("lead"),
      card("first", "core/new", { width: "half", config: { a: 1 } }),
      card("between"),
    ]);
  });

  it("keeps the merged card unless every card merged into it was removed", () => {
    const merge = (a: boolean, b: boolean) =>
      applyRetirements(
        [
          card("first", "core/old-one", { removed: a }),
          card("second", "core/old-two", { removed: b }),
        ],
        retirements
      )[0]?.removed;
    expect(merge(true, true)).toBe(true);
    expect(merge(true, false)).toBe(false);
    expect(merge(false, true)).toBe(false);
    expect(merge(false, false)).toBe(false);
  });

  it("maps the same row the same way every time", () => {
    const raw = columnsRow([
      { id: "a", widgetId: "core/old-two", column: 1, order: 0, hidden: true },
      { id: "b", widgetId: "core/old-one", column: 0, order: 0, hidden: false },
    ]);
    const first = readStoredLayout(raw, retirements);
    expect(readStoredLayout(raw, retirements)).toEqual(first);
    // Reading the stored result again maps nothing more.
    expect(
      readStoredLayout(serializeLayout(first.placements), retirements)
        .placements
    ).toEqual(first.placements);
    // Row-major: "b" (column 0) comes first and keeps its id.
    expect(first.placements).toEqual([card("b", "core/new")]);
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
