/**
 * The type changes of fields held inside a named group's or a repeater's JSON value, as
 * `fieldTypeChangesOf` pairs them when asked (`nested`): each named by its path, its steps saying
 * where each container keeps it, at any depth. A container that changes kind, or a field whose type
 * is the same, gives none, and nothing is asked unless the caller asks it.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../../schemas/dynamic-collections";
import { fieldTypeChangesOf } from "../field-type-changes";

const field = (name: string, type: string, extra: object = {}) =>
  ({ name, type, ...extra }) as unknown as FieldDefinition;

const changesOf = (
  previous: FieldDefinition[],
  next: FieldDefinition[],
  nested = true
) =>
  fieldTypeChangesOf({
    previous,
    next,
    dialect: "postgresql",
    builtBy: "collection",
    nested,
  }).map(change => ({
    label: change.within?.label,
    path: change.within?.path,
    from: change.from.type,
    to: change.to.type,
  }));

describe("fieldTypeChangesOf, for fields held inside JSON", () => {
  it("names a group's field by its path, kept under its key", () => {
    expect(
      changesOf(
        [field("details", "group", { fields: [field("price", "text")] })],
        [field("details", "group", { fields: [field("price", "number")] })]
      )
    ).toEqual([
      {
        label: "details.price",
        path: [
          { name: "details", repeated: false },
          { name: "price", repeated: false },
        ],
        from: "text",
        to: "number",
      },
    ]);
  });

  it("names a repeater's field, kept under its key in each item", () => {
    expect(
      changesOf(
        [field("items", "repeater", { fields: [field("price", "text")] })],
        [field("items", "repeater", { fields: [field("price", "number")] })]
      )
    ).toEqual([
      {
        label: "items.price",
        path: [
          { name: "items", repeated: true },
          { name: "price", repeated: false },
        ],
        from: "text",
        to: "number",
      },
    ]);
  });

  it("follows a group inside a repeater", () => {
    const holding = (type: string) =>
      field("items", "repeater", {
        fields: [field("cost", "group", { fields: [field("price", type)] })],
      });
    expect(changesOf([holding("text")], [holding("number")])).toEqual([
      {
        label: "items.cost.price",
        path: [
          { name: "items", repeated: true },
          { name: "cost", repeated: false },
          { name: "price", repeated: false },
        ],
        from: "text",
        to: "number",
      },
    ]);
  });

  it("gives none for a field whose type stays, a container that changes kind, or when not asked", () => {
    const group = (type: string) =>
      field("details", "group", { fields: [field("price", type)] });
    expect(changesOf([group("text")], [group("text")])).toEqual([]);
    // A group becoming a repeater is a change of the field on the row itself, not of a field
    // held inside it.
    expect(
      changesOf(
        [group("text")],
        [field("details", "repeater", { fields: [field("price", "number")] })]
      ).filter(change => change.label !== undefined)
    ).toEqual([]);
    expect(changesOf([group("text")], [group("number")], false)).toEqual([]);
  });

  it("names a container held inside another that changes kind, or a field that becomes one", () => {
    const outer = (inner: FieldDefinition) =>
      field("details", "group", { fields: [inner] });
    const meta = (type: string) =>
      field(
        "meta",
        type,
        type === "text" ? {} : { fields: [field("note", "text")] }
      );
    expect(
      changesOf([outer(meta("group"))], [outer(meta("repeater"))])
    ).toEqual([
      {
        label: "details.meta",
        path: [
          { name: "details", repeated: false },
          { name: "meta", repeated: false },
        ],
        from: "group",
        to: "repeater",
      },
    ]);
    expect(
      changesOf([outer(meta("text"))], [outer(meta("group"))]).map(
        change => change.label
      )
    ).toEqual(["details.meta"]);
  });

  it("reads a many-to-many inside JSON as the list of links it keeps there", () => {
    const group = (extra: object) =>
      field("details", "group", {
        fields: [
          field("tags", "relationship", { relationTo: "tags", ...extra }),
        ],
      });
    // A list of ids inline either way: no join table holds a value inside JSON.
    expect(
      changesOf(
        [group({ options: { relationType: "manyToMany" } })],
        [group({ hasMany: true })]
      )
    ).toEqual([]);
  });

  it("gives none for a virtual field, or a field of a virtual container, which stores nothing", () => {
    const group = (inner: FieldDefinition) =>
      field("details", "group", { fields: [inner] });
    const virtual = (type: string) => field("when", type, { virtual: true });
    expect(
      changesOf([group(virtual("date"))], [group(virtual("email"))])
    ).toEqual([]);
    // A virtual group inside a stored one: nothing below it is stored either.
    const inVirtual = (type: string) =>
      field("meta", "group", {
        options: { virtual: true },
        fields: [field("when", type)],
      });
    expect(
      changesOf([group(inVirtual("date"))], [group(inVirtual("email"))])
    ).toEqual([]);
  });

  it("reads a value held inside JSON with no column bound: a long text keeps its type", () => {
    // A short text and a long one differ only by their column, which a value inside JSON has not.
    const group = (extra: object) =>
      field("details", "group", { fields: [field("note", "text", extra)] });
    expect(
      changesOf([group({ options: { variant: "short" } })], [group({})])
    ).toEqual([]);
  });
});
