import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import { checkUserFieldType } from "../validate-user-config";

afterEach(() => clearFieldTypes());

describe("checkUserFieldType", () => {
  it("accepts a built-in scalar type", () => {
    expect(checkUserFieldType("text")).toBeNull();
    expect(checkUserFieldType("number")).toBeNull();
  });

  it("rejects a missing or non-string type", () => {
    expect(checkUserFieldType(undefined)?.code).toBe(
      "USER_FIELD_TYPE_REQUIRED"
    );
    expect(checkUserFieldType(42)?.code).toBe("USER_FIELD_TYPE_NOT_ALLOWED");
  });

  it("rejects an unregistered plugin type", () => {
    expect(checkUserFieldType("rating")?.code).toBe(
      "USER_FIELD_TYPE_NOT_ALLOWED"
    );
  });

  it("accepts a plugin type that opted into the users surface", () => {
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "c",
      surfaces: ["users"],
    });
    expect(checkUserFieldType("rating")).toBeNull();
  });

  it("rejects a plugin type that did not opt into the users surface", () => {
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "c",
      surfaces: ["entries"],
    });
    expect(checkUserFieldType("rating")?.code).toBe(
      "USER_FIELD_TYPE_NOT_ALLOWED"
    );
  });
});
