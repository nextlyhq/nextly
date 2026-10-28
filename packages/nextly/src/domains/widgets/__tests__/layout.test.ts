/**
 * What a stored dashboard arrangement may hold, that a row of an earlier
 * format is no saved arrangement, and -- the half that is easy to get
 * backwards -- what it must NOT refuse.
 */
import { describe, expect, it } from "vitest";

import {
  LAYOUT_SCHEMA_VERSION,
  MAX_CONFIG_DEPTH,
  DASHBOARD_FULL_MESSAGE,
  MAX_PLACEMENTS,
  MAX_STORED_PLACEMENTS,
  dismissalsApplied,
  layoutSizeProblem,
  mergePreservingHidden,
  partitionPlacements,
  placementProblem,
  readPlacements,
  readStoredLayout,
  resolvePlacementIds,
  serializeLayout,
  visibilityToken,
  type StoredLayout,
  type WidgetPlacement,
} from "../layout";

/** A placement that satisfies every rule, for a test to break one field of. */
function placement(
  patch: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "p1",
    widgetId: "core/team",
    w: 6,
    h: 3,
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
  return { id, widgetId, w: 12, h: 3, removed: false, ...patch };
}

/** A current-format row, read: a test expecting one fails here if it is not. */
function readRow(raw: string): StoredLayout {
  const read = readStoredLayout(raw);
  if (read === undefined) throw new Error("expected a current-format row");
  return read;
}

describe("placement shape", () => {
  it("accepts a placement in the current format", () => {
    expect(placementProblem(placement())).toBeUndefined();
  });

  it("accepts every size the grid can draw, at both ends of each direction", () => {
    for (const size of [
      { w: 1, h: 2 },
      { w: 12, h: 2 },
      { w: 7, h: 12 },
    ]) {
      expect(placementProblem(placement(size))).toBeUndefined();
    }
  });

  it("refuses a size the grid cannot draw, naming w and h", () => {
    for (const size of [
      { w: 0, h: 3 },
      { w: 13, h: 3 },
      { w: 6.5, h: 3 },
      { w: "6", h: 3 },
      { w: 6, h: 0 },
      { w: 6, h: 2.5 },
      // Past the twelve rows a card may span.
      { w: 6, h: 13 },
      { w: 6, h: undefined },
      { w: undefined, h: 3 },
    ]) {
      expect(placementProblem(placement(size))).toMatch(/"w".*"h"/);
    }
  });

  it("does not judge a size against any widget's bounds", () => {
    // Whether a size lies within a widget's bounds is the live registry's
    // question, asked as a card is drawn; a stored size outside them is kept.
    expect(
      placementProblem(placement({ widgetId: "core/narrow", w: 12, h: 12 }))
    ).toBeUndefined();
  });

  it("requires removed to be a boolean", () => {
    expect(placementProblem(placement({ removed: "no" }))).toMatch(/"removed"/);
  });

  it("refuses a placement of an earlier format", () => {
    // An admin built before this format sends a named width, or column, order,
    // hidden and size. Neither has `w` and `h`, so each is refused rather than
    // stored half-understood.
    expect(
      placementProblem({
        id: "p1",
        widgetId: "core/team",
        width: "half",
        removed: false,
      })
    ).toMatch(/"w"/);
    expect(
      placementProblem({
        id: "p1",
        widgetId: "core/team",
        column: 0,
        order: 0,
        hidden: false,
        size: "md",
      })
    ).toMatch(/"w"/);
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
        placement({
          config: { range: 7 },
          column: 2,
          width: "half",
          extra: "dropped",
        }),
      ])
    ).toEqual([
      {
        id: "p1",
        widgetId: "core/team",
        w: 6,
        h: 3,
        removed: false,
        config: { range: 7 },
      },
    ]);
  });

  it("names the index of the offending placement", () => {
    expect(() => readPlacements([placement(), placement({ w: 20 })])).toThrow(
      /placements\[1\]/
    );
  });

  it("refuses a non-array", () => {
    expect(() => readPlacements({})).toThrow(/must be an array/);
  });
});

describe("the stored shape", () => {
  it("is the version, the placements as { id, widgetId, w, h, removed, config }, and nothing else", () => {
    // 🔴 The whole serialized text, so a field added to a placement -- a named
    // width beside `w`, a copy of the widget's bounds -- fails here.
    expect(
      JSON.parse(
        serializeLayout([
          card("a", "core/a", { w: 4, h: 2, config: { n: 1 } }),
          card("b", "core/b", { removed: true }),
        ])
      )
    ).toEqual({
      schemaVersion: 4,
      placements: [
        {
          id: "a",
          widgetId: "core/a",
          w: 4,
          h: 2,
          removed: false,
          config: { n: 1 },
        },
        { id: "b", widgetId: "core/b", w: 12, h: 3, removed: true },
      ],
    });
    expect(LAYOUT_SCHEMA_VERSION).toBe(4);
  });

  it("marks only a row nobody arranged", () => {
    expect(JSON.parse(serializeLayout([card("a")], false))).toEqual({
      schemaVersion: 4,
      placements: [card("a")],
      unarranged: true,
    });
  });
});

