/**
 * The container's reserved keys, refused where the declaration is written.
 *
 * A field type is handed its options folded onto an instance that also states
 * which field it is, so an option named `type` or `name` is shadowed and never
 * reaches the callback that asked for it. Type generation refuses them, but a
 * config carrying one boots and syncs first and only fails at `nextly build`.
 */
import { afterEach, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import { pluginUserField } from "../types";
import { validateUserConfig } from "../validate-user-config";

afterEach(() => clearFieldTypes());

it("refuses a reserved key in a plugin user field's options", () => {
  registerFieldType({
    type: "score",
    storage: "number",
    component: "c",
    surfaces: ["users"],
  });

  const result = validateUserConfig({
    fields: [
      pluginUserField({
        name: "s",
        type: "score",
        pluginOptions: { type: "variant" },
      }),
    ],
  });

  expect(result.valid).toBe(false);
  expect(result.errors).toContainEqual({
    path: "fields[0].pluginOptions.type",
    code: "USER_FIELD_PLUGIN_OPTION_RESERVED",
    message:
      "'type' cannot be used as a plugin option: it states which field the type is looking at",
  });
});

it("refuses a reserved key on a built-in field's options", () => {
  // Generation reads the container off every user field whatever its type, so
  // gating this on a plugin type would leave the same declaration passing
  // validation and failing the build.
  const result = validateUserConfig({
    fields: [{ name: "company", type: "text", pluginOptions: { name: "x" } }],
  });

  expect(
    result.errors.some(e => e.code === "USER_FIELD_PLUGIN_OPTION_RESERVED")
  ).toBe(true);
});

it("accepts an option the container may legally carry", () => {
  registerFieldType({
    type: "score",
    storage: "number",
    component: "c",
    surfaces: ["users"],
  });

  const result = validateUserConfig({
    fields: [
      pluginUserField({
        name: "s",
        type: "score",
        pluginOptions: { scale: 5, options: ["a"] },
      }),
    ],
  });

  expect(result.valid).toBe(true);
});
