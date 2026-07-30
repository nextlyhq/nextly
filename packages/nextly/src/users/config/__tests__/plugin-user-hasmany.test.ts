import { afterEach, expect, it } from "vitest";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import { validateUserConfig } from "../validate-user-config";
afterEach(() => clearFieldTypes());
it("refuses hasMany on a users-surface plugin field", () => {
  registerFieldType({
    type: "score",
    storage: "number",
    component: "c",
    surfaces: ["users"],
  });
  const r = validateUserConfig({
    fields: [{ name: "s", type: "score", hasMany: true }],
  } as never);
  expect(r.errors.some(e => e.code === "USER_FIELD_HAS_MANY_UNSUPPORTED")).toBe(
    true
  );
});
