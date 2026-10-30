/**
 * A built setting IS core's setting definition: registration's own validator
 * accepts it unchanged, once the record key is given as its `name`.
 *
 * What this separates is one vocabulary from two. A builder emitting its own
 * shape (`kind`, `default`, a `toggle` type) would type-check in every
 * declaration and still need a translation table before registration, which
 * could drift; here the definition the builder writes is the one
 * `validateWidgetSettings` and `FieldRenderer` already read.
 */
import { describe, expect, it } from "vitest";

import { option } from "../../../../collections/fields/helpers";
import { validateWidgetSettings } from "../../settings";
import { setting } from "../setting-builders";

const CANONICAL = {
  note: setting.text({ label: "Note", defaultValue: "" }),
  body: setting.textarea({ label: "Body", maxLength: 200 }),
  limit: setting.number({ label: "Rows", defaultValue: 3, min: 1, max: 9 }),
  compact: setting.checkbox({ label: "Compact", defaultValue: false }),
  tone: setting.select({
    label: "Tone",
    options: [option("Calm", "calm"), option("Loud", "loud")],
    defaultValue: "calm",
  }),
  since: setting.date({ label: "Since", defaultValue: "2026-01-01" }),
  range: setting.dateRange({ label: "Date range" }),
  collection: setting.collection({ label: "Collection" }),
  field: setting.fieldOf({ of: "collection", label: "Field" }),
  filter: setting.filter({ of: "collection", label: "Filter" }),
  sort: setting.sort({ of: "collection", label: "Sort" }),
  groupBy: setting.groupBy({ of: "collection", label: "Group by" }),
};

describe("a built setting is core's setting definition", () => {
  it("every builder passes registration's own validation as written", () => {
    expect(() =>
      validateWidgetSettings(
        Object.entries(CANONICAL).map(([name, declaration]) => ({
          name,
          ...declaration,
        })),
        "test/w",
        // Core builds this widget's data, so its content settings are read
        // where they are declared rather than by a query knob.
        true
      )
    ).not.toThrow();
  });

  it("writes the definition's own fields, not an author's spelling", () => {
    expect(
      setting.number({
        label: "Rows",
        defaultValue: 5,
        min: 1,
        max: 10,
        admin: { description: "How many rows the card shows." },
      })
    ).toEqual({
      type: "number",
      label: "Rows",
      defaultValue: 5,
      min: 1,
      max: 10,
      admin: { description: "How many rows the card shows." },
    });
    expect(setting.checkbox({ label: "Mine", defaultValue: true })).toEqual({
      type: "checkbox",
      label: "Mine",
      defaultValue: true,
    });
    expect(setting.fieldOf({ of: "source", label: "Field" })).toEqual({
      type: "field",
      of: "source",
      label: "Field",
    });
  });

  it("names each date range for the reader, the last 30 days by default", () => {
    expect(setting.dateRange({ label: "Period" })).toEqual({
      type: "select",
      label: "Period",
      defaultValue: "30d",
      options: [
        { label: "Last 7 days", value: "7d" },
        { label: "Last 30 days", value: "30d" },
        { label: "Last 90 days", value: "90d" },
        { label: "Last 12 months", value: "12m" },
      ],
    });
  });

  it("keeps a select's options as label and value alone", () => {
    // An option carrying more than the definition reads is trimmed, so the
    // admin is sent the two keys it draws and nothing an author added.
    const extra = { label: "Calm", value: "calm", colour: "blue" };
    expect(
      setting.select({ label: "Tone", options: [extra], defaultValue: "calm" })
    ).toEqual({
      type: "select",
      label: "Tone",
      defaultValue: "calm",
      options: [{ label: "Calm", value: "calm" }],
    });
  });
});

describe("a quick setting, as the builders write it", () => {
  it("is marked only when asked, and unmarked settings carry no flag", () => {
    expect(setting.dateRange({ label: "Range", quick: true })).toMatchObject({
      quick: true,
    });
    expect(
      setting.checkbox({ label: "Mine", defaultValue: false, quick: true })
    ).toMatchObject({ quick: true });
    expect(
      setting.select({
        label: "Tone",
        options: [option("A", "a"), option("B", "b")],
        defaultValue: "a",
        quick: true,
      })
    ).toMatchObject({ quick: true });
    // Unmarked, or marked false, the declaration has no flag at all.
    expect(setting.dateRange({ label: "Range" })).not.toHaveProperty("quick");
    expect(
      setting.dateRange({ label: "Range", quick: false })
    ).not.toHaveProperty("quick");
  });
});
