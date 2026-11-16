/**
 * Where a field's values are stored, and whether a move between two definitions keeps them: a
 * move into or out of a group is planned with the two places, and every move a group cannot hold
 * is refused, saying why, before anything changes.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { checkMove, placeOf } from "../check-move";

const text = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type: "text", ...extra }) as FieldDefinition;
const group = (
  name: string,
  fields: FieldDefinition[],
  extra: Record<string, unknown> = {}
) => ({ name, label: name, type: "group", fields, ...extra }) as FieldDefinition;

describe("placeOf", () => {
  it("places a top-level field in its own column, by its name in snake case", () => {
    const found = placeOf([text("subTitle")], ["subTitle"]);
    expect(found).toMatchObject({
      place: { kind: "column", column: "sub_title" },
    });
  });

  it("places a field in a group under its name, inside the group's column", () => {
    const fields = [group("pageMeta", [group("seo", [text("metaTitle")])])];
    expect(placeOf(fields, ["pageMeta", "seo", "metaTitle"])).toMatchObject({
      place: { kind: "json", column: "page_meta", keys: ["seo", "metaTitle"] },
    });
  });

  it("looks through a group with no name, whose fields are stored beside it", () => {
    const fields = [{ type: "group", fields: [text("body")] } as FieldDefinition];
    expect(placeOf(fields, ["body"])).toMatchObject({
      place: { kind: "column", column: "body" },
    });
  });

  it("is null for a path no field has", () => {
    expect(placeOf([text("title")], ["meta", "title"])).toBeNull();
  });
});

describe("checkMove", () => {
  const before = [text("title"), group("meta", [text("summary")])];
  const after = [group("meta", [text("summary"), text("title")])];

  it("plans a move into a group, from the column to the key", () => {
    const checked = checkMove(before, after, {
      from: ["title"],
      to: ["meta", "title"],
    });
    expect(checked).toEqual({
      ok: true,
      move: expect.objectContaining({
        from: { kind: "column", column: "title" },
        to: { kind: "json", column: "meta", keys: ["title"] },
      }),
    });
  });

  it("plans a move out of a group, from the key to a column", () => {
    const checked = checkMove(after, before, {
      from: ["meta", "title"],
      to: ["title"],
    });
    expect(checked).toMatchObject({
      ok: true,
      move: {
        from: { kind: "json", column: "meta", keys: ["title"] },
        to: { kind: "column", column: "title" },
      },
    });
  });

  it("refuses a move whose field is not where it says, before or after", () => {
    expect(
      checkMove(before, after, { from: ["subtitle"], to: ["meta", "title"] })
    ).toMatchObject({ ok: false, reason: "not-found" });
    expect(
      checkMove(before, after, { from: ["title"], to: ["meta", "heading"] })
    ).toMatchObject({ ok: false, reason: "not-found" });
  });

  it("refuses a move that also changes the field's type", () => {
    const changed = [
      group("meta", [text("summary"), { ...text("title"), type: "textarea" }]),
    ];
    expect(
      checkMove(before, changed, { from: ["title"], to: ["meta", "title"] })
    ).toMatchObject({ ok: false, reason: "type-changed" });
  });

  it("refuses a field the database keeps unique into a group, saying why", () => {
    const uniqueBefore = [text("slug", { unique: true }), group("meta", [])];
    const uniqueAfter = [group("meta", [text("slug", { unique: true })])];
    const checked = checkMove(uniqueBefore, uniqueAfter, {
      from: ["slug"],
      to: ["meta", "slug"],
    });
    expect(checked).toMatchObject({ ok: false, reason: "unique" });
    expect(checked.ok ? "" : checked.message).toMatch(
      /one JSON value, which cannot be kept unique/
    );
  });

  it("refuses a one-to-one relationship into a group", () => {
    const owner = {
      name: "owner",
      label: "Owner",
      type: "relationship",
      relationTo: "users",
      options: { relationType: "oneToOne" },
    } as unknown as FieldDefinition;
    const checked = checkMove([owner, group("meta", [])], [group("meta", [owner])], {
      from: ["owner"],
      to: ["meta", "owner"],
    });
    expect(checked).toMatchObject({ ok: false, reason: "unique" });
  });

  it("refuses a move into repeating rows as not available yet, and out of them as losing rows", () => {
    const rowsBefore = [text("title"), { name: "items", type: "repeater", fields: [] } as unknown as FieldDefinition];
    const rowsAfter = [{ name: "items", type: "repeater", fields: [text("title")] } as unknown as FieldDefinition];
    expect(
      checkMove(rowsBefore, rowsAfter, { from: ["title"], to: ["items", "title"] })
    ).toMatchObject({ ok: false, reason: "into-repeater" });
    expect(
      checkMove(rowsAfter, rowsBefore, { from: ["items", "title"], to: ["title"] })
    ).toMatchObject({ ok: false, reason: "out-of-repeater" });
  });

  it("refuses a move into or out of a field group, which is changed in its own editor", () => {
    const placed = { name: "seo", type: "component", component: "seo", fields: [text("title")] } as unknown as FieldDefinition;
    expect(
      checkMove([placed], [text("title"), { ...placed, fields: [] } as FieldDefinition], {
        from: ["seo", "title"],
        to: ["title"],
      })
    ).toMatchObject({ ok: false, reason: "field-group" });
  });

  it("refuses a field with no column of its own, whose values are not on the row", () => {
    const virtual = text("preview", { virtual: true });
    expect(
      checkMove([virtual, group("meta", [])], [group("meta", [virtual])], {
        from: ["preview"],
        to: ["meta", "preview"],
      })
    ).toMatchObject({ ok: false, reason: "no-column" });
    const placed = { name: "seo", label: "SEO", type: "component", component: "seo" } as unknown as FieldDefinition;
    expect(
      checkMove([placed, group("meta", [])], [group("meta", [placed])], {
        from: ["seo"],
        to: ["meta", "seo"],
      })
    ).toMatchObject({ ok: false, reason: "no-column" });
  });

  it("refuses a move that also changes where or how the field stores its values", () => {
    // Virtual before, stored after: there was no column to move from.
    const virtual = text("preview", { virtual: true });
    expect(
      checkMove([virtual, group("meta", [])], [group("meta", [text("preview")])], {
        from: ["preview"],
        to: ["meta", "preview"],
      })
    ).toMatchObject({ ok: false });
    // The same type, a number becoming a list of numbers: a scalar is not the list it now holds.
    const views = { name: "views", label: "Views", type: "number" } as FieldDefinition;
    const many = { ...views, hasMany: true } as FieldDefinition;
    expect(
      checkMove([views, group("meta", [])], [group("meta", [many])], {
        from: ["views"],
        to: ["meta", "views"],
      })
    ).toMatchObject({ ok: false, reason: "type-changed" });
  });

  it("refuses a move into or out of a group that stores nothing", () => {
    const before = [text("title"), group("meta", [], { virtual: true })];
    const after = [group("meta", [text("title")], { virtual: true })];
    expect(
      checkMove(before, after, { from: ["title"], to: ["meta", "title"] })
    ).toMatchObject({ ok: false, reason: "no-column" });
    expect(
      checkMove(after, before, { from: ["meta", "title"], to: ["title"] })
    ).toMatchObject({ ok: false, reason: "no-column" });
  });

  it("refuses a move into a stored group through a container inside it that stores nothing", () => {
    const computed = group("computed", [], { virtual: true });
    const before = [text("title"), group("meta", [computed])];
    const after = [
      group("meta", [group("computed", [text("title")], { virtual: true })]),
    ];
    expect(
      checkMove(before, after, {
        from: ["title"],
        to: ["meta", "computed", "title"],
      })
    ).toMatchObject({ ok: false, reason: "no-column" });
  });

  it("refuses a move that stays inside a field group, whose values are in its own table", () => {
    const placed = (fields: FieldDefinition[]) =>
      ({
        name: "seo",
        type: "component",
        component: "seo",
        fields,
      }) as unknown as FieldDefinition;
    expect(
      checkMove(
        [placed([text("title"), group("meta", [])])],
        [placed([group("meta", [text("title")])])],
        { from: ["seo", "title"], to: ["seo", "meta", "title"] }
      )
    ).toMatchObject({ ok: false });
  });

  it("refuses a move out of a group into a unique field, whose values would arrive after the uniqueness", () => {
    const checked = checkMove(
      [group("meta", [text("slug")])],
      [text("slug", { unique: true }), group("meta", [])],
      { from: ["meta", "slug"], to: ["slug"] }
    );
    expect(checked).toMatchObject({ ok: false, reason: "unique" });
    expect((checked as { message: string }).message).toMatch(
      /Move it first, then make it unique as a change of its own/
    );
  });

  it("refuses a move into a group in the same save that takes the field's uniqueness away", () => {
    const before = [text("slug", { unique: true }), group("meta", [])];
    const after = [group("meta", [text("slug")])];
    expect(
      checkMove(before, after, { from: ["slug"], to: ["meta", "slug"] })
    ).toMatchObject({ ok: false, reason: "unique" });
  });

  it("refuses a move that stays inside repeating rows, whose column holds a list of rows", () => {
    const rows = (fields: FieldDefinition[]) =>
      ({ name: "items", label: "Items", type: "repeater", fields }) as unknown as FieldDefinition;
    expect(
      checkMove(
        [rows([text("title"), group("meta", [])])],
        [rows([group("meta", [text("title")])])],
        { from: ["items", "title"], to: ["items", "meta", "title"] }
      )
    ).toMatchObject({ ok: false, reason: "within-repeater" });
  });

  it("judges a container that kept its name but changed type as one the field leaves", () => {
    const rows = { name: "box", type: "repeater", fields: [text("title")] } as unknown as FieldDefinition;
    const boxGroup = group("box", [group("meta", [text("title")])]);
    expect(
      checkMove([rows], [boxGroup], { from: ["box", "title"], to: ["box", "meta", "title"] })
    ).toMatchObject({ ok: false, reason: "out-of-repeater" });
  });

  it("refuses a move into a field group spelled either way", () => {
    for (const type of ["component", "fieldGroup"]) {
      const placed = { name: "seo", type, fields: [] } as unknown as FieldDefinition;
      const holding = { ...placed, fields: [text("title")] } as unknown as FieldDefinition;
      expect(
        checkMove([text("title"), placed], [holding], { from: ["title"], to: ["seo", "title"] })
      ).toMatchObject({ ok: false, reason: "field-group" });
    }
  });

  describe("in an entity kept per language", () => {
    const translated = { localized: true };

    it("refuses a translated field into a group that keeps one value for every language", () => {
      expect(
        checkMove(before, after, { from: ["title"], to: ["meta", "title"] }, translated)
      ).toMatchObject({ ok: false, reason: "translation-changes" });
    });

    it("plans a translated field into a translated group, each language's value moving with it", () => {
      const translatedAfter = [
        group("meta", [text("summary"), text("title")], { localized: true }),
      ];
      expect(
        checkMove(before, translatedAfter, { from: ["title"], to: ["meta", "title"] }, translated)
      ).toMatchObject({ ok: true, move: { perLanguage: true } });
    });

    it("plans a field kept once for every language into a group kept the same way", () => {
      const shared = [text("code", { localized: false }), group("meta", [])];
      const sharedAfter = [group("meta", [text("code", { localized: false })])];
      expect(
        checkMove(shared, sharedAfter, { from: ["code"], to: ["meta", "code"] }, translated)
      ).toMatchObject({ ok: true, move: { perLanguage: false } });
    });
  });
});
