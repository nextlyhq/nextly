/**
 * Whether unsaved edits change what every language shares. The plausible broken versions: any
 * edit counts as shared (the choice on every publish), none does (a shared change goes live in
 * every language unannounced), and an edit inside a shared group is missed.
 */
import { describe, expect, it } from "vitest";

import { editsSharedFields } from "../shared-edits";

const FIELDS = [
  { type: "text", name: "title" },
  { type: "number", name: "price" },
  { type: "group", name: "seo" },
  { type: "relationship", name: "author" },
  // A field with no name of its own, such as a layout.
  { type: "row" },
];

describe("whether unsaved edits change a field every language shares", () => {
  const startedFrom = {
    title: "Hello",
    price: 10,
    seo: { noIndex: false },
    author: { id: "a1", name: "Ada" },
  };
  const edits = (current: Record<string, unknown>) =>
    editsSharedFields({
      fields: FIELDS,
      translated: ["title"],
      startedFrom,
      current: { ...startedFrom, ...current },
    });

  it("is false for no edit, and for an edit to a translated field alone", () => {
    expect(edits({})).toBe(false);
    expect(edits({ title: "Hello again" })).toBe(false);
  });

  it("is true for an edit to a shared field, beside a translated one or alone", () => {
    expect(edits({ price: 12 })).toBe(true);
    expect(edits({ title: "Hello again", price: 12 })).toBe(true);
  });

  it("is true for an edit inside a shared group", () => {
    expect(edits({ seo: { noIndex: true } })).toBe(true);
  });

  it("is false for a shared value held another way: a group read again, a document by its id", () => {
    expect(edits({ seo: { noIndex: false } })).toBe(false);
    expect(edits({ author: "a1" })).toBe(false);
    expect(edits({ author: "a2" })).toBe(true);
  });
});