describe("reading a stored row", () => {
  it("round-trips what it serialized, in order, sizes included", () => {
    const placements = [
      card("b", "core/b", { w: 3, h: 5, config: { n: 1 } }),
      card("a", "core/a", { removed: true }),
    ];
    const read = readRow(serializeLayout(placements));
    expect(read.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION);
    expect(read.placements).toEqual(placements);
    expect(read.unarranged).toBeUndefined();
  });

  it("keeps the unarranged mark through a round trip", () => {
    expect(readRow(serializeLayout([card("a")], false)).unarranged).toBe(true);
  });

  it("throws on a row with no version, or a version this core never wrote", () => {
    // Not an earlier format to reset: a row nothing here understands, which
    // stays on the unreadable path.
    for (const schemaVersion of [
      0,
      5,
      99,
      -1,
      2.5,
      "3",
      "4",
      null,
      undefined,
    ]) {
      expect(() =>
        readStoredLayout(JSON.stringify({ schemaVersion, placements: [] }))
      ).toThrow();
    }
    expect(() =>
      readStoredLayout(JSON.stringify({ placements: [] }))
    ).toThrow();
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
          placements: [placement({ w: 0 })],
        })
      )
    ).toThrow();
  });

  it("throws on a current-format row holding a named width rather than w and h", () => {
    // A version 4 row is read by version 4's rules alone: nothing of an
    // earlier format is understood under the new number either.
    expect(() =>
      readStoredLayout(
        JSON.stringify({
          schemaVersion: LAYOUT_SCHEMA_VERSION,
          placements: [
            { id: "p1", widgetId: "core/team", width: "half", removed: false },
          ],
        })
      )
    ).toThrow();
  });
});

/**
 * A row of each earlier format, holding every field that format stored: cards
 * of core widgets and of a retired one, sizes, settings, a removal, a skipped
 * Get started step and the unarranged mark.
 */
const EARLIER_ROWS: ReadonlyArray<[number, string]> = [
  [
    1,
    JSON.stringify({
      schemaVersion: 1,
      placements: [
        {
          id: "mine",
          widgetId: "core/b",
          order: 0,
          hidden: false,
          size: "lg",
          height: "tall",
          config: { range: "7d" },
        },
        { id: "gone", widgetId: "core/a", order: 1, hidden: true },
      ],
    }),
  ],
  [
    2,
    JSON.stringify({
      schemaVersion: 2,
      columnCount: 3,
      unarranged: true,
      placements: [
        {
          id: "mine",
          widgetId: "core/b",
          column: 2,
          order: 0,
          hidden: false,
          size: "sm",
          height: "short",
          config: { range: "30d" },
        },
        { id: "gone", widgetId: "core/a", column: 0, order: 1, hidden: true },
        {
          id: "old",
          widgetId: "core/onboarding-checklist",
          column: 1,
          order: 0,
          hidden: false,
        },
      ],
    }),
  ],
  [
    3,
    JSON.stringify({
      schemaVersion: 3,
      unarranged: true,
      placements: [
        {
          id: "mine",
          widgetId: "core/b",
          width: "quarter",
          removed: false,
          config: { range: "90d" },
        },
        { id: "gone", widgetId: "core/a", width: "half", removed: true },
        {
          id: "core/get-started",
          widgetId: "core/get-started",
          width: "full",
          removed: false,
          config: { skipped: ["collection", "content"] },
        },
        { id: "extra", widgetId: "core/extra", width: "third", removed: false },
      ],
    }),
  ],
];

