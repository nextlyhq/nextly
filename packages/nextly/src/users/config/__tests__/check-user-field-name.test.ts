import { describe, expect, it } from "vitest";

import {
  checkUserFieldName,
  checkUserFieldType,
  RESERVED_USER_FIELD_NAMES,
} from "../validate-user-config";

describe("checkUserFieldName", () => {
  it("accepts an ordinary field name", () => {
    expect(checkUserFieldName("phoneNumber")).toBeNull();
    expect(checkUserFieldName("phone_number")).toBeNull();
    expect(checkUserFieldName("a1")).toBeNull();
  });

  it.each([...RESERVED_USER_FIELD_NAMES])(
    "rejects the built-in name %s",
    name => {
      expect(checkUserFieldName(name)?.code).toBe("USER_FIELD_NAME_RESERVED");
    }
  );

  it("matches reserved names regardless of case", () => {
    for (const name of ["Email", "EMAIL", "eMaIl", "ID", "PassWordHash"]) {
      expect(checkUserFieldName(name)?.code).toBe("USER_FIELD_NAME_RESERVED");
    }
  });

  it("rejects a SQL keyword", () => {
    expect(checkUserFieldName("select")?.code).toBe(
      "USER_FIELD_NAME_SQL_KEYWORD"
    );
  });

  it("rejects names that cannot be a column identifier", () => {
    for (const name of ["1abc", "has-dash", "has space", "has.dot", ""]) {
      expect(checkUserFieldName(name)).not.toBeNull();
    }
  });

  it("rejects a missing or non-string name", () => {
    expect(checkUserFieldName(undefined)?.code).toBe(
      "USER_FIELD_NAME_REQUIRED"
    );
    expect(checkUserFieldName(null)?.code).toBe("USER_FIELD_NAME_REQUIRED");
    expect(checkUserFieldName(42)?.code).toBe("USER_FIELD_NAME_REQUIRED");
  });

  it("reports the built-in conflict for a name that is also a SQL keyword", () => {
    // `password` is both; the built-in conflict is the actionable reason.
    expect(checkUserFieldName("password")?.code).toBe(
      "USER_FIELD_NAME_RESERVED"
    );
  });

  it("names the offending value so the message can be shown as-is", () => {
    expect(checkUserFieldName("email")?.message).toContain("email");
  });
});

describe("checkUserFieldType", () => {
  it("accepts every supported type", () => {
    for (const type of [
      "text",
      "textarea",
      "number",
      "email",
      "select",
      "radio",
      "checkbox",
      "date",
    ]) {
      expect(checkUserFieldType(type)).toBeNull();
    }
  });

  it("rejects a type with no user_ext column representation", () => {
    expect(checkUserFieldType("relationship")?.code).toBe(
      "USER_FIELD_TYPE_NOT_ALLOWED"
    );
    expect(checkUserFieldType("richText")?.code).toBe(
      "USER_FIELD_TYPE_NOT_ALLOWED"
    );
  });

  it("rejects a missing type", () => {
    expect(checkUserFieldType(undefined)?.code).toBe(
      "USER_FIELD_TYPE_REQUIRED"
    );
  });

  it("describes a non-string type without stringifying caller data", () => {
    const rejection = checkUserFieldType({ nested: "object" });
    expect(rejection?.code).toBe("USER_FIELD_TYPE_NOT_ALLOWED");
    expect(rejection?.message).toContain("object");
    expect(rejection?.message).not.toContain("nested");
  });
});
