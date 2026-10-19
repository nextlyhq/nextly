/**
 * A built setting IS core's setting definition: registration's own validator
 * accepts it unchanged, once the record key is given as its `name`.
 *
 * What this separates is one vocabulary from two. A builder emitting its own
 * shape (`kind`, `default`, a `toggle` type) would type-check in every
 * declaration and still need a translation table before registration, which
 * could drift; here the definition the builder writes is the one
 * `validateWidgetSettings` and `FieldRenderer` already read.
 *
 * Only the builders whose controls core already has a type for are listed.
 * Collection, Filter, Sort and Group by are the controls core does not have
 * yet; they are added to the one setting union, not translated into it.
 */
import { describe, expect, it } from "vitest";

import { MAX_WIDGET_ROWS } from "../../query-limits";

import { validateWidgetSettings } from "../../settings";
import { settings } from "../setting-builders";

const CANONICAL = {
  items: settings.items(),
  range: settings.dateRange(),
  style: settings.chartStyle(),
  mine: settings.onlyMine(),
  note: settings.text({ default: "" }),
  limit: settings.number({ default: 3, min: 1, max: 9 }),
  compact: settings.toggle({ default: false }),
  tone: settings.select({ options: ["calm", "loud"], default: "calm" }),
};

describe("a built setting is core's setting definition", () => {
  it.each(Object.entries(CANONICAL))(
    "%s passes registration's own validation as written",
    (name, declaration) => {
      expect(() =>
        validateWidgetSettings([{ name, ...declaration }], "test/w")
      ).not.toThrow();
    }
  );

  it("writes the definition's own fields, not an author's spelling", () => {
    expect(settings.items()).toEqual({
      type: "number",
      defaultValue: 5,
      min: 1,
      // The most rows a card draws, the one limit both sides read.
      max: MAX_WIDGET_ROWS,
    });
    expect(settings.toggle({ default: true })).toEqual({
      type: "checkbox",
      defaultValue: true,
    });
    expect(settings.dateRange()).toMatchObject({
      type: "select",
      defaultValue: "30d",
      options: [
        { label: "7d", value: "7d" },
        { label: "30d", value: "30d" },
        { label: "90d", value: "90d" },
        { label: "12m", value: "12m" },
      ],
    });
  });
});
