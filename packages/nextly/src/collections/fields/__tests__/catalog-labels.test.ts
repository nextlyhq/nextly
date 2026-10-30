/**
 * What a field type is CALLED, on every surface that offers it.
 *
 * Every picker, outline, settings panel and review screen reads a type's name
 * from this module, so the name a person sees is decided here once. Two things
 * can still go wrong without any surface noticing: one surface's catalog can
 * carry a different spelling for a type another surface also offers, and a
 * label can leak the internal vocabulary (`richText`, `component`, `array`)
 * that only the stored data should use.
 *
 * The surface catalogs are discovered from the module's exports by their
 * SHAPE rather than listed here, so a surface added later is held to the same
 * rules without anyone remembering to add it to this file.
 */
import { describe, expect, it } from "vitest";

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import * as catalogModule from "../catalog";
import type { FieldTypeCatalogEntry } from "../catalog";

/** Whole-word acronyms a label may spell in capitals anywhere in it. */
const ACRONYMS: ReadonlySet<string> = new Set(["JSON", "URL", "ID"]);

function isCatalogEntry(
  value: unknown
): value is FieldTypeCatalogEntry<string> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return ["type", "label", "category", "hint", "icon"].every(
    key => typeof record[key] === "string"
  );
}

/**
 * Every exported array whose members are all catalog rows: the per-surface
 * catalogs. An array of bare type ids (such as the block type list) is not a
 * catalog and is skipped by shape.
 */
const surfaceCatalogs: ReadonlyArray<
  readonly [string, readonly FieldTypeCatalogEntry<string>[]]
> = Object.entries(catalogModule).flatMap(([name, value]) =>
  Array.isArray(value) && value.length > 0 && value.every(isCatalogEntry)
    ? [[name, value as readonly FieldTypeCatalogEntry<string>[]] as const]
    : []
);

/** Sentence case: first word capitalised, the rest lowercase, acronyms whole. */
function isSentenceCase(label: string): boolean {
  const words = label.split(" ");
  return words.every((word, index) => {
    if (ACRONYMS.has(word)) return true;
    if (index === 0) return /^[A-Z][a-z]*$/.test(word);
    return /^[a-z]+$/.test(word);
  });
}

describe("field type labels across surfaces", () => {
  it("finds every surface's catalog in the module", () => {
    // Positive control for the discovery above: if it stopped recognising the
    // catalogs, the label checks below would pass over an empty list.
    expect(surfaceCatalogs.map(([name]) => name).sort()).toEqual(
      expect.arrayContaining([
        "BLOCK_FIELD_TYPE_CATALOG",
        "FIELD_TYPE_CATALOG",
        "FORM_FIELD_TYPE_CATALOG",
        "USER_FIELD_TYPE_CATALOG",
      ])
    );
  });

  it("every surface's types have one plain label", () => {
    const labelsByType = new Map<string, Set<string>>();
    const allTypes = new Set<string>([STORAGE_FORMAT.fieldType, "array"]);
    for (const [, entries] of surfaceCatalogs) {
      for (const entry of entries) {
        allTypes.add(entry.type);
        const labels = labelsByType.get(entry.type) ?? new Set<string>();
        labels.add(entry.label);
        labelsByType.set(entry.type, labels);
      }
    }

    const problems: string[] = [];
    for (const [type, labels] of labelsByType) {
      if (labels.size > 1) {
        problems.push(`${type}: several labels ${[...labels].join(" / ")}`);
      }
      for (const label of labels) {
        if (allTypes.has(label) || /[a-z][A-Z]/.test(label)) {
          problems.push(`${type}: label "${label}" is an internal type id`);
        }
        if (/\b(component|array)s?\b/i.test(label)) {
          problems.push(`${type}: label "${label}" uses internal vocabulary`);
        }
        if (!isSentenceCase(label)) {
          problems.push(`${type}: label "${label}" is not in sentence case`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("names the rich-text, upload, relationship, repeater and field-group types plainly", () => {
    // The plain-label rules above cannot tell a plain name from a jargon one
    // ("Editor", "Repeater" both pass them), so the chosen names are pinned.
    const labelOf = (type: string) =>
      catalogModule.FIELD_TYPE_CATALOG.find(entry => entry.type === type)
        ?.label;
    expect({
      richText: labelOf("richText"),
      upload: labelOf("upload"),
      relationship: labelOf("relationship"),
      repeater: labelOf("repeater"),
      fieldGroup: labelOf(STORAGE_FORMAT.fieldType),
    }).toEqual({
      richText: "Rich text",
      upload: "Image or file",
      relationship: "Link to entries",
      repeater: "Repeating rows",
      fieldGroup: "Field group",
    });
  });
});
