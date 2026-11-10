/**
 * Registers one code-first collection's or single's runtime Drizzle tables in
 * the schema registry at boot: the main table, and for a localized entity its
 * `_locales` companion.
 *
 * Collections and singles share this so they cannot register different
 * shapes for the same storage. A localized entity's translatable fields live
 * only on the companion, which is what the migrations create, so the main
 * table must leave them out. Registered with them, every read selects
 * columns the main table does not have and fails with "no such column".
 *
 * @module di/register-runtime-tables
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { SchemaRegistry } from "../database/schema-registry";
import {
  publishesPerLanguage,
  storesPerLanguage,
} from "../domains/i18n/per-language-storage";
import { buildCompanionRuntimeTable } from "../domains/i18n/runtime/companion-registration";
import { generateRuntimeSchema } from "../domains/schema/services/runtime-schema-generator";
import type { FieldDefinition } from "../schemas/dynamic-collections";

/** What the registration needs to know about one entity, read from its config. */
export interface RuntimeTableEntity {
  slug: string;
  tableName: string;
  fields: FieldDefinition[];
  /** The Draft/Published lifecycle: the system status column, and `_status` on the companion. */
  status: boolean;
  /** The entity's own localization switch. */
  localized: boolean;
}

/** Register `entity`'s main table and, when it is localized, its companion. */
export function registerEntityRuntimeTables(
  registry: Pick<SchemaRegistry, "registerDynamicSchema">,
  entity: RuntimeTableEntity,
  dialect: SupportedDialect
): void {
  // Where its translatable columns live: its companion for a translatable entity, or for every
  // entity on a site that keeps every translatable field per language.
  const perLanguage = storesPerLanguage(entity);
  const { table } = generateRuntimeSchema(
    entity.tableName,
    entity.fields,
    dialect,
    { status: entity.status, localized: perLanguage }
  );
  registry.registerDynamicSchema(entity.tableName, table);
  if (!perLanguage) return;
  const companion = buildCompanionRuntimeTable({
    slug: entity.slug,
    tableName: entity.tableName,
    fields: entity.fields,
    dialect,
    localized: true,
    // Carried so a Draft/Published entity's companion has `_status`, as the
    // companion the migrations create does.
    // A per-language `_status` only where the entity publishes each language on its own.
    status: publishesPerLanguage(entity),
  });
  if (companion) {
    registry.registerDynamicSchema(
      companion.companionTableName,
      companion.table
    );
  }
}
