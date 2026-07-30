/**
 * A plugin may opt a field type into the `users` surface, and runtime
 * validation accepts one. The authoring type has to admit it too, or a
 * code-defined config fails the consuming app's type check unless it is cast.
 *
 * Named `.test-d.ts` deliberately: `**\/*.test.ts` is excluded from the
 * type-check, so a claim about types written there is never verified.
 */
import type { UserFieldConfig } from "./types";
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
