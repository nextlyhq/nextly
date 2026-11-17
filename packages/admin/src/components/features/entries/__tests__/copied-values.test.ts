/**
 * The values a copy from another language put into a form, and the claim its save makes for
 * each: a field still holding the copied value was copied from that language; one edited since
 * is the person's own translation and claims nothing.
 */
import { describe, expect, it } from "vitest";

import { copiedValuesFor } from "../copied-values";

describe("copiedValuesFor", () => {
  it("claims a copy for each field still holding the copied value", () => {
    const copies = copiedValuesFor({});
    copies.record({ title: "Hello", body: "World" }, "en");

    expect(
      copies.provenanceForSave({ title: "Hello", body: "World, edited" })
    ).toEqual({ title: { origin: "copy", sourceLocale: "en" } });
  });

  it("claims the latest copy of a field, and nothing once the save is made", () => {
    const copies = copiedValuesFor({});
    copies.record({ title: "Hello" }, "en");
    copies.record({ title: "Bonjour" }, "fr");
    expect(copies.provenanceForSave({ title: "Bonjour" })).toEqual({
      title: { origin: "copy", sourceLocale: "fr" },
    });

    copies.saved();
    expect(copies.provenanceForSave({ title: "Bonjour" })).toBeUndefined();
  });

  it("says which version of its source each copy was read at", () => {
    // The server judges a copy against the source language as it now stands: a copy read at an
    // older version of English reads as out of date, so the claim carries the version it read.
    const copies = copiedValuesFor({});
    copies.record({ title: "Hello" }, "en", "3.en:2");
    copies.record({ body: "Bonjour" }, "fr");
    expect(
      copies.provenanceForSave({ title: "Hello", body: "Bonjour" })
    ).toEqual({
      title: { origin: "copy", sourceLocale: "en", sourceRevision: "3.en:2" },
      body: { origin: "copy", sourceLocale: "fr" },
    });
  });

  it("is one tracker per form", () => {
    const control = {};
    copiedValuesFor(control).record({ title: "Hello" }, "en");
    expect(
      copiedValuesFor(control).provenanceForSave({ title: "Hello" })
    ).toEqual({ title: { origin: "copy", sourceLocale: "en" } });
    expect(
      copiedValuesFor({}).provenanceForSave({ title: "Hello" })
    ).toBeUndefined();
  });
});
