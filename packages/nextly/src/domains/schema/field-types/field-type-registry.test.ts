import { afterEach, describe, expect, it } from "vitest";

import {
  allFieldTypes,
  clearFieldTypes,
  getFieldType,
  hasFieldType,
  isPluginFieldTypeOnSurface,
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

describe("isPluginFieldTypeOnSurface", () => {
  it("is false for a built-in type and an unregistered type", () => {
    expect(isPluginFieldTypeOnSurface("text", "entries")).toBe(false);
    expect(isPluginFieldTypeOnSurface("nope", "entries")).toBe(false);
  });

  it("honors a type's declared surfaces", () => {
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "c",
      surfaces: ["users", "forms"],
    });
    expect(isPluginFieldTypeOnSurface("rating", "users")).toBe(true);
    expect(isPluginFieldTypeOnSurface("rating", "forms")).toBe(true);
    expect(isPluginFieldTypeOnSurface("rating", "entries")).toBe(false);
  });

  it("defaults an omitted surfaces list to the entries surface only", () => {
    registerFieldType({ type: "rating", storage: "number", component: "c" });
    expect(isPluginFieldTypeOnSurface("rating", "entries")).toBe(true);
    expect(isPluginFieldTypeOnSurface("rating", "users")).toBe(false);
    expect(isPluginFieldTypeOnSurface("rating", "forms")).toBe(false);
  });
});
