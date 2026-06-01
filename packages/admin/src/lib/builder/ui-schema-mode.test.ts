/**
 * @module lib/builder/ui-schema-mode.test
 * @since v0.0.3-alpha (Plan D4)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isUiSchemaWriteMode, UI_SCHEMA_FIELD_TYPES } from "./ui-schema-mode";

const ORIGINAL_ENV = process.env.NODE_ENV;
const ORIGINAL_FLAG = process.env.NEXT_PUBLIC_NEXTLY_UI_SCHEMA_WRITE;

beforeEach(() => {
  process.env.NODE_ENV = "development";
  process.env.NEXT_PUBLIC_NEXTLY_UI_SCHEMA_WRITE = "1";
});
afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
  process.env.NEXT_PUBLIC_NEXTLY_UI_SCHEMA_WRITE = ORIGINAL_FLAG;
});

describe("isUiSchemaWriteMode", () => {
  it("is true in development with the flag on", () => {
    expect(isUiSchemaWriteMode()).toBe(true);
  });
  it("is false when the flag is off", () => {
    process.env.NEXT_PUBLIC_NEXTLY_UI_SCHEMA_WRITE = "";
    expect(isUiSchemaWriteMode()).toBe(false);
  });
  it("is false in production even with the flag on", () => {
    process.env.NODE_ENV = "production";
    expect(isUiSchemaWriteMode()).toBe(false);
  });
});

describe("UI_SCHEMA_FIELD_TYPES", () => {
  it("is the 9 supported v1 types", () => {
    expect([...UI_SCHEMA_FIELD_TYPES].sort()).toEqual(
      [
        "checkbox",
        "date",
        "number",
        "relationship",
        "richText",
        "select",
        "text",
        "textarea",
        "upload",
      ].sort()
    );
  });
});
