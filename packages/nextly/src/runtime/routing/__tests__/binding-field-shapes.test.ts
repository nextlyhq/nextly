/**
 * The shapes a binding is checked against, made from stored field
 * definitions: what each field holds, and only the fields the visitor's
 * reader allows.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";

import {
  bindingFieldShapes,
  fieldShapesOf,
  type BindingSourceRef,
} from "../binding-field-shapes";

const everyone = async () => true;

afterEach(() => {
  clearFieldTypes();
});

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
        {
          name: "opens",
          type: "date",
          admin: { date: { pickerAppearance: "timeOnly" } },
        },
      ],
      everyone
    );
    expect(shapes).toEqual([
      { name: "unset", type: "date", dateOnly: true },
      { name: "day", type: "date", dateOnly: true },
      { name: "month", type: "date", monthOnly: true },
      { name: "at", type: "date" },
      { name: "opens", type: "date", timeOnly: true },
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

  it("keeps an unnamed group's fields at the level it sits in, and no repeater's rows", async () => {
    const readable = vi.fn(async (_path: readonly string[]) => true);
    const shapes = await fieldShapesOf(
      [
        { name: "title", type: "text" },
        // Laid out in a group with no name: stored beside `title`.
        { type: "group", fields: [{ name: "summary", type: "text" }] },
        // A repeater with no name stores its children per row, not here.
        { type: "repeater", fields: [{ name: "row", type: "text" }] },
      ],
      readable
    );
    expect(shapes.map(shape => shape.name)).toEqual(["title", "summary"]);
    expect(readable.mock.calls.map(([path]) => path.join("."))).toEqual([
      "title",
      "summary",
    ]);
  });

  it("calls a repeater and a repeatable component a list, and a single component one value", async () => {
    const shapes = await fieldShapesOf(
      [
        { name: "rows", type: "repeater" },
        { name: "cards", type: "component", repeatable: true },
        { name: "blocks", type: "fieldGroup", repeatable: true },
        { name: "hero", type: "component" },
        { name: "byline", type: "fieldGroup", repeatable: false },
      ],
      everyone
    );
    const many = Object.fromEntries(
      shapes.map(shape => [shape.name, shape.hasMany === true])
    );
    expect(many).toEqual({
      rows: true,
      cards: true,
      blocks: true,
      hero: false,
      byline: false,
    });
  });

  it("follows one component's fields, judged by that component's own rules from its top level", async () => {
    const asked: string[] = [];
    const readable = vi.fn(
      async (
        path: readonly string[],
        within?: { component: string; path: readonly string[] }
      ) => {
        asked.push(
          within === undefined
            ? path.join(".")
            : `${path.join(".")} in ${within.component}:${within.path.join(".")}`
        );
        return within?.path.join(".") !== "secret";
      }
    );
    // As the fields are expanded: the component's own fields grafted on.
    const shapes = await fieldShapesOf(
      [
        {
          name: "card",
          type: "component",
          component: "pss_card",
          fields: [
            { name: "heading", type: "text" },
            { name: "secret", type: "text" },
            {
              name: "box",
              type: "group",
              fields: [{ name: "tag", type: "text" }],
            },
          ],
        },
      ],
      readable
    );
    expect(shapes).toEqual([
      {
        name: "card",
        type: "component",
        fields: [
          { name: "heading", type: "text" },
          {
            name: "box",
            type: "group",
            fields: [{ name: "tag", type: "text" }],
          },
        ],
      },
    ]);
    expect(asked).toEqual([
      "card",
      "card.heading in pss_card:heading",
      "card.secret in pss_card:secret",
      "card.box in pss_card:box",
      "card.box.tag in pss_card:box.tag",
    ]);
  });

  it("does not follow a dynamic zone, whose members differ by instance", async () => {
    const shapes = await fieldShapesOf(
      [
        {
          name: "zone",
          type: "fieldGroup",
          components: ["pss_card", "pss_quote"],
          repeatable: true,
          fields: [
            {
              name: "#pss_card",
              type: "group",
              fields: [{ name: "heading", type: "text" }],
            },
          ],
        },
      ],
      everyone
    );
    expect(shapes).toEqual([
      { name: "zone", type: "fieldGroup", hasMany: true },
    ]);
  });

  it("gives a contributed field type the storage primitive it registered, and a built-in none", async () => {
    registerFieldType({
      type: "pss-rating",
      storage: "number",
      component: "plugin/pss-rating",
    });
    const shapes = await fieldShapesOf(
      [
        { name: "score", type: "pss-rating" },
        { name: "title", type: "text" },
      ],
      everyone
    );
    expect(shapes).toEqual([
      { name: "score", type: "pss-rating", storage: "number" },
      { name: "title", type: "text" },
    ]);
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
  it.each([[{ locale: "" }], [{ locale: 5 }], [{ locale: "fr", user: {} }]])(
    "refuses %j as options, before reading anything",
    async options => {
      await expect(
        bindingFieldShapes(
          { collection: "posts" },
          options as unknown as Parameters<typeof bindingFieldShapes>[1]
        )
      ).rejects.toThrow(/a language and nothing else/);
    }
  );

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
