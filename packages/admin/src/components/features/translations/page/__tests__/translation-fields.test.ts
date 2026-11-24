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

  it("names a shared field that holds nothing yet", () => {
    const set = translationFields([field("price", "number")], {
      price: null,
      _allLocales: {},
    });
    expect(names(set.shared)).toEqual(["price"]);
  });

  it("keeps a container's own text apart from the rows", () => {
    const set = translationFields(
      [
        field("seo", "fieldGroup"),
        field("links", "repeater"),
        field("layout", "blocks"),
        field("body", "richText"),
      ],
      { _allLocales: perLanguage("seo", "links", "layout", "body") }
    );
    expect(names(set.rows)).toEqual(["body"]);
    expect(names(set.nested)).toEqual(["seo", "links", "layout"]);
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
