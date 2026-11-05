/**
 * A plugin may opt a field type into the `users` surface, and runtime
 * validation accepts one. The authoring type has to admit it too, or a
 * code-defined config fails the consuming app's type check unless it is cast.
 *
 * Named `.test-d.ts` deliberately: `**\/*.test.ts` is excluded from the
 * type-check, so a claim about types written there is never verified.
 */
import { describe, expectTypeOf, it } from "vitest";

import type {
  UserFieldConfig,
  UserPhoneFieldConfig,
  UserUrlFieldConfig,
} from "./types";
import { pluginUserField } from "./types";

const builtIn: UserFieldConfig = { name: "company", type: "text" };

// A type that takes options, stored in the container.
const withOptions: UserFieldConfig = pluginUserField({
  name: "score",
  type: "star-rating",
  pluginOptions: { ratingScale: { max: 5 } },
});

// A type that takes none. Nothing synthetic has to be invented to satisfy the
// authoring type, which is what the runtime accepts too.
const optionless: UserFieldConfig = pluginUserField({
  name: "badge",
  type: "badge",
});

// Options written straight onto the field, which the contract permits when the
// names collide with nothing the built-in shape declares.
const flatOptions: UserFieldConfig = pluginUserField({
  name: "rating",
  type: "star-rating",
  ratingScale: { max: 5 },
});

export const userFieldConfigAdmitsPluginTypes: UserFieldConfig[] = [
  builtIn,
  withOptions,
  optionless,
  flatOptions,
];

// A url or phone field marked `admin.hidden`, which the Direct API leaves out
// of a read passing `showHiddenFields: false` as it does a canonical field's.
// Each written as its own configuration and as an arm of the union an app
// declares its user fields with, so the flag type-checks wherever it is set.
const hiddenUrl: UserUrlFieldConfig = {
  name: "profileUrl",
  type: "url",
  admin: { hidden: true },
};
const hiddenPhone: UserPhoneFieldConfig = {
  name: "mobile",
  type: "phone",
  admin: { hidden: true, description: "Kept for account recovery" },
};

export const userSurfaceFieldsAcceptHidden: UserFieldConfig[] = [
  hiddenUrl,
  hiddenPhone,
  { name: "website", type: "url", admin: { hidden: true } },
  { name: "landline", type: "phone", admin: { hidden: false } },
];

describe("pluginUserField", () => {
  it("refuses a built-in token", () => {
    // A built-in on the open arm would satisfy `UserFieldConfig` without the
    // shape that token requires — `select` without its `options`. The helper is
    // the only way onto that arm, so the refusal has to live there.
    type SelectArg = Parameters<
      typeof pluginUserField<{ name: "choice"; type: "select" }>
    >[0];

    expectTypeOf<{
      name: "choice";
      type: "select";
    }>().not.toExtend<SelectArg>();
  });

  it("still accepts a plugin token", () => {
    type PluginArg = Parameters<
      typeof pluginUserField<{ name: "score"; type: "star-rating" }>
    >[0];

    expectTypeOf<{
      name: "score";
      type: "star-rating";
    }>().toExtend<PluginArg>();
  });
});
