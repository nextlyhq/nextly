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
  it("moves that one field, leaving the other where it is", () => {
    const fields = [
      plain("f-g1", "first", { type: "group", fields: [plain("f-same", "x")] }),
      plain("f-g2", "second", {
        type: "group",
        fields: [plain("f-same", "x")],
      }),
    ];
    const after = moved(judgeMove(fields, "f-same", {}, ctx));
    expect(namesIn(after, "f-g1")).toEqual([]);
    expect(namesIn(after, "f-g2")).toEqual(["x"]);
    expect(namesIn(after)).toEqual(["first", "second", "x"]);
  });
});

describe("names that clash where a field arrives", () => {
  /** A top-level field `incoming` beside a group holding one field `held`. */
  const tree = (incoming: string, held: string): BuilderField[] => [
    plain("f-incoming", incoming),
    plain("f-group", "details", {
      type: "group",
      fields: [plain("f-held", held)],
    }),
    plain("f-top", held === "title" ? "heading" : held),
  ];

  it.each([
    ["the same name", "subtitle", "subtitle"],
    ["the same name in other letter case", "Subtitle", "subtitle"],
    ["a name that becomes the same column", "subTitle", "sub_title"],
  ])("%s, at the top level and inside a group", (words, incoming, held) => {
    // Beside a top-level field of the held name.
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
