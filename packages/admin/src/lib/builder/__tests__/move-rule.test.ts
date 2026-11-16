/**
 * The move rule, over the nested fixture: every move it allows and every one it
 * refuses, with the sentence that says why. A drag, the menu and the keys all
 * ask this rule, so these cases hold for each of them.
 */
import { describe, expect, it } from "vitest";

import { nestedFixtureFields } from "@admin/components/features/schema-builder/__fixtures__/nested-fixture";
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import type { FieldDefinition } from "@admin/types/collection";

import { convertToBuilderField } from "../field-transformers";

import {
  judgeMove,
  moveDestinations,
  savedContainerIdsFrom,
  savedFieldsOffTheirLevel,
  type MoveContext,
  type MoveVerdict,
} from "../move-rule";

// The rule's whole answer, every change of container included: what it says
// once a save keeps values across containers. The refusal it gives until then
// is tested on its own, below.
const ctx: MoveContext = {
  entityReadOnly: false,
  topLevelReservesNames: true,
  containerChanges: true,
};

/** A plain field, as the Builder holds one. */
function plain(
  id: string,
  name: string,
  extra: Partial<BuilderField> = {}
): BuilderField {
  return { id, name, label: name, type: "text", ...extra } as BuilderField;
}

/** The names, in order, of a container's fields after a move. */
function namesIn(
  fields: readonly BuilderField[],
  containerId?: string
): string[] {
  const find = (list: readonly BuilderField[]): BuilderField | undefined => {
    for (const each of list) {
      if (each.id === containerId) return each;
      const below = each.fields ? find(each.fields) : undefined;
      if (below) return below;
    }
    return undefined;
  };
  const list = containerId ? (find(fields)?.fields ?? []) : fields;
  return list.map(each => each.name);
}

/** A stored field, as the Builder loads it. */
function loaded(definition: Record<string, unknown>): BuilderField {
  return convertToBuilderField(definition as unknown as FieldDefinition, 0);
}

function refusal(verdict: MoveVerdict): { reason: string; message: string } {
  if (verdict.allowed) throw new Error("expected the move to be refused");
  return { reason: verdict.reason, message: verdict.message };
}

function moved(verdict: MoveVerdict): BuilderField[] {
  if (!verdict.allowed) throw new Error(`refused: ${verdict.message}`);
  return verdict.fields;
}

describe("moves the rule allows", () => {
  it("reorders a field among its siblings", () => {
    const fields = moved(
      judgeMove(
        nestedFixtureFields(),
        "f-summary-b",
        { beforeFieldId: "f-summary-a" },
        ctx
      )
    );
    expect(namesIn(fields).slice(0, 3)).toEqual([
      "title",
      "summary_b",
      "summary_a",
    ]);
  });

  it("moves a field into a group and back out, keeping it one field", () => {
    const into = moved(
      judgeMove(
        nestedFixtureFields(),
        "f-summary-a",
        { parentFieldId: "f-meta" },
        ctx
      )
    );
    expect(namesIn(into, "f-meta")).toContain("summary_a");
    expect(namesIn(into)).not.toContain("summary_a");
    const back = moved(
      judgeMove(into, "f-summary-a", { beforeFieldId: "f-summary-b" }, ctx)
    );
    expect(namesIn(back).slice(0, 3)).toEqual([
      "title",
      "summary_a",
      "summary_b",
    ]);
  });

  it("moves one field on its own, whatever its width", () => {
    const fields = nestedFixtureFields().map(each =>
      each.id === "f-summary-a" || each.id === "f-summary-b"
        ? { ...each, admin: { ...each.admin, width: "50%" } }
        : each
    ) as BuilderField[];
    const after = moved(
      judgeMove(fields, "f-summary-b", { parentFieldId: "f-meta" }, ctx)
    );
    expect(namesIn(after)).toContain("summary_a");
    expect(namesIn(after, "f-meta")).toContain("summary_b");
  });

  it("names the repeating rows a field enters, one level deep, from the top level", () => {
    const verdict = judgeMove(
      nestedFixtureFields(),
      "f-summary-a",
      { parentFieldId: "f-sections" },
      ctx
    );
    expect(verdict.allowed && verdict.repeatingRowsEntered).toEqual([
      "Sections",
    ]);
  });

  it("names both levels of repeating rows, outermost first, two levels deep", () => {
    const verdict = judgeMove(
      nestedFixtureFields(),
      "f-summary-a",
      { parentFieldId: "f-items-cta" },
      ctx
    );
    expect(verdict.allowed && verdict.repeatingRowsEntered).toEqual([
      "Sections",
      "Items",
    ]);
  });

  it("names only the inner rows for a field moving from an outer row it stays inside", () => {
    const verdict = judgeMove(
      nestedFixtureFields(),
      "f-sections-heading",
      { parentFieldId: "f-items-cta" },
      ctx
    );
    expect(verdict.allowed && verdict.repeatingRowsEntered).toEqual(["Items"]);
  });
});

