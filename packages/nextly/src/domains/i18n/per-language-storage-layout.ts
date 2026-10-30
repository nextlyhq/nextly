/**
 * The boot refusal of a database laid out before per-language storage: with
 * `experimental.perLanguageStorage` on, an entity whose main table still holds its translatable
 * columns would be served from two layouts at once, and the schema push that follows would plan to
 * drop those columns. Storage is never mixed, so the boot stops first and names what it found.
 *
 * Only an entity that is not marked translatable can be in that state: a translatable one already
 * keeps its values per language, whatever the setting.
 *
 * @module domains/i18n/per-language-storage-layout
 * @experimental
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";
import { introspectLiveSnapshot } from "../schema/pipeline/diff/introspect-live";

import { deriveCompanionSpec } from "./migration/derive-companion-spec";

/** An entity as the refusal reads it: where it is stored, its fields and its own flag. */
export interface LaidOutEntity {
  kind: "collection" | "single" | "component";
  slug: string;
  tableName: string;
  fields: readonly { name?: string; type: string; localized?: boolean }[];
  localized?: unknown;
}

/** What the refusal needs of the adapter: its dialect and a handle to introspect through. */
interface LayoutAdapter {
  dialect: SupportedDialect;
  getDrizzle(): unknown;
}

/**
 * The translatable columns `entity` would keep on its main table if it were not stored per
 * language: the columns its companion is given, read from the companion's own spec so the two
 * cannot disagree about which fields are translatable.
 */
function translatableColumns(
  entity: LaidOutEntity,
  dialect: SupportedDialect
): string[] {
  const spec = deriveCompanionSpec({
    slug: entity.slug,
    dbName: entity.tableName,
    fields: entity.fields as Parameters<
      typeof deriveCompanionSpec
    >[0]["fields"],
    dialect,
    defaultLocale: "en",
    collectionLocalized: true,
    builtBy: "codeFirst",
  });
  return spec ? spec.columns.map(column => column.name) : [];
}

/**
 * Refuses the boot when any entity not marked translatable still keeps translatable columns on its
 * main table, naming each one and its columns. An entity whose table does not exist yet is laid
 * out per language when it is created, so it is not a refusal.
 */
export async function refuseMixedStorage(
  adapter: LayoutAdapter,
  entities: readonly LaidOutEntity[]
): Promise<void> {
  const candidates = entities
    .filter(entity => entity.localized !== true)
    .map(entity => ({
      entity,
      columns: translatableColumns(entity, adapter.dialect),
    }))
    .filter(({ columns }) => columns.length > 0);
  if (candidates.length === 0) return;

  const snapshot = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.dialect,
    candidates.map(({ entity }) => entity.tableName)
  );
  const found = candidates.flatMap(({ entity, columns }) => {
    const live = snapshot.tables.find(table => table.name === entity.tableName);
    if (!live) return [];
    const present = new Set(live.columns.map(column => column.name));
    const onMain = columns.filter(column => present.has(column));
    return onMain.length > 0 ? [{ entity, onMain }] : [];
  });
  if (found.length === 0) return;

  const named = found
    .map(
      ({ entity, onMain }) =>
        `the ${entity.kind} "${entity.slug}" (${onMain.join(", ")})`
    )
    .join("; ");
  throw new NextlyError({
    code: "NEXTLY_PER_LANGUAGE_STORAGE_MIXED",
    publicMessage:
      `experimental.perLanguageStorage is on, but this database still keeps translatable values ` +
      `on the main tables of ${named}. A site never serves both layouts: turn the setting off ` +
      `until those values are stored per language.`,
    logContext: {
      entities: found.map(({ entity, onMain }) => ({
        kind: entity.kind,
        slug: entity.slug,
        columns: onMain,
      })),
    },
  });
}
