/**
 * The one meaning of a read's `select`, shared by collection and Single reads.
 */
import { describe, expect, it } from "vitest";

import {
  applyFieldSelection,
  selectedFieldPaths,
  selectedTopLevelFields,
} from "../field-selection";

const entry = {
  id: "e1",
  title: "Hello",
  body: "World",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  first_published_at: null,
  author: { id: "a1", name: "Ann", email: "ann@example.test" },
  tags: [
    { id: "t1", label: "one", colour: "red" },
    { id: "t2", label: "two", colour: "blue" },
  ],
};

describe("applyFieldSelection", () => {
  it("includes the fields named true, with the id and system timestamps", () => {
    expect(applyFieldSelection(entry, { title: true })).toEqual({
      id: "e1",
      title: "Hello",
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      first_published_at: null,
    });
  });

  it("ignores a false entry rather than excluding the field", () => {
    expect(applyFieldSelection(entry, { title: true, body: false })).toEqual(
      applyFieldSelection(entry, { title: true })
    );
  });

  it("leaves the entry whole when the selection includes nothing", () => {
    expect(applyFieldSelection(entry, {})).toBe(entry);
    expect(applyFieldSelection(entry, { body: false })).toBe(entry);
  });

  it("selects a dot path inside an object and inside each row of a list", () => {
    expect(
      applyFieldSelection(entry, { "author.name": true, "tags.label": true })
    ).toMatchObject({
      author: { id: "a1", name: "Ann" },
      tags: [
        { id: "t1", label: "one" },
        { id: "t2", label: "two" },
      ],
    });
    const selected = applyFieldSelection(entry, { "author.name": true });
    expect(selected.author).not.toHaveProperty("email");
  });
});

describe("selectedFieldPaths and selectedTopLevelFields", () => {
  it("name the included paths, and each path's top-level field once", () => {
    const select = { title: true, body: false, "author.name": true };
    expect(selectedFieldPaths(select)).toEqual(["title", "author.name"]);
    expect(selectedFieldPaths(undefined)).toEqual([]);
    expect([
      ...selectedTopLevelFields({ ...select, "author.email": true }),
    ]).toEqual(["title", "author"]);
  });
});