describe("moves the rule refuses", () => {
  it("into itself", () => {
    expect(
      refusal(
        judgeMove(
          nestedFixtureFields(),
          "f-meta",
          { parentFieldId: "f-meta" },
          ctx
        )
      ).reason
    ).toBe("into-itself");
  });

  it("into a field that holds no fields", () => {
    const { reason, message } = refusal(
      judgeMove(
        nestedFixtureFields(),
        "f-summary-a",
        { parentFieldId: "f-summary-b" },
        ctx
      )
    );
    expect(reason).toBe("not-a-container");
    expect(message).toContain("holds no fields");
  });

  it("into a blocks field, whose blocks are declared in code", () => {
    const { reason, message } = refusal(
      judgeMove(
        nestedFixtureFields(),
        "f-summary-a",
        { parentFieldId: "f-body" },
        ctx
      )
    );
    expect(reason).toBe("into-blocks");
    expect(message).toContain("blocks declared in code");
  });

  it("out of repeating rows, at the top level and nested in a group", () => {
    for (const [id, target] of [
      ["f-sections-heading", {}],
      ["f-cta-label", {}],
      ["f-cta-label", { parentFieldId: "f-meta" }],
    ] as const) {
      const { reason, message } = refusal(
        judgeMove(nestedFixtureFields(), id, target, ctx)
      );
      expect(reason).toBe("out-of-repeating-rows");
      expect(message).toContain("several rows");
      expect(message).toContain("Add a new field there instead");
    }
  });

  it("from one repeating rows into others", () => {
    const fields = [
      ...nestedFixtureFields(),
      plain("f-links", "links", {
        type: "repeater",
        fields: [plain("f-link-url", "url")],
      }),
    ];
    expect(
      refusal(
        judgeMove(fields, "f-link-url", { parentFieldId: "f-sections" }, ctx)
      ).reason
    ).toBe("out-of-repeating-rows");
  });

  it("into a field group, naming it and every place using it, for a collection, a Single and a field group as host", () => {
    for (const host of ["collection", "single", "fieldGroup"]) {
      const { reason, message } = refusal(
        judgeMove(
          nestedFixtureFields(),
          "f-summary-a",
          { parentFieldId: "f-seo" },
          {
            ...ctx,
            topLevelReservesNames: host !== "fieldGroup",
            describeFieldGroup: () => ({
              label: "SEO",
              usedBy: ["Posts", "Pages", "Card"],
            }),
          }
        )
      );
      expect(reason).toBe("into-field-group");
      expect(message).toContain("the field group SEO");
      expect(message).toContain("changed only in its own editor");
      expect(message).toContain("Posts, Pages, Card");
    }
  });

  it("out of a field group, by the same refusal", () => {
    const seo = nestedFixtureFields().find(each => each.id === "f-seo")!;
    const { reason, message } = refusal(
      judgeMove(
        nestedFixtureFields(),
        "f-seo/meta_title",
        {},
        {
          ...ctx,
          fieldGroupFieldHolding: id =>
            id.startsWith("f-seo/") ? seo : undefined,
          describeFieldGroup: () => ({ label: "SEO", usedBy: ["Posts"] }),
        }
      )
    );
    expect(reason).toBe("into-field-group");
    expect(message).toContain("the field group SEO");
  });

  it("a read-only row: built in, owned by code, owned by a plugin, or in a read-only entity", () => {
    const fields = [
      plain("f-sys", "slug", { isSystem: true }),
      ...nestedFixtureFields(),
    ];
    for (const [id, where] of [
      ["f-sys", ctx],
      ["f-legacy-code", ctx],
      ["f-meta-rating", ctx],
      ["f-summary-a", { ...ctx, entityReadOnly: true }],
    ] as const) {
      const { reason, message } = refusal(
        judgeMove(fields, id, { parentFieldId: "f-meta" }, where)
      );
      expect(reason).toBe("read-only");
      expect(message).toContain("cannot move");
    }
  });

  it("into a read-only container, saying where it is defined", () => {
    const fields = [
      ...nestedFixtureFields(),
      plain("f-owned", "owned", {
        type: "group",
        source: "plugin",
        owner: "@acme/seo",
        fields: [],
      }),
    ];
    const { reason, message } = refusal(
      judgeMove(fields, "f-summary-a", { parentFieldId: "f-owned" }, ctx)
    );
    expect(reason).toBe("read-only-container");
    expect(message).toContain("@acme/seo");
  });

  it("a unique field, a one-to-one and a translated one-to-one into a group and into repeating rows", () => {
    const fields = [
      ...nestedFixtureFields(),
      plain("f-code", "code", { advanced: { unique: true } }),
      // A one-to-one, as the server's read gives it to the editor: a
      // relationship marked Unique, loaded through the Builder's own loader.
      {
        ...loaded({
          name: "author",
          label: "Author",
          type: "relationship",
          relationTo: "users",
          unique: true,
        }),
        id: "f-author",
      },
      {
        ...loaded({
          name: "owner",
          label: "Owner",
          type: "relationship",
          relationTo: "users",
          unique: true,
          localized: true,
        }),
        id: "f-owner",
      },
    ];
    for (const id of ["f-code", "f-author", "f-owner"]) {
      for (const into of ["f-meta", "f-sections", "f-items-cta"]) {
        const { reason, message } = refusal(
          judgeMove(fields, id, { parentFieldId: into }, ctx)
        );
        expect(reason).toBe("unique-into-container");
        expect(message).toContain("once it is no longer unique");
      }
    }
  });
});

