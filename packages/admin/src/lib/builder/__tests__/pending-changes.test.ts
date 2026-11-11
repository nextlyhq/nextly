/**
 * The Builder's pending changes: the definition as loaded compared with the
 * definition now, field by field identity, so what counts is the net
 * difference. An edit undone, or one that puts a field back as it was saved,
 * is no change.
 */
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { pendingChanges, rowMarks } from "../pending-changes";

const text = (id: string, overrides: Partial<BuilderField> = {}) =>
  ({
    id,
    name: id,
    label: id[0]?.toUpperCase() + id.slice(1),
    type: "text",
    ...overrides,
  }) as BuilderField;

const group = (
  id: string,
  fields: BuilderField[],
  overrides: Partial<BuilderField> = {}
) => text(id, { type: "group", fields, ...overrides });

/** The kinds and fields of the changes, in order. */
const summary = (baseline: BuilderField[], current: BuilderField[]) =>
  pendingChanges(baseline, current).map(change => `${change.kind} ${change.fieldId}`);

const saved = [
  text("title"),
  text("summary"),
  group("address", [text("street"), text("city"), text("zip")]),
];

describe("pending changes", () => {
  it("finds none when nothing changed", () => {
    expect(pendingChanges(saved, structuredClone(saved))).toEqual([]);
  });

  it("an added field is one change, its own fields with it", () => {
    const current = [
      ...saved,
      text("subtitle"),
      group("seo", [text("metaTitle"), text("metaDescription")]),
    ];
    const changes = pendingChanges(saved, current);
    expect(changes.map(c => `${c.kind} ${c.fieldId}`)).toEqual([
      "added subtitle",
      "added seo",
    ]);
    expect(changes[1]?.inside).toBe(2);
  });

  it("a field added inside a saved group is its own change", () => {
    const current = [
      text("title"),
      text("summary"),
      group("address", [
        text("street"),
        text("city"),
        text("zip"),
        text("country"),
      ]),
    ];
    expect(summary(saved, current)).toEqual(["added country"]);
  });

  it("a duplicate is an added field, with the fields inside its copy", () => {
    const copy = group("address-copy", [
      text("street-copy"),
      text("city-copy"),
      text("zip-copy"),
    ]);
    const changes = pendingChanges(saved, [...saved, copy]);
    expect(changes.map(c => `${c.kind} ${c.fieldId}`)).toEqual([
      "added address-copy",
    ]);
    expect(changes[0]?.inside).toBe(3);
  });

  it("a deleted container is one change naming how many fields inside go too", () => {
    const changes = pendingChanges(saved, [text("title"), text("summary")]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "deleted",
      fieldId: "address",
      inside: 3,
    });
  });

  it("a deleted field inside a saved group is its own change", () => {
    const current = [
      text("title"),
      text("summary"),
      group("address", [text("street"), text("zip")]),
    ];
    expect(summary(saved, current)).toEqual(["deleted city"]);
  });

  it("a setting is a change of settings", () => {
    const current = structuredClone(saved);
    current[0] = text("title", { validation: { required: true } });
    expect(summary(saved, current)).toEqual(["settings title"]);
  });

  it("a setting of a field inside a group is that field's change, not the group's", () => {
    const current = structuredClone(saved);
    current[2]!.fields![1] = text("city", { admin: { width: "50%" } });
    expect(summary(saved, current)).toEqual(["settings city"]);
  });

  it("a rename is a rename, with the name it had", () => {
    const current = structuredClone(saved);
    current[1] = text("summary", { name: "excerpt" });
    const [change] = pendingChanges(saved, current);
    expect(change).toMatchObject({
      kind: "renamed",
      fieldId: "summary",
      name: "excerpt",
      previousName: "summary",
    });
  });

  it("a type change is a type change, with the type it had", () => {
    const current = structuredClone(saved);
    current[1] = text("summary", { type: "textarea" });
    const [change] = pendingChanges(saved, current);
    expect(change).toMatchObject({
      kind: "typeChanged",
      fieldId: "summary",
      type: "textarea",
      previousType: "text",
    });
  });

  it("a field moved into another container is a move", () => {
    const current = [
      text("title"),
      group("address", [text("street"), text("city"), text("zip"), text("summary")]),
    ];
    expect(summary(saved, current)).toEqual(["moved summary"]);
  });

  it("one field dragged past others is one move, not a change of each it passed", () => {
    const current = [
      text("summary"),
      group("address", [text("street"), text("city"), text("zip")]),
      text("title"),
    ];
    expect(summary(saved, current)).toEqual(["moved title"]);
  });

  it("a field put after a new one has not moved", () => {
    const current = [text("intro"), ...saved];
    expect(summary(saved, current)).toEqual(["added intro"]);
  });

  it("each change of one field counts: moved, renamed and set at once", () => {
    const current = [
      text("summary"),
      group("address", [text("street"), text("city"), text("zip")]),
      text("title", { name: "headline", admin: { width: "50%" } }),
    ];
    expect(summary(saved, current).sort()).toEqual([
      "moved title",
      "renamed title",
      "settings title",
    ]);
  });

  it("an edit put back as it was saved counts as none", () => {
    const edited = structuredClone(saved);
    edited[0] = text("title", { label: "Headline", name: "headline" });
    expect(pendingChanges(saved, edited)).toHaveLength(2);
    const back = structuredClone(edited);
    back[0] = text("title");
    expect(pendingChanges(saved, back)).toEqual([]);
  });

  it("a field added and then deleted counts as none", () => {
    const added = [...saved, text("subtitle")];
    expect(pendingChanges(saved, added)).toHaveLength(1);
    expect(pendingChanges(saved, added.slice(0, -1))).toEqual([]);
  });

  it("a field moved away and back counts as none", () => {
    const away = [
      text("summary"),
      text("title"),
      group("address", [text("street"), text("city"), text("zip")]),
    ];
    expect(pendingChanges(saved, away)).toHaveLength(1);
    expect(
      pendingChanges(saved, [
        text("title"),
        text("summary"),
        group("address", [text("street"), text("city"), text("zip")]),
      ])
    ).toEqual([]);
  });

  it("an undone edit counts as none: the state before it is the saved one", () => {
    const before = structuredClone(saved);
    const after = structuredClone(saved);
    after[0] = text("title", { label: "Headline" });
    expect(pendingChanges(saved, after)).toHaveLength(1);
    expect(pendingChanges(saved, before)).toEqual([]);
  });

  it("system fields are never a change", () => {
    const withSystem = [text("slug", { isSystem: true }), ...saved];
    const current = [
      text("slug", { isSystem: true, label: "Address" }),
      ...structuredClone(saved),
    ];
    expect(pendingChanges(withSystem, current)).toEqual([]);
  });
});

describe("row marks", () => {
  it("marks each changed row new, changed, moved or deleted, a new container's fields included", () => {
    const current = [
      text("summary", { label: "Excerpt" }),
      group("address", [text("street"), text("zip"), text("title")]),
      group("seo", [text("metaTitle")]),
    ];
    const marks = rowMarks(saved, current);
    expect([...(marks.get("summary") ?? [])]).toEqual(["changed"]);
    expect([...(marks.get("title") ?? [])]).toEqual(["moved"]);
    expect([...(marks.get("city") ?? [])]).toEqual(["deleted"]);
    expect([...(marks.get("seo") ?? [])]).toEqual(["new"]);
    expect([...(marks.get("metaTitle") ?? [])]).toEqual(["new"]);
    expect(marks.has("street")).toBe(false);
    expect(marks.has("address")).toBe(false);
  });

  it("marks every field inside a deleted container deleted", () => {
    const marks = rowMarks(saved, [text("title"), text("summary")]);
    for (const id of ["address", "street", "city", "zip"]) {
      expect([...(marks.get(id) ?? [])]).toEqual(["deleted"]);
    }
  });
});
