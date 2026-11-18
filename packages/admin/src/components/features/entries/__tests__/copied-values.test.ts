/**
 * The values a copy from another language put into a form, and the claim its save makes for
 * each: a field still holding the copied value was copied from that language; one edited since
 * is the person's own translation and claims nothing. A save forgets the copies it began with,
 * and a form reset to another document or language, or discarded, forgets every copy.
 */
import { describe, expect, it } from "vitest";

import { copiedValuesFor } from "../copied-values";

describe("copiedValuesFor", () => {
  it("claims a copy for each field still holding the copied value", () => {
    const copies = copiedValuesFor({});
    copies.record({ title: "Hello", body: "World" }, "en");

    expect(
      copies.beginSave({ title: "Hello", body: "World, edited" }).claims
    ).toEqual({ title: { origin: "copy", sourceLocale: "en" } });
  });

  it("claims the latest copy of a field, and nothing once the save is made", () => {
    const copies = copiedValuesFor({});
    copies.record({ title: "Hello" }, "en");
    copies.record({ title: "Bonjour" }, "fr");
    const save = copies.beginSave({ title: "Bonjour" });
    expect(save.claims).toEqual({
      title: { origin: "copy", sourceLocale: "fr" },
    });

    save.saved();
    expect(copies.beginSave({ title: "Bonjour" }).claims).toBeUndefined();
  });

  it("keeps a copy made while a save was on its way", () => {
    // The save carried what the form held when it began. A copy completed while it was in flight
    // is not in it, so it is still claimed by the next save.
    const copies = copiedValuesFor({});
    copies.record({ title: "Hello" }, "en");
    const save = copies.beginSave({ title: "Hello" });
    copies.record({ body: "World" }, "en");

    save.saved();
    expect(copies.beginSave({ title: "Hello", body: "World" }).claims).toEqual({
      body: { origin: "copy", sourceLocale: "en" },
    });
  });

  it("forgets every copy once the form is reset to another document or language", () => {
    // Left behind, a copy would be claimed by a save of a document it was never made in, as soon
    // as a field there held the same value (most simply, the copy's own source language).
    const copies = copiedValuesFor({});
    copies.record({ title: "Hello" }, "en");

    copies.clear();
    expect(copies.beginSave({ title: "Hello" }).claims).toBeUndefined();
  });

  it("says which version of its source each copy was read at", () => {
    // The server judges a copy against the source language as it now stands: a copy read at an
    // older version of English reads as out of date, so the claim carries the version it read.
    const copies = copiedValuesFor({});
    copies.record({ title: "Hello" }, "en", "3.en:2");
    copies.record({ body: "Bonjour" }, "fr");
    expect(
      copies.beginSave({ title: "Hello", body: "Bonjour" }).claims
    ).toEqual({
      title: { origin: "copy", sourceLocale: "en", sourceRevision: "3.en:2" },
      body: { origin: "copy", sourceLocale: "fr" },
    });
  });

  it("is one tracker per form", () => {
    const control = {};
    copiedValuesFor(control).record({ title: "Hello" }, "en");
    expect(
      copiedValuesFor(control).beginSave({ title: "Hello" }).claims
    ).toEqual({ title: { origin: "copy", sourceLocale: "en" } });
    expect(
      copiedValuesFor({}).beginSave({ title: "Hello" }).claims
    ).toBeUndefined();
  });
});
