// The decode that runs before a read's hooks.
//
// `locale=all` is the only shape where a field's value is a language-keyed map,
// and only a localized field is ever read that way. A driver that parses JSON
// hands back a plain object for a shared field, so the two are told apart by
// the field's own declaration rather than by looking at the value.

import { describe, expect, it } from "vitest";

import { decodeJsonFieldValues } from "../collection-utils";

const jsonField = (name: string, localized = false) => ({
  name,
  type: "json",
  localized,
});

describe("decodeJsonFieldValues", () => {
  it("decodes a storage-encoded value", () => {
    const rows = [{ config: '{"mode":"live"}' }];
    decodeJsonFieldValues(rows, [jsonField("config")]);
    expect(rows[0].config).toEqual({ mode: "live" });
  });

  it("leaves a shared JSON object alone under locale=all", () => {
    // The value is the field's own object. Read as a locale map, its string
    // properties get parsed and the caller receives types the row never held.
    const rows = [{ config: { mode: "true", retries: "3" } }];
    decodeJsonFieldValues(rows, [jsonField("config")], "all");
    expect(rows[0].config).toEqual({ mode: "true", retries: "3" });
  });

  it("decodes each locale of a localized field under locale=all", () => {
    const rows = [{ config: { en: '{"mode":"live"}', fr: '{"mode":"test"}' } }];
    decodeJsonFieldValues(rows, [jsonField("config", true)], "all");
    expect(rows[0].config).toEqual({
      en: { mode: "live" },
      fr: { mode: "test" },
    });
  });

  it("keeps text that is not JSON as the value it is", () => {
    const rows = [{ config: "not json" }];
    decodeJsonFieldValues(rows, [jsonField("config")]);
    expect(rows[0].config).toBe("not json");
  });
});
