/**
 * A translated entity's translations table (`<table>_locales`), dropped by the
 * migration that drops the entity's table, and made again, empty, by its DOWN.
 *
 * The snapshot records no translations table: it marks a translated table
 * (`localized`) and the columns its translations table holds. So the diff
 * that drops an entity's table never drops the translations table beside it,
 * and a deployed database's delete then fails at the main table's drop on
 * SQLite and MySQL, whose translations table still references it, or leaves
 * the translations table and every translation in it on PostgreSQL, where the
 * drop's CASCADE removes only the reference.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  companionUniqueIndexStatements,
  uniqueColumnsWithKind,
} from "../../i18n/migration/companion-unique-indexes";
import {
  companionTableOf,
  deriveCompanionSpec,
} from "../../i18n/migration/derive-companion-spec";
import { buildCompanionCreateOnlySql } from "../../i18n/migration/generate-up";
import type { I18nTransitionKind } from "../../i18n/migration/transition-state";
import { publishesPerLanguage } from "../../i18n/per-language-storage";
import { DEFAULT_TABLE_NAME_RESOLVERS } from "../migrate/resolved-schema";
import type {
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../pipeline/diff/types";
import { builtByFor } from "../pipeline/registered-collections";
import { quoteIdent } from "../pipeline/sql-templates/identifier-quoting";

import type {
  EntitySettingsRecord,
  RecordedEntitySettings,
} from "./entity-settings";

/** The statements a migration gains for the translations tables of the tables it drops. */
export interface DroppedTranslations {
  /** Each translations table's drop, to lead the UP, before its main table's drop. */
  up: string[];
  /** Each one made again with no rows, to follow its main table's re-creation in the DOWN. */
  down: string[];
}

/** One recorded entity's declaration, read for the fields its translations table holds. */
interface RecordedEntity {
  kind: I18nTransitionKind;
  slug: string;
  entry: RecordedEntitySettings;
}

/** The key the snapshot's entity record keeps each kind under. */
const RECORD_KEYS: Record<I18nTransitionKind, keyof EntitySettingsRecord> = {
  collection: "collections",
  single: "singles",
  fieldGroup: "fieldGroups",
};

/**
 * The translations-table statements for every table `operations` drops that
 * `previous` records as translated.
 *
 * UP: `DROP TABLE IF EXISTS <table>_locales`, with `CASCADE` on PostgreSQL as
 * the main table's drop has, ahead of every other statement so the main table
 * is dropped with nothing referencing it. `IF EXISTS`, since a snapshot
 * written before the record of the translations table's columns cannot say
 * whether one was made.
 *
 * DOWN: the translations table a new translated entity's migration makes,
 * from the entity's declaration as `previousEntities` recorded it, with the
 * per-language unique indexes `previous` records on it, and no rows: what the
 * UP deleted is not in the file to bring back. A previous snapshot that
 * recorded no declaration for the entity gives no statement, and the
 * translations table is made again by the runtime's own check of it at the
 * next start.
 */
export function droppedTranslations(args: {
  operations: readonly Operation[];
  previous: NextlySchemaSnapshot;
  previousEntities: EntitySettingsRecord | undefined;
  dialect: SupportedDialect;
  defaultLocale: string;
}): DroppedTranslations {
  const { dialect } = args;
  const tables = new Map(args.previous.tables.map(t => [t.name, t]));
  const dropped = args.operations.flatMap(op =>
    op.type === "drop_table" ? [op.tableName] : []
  );
  const up: string[] = [];
  const down: string[] = [];
  for (const table of new Set(dropped)) {
    const main = tables.get(table);
    if (main?.localized !== true) continue;
    const quoted = quoteIdent(companionTableOf(table), dialect);
    up.push(
      dialect === "postgresql"
        ? `DROP TABLE IF EXISTS ${quoted} CASCADE`
        : `DROP TABLE IF EXISTS ${quoted}`
    );
    const entity = recordedEntityOf(table, args.previousEntities);
    if (entity === undefined) continue;
    down.push(...emptyTranslationsTable(entity, main, args));
  }
  return { up, down };
}

