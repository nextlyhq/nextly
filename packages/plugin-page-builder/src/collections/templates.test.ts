/**
 * What the template form draws of a template's fields.
 *
 * The four fields naming an own design's entry and source are the plugin's
 * bookkeeping, written as the system: the form keeps them out (`hidden`), and
 * the panel says them instead. Each absence is paired with a positive control
 * on the same read, since a field with no admin options at all satisfies "not
 * shown" no better than one hidden on purpose.
 */
import { describe, expect, it } from "vitest";

import {
  TEMPLATE_DESIGN_DETAILS_COMPONENT,
  TEMPLATE_OWN_DESIGNS_COMPONENT,
} from "../builder-view";
import { pageBuilder } from "../plugin";

import {
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_COLLECTION_FIELD_COMPONENT,
  TEMPLATE_CONTENT_FIELD,
  TEMPLATE_ENTRY_COLLECTION_FIELD,
  TEMPLATE_ENTRY_FIELD,
  TEMPLATE_ENTRY_ID_FIELD,
  TEMPLATE_FORKED_FROM_FIELD,
  TEMPLATES_SLUG,
  templatesCollection,
} from "./templates";

interface DeclaredField {
  name?: string;
  admin?: { hidden?: unknown; component?: unknown; condition?: unknown };
}

function fieldNamed(name: string): DeclaredField {
  const found = (templatesCollection().fields as DeclaredField[]).find(
    field => field.name === name
  );
  if (found === undefined) throw new Error(`no field named ${name}`);
  return found;
}

describe("the template form", () => {
  it("does not draw the four fields an own design names its entry and source in", () => {
    for (const name of [
      TEMPLATE_ENTRY_FIELD,
      TEMPLATE_ENTRY_COLLECTION_FIELD,
      TEMPLATE_ENTRY_ID_FIELD,
      TEMPLATE_FORKED_FROM_FIELD,
    ]) {
      expect(fieldNamed(name).admin?.hidden, name).toBe(true);
    }
    // The control: the fields an author edits are drawn.
    for (const name of [
      "title",
      TEMPLATE_COLLECTION_FIELD,
      TEMPLATE_CONTENT_FIELD,
    ]) {
      expect(fieldNamed(name).admin?.hidden, name).toBeUndefined();
    }
  });

  it("keeps the names every write path and read uses", () => {
    // Hidden from the form only: the stored names are the ones the guard,
    // the routes and the reads name, so nothing written before is lost.
    expect([
      TEMPLATE_ENTRY_FIELD,
      TEMPLATE_ENTRY_COLLECTION_FIELD,
      TEMPLATE_ENTRY_ID_FIELD,
      TEMPLATE_FORKED_FROM_FIELD,
    ]).toEqual(["entry", "entryCollection", "entryId", "forkedFrom"]);
  });

  it("draws the collection with its own control, on a collection's template only", () => {
    const collection = fieldNamed(TEMPLATE_COLLECTION_FIELD);
    expect(collection.admin?.component).toBe(
      TEMPLATE_COLLECTION_FIELD_COMPONENT
    );
    // An own design leaves `entry` filled and names no collection.
    expect(collection.admin?.condition).toEqual({
      field: TEMPLATE_ENTRY_FIELD,
      equals: "",
    });
  });

  it("says an own design's entry and source in its panel, beside the own designs list", () => {
    const views = pageBuilder().contributes?.admin?.views as
      | Record<string, { panelSections?: { component: string }[] }>
      | undefined;
    const sections = views?.[TEMPLATES_SLUG]?.panelSections ?? [];
    expect(sections.map(section => section.component)).toEqual([
      TEMPLATE_OWN_DESIGNS_COMPONENT,
      TEMPLATE_DESIGN_DETAILS_COMPONENT,
    ]);
  });
});
