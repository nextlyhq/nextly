/**
 * The translated date columns an earlier release made with a time zone on PostgreSQL
 * (`zonedDateColumns`), in the translations table of every translated entity the registry holds:
 * collections, Singles and field groups, made in the Schema Builder or declared in config alike.
 *
 * `nextly i18n:convert-zoned-dates` converts them, once the release serves every instance: an instance of an earlier
 * release still running writes a date in a non-default language as its own local time, which a
 * converted column keeps as given. The development sync and `next dev`'s reload, where no earlier
 * instance runs, convert them too, each once its own translations pass refused nothing. `nextly
 * migrate` and a production start change no column's type; they name each such column once, and
 * that command.
 *
 * Each column is found from its field's definition, never from its type alone, so a column given a
 * time zone by hand that no translated date field describes is left as it is.
 *
 * @module domains/i18n/runtime/zoned-date-companions
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../../shared/types";
import {
  builtByFor,
  isCodeOwned,
} from "../../schema/pipeline/registered-collections";
import type { RegisteredCollectionRow } from "../../schema/pipeline/registered-collections";
import { quoteIdent } from "../../schema/pipeline/sql-templates/identifier-quoting";
import { isFieldLocalized } from "../classify-fields";
import { zonedDateColumns } from "../migration/companion-column-holds";
import type { CompanionFieldLike } from "../migration/reconcile-companion";

/** A registry reader that reports nothing of its own: this pass names what it finds itself. */
const QUIET: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** One translated entity's table and the fields that decide its translations columns. */
interface TranslatedEntity {
  tableName: string;
  fields: readonly CompanionFieldLike[];
  builtBy: ReturnType<typeof builtByFor>;
}

/** Every entity the registry holds, with what decides its translations columns. */
async function translatedEntities(
  adapter: DrizzleAdapter
): Promise<TranslatedEntity[]> {
  const [
    { CollectionRegistryService },
    { SingleRegistryService },
    { FieldGroupRegistryService },
  ] = await Promise.all([
    import("../../collections/services/collection-registry-service"),
    import("../../singles/services/single-registry-service"),
    import("../../field-groups/services/field-group-registry-service"),
  ]);
  const [collections, singles, fieldGroups] = await Promise.all([
    new CollectionRegistryService(adapter, QUIET).getAllCollections(),
    new SingleRegistryService(adapter, QUIET).getAllSingles(),
    new FieldGroupRegistryService(adapter, QUIET).getAllComponents(),
  ]);
  return [
    ...entitiesOf("collection", collections),
    ...entitiesOf("single", singles),
    ...entitiesOf("fieldGroup", fieldGroups),
  ];
}

/** A stored entity as this pass reads it: where its values live, its fields, and its owner. */
type StoredEntity = RegisteredCollectionRow & {
  tableName: string;
  fields?: readonly unknown[] | null;
};

/**
 * `records` of one kind, each with its translatable fields. Every entity is taken, whatever its
 * own `localized` says: under per-language storage one not marked translated keeps its
 * translatable values in a translations table too, and a command that reads no config (`nextly
 * i18n:convert-zoned-dates`) cannot know that setting. The translations table being there is what decides
 * (`findZonedDateColumns`).
 */
function entitiesOf(
  kind: "collection" | "single" | "fieldGroup",
  records: readonly StoredEntity[]
): TranslatedEntity[] {
  return records.map(record => ({
    tableName: record.tableName,
    fields: ((record.fields ?? []) as CompanionFieldLike[]).filter(field =>
      isFieldLocalized(field, true)
    ),
    builtBy: builtByFor(kind, !isCodeOwned(record)),
  }));
}

/** One translated date column an earlier release made with a time zone. */
export interface ZonedDateColumn {
  table: string;
  column: string;
  /** The type the column takes: its field's own, as the main table's. */
  type: string;
}

/**
 * Every translated date column an earlier release made with a time zone, read only.
 *
 * Every translations table is read in one catalog query (`introspectLiveColumns`), after the three
 * registry reads, so the statements this runs stay the same however many entities the registry
 * holds: a production start runs it every time, with a fixed budget of statements and waits. A
 * table not there yet is simply absent from what the query returns.
 */
