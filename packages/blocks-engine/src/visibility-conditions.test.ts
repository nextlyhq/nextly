/**
 * Whether a block's visibility conditions hold for the entry or list item a
 * page shows, and which way every condition that cannot be checked fails.
 *
 * The evaluator answers shown or hidden. Every answer it cannot give with
 * certainty is hidden AND reported: an unknown operator or field, a field the
 * public may not read, a value whose type does not fit, a source the page does
 * not have. Content missing from a page is visible and reportable; content
 * shown to the wrong reader cannot be taken back.
 */
import { describe, expect, it } from "vitest";

import type { BindingFieldShape } from "./binding-rules";
import type { BlockNode } from "./document";
import type { ListFields } from "./list-query";
import {
  defineNamedQuery,
  namedQueryDeclaration,
  type NamedQuerySource,
} from "./named-query";
import {
  canonicalConditions,
  conditionDemand,
  conditionIssues,
  conditionScopeIn,
  CONDITION_ISSUE_CODES,
  CONDITION_KIND_OPS,
  CONDITION_MAX,
  CONDITION_OP_ALIASES,
  CONDITION_OPS,
  CONDITION_REGISTRY,
  conditionFieldKind,
  conditionOp,
  evaluateConditions,
  type ConditionRegistry,
  type ConditionSubject,
  withConditions,
} from "./visibility-conditions";

const READABLE: readonly BindingFieldShape[] = [
  { name: "title", type: "text" },
  { name: "rating", type: "number" },
  { name: "publishedAt", type: "date" },
  { name: "eventDay", type: "date", dateOnly: true },
  { name: "featured", type: "checkbox" },
  { name: "tier", type: "select", options: ["free", "vip"] },
  { name: "author", type: "relationship", relationTo: "authors" },
  { name: "tags", type: "text", hasMany: true },
  { name: "cover", type: "upload", relationTo: "media" },
];

const FIELDS: ListFields = {
  declared: new Set([
    "id",
    ...READABLE.map(field => field.name),
    "internalScore",
  ]),
  readable: READABLE,
  label: "Posts",
};

function subject(values: Record<string, unknown>): ConditionSubject {
  return { fields: FIELDS, values };
}

function gated(conditions: unknown): Pick<BlockNode, "id" | "visibility"> {
  return { id: "n1", visibility: { conditions } as BlockNode["visibility"] };
}

/** Shown or hidden, for one AND group on the entry. */
function shows(
  group: readonly unknown[],
  values: Record<string, unknown>
): boolean {
  return evaluateConditions(gated([group]), {
    source: "entry",
    subject: subject(values),
  }).shown;
}

/** The codes reported for one AND group on the entry. */
function codes(
  conditions: unknown,
  values: Record<string, unknown> = {}
): string[] {
  const result = evaluateConditions(gated(conditions), {
    source: "entry",
    subject: subject(values),
  });
  return result.issues.map(issue => issue.code);
}

describe("the operator vocabulary", () => {
  it("is the closed set authors are offered, spelled as list filters spell them", () => {
    expect([...CONDITION_OPS]).toEqual([
      "equals",
      "not_equals",
      "contains",
      "not_contains",
      "greater_than",
      "less_than",
      "exists",
      "not_exists",
      "is_true",
      "is_false",
    ]);
  });

  it("reads the unambiguous older spellings as the operator they always meant", () => {
    expect(CONDITION_OP_ALIASES).toEqual({
      eq: "equals",
      ne: "not_equals",
      neq: "not_equals",
      gt: "greater_than",
      lt: "less_than",
    });
    expect(conditionOp("eq")).toBe("equals");
    expect(conditionOp("neq")).toBe("not_equals");
    expect(conditionOp("less_than")).toBe("less_than");
  });

  it("knows nothing else, ambiguous spellings included", () => {
    // "gte" could be read as either bound of a day, "in" takes a list a
    // condition does not, and a prototype key is not an operator.
    for (const op of ["gte", "in", "EQ", "", "toString", "__proto__", 3]) {
      expect(conditionOp(op)).toBeUndefined();
    }
  });

  it("registers every operator and source as decided when the page is built", () => {
    for (const op of CONDITION_OPS) {
      expect(CONDITION_REGISTRY.ops[op]).toBe("static");
    }
    expect(CONDITION_REGISTRY.sources).toEqual({
      entry: "static",
      item: "static",
    });
  });

  it("offers each kind of field only the operators that mean something on it", () => {
    expect(CONDITION_KIND_OPS).toEqual({
      text: [
        "equals",
        "not_equals",
        "contains",
        "not_contains",
        "exists",
        "not_exists",
      ],
      number: [
        "equals",
        "not_equals",
        "greater_than",
        "less_than",
        "exists",
        "not_exists",
      ],
      date: ["greater_than", "less_than", "exists", "not_exists"],
      choice: ["equals", "not_equals", "exists", "not_exists"],
      boolean: ["is_true", "is_false", "equals", "not_equals"],
      entry: ["equals", "not_equals", "exists", "not_exists"],
      other: ["exists", "not_exists"],
    });
    expect(
      conditionFieldKind({ name: "tags", type: "text", hasMany: true })
    ).toBe("other");
    expect(conditionFieldKind({ name: "body", type: "richText" })).toBe(
      "other"
    );
    expect(conditionFieldKind({ name: "tier", type: "radio" })).toBe("choice");
  });
});

