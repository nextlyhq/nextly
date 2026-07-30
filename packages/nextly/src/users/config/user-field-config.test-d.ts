/**
 * A plugin may opt a field type into the `users` surface, and runtime
 * validation accepts one. The authoring type has to admit it too, or a
 * code-defined config fails the consuming app's type check unless it is cast.
 *
 * Named `.test-d.ts` deliberately: `**\/*.test.ts` is excluded from the
 * type-check, so a claim about types written there is never verified.
 */
import type { UserFieldConfig } from "./types";

const builtIn: UserFieldConfig = { name: "company", type: "text" };

const pluginContributed: UserFieldConfig = {
  name: "score",
  type: "star-rating",
  // Required by the plugin arm: it is what tells this apart from a built-in
  // declaration, so a malformed `{ type: "select" }` still fails its own shape.
  pluginOptions: { ratingScale: { max: 5 } },
};

export const userFieldConfigAdmitsPluginTypes: UserFieldConfig[] = [
  builtIn,
  pluginContributed,
];