describe("fields that cannot change place", () => {
  it("are not passed by a reorder, up or down, but a move that passes none is allowed", () => {
    const fields = [
      plain("f-a", "a"),
      plain("f-code", "code_owned", { source: "code" }),
      plain("f-b", "b"),
      plain("f-c", "c"),
    ];
    const down = refusal(
      judgeMove(fields, "f-a", { beforeFieldId: "f-c" }, ctx)
    );
    expect(down.reason).toBe("read-only");
    expect(down.message).toContain("cannot move past");
    expect(
      refusal(judgeMove(fields, "f-c", { beforeFieldId: "f-a" }, ctx)).reason
    ).toBe("read-only");
    expect(
      judgeMove(fields, "f-c", { beforeFieldId: "f-b" }, ctx).allowed
    ).toBe(true);
  });
});

describe("a field among copies that share its id", () => {
  it("refuses moving one of them, since a move by id could not tell which is meant", () => {
    const fields = [
      plain("f-g1", "first", { type: "group", fields: [plain("f-same", "x")] }),
      plain("f-g2", "second", {
        type: "group",
        fields: [plain("f-same", "x")],
      }),
    ];
    expect(refusal(judgeMove(fields, "f-same", {}, ctx))).toEqual({
      reason: "ambiguous-place",
      message:
        "x shares its id with another field, so a move could not tell the two apart.",
    });
  });

  it("judges a carried field's name against a field sharing its id where it arrives", () => {
    // The name check skips only the moved object itself: a field that shares
    // an id with one the layout group carries is another field, whose name counts.
    const fields = [
      plain("f-outer", "outer", {
        type: "group",
        fields: [
          plain("f-layout", "", {
            type: "group",
            fields: [plain("f-same", "x")],
          }),
        ],
      }),
      plain("f-same", "x"),
    ];
    expect(refusal(judgeMove(fields, "f-layout", {}, ctx)).reason).toBe(
      "name-clash"
    );
  });

  it("refuses a place whose id another container shares, which a move could not tell apart", () => {
    const inner = () =>
      plain("f-inner", "inner", { type: "group", fields: [] });
    const fields = [
      plain("f-a", "a"),
      plain("f-g1", "first", { type: "group", fields: [inner()] }),
      plain("f-g2", "second", { type: "group", fields: [inner()] }),
    ];
    const { reason, message } = refusal(
      judgeMove(fields, "f-a", { parentFieldId: "f-inner" }, ctx)
    );
    expect(reason).toBe("ambiguous-place");
    expect(message).toContain("inner");
    // A group holding nothing may carry no `fields` at all; the move would still place into both.
    const bare = () =>
      ({
        id: "f-inner",
        name: "inner",
        label: "inner",
        type: "group",
      }) as BuilderField;
    const bareFields = [
      plain("f-a", "a"),
      plain("f-g1", "first", { type: "group", fields: [bare()] }),
      plain("f-g2", "second", { type: "group", fields: [bare()] }),
    ];
    expect(
      refusal(judgeMove(bareFields, "f-a", { parentFieldId: "f-inner" }, ctx))
        .reason
    ).toBe("ambiguous-place");
  });
});