describe("each operator on the field kinds it takes", () => {
  it("equals and not_equals on text compare the whole value exactly", () => {
    expect(
      shows([{ field: "title", op: "equals", value: "Launch" }], {
        title: "Launch",
      })
    ).toBe(true);
    expect(
      shows([{ field: "title", op: "equals", value: "Launch" }], {
        title: "launch",
      })
    ).toBe(false);
    expect(
      shows([{ field: "title", op: "not_equals", value: "Launch" }], {
        title: "Other",
      })
    ).toBe(true);
    expect(
      shows([{ field: "title", op: "not_equals", value: "Launch" }], {
        title: "Launch",
      })
    ).toBe(false);
  });

  it("not_equals holds on an empty field, equals does not", () => {
    expect(
      shows([{ field: "title", op: "not_equals", value: "Launch" }], {})
    ).toBe(true);
    expect(
      shows([{ field: "title", op: "equals", value: "Launch" }], {
        title: null,
      })
    ).toBe(false);
  });

  it("contains and not_contains look for text ignoring case, as a list's filter does", () => {
    expect(
      shows([{ field: "title", op: "contains", value: "LAUNCH" }], {
        title: "Our launch day",
      })
    ).toBe(true);
    expect(
      shows([{ field: "title", op: "contains", value: "launch" }], {
        title: "Other",
      })
    ).toBe(false);
    expect(
      shows([{ field: "title", op: "contains", value: "launch" }], {})
    ).toBe(false);
    expect(
      shows([{ field: "title", op: "not_contains", value: "launch" }], {
        title: "Other",
      })
    ).toBe(true);
    expect(
      shows([{ field: "title", op: "not_contains", value: "launch" }], {
        title: "Launch!",
      })
    ).toBe(false);
    expect(
      shows([{ field: "title", op: "not_contains", value: "launch" }], {})
    ).toBe(true);
  });

  it("orders numbers strictly", () => {
    expect(
      shows([{ field: "rating", op: "greater_than", value: 3 }], { rating: 4 })
    ).toBe(true);
    expect(
      shows([{ field: "rating", op: "greater_than", value: 3 }], { rating: 3 })
    ).toBe(false);
    expect(
      shows([{ field: "rating", op: "less_than", value: 3 }], { rating: 2.5 })
    ).toBe(true);
    expect(
      shows([{ field: "rating", op: "less_than", value: 3 }], { rating: 3 })
    ).toBe(false);
    expect(shows([{ field: "rating", op: "less_than", value: 3 }], {})).toBe(
      false
    );
    expect(
      shows([{ field: "rating", op: "equals", value: 3 }], { rating: 3 })
    ).toBe(true);
  });

  it("orders an instant by whole days: after a day is from the start of the next", () => {
    const after = [
      { field: "publishedAt", op: "greater_than", value: "2026-11-01" },
    ];
    expect(shows(after, { publishedAt: "2026-11-01T23:59:59.000Z" })).toBe(
      false
    );
    expect(shows(after, { publishedAt: "2026-11-02T00:00:00.000Z" })).toBe(
      true
    );
    const before = [
      { field: "publishedAt", op: "less_than", value: "2026-11-01" },
    ];
    expect(shows(before, { publishedAt: "2026-10-31T23:59:59.999Z" })).toBe(
      true
    );
    expect(shows(before, { publishedAt: "2026-11-01T00:00:00.000Z" })).toBe(
      false
    );
  });

  it("starts each day where the caller's zone starts it", () => {
    // A site in UTC+5 starts 2 November at 19:00 UTC on the 1st.
    const dayStart = (day: string) => Date.parse(`${day}T00:00:00+05:00`);
    const result = evaluateConditions(
      gated([
        [{ field: "publishedAt", op: "greater_than", value: "2026-11-01" }],
      ]),
      {
        source: "entry",
        subject: subject({ publishedAt: "2026-11-01T19:30:00.000Z" }),
        dayStart,
      }
    );
    expect(result.shown).toBe(true);
  });

  it("hands the zone hook the field, so a calendar day can be read as stored", () => {
    const seen: string[] = [];
    evaluateConditions(
      gated([[{ field: "eventDay", op: "less_than", value: "2026-11-01" }]]),
      {
        source: "entry",
        subject: subject({ eventDay: "2026-10-31T00:00:00.000Z" }),
        dayStart: (day, field) => {
          seen.push(`${field.name}:${day}`);
          return Date.parse(`${day}T00:00:00Z`);
        },
      }
    );
    expect(seen).toEqual(["eventDay:2026-11-01"]);
  });

  it("exists and not_exists read empty text, an empty list and no value alike", () => {
    expect(shows([{ field: "title", op: "exists" }], { title: "x" })).toBe(
      true
    );
    expect(shows([{ field: "title", op: "exists" }], { title: "" })).toBe(
      false
    );
    expect(shows([{ field: "tags", op: "exists" }], { tags: [] })).toBe(false);
    expect(shows([{ field: "tags", op: "exists" }], { tags: ["a"] })).toBe(
      true
    );
    expect(shows([{ field: "cover", op: "not_exists" }], {})).toBe(true);
    expect(
      shows([{ field: "cover", op: "not_exists" }], { cover: { id: "m1" } })
    ).toBe(false);
  });

  it("is_true and is_false read a yes-or-no field, an unset one as no", () => {
    expect(
      shows([{ field: "featured", op: "is_true" }], { featured: true })
    ).toBe(true);
    expect(
      shows([{ field: "featured", op: "is_true" }], { featured: false })
    ).toBe(false);
    expect(
      shows([{ field: "featured", op: "is_false" }], { featured: false })
    ).toBe(true);
    expect(shows([{ field: "featured", op: "is_false" }], {})).toBe(true);
    expect(
      shows([{ field: "featured", op: "is_false" }], { featured: true })
    ).toBe(false);
  });

  it("compares a choice with one of its options", () => {
    expect(
      shows([{ field: "tier", op: "equals", value: "vip" }], { tier: "vip" })
    ).toBe(true);
    expect(
      shows([{ field: "tier", op: "not_equals", value: "vip" }], {
        tier: "free",
      })
    ).toBe(true);
  });

  it("compares a related entry by its id, populated or not", () => {
    const group = [{ field: "author", op: "equals", value: "a1" }];
    expect(shows(group, { author: "a1" })).toBe(true);
    expect(shows(group, { author: { id: "a1", name: "Ada" } })).toBe(true);
    expect(shows(group, { author: { id: "a2" } })).toBe(false);
    expect(
      shows([{ field: "author", op: "equals", value: 7 }], { author: 7 })
    ).toBe(true);
  });
});

