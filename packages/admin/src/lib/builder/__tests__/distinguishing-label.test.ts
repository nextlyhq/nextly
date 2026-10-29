// Why: a label is not unique in the Builder -- two sibling fields may share
// label AND type, two fields in different containers may share a label, and
// two entities may share a display name. These tests hold that what the helper
// returns for each of a same-labelled pair is text a person can tell apart,
// and that the text says WHAT tells them apart (the field's name in the
// database and API and its place; an entity's kind and slug). Exact strings
// are asserted, because a broken helper that appended an internal id would
// also produce two different strings without telling a person anything.
import { describe, expect, it } from "vitest";

import type { BuilderField } from "../../../components/features/schema-builder/types";
import {
  distinguishEntities,
  distinguishFields,
  type BuilderEntity,
} from "../distinguishing-label";

function field(
  id: string,
  name: string,
  label: string,
  type: BuilderField["type"] = "text",
  fields?: BuilderField[]
): BuilderField {
  return { id, name, label, type, ...(fields ? { fields } : {}) };
}

/** The entry the helper returned for one field id. */
function entryFor(fields: BuilderField[], id: string) {
  const entry = distinguishFields(fields).find(e => e.field.id === id);
  if (!entry) throw new Error(`no entry for ${id}`);
  return entry;
}

describe("distinguishing a label from another of the same label", () => {
  it("two sibling fields of one label and type", () => {
    const fields = [
      field("a", "subtitle", "Subtitle"),
      field("b", "subtitle_2", "Subtitle"),
    ];
    const first = entryFor(fields, "a");
    const second = entryFor(fields, "b");

    // Same label on screen, told apart by the name, labelled as such.
    expect(first.label).toBe("Subtitle");
    expect(second.label).toBe("Subtitle");
    expect(first.text).toBe(
      "Subtitle (name in the database and API: subtitle)"
    );
    expect(second.text).toBe(
      "Subtitle (name in the database and API: subtitle_2)"
    );
    expect(first.text).not.toBe(second.text);
    // A top-level field has no place to name.
    expect(first.place).toBeNull();
  });

  it("two fields of one label in different containers", () => {
    const fields = [
      field("hero", "hero", "Hero", "group", [
        field("hero-sub", "subtitle", "Subtitle"),
      ]),
      field("footer", "footer", "Footer", "repeater", [
        field("footer-sub", "subtitle", "Subtitle"),
      ]),
      // Two containers that share a label too: only the name path parts them.
      field("d1", "details", "Details", "group", [
        field("d1-sub", "subtitle", "Subtitle"),
      ]),
      field("d2", "details_2", "Details", "group", [
        field("d2-sub", "subtitle", "Subtitle"),
      ]),
    ];

    const hero = entryFor(fields, "hero-sub");
    const footer = entryFor(fields, "footer-sub");
    expect(hero.place).toBe("Hero › Subtitle");
    expect(hero.text).toBe(
      "Hero › Subtitle (name in the database and API: hero.subtitle)"
    );
    expect(footer.text).toBe(
      "Footer › Subtitle (name in the database and API: footer.subtitle)"
    );

    const d1 = entryFor(fields, "d1-sub");
    const d2 = entryFor(fields, "d2-sub");
    expect(d1.text).toBe(
      "Details › Subtitle (name in the database and API: details.subtitle)"
    );
    expect(d2.text).toBe(
      "Details › Subtitle (name in the database and API: details_2.subtitle)"
    );

    // Every field in the tree reads differently from every other.
    const texts = distinguishFields(fields).map(e => e.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("two collections of one name", () => {
    const entities: BuilderEntity[] = [
      { kind: "collection", label: "Posts", slug: "posts" },
      { kind: "collection", label: "Posts", slug: "blog_posts" },
      { kind: "single", label: "Posts", slug: "posts" },
      { kind: "field-group", label: "Posts", slug: "posts" },
    ];
    const texts = distinguishEntities(entities).map(e => e.text);

    expect(texts).toEqual([
      "Posts (Collection, slug: posts)",
      "Posts (Collection, slug: blog_posts)",
      "Posts (Single, slug: posts)",
      "Posts (Field group, slug: posts)",
    ]);
    expect(new Set(texts).size).toBe(texts.length);
    // Field groups are "component" only inside the code.
    for (const text of texts)
      expect(text.toLowerCase()).not.toContain("component");
  });
});
