/**
 * Which conditions a pending change leaves broken: one whose source is no
 * longer a field the entry form can read beside it (moved away, deleted, or no
 * longer a type a condition reads), or one comparing a dropdown with an option
 * it no longer has. A broken condition stays on its field, marked, and is
 * never dropped; the check is made on the fields as they stand, so it holds
 * after any change, undo or redo alike.
 */
import { describe, expect, it } from "vitest";

import type {
  BuilderField,
  FieldCondition,
} from "@admin/components/features/schema-builder/types";

import { brokenConditions, followRename } from "../condition-identity";

function field(name: string, extra: Partial<BuilderField> = {}): BuilderField {
  return {
    id: `f-${name || String(extra.label)}`,
    name,
    label: name ? name[0].toUpperCase() + name.slice(1) : "",
    type: "text",
    ...extra,
  } as BuilderField;
}

/** A field shown only while `source` equals `value`. */
function gated(name: string, source: string, value = "yes"): BuilderField {
  return field(name, {
    admin: { condition: { field: source, operator: "equals", value } },
  });
}

const status = (options: string[]) =>
  field("status", {
    type: "select",
    options: options.map(value => ({ label: value, value })),
  });

describe("a broken condition", () => {
  it("a move: its source moved into a group, out of the level it is read on", () => {
    const fields = [
      gated("teaser", "summary"),
      field("details", { type: "group", fields: [field("summary")] }),
    ];
    const broken = brokenConditions(fields);
    expect(broken.get("f-teaser")).toEqual({
      reason: "no-source",
      message:
        "Teaser's condition reads summary, which is no longer beside it. Choose another field for it, or remove the condition.",
    });
    // Marked, never dropped: the condition is still on the field.
    expect(fields[0].admin?.condition?.field).toBe("summary");
  });

  it("a delete: its source is gone", () => {
    const broken = brokenConditions([gated("teaser", "summary")]);
    expect(broken.get("f-teaser")?.reason).toBe("no-source");
  });

  it("a removed option: a dropdown compared with an option it no longer has", () => {
    const broken = brokenConditions([
      gated("teaser", "status", "archived"),
      status(["draft", "published"]),
    ]);
    expect(broken.get("f-teaser")).toEqual({
      reason: "option-removed",
      message:
        'Teaser\'s condition compares Status with "archived", which is no longer one of its options. Choose another value, or remove the condition.',
    });
  });

  it("a source no longer of a type a condition reads", () => {
    const broken = brokenConditions([
      gated("teaser", "author"),
      field("author", { type: "relationship" }),
    ]);
    expect(broken.get("f-teaser")).toEqual({
      reason: "not-a-source",
      message:
        "Teaser's condition reads Author, which a condition cannot compare. Choose another field for it, or remove the condition.",
    });
  });

  it("at any depth: a nested field's source moved out of its group", () => {
    const fields = [
      field("summary"),
      field("details", { type: "group", fields: [gated("teaser", "summary")] }),
    ];
    expect(brokenConditions(fields).get("f-teaser")?.reason).toBe("no-source");
  });
});

describe("a condition that still reads its source", () => {
  it("a source beside it, or on its level through a group with no name", () => {
    const fields = [
      gated("teaser", "summary"),
      field("", { label: "Layout", type: "group", fields: [field("summary")] }),
      field("details", {
        type: "group",
        fields: [
          gated("caption", "headline"),
          field("", {
            label: "Inner",
            type: "group",
            fields: [field("headline")],
          }),
        ],
      }),
    ];
    expect(brokenConditions(fields).size).toBe(0);
  });

  it("a dropdown compared with an option it has, or with nothing at all", () => {
    const fields = [
      gated("teaser", "status", "published"),
      field("caption", {
        admin: { condition: { field: "status", operator: "isEmpty" } },
      }),
      status(["draft", "published"]),
    ];
    expect(brokenConditions(fields).size).toBe(0);
  });

  it("a built-in field as the source, and the older { field, equals } shape", () => {
    const fields = [
      field("title", { isSystem: true }),
      field("teaser", {
        admin: { condition: { field: "title", equals: "x" } },
      }),
    ];
    expect(brokenConditions(fields).size).toBe(0);
  });

  it("a source of a type a plugin contributes, which the Builder cannot judge", () => {
    // A plugin's scalar field: the entry form may well compare it, and nothing
    // here knows otherwise, so its condition is not held against the save.
    const fields = [
      gated("teaser", "rating"),
      field("rating", { type: "acme-rating" }),
    ];
    expect(brokenConditions(fields).size).toBe(0);
  });

  it("a condition not yet given a source is unfinished, not broken", () => {
    const fields = [
      field("teaser", {
        admin: { condition: { field: "", operator: "equals", value: "" } },
      }),
    ];
    expect(brokenConditions(fields).size).toBe(0);
  });
});