describe("names that clash where a field arrives", () => {
  /**
   * A field `incoming` inside a group of its own, beside a group holding one field `held`: each
   * move below takes it somewhere new, which is where a name is judged. A reorder among the
   * siblings it already has arrives nowhere new (the cases under "what a move takes with it").
   */
  const tree = (incoming: string, held: string): BuilderField[] => [
    plain("f-source", "source", {
      type: "group",
      fields: [plain("f-incoming", incoming)],
    }),
    plain("f-group", "details", {
      type: "group",
      fields: [plain("f-held", held)],
    }),
    plain("f-top", held === "title" ? "heading" : held),
  ];

  // Judged on the names the save sends (`convertToFieldDefinition`): a name typed in other letter
  // case, or with spaces, is sent as the stored name it becomes, which is then the same name.
  it.each([
    ["the same name", "subtitle", "subtitle"],
    ["a name typed in other letter case", "Subtitle", "subtitle"],
    ["a name typed with spaces", "Sub Title", "sub_title"],
  ])("%s, at the top level and inside a group", (_case, incoming, held) => {
    const words = "the same name";
    // Out of its group, beside a top-level field of the held name.
    const top = refusal(
      judgeMove(
        tree(incoming, held),
        "f-incoming",
        { beforeFieldId: "f-top" },
        ctx
      )
    );
    expect(top.reason).toBe("name-clash");
    expect(top.message).toContain(words);
    // Into the group, beside its field of the held name.
    const inGroup = refusal(
      judgeMove(
        tree(incoming, held).filter(each => each.id !== "f-top"),
        "f-incoming",
        { parentFieldId: "f-group" },
        ctx
      )
    );
    expect(inGroup.reason).toBe("name-clash");
    expect(inGroup.message).toContain(words);
  });

  it("a name a pending delete still holds, until the delete is saved", () => {
    const fields = [
      plain("f-incoming", "headline"),
      plain("f-group", "details", { type: "group", fields: [] }),
    ];
    const { reason, message } = refusal(
      judgeMove(
        fields,
        "f-incoming",
        { parentFieldId: "f-group" },
        {
          ...ctx,
          heldNames: new Map([["f-group", ["Headline"]]]),
        }
      )
    );
    expect(reason).toBe("name-clash");
    expect(message).toContain("until the delete is saved");
  });

  it("a name reserved at the top level, though not inside a group", () => {
    const fields = [
      plain("f-group", "details", {
        type: "group",
        fields: [plain("f-status", "status")],
      }),
    ];
    expect(refusal(judgeMove(fields, "f-status", {}, ctx)).reason).toBe(
      "reserved-name"
    );
    // A field group's own top level reserves no built-in names.
    expect(
      judgeMove(
        fields,
        "f-status",
        {},
        { ...ctx, topLevelReservesNames: false }
      ).allowed
    ).toBe(true);
  });
});