describe("a row of an earlier format is no saved arrangement", () => {
  // A default as `defaultLayoutPlacements` builds one: each card named after its widget.
  const defaults: WidgetPlacement[] = [
    {
      id: "core/get-started",
      widgetId: "core/get-started",
      w: 12,
      h: 4,
      removed: false,
    },
    { id: "core/a", widgetId: "core/a", w: 6, h: 3, removed: false },
    { id: "core/b", widgetId: "core/b", w: 4, h: 2, removed: false },
  ];

  for (const [version, raw] of EARLIER_ROWS) {
    it(`reads a version ${version} row as no row at all`, () => {
      expect(readStoredLayout(raw)).toBeUndefined();
    });

    it(`yields exactly the default from a version ${version} row: no card, size, setting, removal or skip carried over`, () => {
      // 🔴 Through the one path a row's choices reach a reader who follows
      // the default. A row read as anything but absent would carry its
      // removal of `core/a`, its settings on `core/b` or its skips here.
      expect(dismissalsApplied(defaults, readStoredLayout(raw))).toEqual(
        defaults
      );
      expect(dismissalsApplied(defaults, readStoredLayout(raw))).toEqual(
        dismissalsApplied(defaults, undefined)
      );
    });
  }

  it("CONTROL: the same choices in a current-format row do reach the default", () => {
    // Shows the assertion above can fail: a version 4 row holding a removal
    // and settings changes what the reader following the default is handed.
    const row = readStoredLayout(
      serializeLayout(
        [
          card("gone", "core/a", { removed: true }),
          card("mine", "core/b", { config: { range: "7d" } }),
        ],
        false
      )
    );
    expect(dismissalsApplied(defaults, row)).not.toEqual(defaults);
  });

  it("keeps each card's own choice where the default places one widget twice", () => {
    const twice = [card("core/a", "core/a"), card("core/a~2", "core/a")];
    const row = readStoredLayout(
      serializeLayout(
        [
          card("core/a", "core/a", { removed: true, config: { range: "7d" } }),
          card("core/a~2", "core/a", { config: { range: "30d" } }),
        ],
        false
      )
    );
    expect(
      dismissalsApplied(twice, row).map(each => [each.removed, each.config])
    ).toEqual([
      [true, { range: "7d" }],
      [false, { range: "30d" }],
    ]);
  });

  it("reads only the version: an earlier row whose content no format allows is still no row", () => {
    // Nothing past the version number is looked at, so content no reader of
    // that format would have accepted cannot make the row unreadable.
    for (const version of [1, 2, 3]) {
      expect(
        readStoredLayout(
          JSON.stringify({ schemaVersion: version, placements: "not a list" })
        )
      ).toBeUndefined();
    }
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

  it("puts a withheld card of a visible widget in the invisible half", () => {
    const set = (to: string) =>
      card(to, "core/a", { config: { collection: to } });
    const { visible: shown, invisible } = partitionPlacements(
      [set("posts"), set("secret")],
      visible,
      placement => placement.config?.collection === "secret"
    );
    expect(shown.map(p => p.id)).toEqual(["posts"]);
    expect(invisible.map(p => p.id)).toEqual(["secret"]);
  });
});

describe("merging a write with the cards the writer could not see", () => {
  const visible = new Set(["core/a", "core/b", "core/c"]);

  it("carries a withheld card of a visible widget back in place", () => {
    // A Count card set to a collection the writer may not read is not in what
    // they were handed, so their save cannot hold it: dropping it would
    // delete it.
    const secret = card("S", "core/a", { config: { collection: "secret" } });
    const merged = mergePreservingHidden(
      [card("b"), card("a")],
      [card("a"), secret, card("b")],
      visible,
      placement => placement.config?.collection === "secret"
    );
    expect(merged.map(p => p.id)).toEqual(["b", "a", "S"]);
  });

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
      w: 3,
      h: 2,
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

  it("keeps a withheld card of a one-card widget beside the one the caller adds", () => {
    // 🔴 Neither refused nor replaced. Refusing the add would tell the caller
    // a card they may not see exists; dropping the hidden card would lose it.
    // Both are kept, and the read allows a row that already holds more than
    // one, so the arrangement still saves when both are shown.
    const hidden = card("old", "acme/pinned", {
      config: { source: "secret" },
    });
    const added = card("new", "acme/pinned", { config: { source: "posts" } });
    const merged = mergePreservingHidden(
      [added],
      [hidden],
      new Set(["acme/pinned"]),
      placement => placement.config?.source === "secret"
    );
    expect(merged).toEqual([hidden, added]);
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

  it("measures BYTES, not characters, and says the dashboard is full", () => {
    // A multi-byte payload under the character count but over the byte limit.
    const wide = "\u{1F600}".repeat(9000);
    expect(layoutSizeProblem([card("a", "core/a", { config: { wide } })])).toBe(
      DASHBOARD_FULL_MESSAGE
    );
    // The must-differ half: as many characters, one byte each, fit.
    expect(
      layoutSizeProblem([
        card("a", "core/a", { config: { wide: "x".repeat(9000) } }),
      ])
    ).toBeUndefined();
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

  it("moves when the collections a reader may read change by name alone", () => {
    // Renaming `a_b` to `a-b` keeps every widget id and changes this.
    expect(visibilityToken(["a"], [], ["a_b"])).not.toBe(
      visibilityToken(["a"], [], ["a-b"])
    );
    expect(visibilityToken(["a"], [])).toBe(visibilityToken(["a"], [], []));
  });

  it("moves when a Collection setting changes, with nothing else changing", () => {
    // A stored card is judged by the setting -- its default when it stores no
    // value -- so a plugin changing it moves that card between withheld and
    // shown.
    expect(visibilityToken(["a"], [], [], ['a="posts"'])).not.toBe(
      visibilityToken(["a"], [], [], ['a="secret"'])
    );
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
      w: 4,
      h: 5,
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
    const read = readRow(serializeLayout(collided));
    expect(read.placements.map(p => p.id)).toEqual(["same", "same"]);
    expect(read.duplicatePlacementIds).toEqual(["same"]);
  });

  it("CONTROL: a sound row reports nothing", () => {
    expect(
      readRow(serializeLayout([card("a"), card("b")])).duplicatePlacementIds
    ).toBeUndefined();
  });
});
