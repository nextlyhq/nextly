import { describe, it, expect } from "vitest";

import {
  defaultLocalizedForType,
  isFieldLocalized,
  resolveLocalizedFieldNames,
} from "./classify-fields";

describe("classify-fields", () => {
  it("text-like types default to localized; value/structural default to shared", () => {
    for (const t of [
      "text",
      "textarea",
      "richText",
      "email",
      "code",
    ] as const) {
      expect(defaultLocalizedForType(t)).toBe(true);
    }
    for (const t of [
      "number",
      "date",
      "checkbox",
      "select",
      "radio",
      "relationship",
      "upload",
      "repeater",
      "group",
      "json",
      "chips",
      "component",
    ] as const) {
      expect(defaultLocalizedForType(t)).toBe(false);
    }
  });

  it("password is never localizable, even if flagged", () => {
    expect(
      isFieldLocalized({ type: "password", name: "p", localized: true }, true)
    ).toBe(false);
  });

  it("collection switch off => nothing localized", () => {
    expect(isFieldLocalized({ type: "text", name: "t" }, false)).toBe(false);
  });

  it("explicit localized flag overrides the default", () => {
    expect(
      isFieldLocalized({ type: "number", name: "n", localized: true }, true)
    ).toBe(true);
    expect(
      isFieldLocalized({ type: "text", name: "t", localized: false }, true)
    ).toBe(false);
  });

  it("resolveLocalizedFieldNames returns the localized subset", () => {
    const fields = [
      { type: "text", name: "title" },
      { type: "number", name: "price" },
      { type: "richText", name: "body" },
      { type: "password", name: "secret" },
    ];
    expect(resolveLocalizedFieldNames(fields, true)).toEqual(["title", "body"]);
    expect(resolveLocalizedFieldNames(fields, false)).toEqual([]);
  });
});