describe("Move to…'s places", () => {
  it("lists every container with the rule's answer for each", () => {
    const places = moveDestinations(nestedFixtureFields(), "f-summary-a", ctx);
    const answers = new Map(
      places.map(place => [
        place.parentFieldId ?? "top",
        place.verdict.allowed ? "ok" : place.verdict.reason,
      ])
    );
    expect(answers.get("top")).toBe("ok");
    expect(answers.get("f-meta")).toBe("ok");
    expect(answers.get("f-sections")).toBe("ok");
    expect(answers.get("f-items-cta")).toBe("ok");
    expect(answers.get("f-body")).toBe("into-blocks");
    expect(answers.get("f-seo")).toBe("into-field-group");
  });
});

describe("while a save cannot keep values across containers", () => {
  // What the Builder asks today: the switch as it ships.
  const today: MoveContext = {
    entityReadOnly: false,
    topLevelReservesNames: true,
  };
  const NOT_YET =
    "Moving a field into or out of a group or repeating rows is not available yet.";

  it.each([
    ["into a group", "f-summary-a", { parentFieldId: "f-meta" }],
    ["out of a group", "f-meta-title", {}],
    ["into repeating rows", "f-summary-a", { parentFieldId: "f-sections" }],
    [
      "into a group inside repeating rows",
      "f-sections-heading",
      { parentFieldId: "f-items-cta" },
    ],
  ])("refuses a move %s, saying so", (_, id, target) => {
    expect(
      refusal(judgeMove(nestedFixtureFields(), id, target, today))
    ).toEqual({ reason: "not-available-yet", message: NOT_YET });
  });

  it("still reorders within the top level and within a nested group", () => {
    const top = moved(
      judgeMove(
        nestedFixtureFields(),
        "f-summary-b",
        { beforeFieldId: "f-summary-a" },
        today
      )
    );
    expect(namesIn(top).slice(0, 3)).toEqual([
      "title",
      "summary_b",
      "summary_a",
    ]);
    const inGroup = moved(
      judgeMove(
        nestedFixtureFields(),
        "f-cta-kind",
        { parentFieldId: "f-items-cta", beforeFieldId: "f-cta-label" },
        today
      )
    );
    expect(namesIn(inGroup, "f-items-cta")).toEqual(["kind", "label"]);
  });

  it("keeps the lasting refusals ahead of it, which say more", () => {
    const answer = (target: { parentFieldId?: string }) =>
      refusal(judgeMove(nestedFixtureFields(), "f-summary-a", target, today))
        .reason;
    expect(answer({ parentFieldId: "f-body" })).toBe("into-blocks");
    expect(answer({ parentFieldId: "f-seo" })).toBe("into-field-group");
    expect(
      refusal(judgeMove(nestedFixtureFields(), "f-cta-label", {}, today)).reason
    ).toBe("out-of-repeating-rows");
  });

  it("offers only the field's own container in Move to…", () => {
    const answers = moveDestinations(
      nestedFixtureFields(),
      "f-summary-a",
      today
    ).map(place => [
      place.parentFieldId ?? "top",
      place.verdict.allowed ? "ok" : place.verdict.reason,
    ]);
    expect(Object.fromEntries(answers)).toMatchObject({
      top: "ok",
      "f-meta": "not-available-yet",
      "f-sections": "not-available-yet",
      "f-items-cta": "not-available-yet",
    });
  });
});

