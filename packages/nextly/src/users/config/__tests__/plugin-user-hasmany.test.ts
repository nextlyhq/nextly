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

it("refuses hasMany on a config-declared plugin type before registration", () => {
  // `checkUserFieldType` accepts a type the config declares even though its
  // plugin has not registered yet — that is what the second argument carries.
  // A guard reading only the live registry let this route through to fail
  // while binding the scalar column.
  const r = validateUserConfig(
    { fields: [{ name: "s", type: "score", hasMany: true }] } as never,
    new Set(["score"])
  );

  expect(r.errors.some(e => e.code === "USER_FIELD_HAS_MANY_UNSUPPORTED")).toBe(
    true
  );
});