/** The entity whose table `table` is, among those the snapshot recorded. */
function recordedEntityOf(
  table: string,
  record: EntitySettingsRecord | undefined
): RecordedEntity | undefined {
  if (record === undefined) return undefined;
  for (const kind of Object.keys(RECORD_KEYS) as I18nTransitionKind[]) {
    for (const [slug, entry] of Object.entries(record[RECORD_KEYS[kind]])) {
      if (tableOf(kind, slug, entry) === table) return { kind, slug, entry };
    }
  }
  return undefined;
}

/** The table a recorded entity's declaration names, by the rule `nextly migrate` reads it by. */
function tableOf(
  kind: I18nTransitionKind,
  slug: string,
  entry: RecordedEntitySettings
): string {
  const dbName = entry.settings.dbName;
  const named = typeof dbName === "string" ? { slug, dbName } : { slug };
  switch (kind) {
    case "collection":
      return DEFAULT_TABLE_NAME_RESOLVERS.collection(named);
    case "single":
      return DEFAULT_TABLE_NAME_RESOLVERS.single(named);
    case "fieldGroup":
      return DEFAULT_TABLE_NAME_RESOLVERS.component(named);
  }
}

/** A recorded field, as the companion's classifier reads one. */
interface RecordedField {
  name: string;
  type: string;
  localized?: boolean;
  [key: string]: unknown;
}

function isRecordedField(value: unknown): value is RecordedField {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const field = value as Record<string, unknown>;
  return typeof field.name === "string" && typeof field.type === "string";
}

/**
 * The statements making `main`'s translations table again with no rows: its
 * `CREATE TABLE`, then its per-language unique indexes. Its columns are the
 * ones `main` records the translations table held, typed from the recorded
 * fields; none when no recorded field gives one.
 */
function emptyTranslationsTable(
  entity: RecordedEntity,
  main: TableSpec,
  args: { dialect: SupportedDialect; defaultLocale: string }
): string[] {
  const { dialect } = args;
  const settings = entity.entry.settings;
  const fields = (
    Array.isArray(settings.fields) ? settings.fields : []
  ).flatMap((field: unknown) => (isRecordedField(field) ? [field] : []));
  const derived = deriveCompanionSpec({
    builtBy: builtByFor(entity.kind, entity.entry.source === "builder"),
    slug: entity.slug,
    kind: entity.kind,
    dbName: main.name,
    fields,
    dialect,
    defaultLocale: args.defaultLocale,
    collectionLocalized: true,
    status: publishesPerLanguage({
      localized: settings.localized,
      status: settings.status,
    }),
  });
  if (derived === null) return [];
  // The recorded columns, where the snapshot kept them, are what the table held.
  const recorded = main.localizedColumns;
  const spec =
    recorded === undefined
      ? derived
      : {
          ...derived,
          columns: derived.columns.filter(c => recorded.includes(c.name)),
        };
  if (spec.columns.length === 0) return [];
  // A file's statements carry no terminator: the file puts its breakpoints between them.
  const create = buildCompanionCreateOnlySql(spec, {
    emittedToFile: true,
  }).replace(/;$/, "");
  const unique = uniqueColumnsWithKind(
    (main.uniqueLocalizedColumns ?? []).map(entry =>
      typeof entry === "string"
        ? { field: entry, column: entry }
        : { field: entry.column, column: entry.column, kind: entry.kind }
    ),
    spec.columns
  );
  const indexes = companionUniqueIndexStatements({
    dialect,
    companionTable: spec.companionTable,
    wanted: unique,
    translatedColumns: spec.columns.map(c => c.name),
    liveIndexNames: new Set(),
  }).map(statement => statement.replace(/;$/, ""));
  return [create, ...indexes];
}
