// A translated text inside a container keeping its text per language, turned into a type that is
// not translated, is refused before any value is read (`textHeldPerLanguageRefusals`): each
// language's text is in the container's overlay, which the structure the change is judged over
// does not hold. Refused only there: on an entity whose values are all on its rows (the earlier
// layout), for a text a container inside marks shared, and for a row's own `id`, the value is on
// the structure, and the change is judged as any other.

import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../../schemas/dynamic-collections";
import {
  fieldTypeChangesOf,
  textHeldPerLanguageRefusals,
  type EntityTypeChangeInput,
} from "../field-type-changes";

const f = (field: Record<string, unknown>) =>
  field as unknown as FieldDefinition;

function refusalsOf(
  previous: FieldDefinition[],
  next: FieldDefinition[],
  perLanguage: boolean
) {
  const entity: EntityTypeChangeInput = {
    label: "Collection 'posts'",
    table: "dc_posts",
    // Named on every entity by some roads, whatever its layout.
    translationsTable: "dc_posts_locales",
    ...(perLanguage ? { translatedBefore: new Set<string>() } : {}),
    previous,
    next,
    builtBy: "collection",
  };
  const changes = fieldTypeChangesOf({
    previous,
    next,
    dialect: "sqlite",
    builtBy: "collection",
    nested: true,
  });
  return textHeldPerLanguageRefusals(entity, changes).map(r => r.path);
}

const group = (inner: Record<string, unknown>[]) =>
  f({
    name: "details",
    type: "group",
    fields: [{ name: "note", type: "text" }, ...inner],
  });

describe("textHeldPerLanguageRefusals", () => {
  it("refuses a translated text turned into a number inside a container keeping text per language", () => {
    expect(
      refusalsOf(
        [group([{ name: "contact", type: "text" }])],
        [group([{ name: "contact", type: "number" }])],
        true
      )
    ).toEqual(["details.contact"]);
  });

  it("refuses nothing on an entity whose values are all on its rows", () => {
    expect(
      refusalsOf(
        [group([{ name: "contact", type: "text" }])],
        [group([{ name: "contact", type: "number" }])],
        false
      )
    ).toEqual([]);
  });

  it("refuses nothing for a text a container inside marks shared", () => {
    const inner = (type: string) => ({
      name: "meta",
      type: "group",
      localized: false,
      fields: [{ name: "code", type }],
    });
    expect(
      refusalsOf([group([inner("text")])], [group([inner("number")])], true)
    ).toEqual([]);
  });

  // A shape lists its containers by name in a plain object, which answers a built-in's name
  // (`constructor`) with something that is no shape: such a group is read by its own entry alone.
  it("refuses nothing for a text a container named like a built-in marks shared", () => {
    const inner = (type: string) => ({
      name: "constructor",
      type: "group",
      localized: false,
      fields: [{ name: "code", type }],
    });
    expect(
      refusalsOf([group([inner("text")])], [group([inner("number")])], true)
    ).toEqual([]);
  });

  it("refuses nothing for a row's own declared id", () => {
    const rows = (type: string) =>
      f({
        name: "lines",
        type: "repeater",
        fields: [
          { name: "id", type },
          { name: "label", type: "text" },
        ],
      });
    expect(refusalsOf([rows("text")], [rows("number")], true)).toEqual([]);
  });
});
