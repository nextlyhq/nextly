/**
 * What the page shows of each field is read off the server's own answer, so a
 * field the reader may not read is nowhere on it, however the schema
 * describes it.
 */
import type { FieldConfig } from "nextly/config";
import { describe, expect, it } from "vitest";

import { translationFields, valuesPerLanguage } from "../translation-fields";

const field = (
  name: string,
  type: string,
  extra: Record<string, unknown> = {}
): FieldConfig => ({ name, type, ...extra }) as unknown as FieldConfig;

const names = (fields: readonly { name: string }[]) =>
  fields.map(each => each.name);

const perLanguage = (...fields: string[]) =>
  Object.fromEntries(fields.map(name => [name, { en: "x", es: null }]));

describe("translationFields", () => {
  it("gives the text kept per language a row each, in the form's order", () => {
    const set = translationFields(
      [field("title", "text"), field("price", "number"), field("body", "text")],
      { price: 3, _allLocales: perLanguage("body", "title") }
    );
    expect(names(set.rows)).toEqual(["title", "body"]);
    expect(names(set.shared)).toEqual(["price"]);
  });

  it("leaves out a field the server withheld, translatable or shared", () => {
    const set = translationFields(
      [
        field("title", "text"),
        field("secret", "text"),
        field("price", "number"),
        field("cost", "number"),
      ],
      // `secret` and `cost` are not in the answer at all.
      { price: 3, _allLocales: perLanguage("title") }
    );
    expect(names(set.rows)).toEqual(["title"]);
    expect(names(set.shared)).toEqual(["price"]);
  });

  it("takes the title and slug a collection declares none of for shared", () => {
    // As the admin is given them: text with nothing saying they are shared,
    // though each is stored once for every language. The server's answer says
    // so, by keeping no value of them per language.
    const system = [
      field("title", "text", { required: true }),
      field("slug", "text", { required: true, unique: true }),
    ];
    const set = translationFields([...system, field("bio", "textarea")], {
      title: "Ada",
      slug: "ada",
      _allLocales: perLanguage("bio"),
    });
    expect(names(set.rows)).toEqual(["bio"]);
    expect(names(set.shared)).toEqual(["title", "slug"]);
    // Declared, and kept per language, they are translated like any text.
    const declared = translationFields(system, {
      title: "Ada",
      slug: "ada",
      _allLocales: perLanguage("title", "slug"),
    });
    expect(names(declared.rows)).toEqual(["title", "slug"]);
  });

  it("names a shared field that holds nothing yet", () => {
    const set = translationFields([field("price", "number")], {
      price: null,
      _allLocales: {},
    });
    expect(names(set.shared)).toEqual(["price"]);
  });

  it("keeps a container's own text apart from the rows, all in the form's order", () => {
    const text = [field("caption", "text")];
    const set = translationFields(
      [
        field("seo", "fieldGroup", { componentFields: text }),
        field("body", "richText"),
        field("links", "repeater", { fields: text }),
        field("intro", "group", { fields: text }),
      ],
      { _allLocales: perLanguage("seo", "links", "intro", "body") }
    );
    expect(names(set.rows)).toEqual(["body"]);
    expect(names(set.nested)).toEqual(["seo", "links", "intro"]);
    expect(names(set.written)).toEqual(["seo", "body", "links", "intro"]);
  });

  it("takes a container that holds no text for shared", () => {
    const numbers = [field("width", "number")];
    const set = translationFields(
      [
        field("sizes", "repeater", { fields: numbers }),
        field("box", "fieldGroup", { componentFields: numbers }),
        field("links", "repeater", {
          fields: [field("caption", "text")],
          localized: false,
        }),
      ],
      { _allLocales: perLanguage("sizes", "box", "links") }
    );
    expect(names(set.shared)).toEqual(["sizes", "box", "links"]);
    expect(names(set.nested)).toEqual([]);
  });

  it("names page-builder content apart, kept per language or shared", () => {
    const set = translationFields(
      [field("layout", "blocks"), field("footer", "blocks")],
      { footer: null, _allLocales: perLanguage("layout") }
    );
    expect(names(set.elsewhere)).toEqual(["layout"]);
    expect(names(set.shared)).toEqual(["footer"]);
    expect(names(set.written)).toEqual([]);
  });

  it("reads into a group that only lays fields out", () => {
    const set = translationFields(
      [{ type: "group", fields: [field("note", "text")] } as never],
      { _allLocales: perLanguage("note") }
    );
    expect(names(set.rows)).toEqual(["note"]);
  });

  it("leaves out what the form hides, alone or by the group around it", () => {
    const hidden = { admin: { hidden: true } };
    const set = translationFields(
      [
        field("title", "text", hidden),
        {
          type: "group",
          ...hidden,
          fields: [field("note", "text")],
        } as never,
        field("body", "text"),
      ],
      { _allLocales: perLanguage("title", "note", "body") }
    );
    expect(names(set.rows)).toEqual(["body"]);
  });

  it("calls a field what the form calls it", () => {
    const [labelled, plain] = translationFields(
      [
        field("jobTitle", "text", { label: "Role / Title" }),
        field("bio", "text"),
      ],
      { _allLocales: perLanguage("jobTitle", "bio") }
    ).rows;
    expect(labelled?.label).toBe("Role / Title");
    expect(plain?.label).toBe("Bio");
  });
});

describe("valuesPerLanguage", () => {
  it("is empty for a read that carries no languages", () => {
    expect(valuesPerLanguage({ title: "x" })).toEqual({});
    expect(valuesPerLanguage({ _allLocales: "x" })).toEqual({});
  });

  it("passes over an entry that is not a language's value", () => {
    expect(
      valuesPerLanguage({ _allLocales: { title: { en: "x" }, odd: "x" } })
    ).toEqual({ title: { en: "x" } });
  });
});
