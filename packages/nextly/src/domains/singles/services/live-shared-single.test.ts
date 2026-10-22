/**
 * Which of a localized document's fields every language shares, and how each
 * is compared: a junction as a set of ids, and a translated component through
 * its instances and the sub-fields it marks shared.
 */
import { describe, expect, it, vi } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { differingFields } from "../../versions/shared-publish-base";

import { sharedComparison } from "./live-shared-single";

function fields(...defs: Record<string, unknown>[]): FieldConfig[] {
  return defs as unknown as FieldConfig[];
}

const componentFields = new Map<string, FieldConfig[]>([
  // Translated: its words are per language, its code shared.
  [
    "banner",
    fields(
      { name: "words", type: "text" },
      { name: "code", type: "text", localized: false }
    ),
  ],
  // Translated, with nothing shared.
  ["note", fields({ name: "body", type: "text" })],
  // Not translated: every sub-field is shared.
  ["hero", fields({ name: "heading", type: "text" })],
]);
const translatedComponents = new Set(["banner", "note"]);

function compare(
  document: Record<string, unknown>,
  isComponentLocalized = (slug: string) =>
    Promise.resolve(translatedComponents.has(slug))
) {
  return sharedComparison({
    fields: fields(
      { name: "title", type: "text" },
      { name: "banner", type: "component", component: "banner" },
      { name: "footer", type: "component", component: "banner" },
      { name: "note", type: "component", component: "note" },
      { name: "hero", type: "component", component: "hero" },
      { name: "blocks", type: "component", components: ["hero", "banner"] },
      { name: "tags", type: "relationship" }
    ),
    translated: new Set(["title"]),
    document,
    componentFields,
    isComponentLocalized,
    unordered: ["tags"],
  });
}

const document = {
  title: "x",
  banner: { words: "w", code: "c", _componentType: "banner" },
  footer: { words: "w", code: "c", _componentType: "banner" },
  note: { body: "b", _componentType: "note" },
  hero: { heading: "h", _componentType: "hero" },
  // A dynamic zone; its second row's type is stored under the migrated
  // spelling.
  blocks: [
    { heading: "h", _componentType: "hero" },
    { words: "w", code: "c", _fieldGroupType: "banner" },
  ],
  tags: ["a", "b"],
};

describe("sharedComparison", () => {
  it("shares the components and relations every language holds, translated components included", async () => {
    const { shared, byHand } = await compare(document);
    expect(shared.sort()).toEqual([
      "banner",
      "blocks",
      "footer",
      "hero",
      "note",
      "tags",
    ]);
    // The translated components' shared parts are left to the editor.
    expect([...byHand].sort()).toEqual(["banner", "blocks", "footer", "note"]);
  });

  it("compares a translated component with nothing shared by its instances", async () => {
    const { shared, views } = await compare(document);
    const otherWords = { ...document, note: { body: "otro" } };
    const anotherInstance = {
      ...document,
      note: [
        { body: "b", _componentType: "note" },
        { body: "b2", _componentType: "note" },
      ],
    };
    expect(differingFields(shared, document, otherWords, views)).toEqual([]);
    expect(differingFields(shared, document, anotherInstance, views)).toEqual([
      "note",
    ]);
  });

  it("reads a dynamic-zone row's type under either spelling", async () => {
    const { shared, views } = await compare(document);
    const newerCode = {
      ...document,
      blocks: [
        { heading: "h", _componentType: "hero" },
        { words: "w", code: "c2", _fieldGroupType: "banner" },
      ],
    };
    const otherWords = {
      ...document,
      blocks: [
        { heading: "h", _componentType: "hero" },
        { words: "otra", code: "c", _componentType: "banner" },
      ],
    };
    expect(differingFields(shared, document, newerCode, views)).toEqual([
      "blocks",
    ]);
    expect(differingFields(shared, document, otherWords, views)).toEqual([]);
  });

  it("compares a translated component by its shared sub-fields alone", async () => {
    const { shared, views } = await compare(document);
    const otherLanguage = {
      ...document,
      banner: { words: "otra", code: "c", _componentType: "banner" },
    };
    const newerCode = {
      ...document,
      banner: { words: "w", code: "c2", _componentType: "banner" },
    };
    expect(differingFields(shared, document, otherLanguage, views)).toEqual([]);
    expect(differingFields(shared, document, newerCode, views)).toEqual([
      "banner",
    ]);
  });

  it("compares a junction's ids as a set", async () => {
    const { shared, views } = await compare(document);
    const reordered = { ...document, tags: ["b", "a"] };
    const changed = { ...document, tags: ["a", "c"] };
    expect(differingFields(shared, document, reordered, views)).toEqual([]);
    expect(differingFields(shared, document, changed, views)).toEqual(["tags"]);
  });

  it("asks once per distinct component whether it is translated", async () => {
    const asked = vi.fn((slug: string) =>
      Promise.resolve(translatedComponents.has(slug))
    );
    await compare(document, asked);
    // banner is referenced by two fields and asked once.
    expect(asked.mock.calls.map(([slug]) => slug).sort()).toEqual([
      "banner",
      "hero",
      "note",
    ]);
  });
});
