/**
 * A plugin's switch for the fields its `extend` added: on some types, at this
 * moment, it can switch them off without changing any schema or stored value.
 *
 * A plugin that adds a field to every content type may let a person turn it
 * off for one type from the admin, where a configuration change and a
 * migration are no answer. The column and every saved value stay; the admin
 * stops drawing the field on that type's pages, and stops offering the
 * plugin's contributions there that carry `extendedWith`, until the switch is
 * on again. What the field means while it is off is the plugin's to decide.
 *
 * The plugin answers through a service of its own named
 * {@link EXTENSION_SWITCH_SERVICE}, built with its context like any other, so
 * it reads its own settings, cached as it caches them, on each admin request.
 *
 * @module plugins/extension-switch
 * @experimental
 */
import {
  isRequired,
  numberRule,
  type ValidatableField,
} from "../shared/lib/entry-validation";

import { typesExtendedBy, type ExtendedType } from "./extended-types";
import type { PluginDefinition } from "./plugin-context";
import { buildPluginServicesNamespace } from "./services/plugin-services-registry";

/**
 * @experimental The name of the service a plugin contributes
 * (`contributes.services`) to switch its extension fields off on some types.
 */
export const EXTENSION_SWITCH_SERVICE = "extensionSwitch";

/** @experimental What a plugin's extension switch answers. */
export interface ExtensionSwitch {
  /**
   * The types where `field`, which this plugin's `extend` added, is switched
   * off now. A type the field was never added to is ignored.
   */
  switchedOff(
    field: string
  ): readonly ExtendedType[] | Promise<readonly ExtendedType[]>;
}

/** Each plugin's switched-off fields: plugin to field to `kind:slug` keys. */
export type SwitchedOffExtensions = ReadonlyMap<
  string,
  ReadonlyMap<string, ReadonlySet<string>>
>;

const keyOf = (type: ExtendedType): string => `${type.kind}:${type.slug}`;

function isSwitch(value: unknown): value is ExtensionSwitch {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { switchedOff?: unknown }).switchedOff === "function"
  );
}

/** One plugin's switch, or nothing where it contributes none. */
function switchOf(plugin: string): ExtensionSwitch | undefined {
  const service: unknown =
    buildPluginServicesNamespace()[plugin]?.[EXTENSION_SWITCH_SERVICE];
  return isSwitch(service) ? service : undefined;
}

/**
 * What each plugin's switch has off now, for the fields each names in
 * `fields`. A plugin with no switch, or one whose switch fails, has nothing
 * off: a switch that cannot be read leaves the plugin's fields where they
 * are, and the failure is reported, rather than hiding fields on a guess.
 */
export async function switchedOffExtensions(
  plugins: readonly PluginDefinition[],
  fields: Readonly<Record<string, readonly string[]>>,
  logger?: { warn?: (message: string) => void }
): Promise<SwitchedOffExtensions> {
  const off = new Map<string, ReadonlyMap<string, ReadonlySet<string>>>();
  await Promise.all(
    plugins.map(async ({ name }) => {
      const named = fields[name] ?? [];
      if (named.length === 0) return;
      try {
        // Built on first use, so a switch that cannot be built is a failed
        // switch too.
        const toggle = switchOf(name);
        if (toggle === undefined) return;
        const byField = new Map<string, ReadonlySet<string>>();
        for (const field of named) {
          byField.set(
            field,
            new Set((await toggle.switchedOff(field)).map(keyOf))
          );
        }
        off.set(name, byField);
      } catch (error) {
        logger?.warn?.(
          `[plugins] "${name}" could not say which of its fields are switched off, so none is: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    })
  );
  return off;
}

/**
 * Whether `field` demands a value, or holds a field that does at any depth
 * (a group's or repeater's own fields): required, or a list with a positive
 * `minRows` or `minChips`, in either spelling the entry validator reads. A
 * page that drew it nowhere could not then be saved.
 */
function holdsRequired(field: unknown): boolean {
  if (typeof field !== "object" || field === null) return false;
  const validatable = field as ValidatableField;
  // Required, or a list that must hold at least one row or chip: either way
  // an empty value the page could not fill is refused.
  if (isRequired(validatable)) return true;
  for (const bound of ["minRows", "minChips"]) {
    if ((numberRule(validatable, bound) ?? 0) > 0) return true;
  }
  const { fields } = field as { fields?: unknown };
  return Array.isArray(fields) && fields.some(holdsRequired);
}

/**
 * Every field each plugin's `extend` adds, by plugin, or with
 * `"switchable"` only those its switch may turn off: never a required one,
 * since a page that drew it nowhere could not be saved, so a required field
 * is always shown.
 */
export function extensionFieldsOf(
  plugins: readonly PluginDefinition[],
  which: "all" | "switchable" = "all"
): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const plugin of plugins) {
    const declared = (plugin.contributes?.extend ?? []).flatMap(clause =>
      clause.fields.flatMap(field => {
        const { name } = field as { name?: unknown };
        return typeof name === "string" ? [{ name, field }] : [];
      })
    );
    // A name kept wherever any of its declarations holds a required field:
    // which target a declaration reached is not asked here.
    const kept = new Set(
      which === "all"
        ? []
        : declared.filter(({ field }) => holdsRequired(field)).map(d => d.name)
    );
    const names = declared
      .map(({ name }) => name)
      .filter(name => !kept.has(name));
    if (names.length > 0) fields[plugin.name] = [...new Set(names)];
  }
  return fields;
}

/**
 * @experimental The fields the admin draws nowhere on each type's pages, by
 * `kind:slug`: those a plugin added there and has switched off.
 */
export function withheldFieldsOf(
  off: SwitchedOffExtensions
): Record<string, string[]> {
  const withheld: Record<string, string[]> = {};
  for (const [plugin, byField] of off) {
    for (const [field, keys] of byField) {
      for (const type of typesExtendedBy(plugin, field)) {
        const key = keyOf(type);
        if (!keys.has(key)) continue;
        withheld[key] = [...(withheld[key] ?? []), field];
      }
    }
  }
  return withheld;
}
