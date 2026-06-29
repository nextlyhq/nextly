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

import {
  applyExtendClauses,
  type BuilderEntities,
  type DeferredExtend,
  type SchemaEntityLike,
} from "./apply-contributions";

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

/** Clone the entities with every `source:"plugin"` field removed (per entity). */
function stripPluginFields(e: BuilderEntities): Required<BuilderEntities> {
  const strip = (arr?: SchemaEntityLike[]): SchemaEntityLike[] =>
    (arr ?? []).map(x => ({
      ...x,
      fields: (x.fields ?? []).filter(
        f => (f as { source?: string }).source !== "plugin"
      ),
    }));
  return {
    collections: strip(e.collections),
    singles: strip(e.singles),
    components: strip(e.components),
  };
}

export interface ReconcileResult {
  /** Builder entities with active plugins' fields merged (tagged), stale plugin fields stripped. */
  entities: Required<BuilderEntities>;
  /** Targets that are neither code/plugin nor a Builder entity (real typos). */
  unresolved: { target: string; owner: string }[];
}

/**
 * Reconcile deferred plugin `extend` clauses against the loaded Builder
 * entities (runtime / dev-push parity with `migrate`):
 *
 * 1. Strip every previously-persisted `source:"plugin"` field — so a removed or
 *    renamed plugin's columns disappear from the registry (the physical column
 *    is left orphaned by the add-only materializer).
 * 2. Re-merge the active plugins' clauses (tagged `source:"plugin"`/owner/
 *    locked) onto the stripped set. Add-only `tryExtend` + the strip make this
 *    idempotent: re-running yields exactly one copy of each field.
 * 3. Collect any target absent from the Builder set as `unresolved` (the boot
 *    seam decides warn-and-skip vs. strict-throw).
 *
 * Pure given its inputs (clones touched arrays); unit-tested with stub entities.
 */
export function reconcileBuilderContributions(
  deferred: DeferredExtend[],
  builder: BuilderEntities
): ReconcileResult {
  const stripped = stripPluginFields(builder);
  const tagged = deferred.map(d => ({
    ...d,
    fields: tagPluginFields(d.fields, d.owner),
  }));
  const r = applyExtendClauses(
    stripped.collections,
    stripped.singles,
    stripped.components,
    tagged,
    "collect"
  );
  return {
    entities: {
      collections: r.collections,
      singles: r.singles,
      components: r.components,
    },
    unresolved: r.deferred.map(d => ({ target: d.target, owner: d.owner })),
  };
}