describe("groups", () => {
  it("shows a block when every condition of one group holds", () => {
    const group = [
      { field: "tier", op: "equals", value: "vip" },
      { field: "rating", op: "greater_than", value: 3 },
    ];
    expect(shows(group, { tier: "vip", rating: 4 })).toBe(true);
    expect(shows(group, { tier: "vip", rating: 2 })).toBe(false);
  });

  it("shows a block when any group holds", () => {
    const conditions = [
      [{ field: "tier", op: "equals", value: "vip" }],
      [{ field: "featured", op: "is_true" }],
    ];
    const result = evaluateConditions(gated(conditions), {
      source: "entry",
      subject: subject({ tier: "free", featured: true }),
    });
    expect(result).toEqual({ shown: true, issues: [] });
  });

  it("shows a block whose conditions restrict nobody, without a subject", () => {
    // No groups, or an empty group (an AND of nothing), restrict nobody, as
    // the renderer and the style compiler already agree.
    for (const conditions of [
      undefined,
      [],
      [[]],
      [[], [{ field: "nope", op: "bogus" }]],
    ]) {
      expect(
        evaluateConditions(gated(conditions), { source: "entry" })
      ).toEqual({
        shown: true,
        issues: [],
      });
    }
  });
});

describe("a condition that cannot be checked", () => {
  it("hides a block whose conditions cannot be read", () => {
    for (const conditions of [
      "vip",
      [{ field: "tier", op: "equals" }],
      [[null]],
      [[{ op: "equals" }]],
    ]) {
      expect(codes(conditions)).toEqual(["condition-malformed"]);
      expect(
        evaluateConditions(gated(conditions), {
          source: "entry",
          subject: subject({}),
        }).shown
      ).toBe(false);
    }
  });

  it("hides and reports an operator nobody knows, even in a group that would hold", () => {
    const conditions = [
      [{ field: "tier", op: "equals", value: "vip" }],
      [{ field: "tier", op: "matches", value: "v.*" }],
    ];
    const result = evaluateConditions(gated(conditions), {
      source: "entry",
      subject: subject({ tier: "vip" }),
    });
    expect(result.shown).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        kind: "condition",
        nodeId: "n1",
        code: "condition-op-unknown",
        path: "/visibility/conditions/1/0",
      }),
    ]);
  });

  it("hides and reports a field the entry does not have", () => {
    expect(codes([[{ field: "missing", op: "exists" }]])).toEqual([
      "condition-field-unknown",
    ]);
  });

  it("hides a field the public may not read, whatever the value handed in holds", () => {
    // The caller handed the hidden field's value in by mistake; the
    // evaluator must not read it, or whether the block shows reveals it.
    const result = evaluateConditions(
      gated([[{ field: "internalScore", op: "greater_than", value: 5 }]]),
      { source: "entry", subject: subject({ internalScore: 9 }) }
    );
    expect(result.shown).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual([
      "condition-field-protected",
    ]);
    expect(result.issues[0]?.message).not.toContain("9");
  });

  it("hides and reports an operator the field's kind does not take", () => {
    expect(
      codes([[{ field: "publishedAt", op: "equals", value: "2026-11-01" }]])
    ).toEqual(["condition-unsuited"]);
    expect(codes([[{ field: "title", op: "greater_than", value: 3 }]])).toEqual(
      ["condition-unsuited"]
    );
    expect(codes([[{ field: "tags", op: "contains", value: "a" }]])).toEqual([
      "condition-unsuited",
    ]);
  });

  it("hides and reports a value that does not fit the field or the operator", () => {
    expect(
      codes([[{ field: "rating", op: "greater_than", value: "3" }]])
    ).toEqual(["condition-unsuited"]);
    expect(
      codes([[{ field: "publishedAt", op: "less_than", value: "2026-02-30" }]])
    ).toEqual(["condition-unsuited"]);
    expect(codes([[{ field: "tier", op: "equals", value: "gold" }]])).toEqual([
      "condition-unsuited",
    ]);
    expect(
      codes([[{ field: "featured", op: "is_true", value: true }]])
    ).toEqual(["condition-unsuited"]);
    expect(codes([[{ field: "title", op: "contains", value: "" }]])).toEqual([
      "condition-unsuited",
    ]);
    expect(
      codes([[{ field: "featured", op: "equals", value: "yes" }]])
    ).toEqual(["condition-unsuited"]);
  });

  it("hides and reports a field holding a value of another type than declared", () => {
    const result = evaluateConditions(
      gated([[{ field: "rating", op: "greater_than", value: 3 }]]),
      { source: "entry", subject: subject({ rating: "four" }) }
    );
    expect(result.shown).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual([
      "condition-value-unreadable",
    ]);
    // The stored value never reaches a report.
    expect(result.issues[0]?.message).not.toContain("four");
  });

  it("hides and reports a block with no entry or item to check", () => {
    const result = evaluateConditions(
      gated([[{ field: "tier", op: "equals", value: "vip" }]]),
      { source: "item" }
    );
    expect(result.shown).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual([
      "condition-source-unavailable",
    ]);
  });

  it("hides and reports more conditions than a block may hold", () => {
    const group = Array.from({ length: CONDITION_MAX + 1 }, () => ({
      field: "title",
      op: "exists",
    }));
    expect(codes([group], { title: "x" })).toEqual(["condition-too-many"]);
    const atCap = group.slice(1);
    expect(shows(atCap, { title: "x" })).toBe(true);
  });

  it("refuses an operator or source registered as decided per visit", () => {
    const perVisit: ConditionRegistry = {
      ops: { ...CONDITION_REGISTRY.ops, equals: "request" },
      sources: CONDITION_REGISTRY.sources,
    };
    const result = evaluateConditions(
      gated([[{ field: "tier", op: "equals", value: "vip" }]]),
      { source: "entry", subject: subject({ tier: "vip" }), registry: perVisit }
    );
    expect(result.shown).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual([
      "condition-not-static",
    ]);
    const timed: ConditionRegistry = {
      ops: CONDITION_REGISTRY.ops,
      sources: { ...CONDITION_REGISTRY.sources, item: "time-bounded" },
    };
    const onItem = evaluateConditions(
      gated([[{ field: "tier", op: "equals", value: "vip" }]]),
      { source: "item", subject: subject({ tier: "vip" }), registry: timed }
    );
    expect(onItem.issues.map(issue => issue.code)).toEqual([
      "condition-not-static",
    ]);
  });

  it("reports only codes from its own table", () => {
    const every = [
      ...codes("x"),
      ...codes([[{ field: "a", op: "zzz" }]]),
      ...codes([[{ field: "missing", op: "exists" }]]),
      ...codes([[{ field: "internalScore", op: "exists" }]]),
      ...codes([[{ field: "title", op: "greater_than", value: 1 }]]),
      ...codes([[{ field: "rating", op: "less_than", value: 3 }]], {
        rating: "x",
      }),
    ];
    for (const code of every)
      expect(CONDITION_ISSUE_CODES).toHaveProperty(code);
  });
});

