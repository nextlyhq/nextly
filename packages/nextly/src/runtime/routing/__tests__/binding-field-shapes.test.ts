/**
 * The shapes a binding is checked against, made from stored field
 * definitions: what each field holds, and only the fields the visitor's
 * reader allows.
 */
import { describe, expect, it, vi } from "vitest";

import {
  bindingFieldShapes,
  fieldShapesOf,
  type BindingSourceRef,
} from "../binding-field-shapes";

const everyone = async () => true;

describe("fieldShapesOf", () => {
  it("says what each field holds", async () => {
    const shapes = await fieldShapesOf(
      [
        { name: "title", type: "text" },
        { name: "tags", type: "text", hasMany: true },
        { name: "labels", type: "chips" },
        { name: "author", type: "relationship", relationTo: "authors" },
        {
          name: "kind",
          type: "select",
          options: [
            { label: "News", value: "news" },
            { label: "Guide", value: "guide" },
          ],
        },
        { name: "size", type: "radio", options: ["s", "m"] },
      ],
      everyone
    );
    expect(shapes).toEqual([
      { name: "title", type: "text" },
      { name: "tags", type: "text", hasMany: true },
      { name: "labels", type: "chips", hasMany: true },
      { name: "author", type: "relationship", relationTo: "authors" },
      { name: "kind", type: "select", options: ["news", "guide"] },
      { name: "size", type: "radio", options: ["s", "m"] },
    ]);
  });

  it("tells a day and a month from an instant, a day when no picker is set", async () => {
    const shapes = await fieldShapesOf(
      [
        { name: "unset", type: "date" },
        {
          name: "day",
          type: "date",
          admin: { date: { pickerAppearance: "dayOnly" } },
        },
        {
          name: "month",
          type: "date",
          admin: { date: { pickerAppearance: "monthOnly" } },
        },
        {
          name: "at",
          type: "date",
          admin: { date: { pickerAppearance: "dayAndTime" } },
        },
      ],
      everyone
    );
    expect(shapes).toEqual([
      { name: "unset", type: "date", dateOnly: true },
      { name: "day", type: "date", dateOnly: true },
      { name: "month", type: "date", monthOnly: true },
      { name: "at", type: "date" },
    ]);
  });

  it("leaves out a field the reader refuses, judged by its whole path", async () => {
    const asked: string[] = [];
    const readable = vi.fn(async (path: readonly string[]) => {
      asked.push(path.join("."));
      return path.join(".") !== "secret" && path.join(".") !== "seo.note";
    });
    const shapes = await fieldShapesOf(
      [
        { name: "title", type: "text" },
        { name: "secret", type: "text" },
        {
          name: "seo",
          type: "group",
          fields: [
            { name: "summary", type: "text" },
            { name: "note", type: "text" },
          ],
        },
      ],
      readable
    );
    expect(shapes.map(shape => shape.name)).toEqual(["title", "seo"]);
    expect(shapes[1]?.fields).toEqual([{ name: "summary", type: "text" }]);
    expect(asked).toEqual([
      "title",
      "secret",
      "seo",
      "seo.summary",
      "seo.note",
    ]);
  });

  it("does not look inside a group the reader refuses", async () => {
    const readable = vi.fn(
      async (path: readonly string[]) => path[0] !== "seo"
    );
    const shapes = await fieldShapesOf(
      [
        {
          name: "seo",
          type: "group",
          fields: [{ name: "summary", type: "text" }],
        },
      ],
      readable
    );
    expect(shapes).toEqual([]);
    expect(readable).toHaveBeenCalledTimes(1);
  });

  it("never offers a password, whatever the reader says", async () => {
    const shapes = await fieldShapesOf(
      [
        { name: "title", type: "text" },
        { name: "pin", type: "password" },
      ],
      everyone
    );
    expect(shapes.map(shape => shape.name)).toEqual(["title"]);
  });

  it("leaves out a stored definition it cannot read", async () => {
    const shapes = await fieldShapesOf(
      [{ type: "text" }, "title", { name: "title", type: "text" }],
      everyone
    );
    expect(shapes).toEqual([{ name: "title", type: "text" }]);
  });
});

describe("bindingFieldShapes", () => {
  it.each([
    [{}],
    [{ collection: "" }],
    [{ collection: "posts", single: "banner" }],
    [{ collection: 5 }],
  ])("refuses %j as a source, before reading anything", async ref => {
    await expect(
      bindingFieldShapes(ref as unknown as BindingSourceRef)
    ).rejects.toThrow(/one collection or one Single/);
  });
});
