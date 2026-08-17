/**
 * A snapshot is captured from the persisted row, so it carries whatever shape
 * the dialect stored — JSON as text on SQLite, objects elsewhere, and four
 * spellings of a boolean. These are the readings the editor's inputs need, and
 * the cases where handing over the raw value would render a field as empty
 * while it plainly held something.
 */
import type { FieldConfig } from "nextly/config";
import { describe, it, expect } from "vitest";

import { snapshotToFormValues } from "../snapshot-to-form-values";

const field = (name: string, type: string, extra = {}): FieldConfig =>
  ({ name, type, label: name, ...extra }) as FieldConfig;

describe("snapshotToFormValues", () => {
  it("parses a JSON-backed value stored as text, as SQLite stores it", () => {
    const values = snapshotToFormValues([field("tags", "chips")], {
      tags: '["alpha","beta"]',
    });

    // Handed over raw, a control expecting a list receives a string and shows
    // nothing — the field reads as empty while it held two entries.
    expect(values.tags).toEqual(["alpha", "beta"]);
  });

  it("leaves an already-parsed value alone, as Postgres and MySQL store it", () => {
    const values = snapshotToFormValues([field("tags", "chips")], {
      tags: ["alpha"],
    });

    expect(values.tags).toEqual(["alpha"]);
  });

  it("reads every dialect's spelling of a boolean", () => {
    for (const stored of [true, "true", 1, "1"]) {
      expect(
        snapshotToFormValues([field("live", "checkbox")], { live: stored }).live
      ).toBe(true);
    }
    expect(
      snapshotToFormValues([field("live", "checkbox")], { live: false }).live
    ).toBe(false);
  });

  it("omits a field the snapshot has no value for", () => {
    const values = snapshotToFormValues(
      [field("title", "text"), field("subtitle", "text")],
      { title: "Only this" }
    );

    // Absent rather than null: an explicit null turns a controlled input
    // uncontrolled, and both render blank, which is the truthful reading.
    expect(values).toEqual({ title: "Only this" });
    expect("subtitle" in values).toBe(false);
  });

  it("reads the children of a nameless container against the same object", () => {
    const grouped = [
      { name: "", type: "group", fields: [field("city", "text")] },
    ] as FieldConfig[];

    // A presentational group stores its children beside it, so dropping it
    // would hide every field inside from the historical document.
    expect(snapshotToFormValues(grouped, { city: "Lisbon" })).toEqual({
      city: "Lisbon",
    });
  });

  it("treats a snapshot that is not an object as holding nothing", () => {
    expect(snapshotToFormValues([field("title", "text")], "corrupt")).toEqual(
      {}
    );
    expect(snapshotToFormValues([field("title", "text")], null)).toEqual({});
  });
});
