/**
 * Plugin field types' declared settings: the boot check that every one can be
 * drawn and stored.
 *
 * A setting is drawn in the Schema Builder's settings panel and its value kept
 * at `pluginOptions[key]` on each field of the type. A malformed declaration
 * would otherwise surface only there, as a control that cannot be used (a
 * select with nothing to choose) or as two controls writing one value (a key
 * used twice), and nothing would tell the plugin's author. Registration is the
 * last moment the mistake is still the author's to see, so the check is here
 * and refuses boot, naming the plugin, the type and the setting.
 *
 * @module plugins/validate-field-type-settings
 */
import { z } from "zod";

import { NextlyError } from "../errors/nextly-error";

import type { PluginFieldTypeSetting } from "./contributions";
import type { PluginDefinition } from "./plugin-context";
import { RESERVED_PLUGIN_OPTION_KEYS } from "./plugin-options";

/** A key the panel and the stored options can both carry unchanged. */
const KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

const base = {
  key: z
    .string()
    .regex(KEY, "a key of letters, digits and _, starting with a letter"),
  label: z.string().trim().min(1, "a label"),
  help: z.string().optional(),
  tab: z.enum(["general", "validation", "display", "advanced"]).optional(),
};

/**
 * One setting as declared. Typed against `PluginFieldTypeSetting`, so the
 * published type and what boot accepts cannot drift apart unnoticed.
 */
const settingSchema: z.ZodType<PluginFieldTypeSetting> = z.discriminatedUnion(
  "control",
  [
    z
      .object({ ...base, control: z.enum(["text", "number", "boolean"]) })
      .strict(),
    z
      .object({
        ...base,
        control: z.literal("select"),
        options: z
          .array(
            z
              .object({
                label: z.string().trim().min(1, "a label"),
                value: z.string().min(1, "a value"),
              })
              .strict()
          )
          .min(1, "at least one option"),
      })
      .strict(),
  ]
);

function settingError(
  pluginName: string,
  fieldType: string,
  reason: string,
  context: Record<string, unknown>
): NextlyError {
  return new NextlyError({
    code: "CONFIGURATION_ERROR",
    publicMessage: "Plugin configuration is invalid.",
    logMessage: `Plugin "${pluginName}" contributes a field type "${fieldType}" with a setting that ${reason}.`,
    logContext: { plugin: pluginName, fieldType, ...context },
  });
}

/** The first thing wrong with one type's settings, or `null` when none is. */
function problemOf(
  settings: unknown
): { reason: string; context: Record<string, unknown> } | null {
  if (!Array.isArray(settings)) {
    return { reason: "is not in a list", context: {} };
  }
  const seen = new Set<string>();
  for (const [index, declared] of settings.entries()) {
    const parsed = settingSchema.safeParse(declared);
    const key = (declared as { key?: unknown } | null)?.key;
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        reason: `needs ${issue?.message ?? "a valid shape"} at ${[index, ...(issue?.path ?? [])].join(".")}`,
        context: { index, key },
      };
    }
    const setting = parsed.data;
    // The keys core keeps for the field itself inside `pluginOptions`, the set
    // the manifest and option folding enforce, so a setting stored under one
    // would be shadowed or refused at save.
    if (RESERVED_PLUGIN_OPTION_KEYS.has(setting.key)) {
      return {
        reason: `uses the reserved key "${setting.key}", which the field keeps for itself`,
        context: { index, key: setting.key },
      };
    }
    if (seen.has(setting.key)) {
      return {
        reason: `uses the key "${setting.key}" a second time, so two settings would write one value`,
        context: { index, key: setting.key },
      };
    }
    seen.add(setting.key);
    if (setting.control === "select") {
      const values = setting.options.map(option => option.value);
      const repeated = values.find((value, at) => values.indexOf(value) !== at);
      if (repeated !== undefined) {
        return {
          reason: `"${setting.key}" offers the value "${repeated}" twice`,
          context: { index, key: setting.key, value: repeated },
        };
      }
    }
  }
  return null;
}

/**
 * Refuse boot when any plugin field type declares settings that cannot be
 * drawn or stored. Run with the field types' registration, for every plugin
 * whose types are registered, disabled ones included: their fields still open
 * in the Builder.
 */
export function assertFieldTypeSettings(plugins: PluginDefinition[]): void {
  for (const plugin of plugins) {
    for (const fieldType of plugin.contributes?.fieldTypes ?? []) {
      if (fieldType.settings === undefined) continue;
      const problem = problemOf(fieldType.settings);
      if (problem) {
        throw settingError(
          plugin.name,
          fieldType.type,
          problem.reason,
          problem.context
        );
      }
    }
  }
}