describe("what a move takes with it, and where it arrives", () => {
  it("reorders among siblings whose names already clash in the saved definition", () => {
    // A clash the server already holds is kept allowed on save, and a reorder
    // leaves the field among the siblings it had.
    const fields = [
      plain("f-a", "body"),
      plain("f-b", "Body"),
      plain("f-c", "other"),
    ];
    expect(
      namesIn(moved(judgeMove(fields, "f-b", { beforeFieldId: "f-a" }, ctx)))
    ).toEqual(["Body", "body", "other"]);
    // Arriving from elsewhere under a clashing name is still refused.
    const arriving = [
      ...fields,
      plain("f-g", "group", {
        type: "group",
        fields: [plain("f-d", "BODY")],
      }),
    ];
    expect(refusal(judgeMove(arriving, "f-d", {}, ctx)).reason).toBe(
      "name-clash"
    );
  });

  it("refuses moving a container holding a field that cannot change place", () => {
    // Meta is editable, but Rating inside it is the plugin's.
    expect(
      refusal(
        judgeMove(
          nestedFixtureFields(),
          "f-meta",
          { parentFieldId: "f-sections" },
          ctx
        )
      )
    ).toEqual({
      reason: "read-only",
      message:
        "Meta cannot move to another place: Rating inside it is defined by @acme/reviews, and moving it would change where that field is stored.",
    });
    // Among its own siblings it moves, Rating still inside it.
    expect(
      judgeMove(
        nestedFixtureFields(),
        "f-meta",
        { beforeFieldId: "f-body" },
        ctx
      ).allowed
    ).toBe(true);
  });
});

describe("names as the save sends them, and layout groups", () => {
  it("judges a draft name by the name the save sends", () => {
    // The Builder keeps the name as typed; the save sends it normalised.
    const fields = [
      plain("f-g", "group", {
        type: "group",
        fields: [plain("f-a", "My Field!")],
      }),
      plain("f-b", "my_field"),
    ];
    expect(refusal(judgeMove(fields, "f-a", {}, ctx)).reason).toBe(
      "name-clash"
    );
  });

  it("counts a nameless layout group's fields as siblings of the level holding it", () => {
    const fields = [
      plain("f-layout", "", {
        type: "group",
        fields: [plain("f-inner", "body")],
      }),
      plain("f-g", "group", {
        type: "group",
        fields: [plain("f-out", "Body")],
      }),
    ];
    // Arriving at the top level, beside the layout group's `body`.
    expect(refusal(judgeMove(fields, "f-out", {}, ctx)).reason).toBe(
      "name-clash"
    );
    // Into the layout group from the top level stays on the same level: nothing new to judge.
    const level = [plain("f-x", "x"), ...fields];
    expect(
      judgeMove(level, "f-x", { parentFieldId: "f-layout" }, ctx).allowed
    ).toBe(true);
  });

  it("judges every name a moved layout group carries where it arrives", () => {
    const fields = [
      plain("f-layout", "", {
        type: "group",
        fields: [plain("f-inner", "body")],
      }),
      plain("f-g", "group", {
        type: "group",
        fields: [plain("f-out", "Body")],
      }),
    ];
    expect(
      refusal(judgeMove(fields, "f-layout", { parentFieldId: "f-g" }, ctx))
        .reason
    ).toBe("name-clash");
    // A name reserved at the top level, carried there inside a layout group.
    const nested = [
      plain("f-g", "group", {
        type: "group",
        fields: [
          plain("f-layout", "", {
            type: "group",
            fields: [plain("f-status", "status")],
          }),
        ],
      }),
    ];
    expect(refusal(judgeMove(nested, "f-layout", {}, ctx)).reason).toBe(
      "reserved-name"
    );
  });

  it("lets a unique field into a layout group on its own level, but not into one inside a group", () => {
    const fields = [
      plain("f-code", "code", { advanced: { unique: true } }),
      plain("f-layout", "", { type: "group", fields: [] }),
      plain("f-g", "group", {
        type: "group",
        fields: [plain("f-inner-layout", "", { type: "group", fields: [] })],
      }),
    ];
    expect(
      judgeMove(fields, "f-code", { parentFieldId: "f-layout" }, ctx).allowed
    ).toBe(true);
    expect(
      refusal(
        judgeMove(fields, "f-code", { parentFieldId: "f-inner-layout" }, ctx)
      ).reason
    ).toBe("unique-into-container");
  });
});

