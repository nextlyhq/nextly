// Why: pin the contract for snapshotting + diffing user fields. The previous
// implementation diffed only field IDs, which silently masked label / width /
// validation / options edits. This test suite locks in that ALL meaningful
// field shape changes count as dirty.
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { countDirtyFields } from "../dirty-tracking";

const baseField = (overrides: Partial<BuilderField> = {}): BuilderField => ({
  id: "f1",
  name: "title",
  label: "Title",
  type: "text",
  validation: {},
  ...overrides,
});

describe("countDirtyFields", () => {
  it("returns 0 when arrays are identical", () => {
    const fields: BuilderField[] = [baseField()];
    expect(countDirtyFields(fields, fields)).toBe(0);
  });

  it("returns 0 when arrays are deep-equal but distinct references", () => {
    const original = [baseField()];
    const current = [baseField()];
    expect(countDirtyFields(original, current)).toBe(0);
  });

  it("counts a label change as 1", () => {
    const original = [baseField()];
    const current = [baseField({ label: "Headline" })];
    expect(countDirtyFields(original, current)).toBe(1);
  });

  it("counts a width change as 1", () => {
    const original = [baseField({ admin: { width: "100%" } })];
    const current = [baseField({ admin: { width: "50%" } })];
    expect(countDirtyFields(original, current)).toBe(1);
  });

  it("counts a validation change as 1", () => {
    const original = [baseField({ validation: { required: false } })];
    const current = [baseField({ validation: { required: true } })];
    expect(countDirtyFields(original, current)).toBe(1);
  });

  it("counts an options change as 1", () => {
    const original = [
      baseField({
        type: "select",
        options: [{ label: "A", value: "a" }],
      }),
    ];
    const current = [
      baseField({
        type: "select",
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ],
      }),
    ];
    expect(countDirtyFields(original, current)).toBe(1);
  });

  it("counts a defaultValue change as 1", () => {
    const original = [baseField({ defaultValue: null })];
    const current = [baseField({ defaultValue: "hello" })];
    expect(countDirtyFields(original, current)).toBe(1);
  });

  it("counts an added field as 1", () => {
    const original = [baseField()];
    const current = [baseField(), baseField({ id: "f2", name: "body" })];
    expect(countDirtyFields(original, current)).toBe(1);
  });

  it("counts a removed field as 1", () => {
    const original = [baseField(), baseField({ id: "f2", name: "body" })];
    const current = [baseField()];
    expect(countDirtyFields(original, current)).toBe(1);
  });

  it("sums multiple independent changes", () => {
    const original = [
      baseField(),
      baseField({ id: "f2", name: "body", label: "Body" }),
    ];
    const current = [
      baseField({ label: "Headline" }), // 1: modified
      baseField({ id: "f3", name: "intro", label: "Intro" }), // 2 + 3: removed f2 + added f3
    ];
    expect(countDirtyFields(original, current)).toBe(3);
  });

  it("counts an id-only rename as remove + add", () => {
    const original = [baseField()];
    const current = [baseField({ id: "different-id" })];
    // id-only renames shouldn't happen in practice, but if they do they're not
    // a single user-facing edit. Treated as remove + add.
    expect(countDirtyFields(original, current)).toBe(2);
  });

  it("recurses into nested fields for repeater/group/component types", () => {
    const original = [
      baseField({
        id: "f1",
        type: "repeater",
        fields: [baseField({ id: "n1", name: "child", label: "Child" })],
      }),
    ];
    const current = [
      baseField({
        id: "f1",
        type: "repeater",
        fields: [
          baseField({ id: "n1", name: "child", label: "Renamed Child" }),
        ],
      }),
    ];
    expect(countDirtyFields(original, current)).toBe(1);
  });
});