export async function findZonedDateColumns(
  adapter: DrizzleAdapter
): Promise<ZonedDateColumn[]> {
  if (adapter.getCapabilities().dialect !== "postgresql") return [];
  // Only an entity with a translatable field has a translations column to find.
  const entities = (await translatedEntities(adapter)).filter(
    entity => entity.fields.length > 0
  );
  if (entities.length === 0) return [];
  const { introspectLiveColumns } = await import(
    "../../schema/pipeline/diff/introspect-live"
  );
  const { tables } = await introspectLiveColumns(
    adapter.getDrizzle(),
    "postgresql",
    entities.map(entity => `${entity.tableName}_locales`)
  );
  const liveOf = new Map(tables.map(table => [table.name, table.columns]));
  const found: ZonedDateColumn[] = [];
  for (const entity of entities) {
    const table = `${entity.tableName}_locales`;
    const live = liveOf.get(table);
    if (!live || live.length === 0) continue;
    for (const { column, type } of zonedDateColumns({
      fields: entity.fields,
      live,
      dialect: "postgresql",
      builtBy: entity.builtBy,
    })) {
      found.push({ table, column, type });
    }
  }
  return found;
}

/**
 * Converts each of `columns` to its field's own type and answers how many it converted.
 *
 * Converting reads each value in this connection's time zone (`AT TIME ZONE
 * current_setting('TimeZone')`), which keeps each date as Nextly showed it: a value moved into the
 * translations table by turning translation on had been stored read in that zone, and Nextly reads
 * the column as the wall clock that zone renders. Each column is one statement that commits on its
 * own; a failure stops here, and the next run converts the rest.
 */
export async function convertZonedDateColumns(
  adapter: DrizzleAdapter,
  columns: readonly ZonedDateColumn[],
  onNotice?: (message: string) => void
): Promise<number> {
  const q = (name: string) => quoteIdent(name, "postgresql");
  for (const { table, column, type } of columns) {
    await adapter.executeQuery(
      `ALTER TABLE ${q(table)} ALTER COLUMN ${q(column)} TYPE ${type} USING ${q(column)} AT TIME ZONE current_setting('TimeZone')`
    );
    const [setting] = (await adapter.executeQuery(
      "SELECT current_setting('TimeZone') AS zone"
    )) as { zone?: string }[];
    onNotice?.(
      `Converted ${table}.${column} from a date with a time zone to ${type}, reading each ` +
        `value in this connection's time zone (${setting?.zone ?? "unknown"}), so each date ` +
        `keeps the value Nextly showed.`
    );
  }
  return columns.length;
}

/**
 * Converts, or names once, each translated date column an earlier release made with a time zone:
 * converted where no instance of an earlier release can be writing (`convert`), named with `nextly
 * i18n:convert-zoned-dates` where one may be.
 */
export async function convertZonedDateCompanions(
  adapter: DrizzleAdapter,
  options: {
    /** Whether to convert; otherwise each column is named once. */
    convert: boolean;
    /** Told of a column converted, and the zone its values were read in. */
    onNotice?: (message: string) => void;
    /** Told once per column left as it is. */
    onWarning?: (message: string) => void;
  }
): Promise<void> {
  const columns = await findZonedDateColumns(adapter);
  if (options.convert) {
    await convertZonedDateColumns(adapter, columns, options.onNotice);
  } else {
    warnOnce(adapter, columns, options.onWarning);
  }
}

/** The columns `warnOnce` has named, per database handle. */
const warnedOf = new WeakMap<object, Set<string>>();

/** Names each column once per database handle, and what converts it. */
function warnOnce(
  adapter: object,
  columns: readonly ZonedDateColumn[],
  onWarning?: (message: string) => void
): void {
  const warned = warnedOf.get(adapter) ?? new Set<string>();
  warnedOf.set(adapter, warned);
  for (const { table, column } of columns) {
    const name = `${table}.${column}`;
    if (warned.has(name)) continue;
    warned.add(name);
    onWarning?.(
      `${name} is a date column with a time zone, as an earlier release made it: on a server ` +
        `whose time zone is not UTC its dates are stored shifted by that zone. Run \`nextly ` +
        `i18n:convert-zoned-dates\` once this release serves every instance, in the time zone ` +
        `the app runs in, to convert it.`
    );
  }
}
