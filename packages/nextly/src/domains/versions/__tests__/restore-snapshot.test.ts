/**
 * What of a stored snapshot may be resubmitted.
 *
 * Two of these are load-bearing for reasons that are not obvious from the call
 * site: nothing downstream removes a key the schema no longer has, and a
 * localized snapshot holds one locale's values with no way to guess which.
 */
import { describe, it, expect } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { buildRestorePayload, canRestoreLocale } from "../restore-snapshot";

const fields = [
  { name: "title", type: "text" },
  { name: "body", type: "richText" },
] as FieldConfig[];

describe("buildRestorePayload", () => {
  it("keeps the values of fields the schema still has", () => {
    const { payload } = buildRestorePayload(
      { title: "Hello", body: { root: {} } },
      fields
    );

    expect(payload).toEqual({ title: "Hello", body: { root: {} } });
  });

  it("drops a field the schema no longer has, and reports it", () => {
    // Validation walks the schema's fields rather than the payload's keys, so
    // it ignores this; the update then names the missing column in raw SQL.
    const { payload, droppedFields } = buildRestorePayload(
      { title: "Hello", subtitle: "Gone" },
      fields
    );

    expect(payload).toEqual({ title: "Hello" });
    expect(droppedFields).toEqual(["subtitle"]);
  });

  it("never resubmits identity or ownership", () => {
    // Stripped here rather than downstream so hooks are not handed a forged
    // createdBy, and because the singles path never strips it at all.
    const { payload } = buildRestorePayload(
      {
        id: "e1",
        createdAt: "2020-01-01",
        created_by: "someone-else",
        createdBy: "someone-else",
        updatedAt: "2020-01-02",
        title: "Hello",
      },
      fields
    );

    expect(payload).toEqual({ title: "Hello" });
  });

  it("keeps status and slug, which are writable but not schema fields", () => {
    const { payload, droppedFields } = buildRestorePayload(
      { title: "Hello", status: "draft", slug: "hello" },
      fields
    );

    expect(payload).toMatchObject({ status: "draft", slug: "hello" });
    expect(droppedFields).toEqual([]);
  });

  it("keeps a value that was deliberately emptied", () => {
    // Update is a merge, so a field the snapshot holds as null must be sent to
    // restore the emptied state rather than leaving the current value.
    const { payload } = buildRestorePayload({ title: null }, fields);

    expect(payload).toEqual({ title: null });
  });

  it("yields nothing for a snapshot that is not an object", () => {
    expect(buildRestorePayload("corrupt", fields)).toEqual({
      payload: {},
      droppedFields: [],
    });
  });
});

describe("canRestoreLocale", () => {
  it("allows an unlocalized document regardless of the version's locale", () => {
    expect(canRestoreLocale(false, null)).toBe(true);
    expect(canRestoreLocale(false, "de")).toBe(true);
  });

  it("allows a localized document when the version names its locale", () => {
    expect(canRestoreLocale(true, "de")).toBe(true);
  });

  it("refuses a localized document when the version does not", () => {
    // Writing it anyway would put one language's content into whichever locale
    // happens to be the default.
    expect(canRestoreLocale(true, null)).toBe(false);
  });
});
