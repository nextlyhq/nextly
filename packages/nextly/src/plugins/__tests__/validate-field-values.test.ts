/**
 * The entry point a plugin validates its own stored content through.
 *
 * A plugin holding structured content — block props, form submissions — has
 * declarations and values that must satisfy them. Reimplementing the rules
 * would mean a second copy of `required`, of the per-type checks, and of every
 * plugin field type's own `validate`, drifting from the one writes use.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../domains/schema/field-types/field-type-registry";
import { validateFieldValues } from "../validate-field-values";

afterEach(() => {
  clearFieldTypes();
});

describe("validateFieldValues", () => {
  it("reports every violation rather than the first", async () => {
    const issues = await validateFieldValues({ a: "", b: "" }, [
      { name: "a", type: "text", required: true },
      { name: "b", type: "text", required: true },
    ]);

    expect(issues).toHaveLength(2);
  });

  it("enforces required on an omitted field by default", async () => {
    const issues = await validateFieldValues({}, [
      { name: "title", type: "text", required: true },
    ]);

    expect(issues).toHaveLength(1);
  });

  it("leaves an omitted field alone in update mode", async () => {
    const issues = await validateFieldValues(
      {},
      [{ name: "title", type: "text", required: true }],
      { mode: "update" }
    );

    expect(issues).toEqual([]);
  });

  it("applies the storage primitive's rules to a plugin field type", async () => {
    registerFieldType({
      type: "star-rating",
      storage: "number",
      component: "@acme/ratings/admin#StarRating",
    });

    const issues = await validateFieldValues({ score: "not a number" }, [
      { name: "score", type: "star-rating" },
    ]);

    expect(issues).toHaveLength(1);
  });

  it("runs a plugin field type's own validate", async () => {
    registerFieldType({
      type: "star-rating",
      storage: "number",
      component: "@acme/ratings/admin#StarRating",
      validate: value =>
        typeof value === "number" && value <= 5 ? true : "score must be 0-5",
    });

    const issues = await validateFieldValues({ score: 9 }, [
      { name: "score", type: "star-rating" },
    ]);

    expect(issues[0]?.message).toContain("0-5");
  });

  it("reports where a value nested in a container actually sits", async () => {
    const issues = await validateFieldValues({ rows: [{ title: "" }] }, [
      {
        name: "rows",
        type: "repeater",
        fields: [{ name: "title", type: "text", required: true }],
      },
    ] as Parameters<typeof validateFieldValues>[1]);

    expect(issues[0]?.path).toBe("rows[0].title");
  });
});
