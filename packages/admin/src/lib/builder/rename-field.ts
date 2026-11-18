/**
 * Whether a saved field can be renamed in the Builder.
 *
 * A saved field's name is its identity: its column and its API key. Rename… changes it as a
 * rename, which the save answers as one, so the field's values are kept. That needs a column of the
 * field's own on the entity's table, which the save can rename. A field inside a named group or a
 * repeater has none: it is a key inside the container's value, and the save cannot tell a renamed
 * key from one removed beside one added, so its values would stay under the old key. A field using
 * a field group keeps its values in that group's own table, under its name. A field a stored hook
 * names in its settings (an auto-slug's source, say) is read by that hook under its name, which a
 * rename would leave reading a key no entry has. None of these offers Rename….
 *
 * @module lib/builder/rename-field
 */
import { isFieldGroupFieldType } from "nextly/field-group-type";

import { getPrebuiltHook } from "@admin/components/features/schema-builder/HooksEditor/utils/prebuiltHooks";
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import type { StoredHookConfig } from "@admin/types/collection";

import { namingLevel } from "./move-rule";

/** What the panel says beside a saved field's name that Rename… can change. */
export const RENAME_HOW =
  "A saved field's name changes through Rename…, which keeps its values.";

/** Field names stored hooks name, each with the hook that names it: none. */
const NO_HOOK_NAMES: ReadonlyMap<string, string> = new Map();

/**
 * The field names a collection's stored hooks name in their settings, each with the name of the
 * first hook naming it. Every text setting is read as a possible field name: a hook's settings
 * that name fields (an auto-slug's source and target, an audit hook's user fields, a uniqueness
 * check's field) are text, and a text setting that names no field matches none.
 */
export function fieldsNamedByHooks(
  hooks: readonly StoredHookConfig[] | undefined
): ReadonlyMap<string, string> {
  const named = new Map<string, string>();
  for (const hook of hooks ?? []) {
    const hookName = getPrebuiltHook(hook.hookId)?.name ?? hook.hookId;
    for (const value of Object.values(hook.config ?? {})) {
      if (typeof value === "string" && value !== "" && !named.has(value)) {
        named.set(value, hookName);
      }
    }
  }
  return named;
}

/**
 * Why `field`, saved where it sits under `ancestors` (outermost first), cannot be renamed, or
 * `null` when Rename… can rename it. `namedByHooks` holds the names stored hooks name
 * (`fieldsNamedByHooks`).
 */
export function renameUnavailableReason(
  field: BuilderField,
  ancestors: readonly BuilderField[],
  namedByHooks: ReadonlyMap<string, string> = NO_HOOK_NAMES
): string | null {
  const level = namingLevel(ancestors);
  if (level) {
    return `This field is inside ${level.label || level.name}, whose value keeps it by its name, so it cannot be renamed.`;
  }
  if (isFieldGroupFieldType(field.type)) {
    return "This field keeps its values in its field group's own table, under its name, so it cannot be renamed.";
  }
  const hook = namedByHooks.get(field.name ?? "");
  if (hook !== undefined) {
    return `The ${hook} hook names this field in its settings, so it cannot be renamed.`;
  }
  return null;
}

/**
 * Whether Rename… is offered for `field`, under `ancestors`: a saved field, not read-only and not
 * built in, that has a column of its own. The settings panel and the outline's row menu both ask
 * this, so a row never offers a rename its settings will not make.
 */
export function renameOffered(
  field: BuilderField,
  ancestors: readonly BuilderField[],
  saved: boolean,
  readOnly: boolean,
  namedByHooks: ReadonlyMap<string, string> = NO_HOOK_NAMES
): boolean {
  return (
    saved &&
    !readOnly &&
    field.isSystem !== true &&
    renameUnavailableReason(field, ancestors, namedByHooks) === null
  );
}