/**
 * A rename carries the conditions that read the field with it: every condition on the renamed
 * field's level (the fields the entry form reads beside it, through containers with no name) that
 * names its old name names the new one, in the same change. A condition on another level that
 * happens to read the same name reads another field, and stays.
 */
describe("a condition following a rename", () => {
  /** `fields` with `id`'s name set to `name`, as a rename leaves them before conditions follow. */
  const renamed = (
    fields: BuilderField[],
    id: string,
    name: string
  ): BuilderField[] =>
    fields.map(each =>
      each.id === id
        ? { ...each, name }
        : each.fields
          ? { ...each, fields: renamed(each.fields, id, name) }
          : each
    );
  const conditionOf = (fields: readonly BuilderField[], id: string) => {
    const walk = (list: readonly BuilderField[]): string | undefined => {
      for (const each of list) {
        if (each.id === id) return each.admin?.condition?.field;
        const below = each.fields ? walk(each.fields) : undefined;
        if (below !== undefined) return below;
      }
      return undefined;
    };
    return walk(fields);
  };

  it("rewrites a condition on its level that reads the old name", () => {
    const fields = renamed(
      [field("summary"), gated("teaser", "summary")],
      "f-summary",
      "abstract"
    );
    const next = followRename(fields, "f-summary", "summary");
    expect(conditionOf(next, "f-teaser")).toBe("abstract");
    // The rest of the condition is as it was.
    expect(next.find(each => each.id === "f-teaser")?.admin?.condition).toEqual(
      { field: "abstract", operator: "equals", value: "yes" }
    );
    expect(brokenConditions(next).size).toBe(0);
  });

  it("rewrites one read through a group with no name, either way", () => {
    const layout = (fields: BuilderField[]) =>
      field("", { label: "Layout", type: "group", fields });
    // The gated field inside a layout group, its source beside the group.
    const inside = renamed(
      [field("summary"), layout([gated("teaser", "summary")])],
      "f-summary",
      "abstract"
    );
    expect(
      conditionOf(followRename(inside, "f-summary", "summary"), "f-teaser")
    ).toBe("abstract");
    // The source inside a layout group, the gated field beside it.
    const outside = renamed(
      [layout([field("summary")]), gated("teaser", "summary")],
      "f-summary",
      "abstract"
    );
    expect(
      conditionOf(followRename(outside, "f-summary", "summary"), "f-teaser")
    ).toBe("abstract");
  });

  it("leaves a condition on another level that reads the same name", () => {
    const fields = renamed(
      [
        field("summary"),
        field("details", {
          type: "group",
          fields: [
            field("summary", { id: "f-inner" }),
            gated("note", "summary"),
          ],
        }),
      ],
      "f-summary",
      "abstract"
    );
    const next = followRename(fields, "f-summary", "summary");
    // `note` reads the group's own `summary`, which kept its name.
    expect(conditionOf(next, "f-note")).toBe("summary");
  });

  it("rewrites within a named group, for a field renamed inside it", () => {
    const fields = renamed(
      [
        gated("teaser", "summary"),
        field("details", {
          type: "group",
          fields: [
            field("summary", { id: "f-inner" }),
            gated("note", "summary"),
          ],
        }),
      ],
      "f-inner",
      "abstract"
    );
    const next = followRename(fields, "f-inner", "summary");
    expect(conditionOf(next, "f-note")).toBe("abstract");
    // The top level's `teaser` reads no field named summary now; it is not this rename's to follow.
    expect(conditionOf(next, "f-teaser")).toBe("summary");
  });

  it("leaves the renamed field's own condition alone", () => {
    const fields = renamed(
      [
        field("summary", {
          admin: { condition: { field: "summary", operator: "isNotEmpty" } },
        }),
      ],
      "f-summary",
      "abstract"
    );
    expect(
      conditionOf(followRename(fields, "f-summary", "summary"), "f-summary")
    ).toBe("summary");
  });

  // A name cleared to be typed again: a condition not yet given a source reads "" too, so a rename
  // from or to an empty name would take conditions that never read this field.
  it("follows no rename from or to an empty name", () => {
    const unfinished = field("note", {
      admin: { condition: { field: "", operator: "equals", value: "" } },
    });
    const cleared = renamed(
      [field("summary"), gated("teaser", "summary"), unfinished],
      "f-summary",
      ""
    );
    expect(followRename(cleared, "f-summary", "summary")).toBe(cleared);
    const retyped = renamed(cleared, "f-summary", "abstract");
    expect(followRename(retyped, "f-summary", "")).toBe(retyped);
    expect(conditionOf(followRename(retyped, "f-summary", ""), "f-note")).toBe(
      ""
    );
  });

  it("returns the fields themselves when no condition reads the old name", () => {
    const fields = renamed(
      [field("summary"), gated("teaser", "body")],
      "f-summary",
      "abstract"
    );
    expect(followRename(fields, "f-summary", "summary")).toBe(fields);
    expect(followRename(fields, "f-missing", "summary")).toBe(fields);
  });
});

