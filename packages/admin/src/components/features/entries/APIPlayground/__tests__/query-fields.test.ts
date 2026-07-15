import { describe, it, expect } from "vitest";

import type { PlaygroundField, WhereCondition } from "../query-fields";
import {
  fieldLabel,
  formatSelect,
  formatSort,
  formatWhere,
  parseSelect,
  parseSort,
  selectableFields,
  sortableFields,
} from "../query-fields";

const condition = (over: Partial<WhereCondition> = {}): WhereCondition => ({
  id: "c1",
  field: "status",
  operator: "equals",
  value: "draft",
  ...over,
});

const FIELDS: PlaygroundField[] = [
  { name: "title", type: "text" },
  { name: "slug", type: "text" },
  { name: "excerpt", type: "textarea" },
  { name: "editorMode", type: "select", label: "Editor" },
  { name: "content", type: "richText" },
  { name: "layout", type: "json" },
  { name: "categories", type: "relationship" },
  { name: "featuredImage", type: "upload" },
  { name: "publishedAt", type: "date" },
  { name: "sidebar", type: "ui" },
];

describe("sortableFields", () => {
  it("offers the system columns that every collection has", () => {
    const result = sortableFields(FIELDS);
    expect(result).toEqual(
      expect.arrayContaining(["id", "createdAt", "updatedAt"])
    );
  });

  it("offers status only when draft/published is enabled", () => {
    expect(sortableFields(FIELDS, true)).toContain("status");
    expect(sortableFields(FIELDS, false)).not.toContain("status");
  });

  it("offers scalar fields", () => {
    const result = sortableFields(FIELDS);
    expect(result).toEqual(
      expect.arrayContaining([
        "title",
        "slug",
        "excerpt",
        "editorMode",
        "publishedAt",
      ])
    );
  });

  it("leaves out structured fields, which have no meaningful order", () => {
    const result = sortableFields(FIELDS);
    for (const name of ["content", "layout", "categories", "featuredImage"]) {
      expect(result).not.toContain(name);
    }
  });

  it("leaves out layout-only fields, which are not columns at all", () => {
    expect(sortableFields(FIELDS)).not.toContain("sidebar");
  });

  it("survives a collection whose fields have not loaded yet", () => {
    expect(sortableFields()).toEqual(["id", "createdAt", "updatedAt"]);
  });
});

describe("selectableFields", () => {
  it("offers structured fields, which can be asked for even if not ordered by", () => {
    const result = selectableFields(FIELDS);
    expect(result).toEqual(
      expect.arrayContaining([
        "content",
        "layout",
        "categories",
        "featuredImage",
      ])
    );
  });

  it("leaves out layout-only fields", () => {
    expect(selectableFields(FIELDS)).not.toContain("sidebar");
  });
});

describe("fieldLabel", () => {
  it("prefers the field's label", () => {
    expect(fieldLabel("editorMode", FIELDS)).toBe("Editor");
  });

  it("falls back to the name the API uses", () => {
    expect(fieldLabel("title", FIELDS)).toBe("title");
    expect(fieldLabel("createdAt", FIELDS)).toBe("createdAt");
  });
});

describe("parseSort", () => {
  it("reads an ascending field", () => {
    expect(parseSort("title")).toEqual({ field: "title", descending: false });
  });

  it("reads the leading - as descending", () => {
    expect(parseSort("-createdAt")).toEqual({
      field: "createdAt",
      descending: true,
    });
  });

  it("treats absent and empty as no sort", () => {
    expect(parseSort(undefined)).toBeNull();
    expect(parseSort("")).toBeNull();
    expect(parseSort("   ")).toBeNull();
  });
});

describe("formatSort", () => {
  it("writes an ascending field bare", () => {
    expect(formatSort({ field: "title", descending: false })).toBe("title");
  });

  it("writes a descending field with the - prefix", () => {
    expect(formatSort({ field: "title", descending: true })).toBe("-title");
  });

  it("writes nothing when no field is chosen", () => {
    expect(formatSort(null)).toBe("");
    expect(formatSort({ field: "", descending: true })).toBe("");
  });

  it("round-trips with parseSort", () => {
    for (const value of ["title", "-createdAt", "status"]) {
      expect(formatSort(parseSort(value))).toBe(value);
    }
  });
});

