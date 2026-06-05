/**
 * @module lib/builder/ui-schema-mode.test
 */
import { describe, expect, it } from "vitest";

import { UI_SCHEMA_FIELD_TYPES } from "./ui-schema-mode";

describe("UI_SCHEMA_FIELD_TYPES", () => {
  it("is the full canonical field-type set (mirrors the package UI_FIELD_TYPES)", () => {
    expect([...UI_SCHEMA_FIELD_TYPES].sort()).toEqual(
      [
        // original v1 subset
        "checkbox",
        "date",
        "number",
        "relationship",
        "richText",
        "select",
        "text",
        "textarea",
        "upload",
        // widened canonical set
        "chips",
        "code",
        "component",
        "email",
        "group",
        "json",
        "password",
        "radio",
        "repeater",
      ].sort()
    );
  });
});