describe("a condition a type change leaves comparing in a way its source can't", () => {
  it("a number source changed to text breaks a greater-than condition", () => {
    const broken = brokenConditions([
      field("teaser", {
        admin: {
          condition: { field: "views", operator: "greaterThan", value: 10 },
        },
      }),
      // Was a number; now text, which has no "greater than".
      field("views", { type: "text" }),
    ]);
    expect(broken.get("f-teaser")?.reason).toBe("operator-unsupported");
  });

  it("an older equality condition on a checkbox is not broken", () => {
    const broken = brokenConditions([
      field("teaser", {
        admin: { condition: { field: "featured", equals: "true" } },
      }),
      field("featured", { type: "checkbox" }),
    ]);
    expect(broken.has("f-teaser")).toBe(false);
  });

  it("a source whose type still offers the operator is not broken", () => {
    const broken = brokenConditions([
      field("teaser", {
        admin: {
          condition: { field: "views", operator: "greaterThan", value: 10 },
        },
      }),
      field("views", { type: "number" }),
    ]);
    expect(broken.has("f-teaser")).toBe(false);
  });
});

describe("a saved dropdown source whose type changes", () => {
  // The last saved definition: Status a dropdown, Teaser shown while it equals "archived".
  const saved = [
    gated("teaser", "status", "archived"),
    status(["draft", "archived"]),
  ];

  it("changed to text, breaks a condition naming one of its former options", () => {
    const now = [
      gated("teaser", "status", "archived"),
      field("status", { type: "text" }),
    ];
    expect(brokenConditions(now, saved).get("f-teaser")?.reason).toBe(
      "option-removed"
    );
  });

  // A comparison made or repaired after the change reads the field as it is now: a text can equal
  // "archived", and no option was ever compared with it by this condition.
  it("changed to text, does not break a condition made after, or changed to name another value", () => {
    const asText = field("status", { type: "text" });
    const saidNothing = [field("teaser"), status(["draft", "archived"])];
    expect(
      brokenConditions(
        [gated("teaser", "status", "archived"), asText],
        saidNothing
      ).has("f-teaser")
    ).toBe(false);
    // A saved condition the person has since changed to another value or operator.
    const draft = [gated("teaser", "status", "draft"), status(["draft"])];
    expect(
      brokenConditions(
        [gated("teaser", "status", "archived"), asText],
        draft
      ).get("f-teaser")?.reason
    ).toBeUndefined();
  });

  // An id can repeat across containers: the saved source is the one on the reader's own level.
  it("reads the saved source on the reader's own level where an id repeats", () => {
    const teaser = gated("teaser", "status", "archived");
    const saved = [
      field("first", {
        type: "group",
        fields: [teaser, status(["draft", "archived"])],
      }),
      // Another container whose fields share ids, with no such option.
      field("second", {
        type: "group",
        fields: [teaser, field("status", { type: "select", options: [] })],
      }),
    ];
    const nowStatus = field("status", { type: "text" });
    const now = [
      field("first", { type: "group", fields: [teaser, nowStatus] }),
      field("second", { type: "group", fields: [teaser, nowStatus] }),
    ];
    // Read in each group alone, whichever the id lookup would reach first.
    const groupFirst = now.map(each =>
      each.name === "first" ? each : { ...each, fields: [] }
    );
    const groupSecond = now.map(each =>
      each.name === "second" ? each : { ...each, fields: [] }
    );
    expect(
      brokenConditions(groupFirst as BuilderField[], saved).get("f-teaser")
        ?.reason
    ).toBe("option-removed");
    expect(
      brokenConditions(groupSecond as BuilderField[], saved).has("f-teaser")
    ).toBe(false);
  });

  it("not yet saved, is judged from the fields as they stand", () => {
    const now = [
      gated("teaser", "status", "archived"),
      field("status", { type: "text" }),
    ];
    // Nothing saved under that name: a text source compared with a value reads it.
    expect(brokenConditions(now, []).has("f-teaser")).toBe(false);
  });
});

