import { beforeEach, describe, expect, it } from "vitest";

import {
  clearSources,
  getSource,
  listSources,
  registerSource,
  type WidgetSource,
} from "../sources";

const VALID_SOURCE: WidgetSource = {
  id: "collection:posts",
  label: "Posts",
  kind: "collection",
  supports: ["count", "list"],
  fields: [
    { name: "title", type: "string" },
    { name: "status", type: "string" },
  ],
};

beforeEach(() => {
  clearSources();
});

describe("registerSource / getSource", () => {
  it("registers a well-formed source and makes it retrievable", () => {
    registerSource(VALID_SOURCE);
    expect(getSource("collection:posts")).toEqual(VALID_SOURCE);
  });

  it("returns undefined for a source that was never registered", () => {
    expect(getSource("collection:nope")).toBeUndefined();
  });

  it("refuses a duplicate id", () => {
    registerSource(VALID_SOURCE);
    expect(() => registerSource(VALID_SOURCE)).toThrow(
      /Widget source "collection:posts" is already registered/
    );
  });
});

describe("listSources / clearSources", () => {
  it("lists every registered source", () => {
    registerSource(VALID_SOURCE);
    registerSource({ ...VALID_SOURCE, id: "collection:pages", label: "Pages" });
    expect(
      listSources()
        .map(s => s.id)
        .sort()
    ).toEqual(["collection:pages", "collection:posts"]);
  });

  it("returns an empty list when nothing is registered", () => {
    expect(listSources()).toEqual([]);
  });

  it("empties the store", () => {
    registerSource(VALID_SOURCE);
    clearSources();
    expect(listSources()).toEqual([]);
    expect(getSource("collection:posts")).toBeUndefined();
  });
});

describe("registerSource validation (M8)", () => {
  it("refuses an empty id", () => {
    expect(() => registerSource({ ...VALID_SOURCE, id: "" })).toThrow(
      /id is required and must be a non-empty string/
    );
  });

  it("refuses a missing label", () => {
    expect(() => registerSource({ ...VALID_SOURCE, label: "" })).toThrow(
      /label is required/
    );
  });

  it("refuses an unknown kind", () => {
    expect(() =>
      registerSource({
        ...VALID_SOURCE,
        kind: "spreadsheet" as unknown as WidgetSource["kind"],
      })
    ).toThrow(/kind must be one of/);
  });

  it("refuses empty supports", () => {
    expect(() => registerSource({ ...VALID_SOURCE, supports: [] })).toThrow(
      /supports must be a non-empty array of ops/
    );
  });

  it("refuses an unknown op in supports", () => {
    expect(() =>
      registerSource({
        ...VALID_SOURCE,
        supports: [
          "count",
          "explode" as unknown as WidgetSource["supports"][number],
        ],
      })
    ).toThrow(/supports names an unknown op "explode"/);
  });

  it("refuses empty fields", () => {
    expect(() => registerSource({ ...VALID_SOURCE, fields: [] })).toThrow(
      /fields must be a non-empty array/
    );
  });

  it("refuses a field with no name", () => {
    expect(() =>
      registerSource({
        ...VALID_SOURCE,
        fields: [{ name: "", type: "string" }],
      })
    ).toThrow(/every field requires a non-empty name/);
  });

  it("refuses a field with an unknown type", () => {
    expect(() =>
      registerSource({
        ...VALID_SOURCE,
        fields: [
          {
            name: "title",
            type: "money" as unknown as WidgetSource["fields"][number]["type"],
          },
        ],
      })
    ).toThrow(/field "title" has an unknown type "money"/);
  });

  it("refuses duplicate field names", () => {
    expect(() =>
      registerSource({
        ...VALID_SOURCE,
        fields: [
          { name: "title", type: "string" },
          { name: "title", type: "string" },
        ],
      })
    ).toThrow(/field "title" is declared more than once/);
  });
});
