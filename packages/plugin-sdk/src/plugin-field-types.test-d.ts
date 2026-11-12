import { defineFieldGroup } from "nextly";

import { expectTypeOf } from "vitest";

import type {
  PluginContributions,
  PluginFieldType,
  PluginFieldTypeSetting,
  PluginFieldTypeSettingBase,
} from "@nextlyhq/plugin-sdk";
import { pluginField } from "@nextlyhq/plugin-sdk";

// A plugin declares a field of a type it contributes itself. Reached through
// the SDK, which is the only import surface a plugin author is offered.
const scoreField = pluginField({
  name: "score",
  type: "star-rating",
  required: true,
  scale: 5,
});

// The declared shape survives the call. Collapsing it to the marker interface
// would type every option as `unknown` and stop a plugin annotating a reusable
// declaration with its own config type.
const scale: number = scoreField.scale;
const named: string = scoreField.name;

// Every surface that accepts entry fields accepts a contributed one, not just
// `defineCollection` / `defineSingle`. Written inline, `extend` has no `define*`
// call to narrow it, so it has to name the type itself.
const contributions: PluginContributions = {
  extend: [{ target: "posts", fields: [scoreField] }],
};

const group = defineFieldGroup({
  slug: "review",
  fields: [scoreField],
});

// A built-in token is refused: marking one would put it on the open arm, where
// its own required shape is never checked.
// @ts-expect-error `select` is built in; its own factory checks its `options`.
const builtIn = pluginField({ name: "status", type: "select" });

// A field type's declared settings (@experimental): the list the settings
// panel draws, asserted EXACTLY so a control added, a key renamed or the
// options loosened is a deliberate change to this file.
expectTypeOf<PluginFieldType["settings"]>().toEqualTypeOf<
  readonly PluginFieldTypeSetting[] | undefined
>();
expectTypeOf<PluginFieldTypeSettingBase>().toEqualTypeOf<{
  key: string;
  label: string;
  help?: string;
  tab?: "general" | "validation" | "display" | "advanced";
}>();
expectTypeOf<PluginFieldTypeSetting>().toEqualTypeOf<
  | (PluginFieldTypeSettingBase & { control: "text" | "number" | "boolean" })
  | (PluginFieldTypeSettingBase & {
      control: "select";
      options: readonly { label: string; value: string }[];
    })
>();

// Exported so eslint does not flag the assertions as unused.
export const __pluginFieldTypeCheck = {
  scoreField,
  scale,
  named,
  contributions,
  group,
  builtIn,
};
