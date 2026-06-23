import { afterEach, describe, expect, it } from "vitest";

import {
  allFieldTypes,
  clearFieldTypes,
  getFieldType,
  hasFieldType,
  registerFieldType,
} from "./field-type-registry";

afterEach(() => clearFieldTypes());

describe("field-type registry (C7)", () => {
  it("registers and resolves a custom type", () => {
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "@p/admin#Rating",
    });
    expect(hasFieldType("rating")).toBe(true);
    expect(getFieldType("rating")?.storage).toBe("number");
    expect(allFieldTypes().map(d => d.type)).toEqual(["rating"]);
  });

  it("throws on a duplicate plugin type", () => {
    registerFieldType({ type: "rating", storage: "number", component: "c" });
    expect(() =>
      registerFieldType({ type: "rating", storage: "text", component: "c2" })
    ).toThrow(/rating/);
  });

  it("throws when colliding with a built-in type", () => {
    expect(() =>
      registerFieldType({ type: "text", storage: "text", component: "c" })
    ).toThrow(/text/);
  });

  it("clear empties the registry", () => {
    registerFieldType({ type: "rating", storage: "number", component: "c" });
    clearFieldTypes();
    expect(hasFieldType("rating")).toBe(false);
    expect(allFieldTypes()).toEqual([]);
  });
});
