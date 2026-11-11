/**
 * Which fields "Restore…" lists, and how: every field the version holds
 * differently from the editor, chosen; one the person may not read, may not
 * change, or that is no longer in the content type, unchosen and disabled with
 * its reason; one with an unsaved edit, marked as replacing it; and on a
 * translated document, each shared field named as changing every language.
 */
import type { FieldConfig } from "nextly/config";
import { describe, expect, it } from "vitest";

import type { VersionChanges } from "../version-changes";
import {
  removedFieldsOf,
  restorePlan,
  restoresInEditor,
  type RestorePlanInput,
} from "../restore-plan";

const fields = [
  { name: "title", type: "text", label: "Title" },
  { name: "body", type: "text", label: "Body" },
  { name: "views", type: "number", label: "Views" },
  { name: "tags", type: "json", label: "Tags" },
] as unknown as FieldConfig[];

function input(overrides: Partial<RestorePlanInput> = {}): RestorePlanInput {
  return {
    fields,
    snapshot: { title: "Old", body: "Same", views: 1, tags: ["a", "b"] },
    current: { title: "New", body: "Same", views: 2, tags: ["a", "b"] },
    dirty: new Set(),
    withheld: [],
    canEdit: () => true,
    ...overrides,
  };
}

const names = (rows: { name: string }[]) => rows.map(row => row.name);

describe("restorePlan", () => {
  it("lists every field the version holds differently, chosen, in form order", () => {
    const rows = restorePlan(input());

    expect(names(rows)).toEqual(["title", "views"]);
    expect(rows.every(row => row.chosen && !row.disabled)).toBe(true);
    expect(rows[0]).toMatchObject({ label: "Title", replacesUnsaved: false });
  });

  it("does not list an empty group the version never held", () => {
    const rows = restorePlan(
      input({
        snapshot: { title: "New", views: 2, tags: null },
        current: {
          title: "New",
          views: 2,
          tags: { metaTitle: "", keywords: [] },
        },
      })
    );

    expect(rows).toEqual([]);
  });

  it("compares structured values by content, not by reference", () => {
    const rows = restorePlan(
      input({
        snapshot: { title: "New", tags: ["b", "a"] },
        current: { title: "New", tags: ["a", "b"] },
      })
    );

    expect(names(rows)).toEqual(["tags"]);
  });

  it("marks a field whose unsaved edit the restore replaces", () => {
    const rows = restorePlan(input({ dirty: new Set(["title"]) }));

    expect(rows.find(row => row.name === "title")).toMatchObject({
      chosen: true,
      replacesUnsaved: true,
    });
    expect(rows.find(row => row.name === "views")?.replacesUnsaved).toBe(false);
  });

  it("disables a field hidden from the person, and never carries its value", () => {
    const rows = restorePlan(input({ withheld: ["title"] }));

    const title = rows.find(row => row.name === "title");
    expect(title).toMatchObject({
      chosen: false,
      disabled: "hidden",
      reason: "Hidden: you can't read this field",
    });
    expect(title).not.toHaveProperty("value");
  });

  it("disables a field the person may read but not change", () => {
    const rows = restorePlan(input({ canEdit: name => name !== "views" }));

    expect(rows.find(row => row.name === "views")).toMatchObject({
      chosen: false,
      disabled: "read-only",
      reason: "You can't edit this field",
    });
  });

  it("disables a field the comparison names as no longer in the content type", () => {
    const rows = restorePlan(
      input({
        snapshot: { title: "New", views: 2, subtitle: "Gone" },
        removed: new Set(["subtitle"]),
      })
    );

    expect(rows).toEqual([
      expect.objectContaining({
        name: "subtitle",
        chosen: false,
        disabled: "removed",
        reason: "No longer in this content type",
      }),
    ]);
  });

  it("leaves out a key the comparison does not name as removed, such as a system column", () => {
    const rows = restorePlan(
      input({
        snapshot: {
          title: "New",
          views: 2,
          id: "x",
          createdAt: "then",
          updatedAt: "then",
          status: "published",
          _rev: "3",
          firstPublishedAt: "then",
        },
      })
    );

    expect(rows).toEqual([]);
  });

  it("names each shared field of a translated document as changing every language", () => {
    const rows = restorePlan(input({ translatable: new Set(["title"]) }));

    expect(rows.find(row => row.name === "title")?.shared).toBe(false);
    expect(rows.find(row => row.name === "views")?.shared).toBe(true);
  });

  it("names no field as shared on a document that is not translated", () => {
    const rows = restorePlan(input());

    expect(rows.every(row => row.shared === false)).toBe(true);
  });

  it("carries the version's value for each field it may restore", () => {
    const rows = restorePlan(input());

    expect(rows.find(row => row.name === "views")).toMatchObject({
      value: 1,
    });
  });
});

describe("restoresInEditor", () => {
  it("restores a version of the language being edited", () => {
    expect(restoresInEditor("es", "es")).toBe(true);
  });

  it("does not restore another language's version into this editor", () => {
    expect(restoresInEditor("es", "en")).toBe(false);
  });

  it("restores a version that holds no language, or into an untranslated editor", () => {
    expect(restoresInEditor(null, "en")).toBe(true);
    expect(restoresInEditor("es", undefined)).toBe(true);
  });
});

describe("removedFieldsOf", () => {
  it("names the fields the comparison marks as no longer in the content type", () => {
    const changes = {
      byField: new Map([
        ["subtitle", { kind: "unknown", reason: "removed", name: "subtitle" }],
        ["firstPublishedAt", { kind: "unknown", reason: "system", name: "x" }],
        ["title", { kind: "text", name: "title" }],
      ]),
    } as unknown as VersionChanges;

    expect([...removedFieldsOf(changes)]).toEqual(["subtitle"]);
    expect(removedFieldsOf(null).size).toBe(0);
  });
});