describe("conditions stored before they were evaluated", () => {
  it("evaluates the older spellings as the operators they name", () => {
    expect(
      shows([{ field: "tier", op: "eq", value: "vip" }], { tier: "vip" })
    ).toBe(true);
    expect(
      shows([{ field: "tier", op: "ne", value: "vip" }], { tier: "vip" })
    ).toBe(false);
    expect(
      shows([{ field: "rating", op: "gt", value: 3 }], { rating: 4 })
    ).toBe(true);
    expect(
      shows([{ field: "rating", op: "lt", value: 3 }], { rating: 4 })
    ).toBe(false);
  });

  it("rewrites the older spellings and leaves everything else as stored", () => {
    const stored = [
      [
        { field: "status", op: "eq", value: "vip" },
        { field: "rating", op: "gte", value: 3 },
      ],
      [{ field: "featured", op: "neq", value: false, note: "kept" }],
    ];
    expect(canonicalConditions(stored)).toEqual({
      conditions: [
        [
          { field: "status", op: "equals", value: "vip" },
          { field: "rating", op: "gte", value: 3 },
        ],
        [{ field: "featured", op: "not_equals", value: false, note: "kept" }],
      ],
      upgraded: 2,
    });
    // The input is not changed in place.
    expect(stored[0]?.[0]?.op).toBe("eq");
  });

  it("returns a shape it cannot read as it came", () => {
    for (const conditions of ["x", [{ op: "eq" }], [[null]], undefined]) {
      expect(canonicalConditions(conditions)).toEqual({
        conditions,
        upgraded: 0,
      });
    }
  });

  it("keeps failing closed, and reports, a stored combination that does not fit", () => {
    // The format's own example: an older spelling on a field this entry does
    // not have.
    expect(codes([[{ field: "status", op: "eq", value: "vip" }]])).toEqual([
      "condition-field-unknown",
    ]);
    expect(codes([[{ field: "rating", op: "gte", value: 3 }]])).toEqual([
      "condition-op-unknown",
    ]);
    expect(codes([[{ field: "internalScore", op: "gt", value: 3 }]])).toEqual([
      "condition-field-protected",
    ]);
    expect(
      codes([[{ field: "publishedAt", op: "eq", value: "2026-11-01" }]])
    ).toEqual(["condition-unsuited"]);
  });
});

