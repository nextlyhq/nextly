// The source readers behind copy-from-language. Two things are worth pinning
// here rather than leaving to review: that a source read never falls back (a
// fallback read returns the DEFAULT language's text for untranslated fields,
// which copy-from would then write in as though it were a translation), and
// that a collection entry with no id yet declines to offer the action at all.
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  collectionSourceFetcher,
  localizedFieldNamesOf,
  singleSourceFetcher,
} from "../entry-locale-source";

const { findByID, getDocument } = vi.hoisted(() => ({
  findByID: vi.fn(),
  getDocument: vi.fn(),
}));
vi.mock("@admin/services/entryApi", () => ({
  entryApi: { findByID: (...args: unknown[]) => findByID(...args) },
}));
vi.mock("@admin/services/singleApi", () => ({
  singleApi: { getDocument: (...args: unknown[]) => getDocument(...args) },
}));

beforeEach(() => {
  findByID.mockReset();
  getDocument.mockReset();
});

describe("localizedFieldNamesOf", () => {
  const FIELDS = [
    { name: "title", type: "text" },
    { name: "body", type: "richText" },
    { name: "views", type: "number" },
    { name: "secret", type: "password" },
    { name: "sku", type: "text", localized: false },
    { name: "tag", type: "number", localized: true },
  ];

  it("classifies a document's fields by the smart defaults and explicit overrides", () => {
    expect(localizedFieldNamesOf(FIELDS, true)).toEqual([
      "title",
      "body",
      "tag",
    ]);
  });

  it("returns nothing when the document's master localization switch is off", () => {
    expect(localizedFieldNamesOf(FIELDS, false)).toEqual([]);
  });

  it("tolerates the two field shapes it is given without conversion", () => {
    // Entries carry FieldDefinition and singles carry FieldConfig; neither is
    // reshaped at the call site, so a field missing either key must not throw.
    expect(
      localizedFieldNamesOf([{ name: "x" }, { type: "text" }], true)
    ).toEqual([""]);
  });
});

describe("collectionSourceFetcher", () => {
  it("declines without an entry id, so create mode never offers copy-from", () => {
    expect(collectionSourceFetcher("pages", undefined)).toBeUndefined();
  });

  it("reads the requested language with fallback OFF and no relations", async () => {
    findByID.mockResolvedValue({ title: "Hello" });
    const fetch = collectionSourceFetcher("pages", "e1");
    expect(fetch).toBeDefined();

    await expect(fetch?.("en")).resolves.toEqual({ title: "Hello" });
    expect(findByID).toHaveBeenCalledWith("pages", "e1", {
      locale: "en",
      fallbackLocale: "none",
      depth: 0,
    });
  });
});

describe("singleSourceFetcher", () => {
  it("reads by slug alone, with the same no-fallback contract", async () => {
    getDocument.mockResolvedValue({ title: "Hallo" });
    const fetch = singleSourceFetcher("site-settings");

    await expect(fetch("de")).resolves.toEqual({ title: "Hallo" });
    expect(getDocument).toHaveBeenCalledWith("site-settings", {
      locale: "de",
      fallbackLocale: "none",
      depth: 0,
    });
  });
});
