/**
 * Where a field's values are stored, and whether a move between two definitions keeps them: a
 * move into or out of a group is planned with the two places, and every move a group cannot hold
 * is refused, saying why, before anything changes.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { checkMove, definitionRefusal, placeOf } from "../check-move";

const text = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type: "text", ...extra }) as FieldDefinition;
const group = (
  name: string,
  fields: FieldDefinition[],
  extra: Record<string, unknown> = {}
) =>
  ({ name, label: name, type: "group", fields, ...extra }) as FieldDefinition;

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
    const fields = [
      { type: "group", fields: [text("body")] } as FieldDefinition,
    ];
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

  // At any depth: the walk that finds the place a field moves to has no bound, so a field kept unique
  // is refused however many containers deep the place is, and named by the first it enters.
  it.each([
    ...[1, 2, 3, 4, 5, 8, 16].map(depth => ["group", depth] as const),
    ...[1, 2, 3, 4, 5, 8, 16].map(depth => ["repeater", depth] as const),
  ])(
    "refuses a field the database keeps unique into a %s, its containers %i deep, naming the outermost",
    (outermost, depth) => {
      const chain = Array.from({ length: depth }, (_, at) => ({
        name: `level${at}`,
        // The outermost is of the kind asked for; every container below it alternates.
        type: at === 0 ? outermost : at % 2 === 0 ? "repeater" : "group",
      }));
      const nested = (inside: FieldDefinition[]): FieldDefinition[] =>
        chain.reduceRight(
          (fields, container) => [
            { ...container, fields } as unknown as FieldDefinition,
          ],
          inside
        );
      const slug = text("slug", { unique: true });
      const path = chain.map(({ name }) => name);
      const checked = checkMove([slug, ...nested([])], nested([slug]), {
        from: ["slug"],
        to: [...path, "slug"],
      });
      expect(checked).toMatchObject({ ok: false, reason: "unique" });
      expect(checked.ok ? "" : checked.message).toContain(
        `slug cannot be moved into the ${outermost} level0: a ${outermost} keeps its values in one JSON value, which cannot be kept unique.`
      );
    }
  );

  // A field already inside a repeater is refused for its rows, whatever it is: taking its uniqueness
  // away would not make the move possible, so the message never says it would.
  it.each([
    [
      "out to the row",
      ["items"],
      ["slug"],
      "out-of-repeater",
      /cannot be moved out of the repeating rows items/,
    ],
    [
      "into a group outside it",
      ["items"],
      ["meta", "slug"],
      "out-of-repeater",
      /cannot be moved out of the repeating rows items/,
    ],
    [
      "into a group inside it",
      ["items"],
      ["items", "row", "slug"],
      "within-repeater",
      /^Moving slug within the repeating rows items is not available yet\./,
    ],
  ] as const)(
    "refuses a unique field inside a repeater moved %s for its rows, not its uniqueness",
    (_what, _from, to, reason, message) => {
      const slug = text("slug", { unique: true });
      const items = (inside: FieldDefinition[], row: FieldDefinition[]) =>
        ({
          name: "items",
          type: "repeater",
          fields: [...inside, group("row", row)],
        }) as unknown as FieldDefinition;
      const checked = checkMove(
        [items([slug], []), group("meta", [])],
        [
          items(to[0] === "items" ? [] : [], to[0] === "items" ? [slug] : []),
          ...(to[0] === "slug" ? [slug] : []),
          group("meta", to[0] === "meta" ? [slug] : []),
        ],
        { from: ["items", "slug"], to: [...to] }
      );
      expect(checked).toMatchObject({ ok: false, reason });
      expect(checked.ok ? "" : checked.message).toMatch(message);
    }
  );

  // A container no move goes into or out of, or that stores nothing, refuses the move whatever the
  // field is: taking its uniqueness away would not make the move possible, so the message never
  // says it would, though the first container the move enters is a group.
  it.each([
    ["component", "field-group"],
    ["fieldGroup", "field-group"],
    ["blocks", "blocks"],
    ["virtual", "no-column"],
  ] as const)(
    "refuses a unique field into a %s inside a group, and out of one into a group, for the container",
    (type, reason) => {
      const slug = text("slug", { unique: true });
      const held = (...fields: FieldDefinition[]) =>
        (type === "virtual"
          ? group("inner", fields, { virtual: true })
          : { name: "inner", type, fields }) as unknown as FieldDefinition;
      const refusedFor = (
        before: FieldDefinition[],
        after: FieldDefinition[],
        from: string[],
        to: string[]
      ) => {
        const checked = checkMove(before, after, { from, to });
        expect(checked).toMatchObject({ ok: false, reason });
        expect(checked.ok ? "" : checked.message).not.toMatch(/unique/);
      };
      refusedFor(
        [slug, group("meta", [held()])],
        [group("meta", [held(slug)])],
        ["slug"],
        ["meta", "inner", "slug"]
      );
      refusedFor(
        [held(slug), group("meta", [])],
        [held(), group("meta", [slug])],
        ["inner", "slug"],
        ["meta", "slug"]
      );
    }
  );

  // Uniqueness is judged before the repeater: what stops the move is that its values would lose
  // their uniqueness, which the repeater's own "not available yet" would not say.
  it("refuses a field the database keeps unique into a repeater, naming the repeater", () => {
    const items = (fields: FieldDefinition[]) =>
      ({
        name: "items",
        label: "items",
        type: "repeater",
        fields,
      }) as unknown as FieldDefinition;
    const checked = checkMove(
      [text("slug", { unique: true }), items([])],
      [items([text("slug", { unique: true })])],
      { from: ["slug"], to: ["items", "slug"] }
    );
    expect(checked).toMatchObject({ ok: false, reason: "unique" });
    expect(checked.ok ? "" : checked.message).toBe(
      "slug cannot be moved into the repeater items: a repeater keeps its values in one JSON value, which cannot be kept unique. It can be moved once it is no longer unique (a one-to-one changed to many-to-one, or its unique setting removed), as a change of its own."
    );
    // At any depth: into a group inside the repeater, the repeater is what it enters first.
    const deep = checkMove(
      [text("slug", { unique: true }), items([group("meta", [])])],
      [items([group("meta", [text("slug", { unique: true })])])],
      { from: ["slug"], to: ["items", "meta", "slug"] }
    );
    expect(deep).toMatchObject({ ok: false, reason: "unique" });
    expect(deep.ok ? "" : deep.message).toMatch(
      /^slug cannot be moved into the repeater items: a repeater keeps/
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
    const checked = checkMove(
      [owner, group("meta", [])],
      [group("meta", [owner])],
      {
        from: ["owner"],
        to: ["meta", "owner"],
      }
    );
    expect(checked).toMatchObject({ ok: false, reason: "unique" });
  });

  it("refuses a move into repeating rows as not available yet, and out of them as losing rows", () => {
    const rowsBefore = [
      text("title"),
      {
        name: "items",
        type: "repeater",
        fields: [],
      } as unknown as FieldDefinition,
    ];
    const rowsAfter = [
      {
        name: "items",
        type: "repeater",
        fields: [text("title")],
      } as unknown as FieldDefinition,
    ];
    expect(
      checkMove(rowsBefore, rowsAfter, {
        from: ["title"],
        to: ["items", "title"],
      })
    ).toMatchObject({ ok: false, reason: "into-repeater" });
    expect(
      checkMove(rowsAfter, rowsBefore, {
        from: ["items", "title"],
        to: ["title"],
      })
    ).toMatchObject({ ok: false, reason: "out-of-repeater" });
  });

  it("refuses a move into or out of a field group, which is changed in its own editor", () => {
    const placed = {
      name: "seo",
      type: "component",
      component: "seo",
      fields: [text("title")],
    } as unknown as FieldDefinition;
    expect(
      checkMove(
        [placed],
        [text("title"), { ...placed, fields: [] } as FieldDefinition],
        {
          from: ["seo", "title"],
          to: ["title"],
        }
      )
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
    const placed = {
      name: "seo",
      label: "SEO",
      type: "component",
      component: "seo",
    } as unknown as FieldDefinition;
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
      checkMove(
        [virtual, group("meta", [])],
        [group("meta", [text("preview")])],
        {
          from: ["preview"],
          to: ["meta", "preview"],
        }
      )
    ).toMatchObject({ ok: false });
    // The same type, a number becoming a list of numbers: a scalar is not the list it now holds.
    const views = {
      name: "views",
      label: "Views",
      type: "number",
    } as FieldDefinition;
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

  it("refuses a relationship moved while what it relates to changes", () => {
    const author = (relationTo: string) =>
      ({
        name: "author",
        label: "Author",
        type: "relationship",
        relationTo,
      }) as FieldDefinition;
    const checked = checkMove(
      [author("users"), group("meta", [])],
      [group("meta", [author("editors")])],
      { from: ["author"], to: ["meta", "author"] }
    );
    expect(checked).toMatchObject({ ok: false, reason: "type-changed" });
    expect((checked as { message: string }).message).toMatch(
      /changes what it relates to in the same save/
    );
  });

  it("refuses a relationship moved while the target its options name changes, as reads take it", () => {
    // A relationship with no `relationTo` relates to `options.target`, as reads resolve it.
    const author = (target: string) =>
      ({
        name: "author",
        label: "Author",
        type: "relationship",
        options: { target },
      }) as unknown as FieldDefinition;
    const checked = checkMove(
      [author("users"), group("meta", [])],
      [group("meta", [author("editors")])],
      { from: ["author"], to: ["meta", "author"] }
    );
    expect(checked).toMatchObject({ ok: false, reason: "type-changed" });
    expect(
      checkMove(
        [author("users"), group("meta", [])],
        [group("meta", [author("users")])],
        { from: ["author"], to: ["meta", "author"] }
      )
    ).toMatchObject({ ok: true });
  });

  it("refuses a decimal moved while its precision or scale changes, which the copy would round", () => {
    const amount = (extra: Record<string, unknown> = {}) =>
      ({
        name: "amount",
        label: "Amount",
        type: "number",
        dbType: "decimal",
        ...extra,
      }) as unknown as FieldDefinition;
    const out = (from: FieldDefinition, to: FieldDefinition) =>
      checkMove([group("meta", [from])], [to, group("meta", [])], {
        from: ["meta", "amount"],
        to: ["amount"],
      });
    expect(out(amount({ scale: 2 }), amount({ scale: 1 }))).toMatchObject({
      ok: false,
      reason: "type-changed",
    });
    expect(
      out(amount({ precision: 10 }), amount({ precision: 6 }))
    ).toMatchObject({ ok: false, reason: "type-changed" });
    // The same precision and scale, one stated and one by the default, still moves.
    expect(out(amount(), amount({ precision: 10, scale: 2 }))).toMatchObject({
      ok: true,
    });
  });

  // Its column is made unique as the move fills it: the repeats are counted before anything is
  // written, and the file stops over any the database it runs on holds (`repeatedValuesStop`).
  it("plans a move out of a group into a unique field", () => {
    const checked = checkMove(
      [group("meta", [text("slug")])],
      [text("slug", { unique: true }), group("meta", [])],
      { from: ["meta", "slug"], to: ["slug"] }
    );
    expect(checked).toMatchObject({
      ok: true,
      move: { to: { kind: "column", column: "slug" } },
    });
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
      ({
        name: "items",
        label: "Items",
        type: "repeater",
        fields,
      }) as unknown as FieldDefinition;
    expect(
      checkMove(
        [rows([text("title"), group("meta", [])])],
        [rows([group("meta", [text("title")])])],
        { from: ["items", "title"], to: ["items", "meta", "title"] }
      )
    ).toMatchObject({ ok: false, reason: "within-repeater" });
  });

  it("judges a container that kept its name but changed type as one the field leaves", () => {
    const rows = {
      name: "box",
      type: "repeater",
      fields: [text("title")],
    } as unknown as FieldDefinition;
    const boxGroup = group("box", [group("meta", [text("title")])]);
    expect(
      checkMove([rows], [boxGroup], {
        from: ["box", "title"],
        to: ["box", "meta", "title"],
      })
    ).toMatchObject({ ok: false, reason: "out-of-repeater" });
  });

  // The field group is named with every collection, Single and field group using it, directly or
  // through another field group, as the save reads them (`fieldGroupUsers`).
  it("names a field group's every user when it refuses a move into or out of it", () => {
    const placed = {
      name: "seo",
      label: "SEO",
      type: "component",
      component: "seo_box",
      fields: [],
    } as unknown as FieldDefinition;
    const holding = { ...placed, fields: [text("title")] } as FieldDefinition;
    const checked = checkMove(
      [text("title"), placed],
      [holding],
      { from: ["title"], to: ["seo", "title"] },
      {
        fieldGroupUsers: slug =>
          slug === "seo_box"
            ? {
                uses: [
                  { entityType: "collection", entitySlug: "posts" },
                  { entityType: "collection", entitySlug: "articles" },
                  { entityType: "fieldGroup", entitySlug: "card" },
                  {
                    entityType: "single",
                    entitySlug: "home",
                    via: ["card"],
                  },
                ],
                complete: true,
              }
            : undefined,
      }
    );
    expect(checked).toMatchObject({ ok: false, reason: "field-group" });
    expect(checked.ok ? "" : checked.message).toBe(
      "title cannot be moved into or out of the field group seo_box: a field group is changed only in its own editor. It is used by the collection posts, the collection articles, the field group card, the Single home (through card)."
    );
  });

  // A blocks field holds blocks declared in code, not fields, so no path goes through it: a move
  // naming one is refused saying that, where it would otherwise read as naming no field.
  it("refuses a move into or out of a blocks field, which holds blocks declared in code", () => {
    const body = {
      name: "body",
      label: "Body",
      type: "blocks",
    } as unknown as FieldDefinition;
    const into = checkMove([text("title"), body], [body], {
      from: ["title"],
      to: ["body", "title"],
    });
    expect(into).toMatchObject({ ok: false, reason: "blocks" });
    expect(into.ok ? "" : into.message).toBe(
      "title cannot be moved into or out of Body: a blocks field holds blocks declared in code, not fields."
    );
    expect(
      checkMove([body], [text("title"), body], {
        from: ["body", "title"],
        to: ["title"],
      })
    ).toMatchObject({ ok: false, reason: "blocks" });
  });

  // A host's stored definition holds a field group by reference, without its fields, so its paths
  // go through the reference: refused for the field group, where they would read as naming no field.
  it("refuses a move into or out of a field group held by reference, naming its users", () => {
    const placed = {
      name: "card",
      label: "Card",
      type: "component",
      component: "card_box",
    } as unknown as FieldDefinition;
    const users = {
      fieldGroupUsers: (slug: string) =>
        slug === "card_box"
          ? {
              uses: [
                { entityType: "collection" as const, entitySlug: "posts" },
              ],
              complete: false,
            }
          : undefined,
    };
    const out = checkMove(
      [placed],
      [text("summary"), placed],
      { from: ["card", "summary"], to: ["summary"] },
      users
    );
    expect(out).toMatchObject({ ok: false, reason: "field-group" });
    expect(out.ok ? "" : out.message).toBe(
      "summary cannot be moved into or out of the field group card_box: a field group is changed only in its own editor. It is used by the collection posts, and others you may not read."
    );
    expect(
      checkMove(
        [text("summary"), placed],
        [placed],
        { from: ["summary"], to: ["card", "summary"] },
        users
      )
    ).toMatchObject({ ok: false, reason: "field-group" });
  });

  it("refuses a move into a field group spelled either way", () => {
    for (const type of ["component", "fieldGroup"]) {
      const placed = {
        name: "seo",
        type,
        fields: [],
      } as unknown as FieldDefinition;
      const holding = {
        ...placed,
        fields: [text("title")],
      } as unknown as FieldDefinition;
      expect(
        checkMove([text("title"), placed], [holding], {
          from: ["title"],
          to: ["seo", "title"],
        })
      ).toMatchObject({ ok: false, reason: "field-group" });
    }
  });

  describe("in an entity kept per language", () => {
    const translated = { localized: true };

    it("refuses a translated field into a group that keeps one value for every language", () => {
      expect(
        checkMove(
          before,
          after,
          { from: ["title"], to: ["meta", "title"] },
          translated
        )
      ).toMatchObject({ ok: false, reason: "translation-changes" });
    });

    it("plans a translated field into a translated group, each language's value moving with it", () => {
      const translatedAfter = [
        group("meta", [text("summary"), text("title")], { localized: true }),
      ];
      expect(
        checkMove(
          before,
          translatedAfter,
          { from: ["title"], to: ["meta", "title"] },
          translated
        )
      ).toMatchObject({ ok: true, move: { perLanguage: true } });
    });

    it("plans a field kept once for every language into a group kept the same way", () => {
      const shared = [text("code", { localized: false }), group("meta", [])];
      const sharedAfter = [group("meta", [text("code", { localized: false })])];
      expect(
        checkMove(
          shared,
          sharedAfter,
          { from: ["code"], to: ["meta", "code"] },
          translated
        )
      ).toMatchObject({ ok: true, move: { perLanguage: false } });
    });
  });
});

// What a road that would refuse a move for a reason of its own says first: only what the two field
// lists decide alone, so a message never answers with a reason the road may know better.
describe("definitionRefusal", () => {
  const before = [
    { name: "code", type: "text", unique: true },
    { name: "tags", type: "text" },
    { name: "label", type: "text" },
    {
      name: "items",
      type: "repeater",
      fields: [{ name: "note", type: "text" }],
    },
    { name: "meta", type: "group", fields: [{ name: "note", type: "text" }] },
    { name: "page", type: "blocks" },
    { name: "card", type: "component", component: "card" },
  ] as unknown as FieldDefinition[];
  const moved = (name: string, into: string) =>
    before.map(field =>
      (field as { name?: string }).name === into
        ? {
            ...field,
            fields: [
              ...((field as { fields?: object[] }).fields ?? []),
              before.find(each => (each as { name?: string }).name === name),
            ],
          }
        : (field as { name?: string }).name === name
          ? undefined
          : field
    ) as unknown as FieldDefinition[];

  it.each([
    ["a field kept unique into a group", "code", "meta"],
    ["a field kept unique into a repeater", "code", "items"],
    ["a field into a repeater", "label", "items"],
  ] as const)("says %s refused, for what it is", (_what, name, into) => {
    expect(
      definitionRefusal(before, moved(name, into).filter(Boolean) as never, {
        from: [name],
        to: [into, name],
      })
    ).toBeTypeOf("string");
  });

  it("says nothing of a move that is allowed, or is refused for a reason of another kind", () => {
    const allowed = moved("tags", "meta").filter(Boolean) as never;
    expect(
      definitionRefusal(before, allowed, {
        from: ["tags"],
        to: ["meta", "tags"],
      })
    ).toBeUndefined();
    // The same name at a place that does not exist is a save that does not match its fields.
    expect(
      definitionRefusal(before, before, {
        from: ["gone"],
        to: ["meta", "gone"],
      })
    ).toBeUndefined();
  });

  it("says a field group refused only with its users to name", () => {
    const after = before;
    const request = { from: ["label"], to: ["card", "label"] };
    expect(definitionRefusal(before, after, request)).toBeUndefined();
    expect(
      definitionRefusal(before, after, request, {
        fieldGroupUsers: () => ({ uses: [], complete: true }),
      })
    ).toMatch(/cannot be moved into or out of the field group card/);
  });
});