describe("leaving repeating rows before the save", () => {
  const fields = () => [
    plain("f-rows", "rows", {
      type: "repeater",
      fields: [plain("f-kept", "kept"), plain("f-new", "fresh")],
    }),
  ];
  const savedIn = (placements: Record<string, string[] | null>) => ({
    ...ctx,
    savedContainerIdsOf: (id: string) => placements[id] ?? null,
  });

  it("lets a field never saved there leave", () => {
    const after = moved(
      judgeMove(fields(), "f-new", {}, savedIn({ "f-kept": ["f-rows"] }))
    );
    expect(namesIn(after)).toEqual(["rows", "fresh"]);
  });

  it("keeps a field whose rows are saved there in them", () => {
    expect(
      refusal(
        judgeMove(fields(), "f-kept", {}, savedIn({ "f-kept": ["f-rows"] }))
      ).reason
    ).toBe("out-of-repeating-rows");
  });

  it("keeps a saved field in its rows when an unsaved group holding it would leave them", () => {
    const wrapped = [
      plain("f-rows", "rows", {
        type: "repeater",
        fields: [
          plain("f-wrap", "wrap", {
            type: "group",
            fields: [plain("f-kept", "kept")],
          }),
        ],
      }),
    ];
    expect(
      refusal(
        judgeMove(wrapped, "f-wrap", {}, savedIn({ "f-kept": ["f-rows"] }))
      ).reason
    ).toBe("out-of-repeating-rows");
  });
});

describe("which moves wait for a save that keeps values", () => {
  // As the Builder asks today: container changes not yet allowed, with the
  // saved placements the editor knows.
  const NOT_YET =
    "Moving a field into or out of a group or repeating rows is not available yet.";
  const fields = () => [
    plain("f-top", "top"),
    plain("f-layout", "", {
      type: "group",
      fields: [plain("f-inside", "inside")],
    }),
    plain("f-rows", "rows", {
      type: "repeater",
      fields: [plain("f-kept", "kept"), plain("f-new", "fresh")],
    }),
  ];
  const today = (saved: Record<string, string[]>): MoveContext => ({
    entityReadOnly: false,
    topLevelReservesNames: true,
    savedContainerIdsOf: id => saved[id] ?? null,
  });
  const saved = {
    "f-top": [],
    "f-layout": [],
    "f-inside": ["f-layout"],
    "f-rows": [],
    "f-kept": ["f-rows"],
  };

  it("lets a field never saved move into and out of repeating rows", () => {
    const out = moved(judgeMove(fields(), "f-new", {}, today(saved)));
    expect(namesIn(out)).toContain("fresh");
    const unsavedTop = [...fields(), plain("f-draft", "draft")];
    const into = moved(
      judgeMove(
        unsavedTop,
        "f-draft",
        { parentFieldId: "f-rows" },
        today(saved)
      )
    );
    expect(namesIn(into, "f-rows")).toEqual(["kept", "fresh", "draft"]);
  });

  it("refuses a saved field's move to another level, saying it is not available yet", () => {
    expect(
      refusal(
        judgeMove(fields(), "f-top", { parentFieldId: "f-rows" }, today(saved))
      )
    ).toEqual({ reason: "not-available-yet", message: NOT_YET });
  });

  it("refuses an unsaved layout group carrying a saved field to another level", () => {
    // The group was added in this draft, but the field inside it is saved on
    // the top level: moving the group into repeating rows takes that field's
    // values along, which a save would not keep.
    const carrying = [
      plain("f-new-layout", "", {
        type: "group",
        fields: [plain("f-old", "old")],
      }),
      plain("f-rows", "rows", { type: "repeater", fields: [] }),
    ];
    expect(
      refusal(
        judgeMove(
          carrying,
          "f-new-layout",
          { parentFieldId: "f-rows" },
          today({ "f-old": [], "f-rows": [] })
        )
      )
    ).toEqual({ reason: "not-available-yet", message: NOT_YET });
  });

  it("allows a saved field's move into and out of a layout group, which keeps its level", () => {
    const into = moved(
      judgeMove(fields(), "f-top", { parentFieldId: "f-layout" }, today(saved))
    );
    expect(namesIn(into, "f-layout")).toEqual(["inside", "top"]);
    const out = moved(judgeMove(fields(), "f-inside", {}, today(saved)));
    expect(namesIn(out)).toContain("inside");
  });
});