describe("setting a block's conditions", () => {
  const vip = [[{ field: "tier", op: "equals", value: "vip" }]];

  it("replaces the conditions and keeps the devices", () => {
    expect(
      withConditions(
        {
          conditions: [[{ field: "old", op: "exists" }]],
          devices: { mobile: false },
        },
        vip
      )
    ).toEqual({ conditions: vip, devices: { mobile: false } });
  });

  it("stores nothing for a block shown everywhere to everyone", () => {
    expect(withConditions({ conditions: vip }, undefined)).toBeUndefined();
    expect(withConditions({ conditions: vip }, [])).toBeUndefined();
    expect(withConditions(undefined, [])).toBeUndefined();
    expect(
      withConditions({ conditions: vip, devices: { mobile: false } }, [])
    ).toEqual({
      devices: { mobile: false },
    });
  });

  it("stores nothing for groups that let everyone through, an empty group among them", () => {
    // An AND of nothing always holds, so a group with no conditions lets
    // everyone through whatever the other groups say.
    expect(withConditions({ conditions: vip }, [[]])).toBeUndefined();
    expect(withConditions(undefined, [[], ...vip])).toBeUndefined();
    expect(withConditions({ devices: { mobile: false } }, [[]])).toEqual({
      devices: { mobile: false },
    });
  });

  it("replaces a visibility nothing can read, keeping none of it", () => {
    const unreadable = "hidden" as unknown as Parameters<
      typeof withConditions
    >[0];
    expect(withConditions(unreadable, undefined)).toBeUndefined();
    expect(withConditions(unreadable, vip)).toEqual({ conditions: vip });
  });

  it("copies what it stores, so a later edit to the input changes nothing", () => {
    const groups = [[{ field: "tier", op: "equals", value: "vip" }]];
    const stored = withConditions(undefined, groups);
    groups[0]![0]!.value = "free";
    expect(stored).toEqual({ conditions: vip });
  });
});

