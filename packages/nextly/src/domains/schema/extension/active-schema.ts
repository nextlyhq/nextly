/**
 * The process-level active extension schema, and nothing else.
 *
 * Split out of `build-extension-schema` so a consumer can READ the active
 * schema without importing the compiler. `compile.ts` needs
 * `buildUserDrizzleColumn` from the runtime schema generator, so a generator
 * that reached back for the active schema through the builder would close the
 * loop: builder → compile → generator → builder. This module imports nothing
 * at runtime, which is what keeps that edge one-way.
 *
 * The type comes back from the builder as a TYPE import only — erased, so it
 * adds no runtime edge — rather than moving the interface, which would churn
 * every consumer for no gain.
 *
 * @module domains/schema/extension/active-schema
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";

import type { ExtensionSchema } from "./build-extension-schema";

/**
 * Set at boot and on HMR reload, read by every consumer.
 *
 * A module-level value rather than a DI registration because the CLI never
 * boots a container and still has to reach the same answer; two paths to one
 * fact is what the extension module exists to avoid.
 */
const active = new Map<SupportedDialect, ExtensionSchema>();

export function setActiveExtensionSchema(
  dialect: SupportedDialect,
  schema: ExtensionSchema
): void {
  active.set(dialect, schema);
}

export function getActiveExtensionSchema(
  dialect: SupportedDialect
): ExtensionSchema | null {
  return active.get(dialect) ?? null;
}

/** Forget the active schema. For tests and for a reload that failed. */
export function clearActiveExtensionSchema(): void {
  active.clear();
}

/**
 * The active schema without naming a dialect.
 *
 * One process serves one database, so at most one of the three is ever set;
 * asking for all three is how a caller that has no dialect in hand — a
 * response boundary, a row mapper — reaches the same answer the pipeline
 * reaches. The same trick the plugin context already uses.
 */
export function activeExtensionSchema(): ExtensionSchema | null {
  return (
    getActiveExtensionSchema("postgresql") ??
    getActiveExtensionSchema("mysql") ??
    getActiveExtensionSchema("sqlite")
  );
}

/**
 * The columns contributed to `tableName` that must never reach an entry.
 *
 * A contributed column is on the table and in the runtime Drizzle object, so
 * `select()` returns it like any other — which is the whole reason `hidden`
 * exists. Asked per TABLE rather than answered from one global set, because a
 * contributed name is not namespaced: stripping every hidden name from every
 * entry would remove a legitimate field that happened to share one.
 */
export function hiddenColumnNames(tableName: string): readonly string[] {
  const columns = activeExtensionSchema()?.entityColumns.get(tableName);
  if (columns === undefined) return [];
  return columns.filter(c => c.hidden === true).map(c => c.name);
}
