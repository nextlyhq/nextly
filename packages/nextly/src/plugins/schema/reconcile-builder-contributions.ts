/**
 * Boot-time reconciliation of plugin `extend` contributions onto UI-Builder
 * entities (P8 / plugin-access-to-ui-builder-entities).
 *
 * The config fold defers any `extend` whose target isn't a code/plugin entity
 * (a candidate Builder collection/single/component). Under `migrate` those are
 * materialized by {@link resolveBuilderExtends}; this module is the runtime
 * (dev-push) analog: given the deferred clauses + the loaded Builder entities,
 * it produces the reconciled entities (active plugins' fields merged in, tagged
 * with provenance; stale plugin fields stripped) plus the list of targets that
 * resolve to neither code/plugin nor the Builder set.
 *
 * @module plugins/schema/reconcile-builder-contributions
 */

import type { FieldConfig } from "../../collections/fields/types";

/**
 * Stamp plugin provenance on contributed fields (non-mutating). The tag drives
 * (a) the Builder lock/label (`source === "plugin"`) and (b) reconcile, which
 * keys stale-field removal off `source === "plugin"`.
 */
export function tagPluginFields(
  fields: FieldConfig[],
  owner: string
): FieldConfig[] {
  // `source`/`owner`/`locked` are provenance metadata that ride along on the
  // field object (read at the registry/admin layers via FieldDefinition, which
  // models them). FieldConfig is a discriminated union that doesn't declare
  // them, so cast through `unknown`.
  return fields.map(
    f =>
      ({
        ...f,
        source: "plugin",
        owner,
        locked: true,
      }) as unknown as FieldConfig
  );
}