describe("savedContainerIdsFrom", () => {
  const saved = [
    plain("f-top", "top"),
    plain("f-g", "group", {
      type: "group",
      fields: [
        plain("f-rows", "rows", {
          type: "repeater",
          fields: [plain("f-deep", "deep")],
        }),
      ],
    }),
  ];

  it("answers each saved field's containers, outermost first", () => {
    const of = savedContainerIdsFrom(saved);
    expect(of("f-top")).toEqual([]);
    expect(of("f-rows")).toEqual(["f-g"]);
    expect(of("f-deep")).toEqual(["f-g", "f-rows"]);
  });

  it("answers null for a field the saved definition does not hold", () => {
    expect(savedContainerIdsFrom(saved)("f-draft")).toBeNull();
  });
});

describe("a layout group's carried names among themselves", () => {
  it("refuses taking a layout group whose fields already clash to another level, naming both", () => {
    // The clash is held where they stand; arriving together elsewhere would make it anew.
    const fields = [
      plain("f-outer", "outer", {
        type: "group",
        fields: [
          plain("f-layout", "", {
            type: "group",
            fields: [plain("f-a", "body"), plain("f-b", "Body")],
          }),
        ],
      }),
    ];
    const answer = refusal(judgeMove(fields, "f-layout", {}, ctx));
    expect(answer.reason).toBe("name-clash");
    expect(answer.message).toContain("body");
    expect(answer.message).toContain("Body");
  });
});

describe("savedFieldsOffTheirLevel", () => {
  const saved = [
    plain("f-body", "body"),
    plain("f-layout", "", { type: "group", fields: [] }),
    plain("f-g", "group", { type: "group", fields: [plain("f-in", "inner")] }),
  ];

  it("finds a saved field a renamed layout group took to another level", () => {
    const current = [
      plain("f-layout", "box", {
        type: "group",
        fields: [plain("f-body", "body")],
      }),
      plain("f-g", "group", {
        type: "group",
        fields: [plain("f-in", "inner")],
      }),
    ];
    expect(savedFieldsOffTheirLevel(saved, current).map(f => f.id)).toEqual([
      "f-body",
    ]);
  });

  it("finds the fields of a group whose name was taken away", () => {
    const current = [
      plain("f-body", "body"),
      plain("f-layout", "", { type: "group", fields: [] }),
      plain("f-g", "", { type: "group", fields: [plain("f-in", "inner")] }),
    ];
    expect(savedFieldsOffTheirLevel(saved, current).map(f => f.id)).toEqual([
      "f-in",
    ]);
  });

  it("finds nothing for a move within a level, or a field never saved", () => {
    const current = [
      plain("f-layout", "", {
        type: "group",
        fields: [plain("f-body", "body"), plain("f-new", "fresh")],
      }),
      plain("f-g", "group", {
        type: "group",
        fields: [plain("f-in", "inner"), plain("f-new2", "fresh2")],
      }),
    ];
    expect(savedFieldsOffTheirLevel(saved, current)).toEqual([]);
  });
});