describe("what a page's conditions read of its entry", () => {
  const gated = (id: string, conditions: unknown, slots?: unknown) => ({
    id,
    type: "core/box",
    version: 1,
    props: {},
    visibility: { conditions },
    ...(slots === undefined ? {} : { slots }),
  });

  it("names the entry fields every entry-scoped condition checks, once each", () => {
    const demand = conditionDemand([
      gated("a", [[{ field: "tier", op: "equals", value: "vip" }]]),
      gated("b", [
        [{ field: "tier", op: "exists" }],
        [{ field: "rating", op: "gt", value: 3 }],
      ]),
    ]);
    expect([...demand.entryFields].sort()).toEqual(["rating", "tier"]);
    expect(demand.any).toBe(true);
  });

  it("leaves out conditions a list's item decides, but not those in its empty state", () => {
    const list = {
      id: "l",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts" },
      slots: {
        children: [gated("in", [[{ field: "title", op: "exists" }]])],
        empty: [gated("e", [[{ field: "tier", op: "exists" }]])],
      },
    };
    const demand = conditionDemand([list]);
    expect([...demand.entryFields]).toEqual(["tier"]);
    expect(demand.any).toBe(true);
  });

  it("asks for the site's day only when a condition orders a value", () => {
    expect(
      conditionDemand([gated("a", [[{ field: "tier", op: "exists" }]])])
        .ordersValues
    ).toBe(false);
    expect(
      conditionDemand([
        gated("a", [
          [{ field: "publishedAt", op: "less_than", value: "2026-01-01" }],
        ]),
      ]).ordersValues
    ).toBe(true);
  });

  it("names the fields its conditions order by, so a reader knowing their shapes can tell a day", () => {
    const demand = conditionDemand([
      gated("a", [
        [
          { field: "publishedAt", op: "less_than", value: "2026-01-01" },
          { field: "rating", op: "gt", value: 3 },
          { field: "tier", op: "exists" },
        ],
      ]),
    ]);
    expect([...(demand.orderedFields ?? [])].sort()).toEqual([
      "publishedAt",
      "rating",
    ]);
  });

  it("asks nothing of a page with no conditions, or ones that restrict nobody", () => {
    expect(
      conditionDemand([
        gated("a", [[]]),
        { id: "b", type: "core/box", version: 1, props: {} },
      ])
    ).toEqual({
      any: false,
      entryFields: new Set(),
      ordersValues: false,
      orderedFields: new Set(),
    });
  });

  it("says where a list's children read: the item in its per-entry slot only", () => {
    const list = {
      type: "core/collection-loop",
      props: { collection: "posts" },
    };
    const page = { source: "entry" as const, collection: "pages" };
    expect(conditionScopeIn(list, "children", page)).toEqual({
      source: "item",
      collection: "posts",
    });
    expect(conditionScopeIn(list, "empty", page)).toBe(page);
    expect(conditionScopeIn({ type: "core/box" }, "children", page)).toBe(page);
  });

  it("says a custom source's children read its query's row", () => {
    const list = {
      type: "core/collection-loop",
      props: { namedQuery: { name: "events.mine", params: {} } },
    };
    const page = { source: "entry" as const, collection: "pages" };
    expect(conditionScopeIn(list, "children", page)).toEqual({
      source: "item",
      collection: undefined,
      query: "events.mine",
    });
  });
});

