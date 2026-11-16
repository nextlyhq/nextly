/**
 * The rows the outline shows while deletes are pending: the fields now, with
 * each field whose delete is pending shown again at its saved place, so a
 * delete is seen, marked, until it is saved or undone.
 */
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { fieldsWithDeleted } from "../pending-rows";

const text = (id: string): BuilderField =>
  ({ id, name: id, label: id, type: "text" }) as BuilderField;
const group = (id: string, fields: BuilderField[]): BuilderField =>
  ({ id, name: id, label: id, type: "group", fields }) as BuilderField;

const ids = (fields: readonly BuilderField[]): unknown[] =>
  fields.map(f => (f.fields ? [f.id, ids(f.fields)] : f.id));

const saved = [
  text("a"),
  text("b"),
  group("g", [text("x"), text("y"), text("z")]),
  text("c"),
];

describe("fields with deleted", () => {
  it("is the fields as they are when nothing is deleted", () => {
    const current = structuredClone(saved);
    expect(fieldsWithDeleted(current, saved)).toBe(current);
  });

  it("shows a deleted field again between the fields it sat between", () => {
    const current = [text("a"), group("g", saved[2]!.fields!), text("c")];
    expect(ids(fieldsWithDeleted(current, saved))).toEqual([
      "a",
      "b",
      ["g", ["x", "y", "z"]],
      "c",
    ]);
  });

  it("shows a deleted container with the fields it held", () => {
    const current = [text("a"), text("b"), text("c")];
    expect(ids(fieldsWithDeleted(current, saved))).toEqual([
      "a",
      "b",
      ["g", ["x", "y", "z"]],
      "c",
    ]);
  });

  it("shows a field deleted inside a saved group in that group", () => {
    const current = [
      text("a"),
      text("b"),
      group("g", [text("x"), text("z")]),
      text("c"),
    ];
    expect(ids(fieldsWithDeleted(current, saved))).toEqual([
      "a",
      "b",
      ["g", ["x", "y", "z"]],
      "c",
    ]);
  });

  it("puts a deleted field after its nearest saved neighbour still there", () => {
    // "a" moved to the end, and "b", saved after it, was deleted: "b" still
    // follows "a", wherever "a" is now.
    const current = [group("g", saved[2]!.fields!), text("c"), text("a")];
    expect(ids(fieldsWithDeleted(current, saved))).toEqual([
      ["g", ["x", "y", "z"]],
      "c",
      "a",
      "b",
    ]);
  });

  it("puts a deleted field first when nothing saved before it is still there", () => {
    const current = [group("g", saved[2]!.fields!), text("c")];
    expect(ids(fieldsWithDeleted(current, saved.slice(1)))).toEqual([
      "b",
      ["g", ["x", "y", "z"]],
      "c",
    ]);
  });

  it("shows a deleted container without a field moved out of it first", () => {
    // "y" moved to the top, then its group was deleted: "y" shows once, where
    // it is now, and the deleted group holds only what went with it.
    const current = [text("y"), text("a"), text("b"), text("c")];
    expect(ids(fieldsWithDeleted(current, saved))).toEqual([
      "y",
      "a",
      "b",
      ["g", ["x", "z"]],
      "c",
    ]);
  });

  it("never shows a field that was moved, only deleted ones", () => {
    const current = [
      text("a"),
      group("g", [text("x"), text("y"), text("z"), text("b")]),
      text("c"),
    ];
    expect(ids(fieldsWithDeleted(current, saved))).toEqual([
      "a",
      ["g", ["x", "y", "z", "b"]],
      "c",
    ]);
  });
});