// The entry form reads a document as no text at all, so a comparison made of a text would answer the
// same of every document.
describe("a saved source that became rich text", () => {
  const reading = (
    condition: Partial<FieldCondition>,
    source: Partial<BuilderField>
  ) => [
    field("teaser", {
      admin: { condition: { field: "summary", ...condition } },
    }),
    field("summary", source),
  ];
  const brokenNow = (
    condition: Partial<FieldCondition>,
    was: Partial<BuilderField> = {}
  ) =>
    brokenConditions(
      reading(condition, { type: "richText" }),
      reading(condition, was)
    ).get("f-teaser");

  it.each([
    "equals",
    "notEquals",
    "contains",
    "notContains",
    "startsWith",
    "endsWith",
  ] as const)("breaks a comparison by %s inherited from it", operator => {
    expect(brokenNow({ operator, value: "news" })).toEqual({
      reason: "operator-unsupported",
      message:
        "Teaser's condition compares the value of Summary, whose rich text it cannot read. Choose another field for it, or remove the condition.",
    });
  });

  it("breaks an older equality condition, and one comparing with nothing", () => {
    expect(brokenNow({ equals: "news" })?.reason).toBe("operator-unsupported");
    expect(brokenNow({ operator: "equals", value: "" })?.reason).toBe(
      "operator-unsupported"
    );
  });

  it("breaks one naming a dropdown's former option, which no other value would mend", () => {
    expect(
      brokenNow(
        { operator: "equals", value: "draft" },
        { type: "select", options: status(["draft"]).options }
      )?.reason
    ).toBe("operator-unsupported");
  });

  it.each(["isEmpty", "isNotEmpty"] as const)(
    "leaves a comparison by %s, which reads no text",
    operator => {
      expect(brokenNow({ operator })).toBeUndefined();
    }
  );

  it("leaves a source saved as rich text, and a comparison made or changed since", () => {
    const now = reading(
      { operator: "equals", value: "news" },
      { type: "richText" }
    );
    const was = (condition: Partial<FieldCondition>, type: string) =>
      brokenConditions(now, reading(condition, { type })).has("f-teaser");
    expect(was({ operator: "equals", value: "news" }, "richText")).toBe(false);
    expect(was({ operator: "equals", value: "views" }, "text")).toBe(false);
    expect(was({ operator: "contains", value: "news" }, "text")).toBe(false);
    expect(
      brokenConditions(now, [field("teaser"), field("summary")]).has("f-teaser")
    ).toBe(false);
  });
});