describe("a condition on a custom source's row, at save", () => {
  /** A query whose rows are a schema of its own: an id and a title. */
  const mine = defineNamedQuery({
    name: "events.mine",
    label: "My events",
    reads: { collections: ["events"] },
    rows: {
      key: "id",
      fields: [
        { name: "id", type: "text" },
        { name: "title", type: "text" },
      ],
    },
    run: () => Promise.resolve({ rows: [] }),
  });
  const queries: NamedQuerySource = {
    declarationOf: name =>
      name === mine.name ? namedQueryDeclaration(mine) : undefined,
  };
  const forest = (field: string) => [
    {
      id: "list",
      type: "core/collection-loop",
      version: 1,
      props: { namedQuery: { name: mine.name, params: {} } },
      slots: {
        children: [
          {
            id: "box",
            type: "core/box",
            version: 1,
            props: {},
            visibility: {
              conditions: [[{ field, op: "equals", value: "Launch" }]],
            },
          },
        ],
      },
    },
  ];
  const codesOf = (field: string, namedQueries?: NamedQuerySource) =>
    conditionIssues(
      forest(field),
      namedQueries === undefined ? {} : { namedQueries }
    ).map(issue => issue.code);

  it("refuses a field the query's rows do not declare", () => {
    expect(codesOf("venue", queries)).toEqual(["condition-field-unknown"]);
  });

  it("takes a field the query's rows declare", () => {
    expect(codesOf("title", queries)).toEqual([]);
  });

  it("judges it by its operator alone without the site's queries", () => {
    // The control: the refusal above comes from the query's declaration.
    expect(codesOf("venue")).toEqual([]);
  });
});

describe("a block expanded from conditioned component placements", () => {
  // Five one-condition groups on each side: multiplied into one OR of ANDs
  // they would be 25 groups of two, 50 conditions, past the per-block limit.
  const ratings = [1, 2, 3, 4, 5].map(value => [
    { field: "rating", op: "equals", value },
  ]);
  const titles = ["t1", "t2", "t3", "t4", "t5"].map(value => [
    { field: "title", op: "equals", value },
  ]);
  const expanded = {
    id: "n1",
    visibility: { conditions: titles, within: [{ conditions: ratings }] },
  } as Pick<BlockNode, "id" | "visibility">;
  const judged = (values: Record<string, unknown>) =>
    evaluateConditions(expanded, { source: "entry", subject: subject(values) });

  it("is shown when its own conditions and every placement's hold, however many groups each has", () => {
    // The product the gates replace would be past the limit.
    expect(ratings.length * titles.length * 2).toBeGreaterThan(CONDITION_MAX);
    expect(judged({ rating: 3, title: "t4" })).toEqual({
      shown: true,
      issues: [],
    });
  });

  it("is hidden when a placement's conditions fail, though its own hold", () => {
    expect(judged({ rating: 9, title: "t4" }).shown).toBe(false);
    // CONTROL: and when its own fail, though the placement's hold.
    expect(judged({ rating: 3, title: "t9" }).shown).toBe(false);
  });

  it("asks the entry for the fields every placement reads", () => {
    const demand = conditionDemand([
      { type: "core/text", version: 1, props: {}, ...expanded },
    ] as BlockNode[]);
    expect([...demand.entryFields].sort()).toEqual(["rating", "title"]);
  });

  it("fails closed when what the placements left can't be read", () => {
    const result = evaluateConditions(
      { id: "n1", visibility: { within: "hidden" } } as unknown as Pick<
        BlockNode,
        "id" | "visibility"
      >,
      { source: "entry", subject: subject({}) }
    );
    expect(result.shown).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual([
      "condition-malformed",
    ]);
  });
});