describe("parseSelect", () => {
  it("reads the object form the API honours", () => {
    expect(parseSelect('{"title":true,"slug":true}')).toEqual([
      "title",
      "slug",
    ]);
  });

  it("ignores keys that are not selected", () => {
    expect(parseSelect('{"title":true,"slug":false}')).toEqual(["title"]);
  });

  // The API accepts `select=title` and then returns every field, so reading it
  // as a selection would show a state the request does not have.
  it("treats the bare form the API ignores as no selection", () => {
    expect(parseSelect("title")).toEqual([]);
  });

  it("treats malformed or empty input as no selection", () => {
    expect(parseSelect(undefined)).toEqual([]);
    expect(parseSelect("")).toEqual([]);
    expect(parseSelect("{not json")).toEqual([]);
    expect(parseSelect("[1,2]")).toEqual([]);
    expect(parseSelect("null")).toEqual([]);
  });
});

describe("formatSelect", () => {
  it("writes the object form", () => {
    expect(formatSelect(["title", "slug"])).toBe('{"title":true,"slug":true}');
  });

  // An empty object would be a selection of nothing; dropping the key is what
  // "no selection" actually means to the API.
  it("writes nothing when no field is chosen", () => {
    expect(formatSelect([])).toBe("");
  });

  it("round-trips with parseSelect", () => {
    const names = ["title", "publishedAt"];
    expect(parseSelect(formatSelect(names))).toEqual(names);
  });
});

describe("formatWhere", () => {
  it("writes the operator form the API reads", () => {
    expect(formatWhere([condition()])).toBe('{"status":{"equals":"draft"}}');
  });

  it("writes each condition as its own field", () => {
    const result = formatWhere([
      condition({ id: "a", field: "status", value: "draft" }),
      condition({
        id: "b",
        field: "title",
        operator: "contains",
        value: "CMS",
      }),
    ]);
    expect(JSON.parse(result)).toEqual({
      status: { equals: "draft" },
      title: { contains: "CMS" },
    });
  });

  it("splits list operators into an array", () => {
    const result = formatWhere([
      condition({ operator: "in", value: "draft, published" }),
    ]);
    expect(JSON.parse(result)).toEqual({
      status: { in: ["draft", "published"] },
    });
  });

  it("sends exists as a boolean rather than a string", () => {
    expect(
      JSON.parse(
        formatWhere([condition({ operator: "exists", value: "false" })])
      )
    ).toEqual({ status: { exists: false } });
    expect(
      JSON.parse(
        formatWhere([condition({ operator: "exists", value: "true" })])
      )
    ).toEqual({ status: { exists: true } });
  });

  // A condition the API cannot read is ignored server-side and every entry
  // comes back, so sending a half-written row would answer a question nobody
  // asked. Skipping it keeps the URL honest about what is being requested.
  it("skips a row that has no value yet", () => {
    expect(formatWhere([condition({ value: "" })])).toBe("");
  });

  it("skips a row that has no field yet", () => {
    expect(formatWhere([condition({ field: "" })])).toBe("");
  });

  it("skips a list row whose value is only separators", () => {
    expect(formatWhere([condition({ operator: "in", value: " , , " })])).toBe(
      ""
    );
  });

  it("keeps the finished rows when another is still being written", () => {
    const result = formatWhere([
      condition({ id: "a", field: "status", value: "draft" }),
      condition({ id: "b", field: "title", value: "" }),
    ]);
    expect(JSON.parse(result)).toEqual({ status: { equals: "draft" } });
  });

  // `exists` asks whether the column is set, so the row is complete without
  // anything typed into it.
  it("does not require a typed value for exists", () => {
    expect(
      formatWhere([condition({ operator: "exists", value: "" })])
    ).not.toBe("");
  });

  it("writes nothing for no rows at all", () => {
    expect(formatWhere([])).toBe("");
  });
});
