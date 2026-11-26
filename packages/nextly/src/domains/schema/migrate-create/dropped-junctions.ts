/**
 * The many-to-many tables of the collections and Singles a migration removes.
 *
 * A snapshot records no many-to-many table, so the diff never drops one: the removed entity's own
 * would keep a foreign key into the main table the migration drops, which SQLite and MySQL refuse
 * and PostgreSQL's `CASCADE` strips, leaving the table and its rows behind. So the migration drops
 * each of them itself, and its DOWN makes it again, as a delete in the Schema Builder does.
 *
 * Only a removed entity's own links go. The entity they link to, its rows and every other link stay,
 * and a table a remaining entity's field names too, or that is an entity's own, is never dropped.
 *
 * @module domains/schema/migrate-create/dropped-junctions
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { NextlyError } from "../../../errors/nextly-error";
import { DynamicCollectionSchemaService } from "../../dynamic-collections/services/dynamic-collection-schema-service";
import type { NextlySchemaSnapshot, Operation } from "../pipeline/diff/types";
import { quoteIdent } from "../pipeline/sql-templates/identifier-quoting";
import { generateStatements } from "../pipeline/sql-templates/index";
import {
  junctionTablesOf,
  usesJunctionTable,
} from "../services/field-column-descriptor";

import { recordedEntityTable } from "./dropped-translations";
import type {
  EntitySettingsRecord,
  RecordedEntitySettings,
} from "./entity-settings";

/** One many-to-many table's drop, and the tables it links, which are dropped after it. */
export interface JunctionDrop {
  links: readonly string[];
  statement: string;
}

/** What the migration does for the many-to-many tables it drops, each way. */
export interface DroppedJunctions {
  up: JunctionDrop[];
  down: string[];
}

/** An entity the configuration still declares, by its table and fields. */
interface RemainingEntity {
  slug: string;
  tableName: string;
  fields: readonly unknown[];
}

/** A collection or Single `operations` remove: no longer declared, its main table dropped. */
interface RemovedEntity {
  table: string;
  fields: readonly FieldDefinition[];
}

/**
 * The many-to-many tables of every collection and Single `previousEntities` records, that is not
 * among the `remaining`, and whose main table `operations` drop.
 *
 * UP: `DROP TABLE IF EXISTS`, since a field declared in code has such a table only where the Schema
 * Builder, or a development sync, made it. DOWN: the table with its keys, empty, where the table it
 * links to is one the migration returns to. A table in `droppedAlready` is the caller's: a Schema
 * Builder save writes its own entity's statements.
 */
export function droppedJunctions(args: {
  operations: readonly Operation[];
  previous: NextlySchemaSnapshot;
  previousEntities: EntitySettingsRecord | undefined;
  remaining: {
    collections: readonly RemainingEntity[];
    singles: readonly RemainingEntity[];
  };
  droppedAlready: ReadonlySet<string>;
  dialect: SupportedDialect;
}): DroppedJunctions {
  const { dialect, previous, previousEntities } = args;
  if (previousEntities === undefined) return { up: [], down: [] };
  const keyOf = (name: string) => tableNameKey(name, dialect);
  const kept = keptTables(args);
  const tables = new Set(previous.tables.map(table => table.name));
  const targets = new Map(
    Object.entries(previousEntities.collections).map(([slug, entry]) => [
      slug,
      recordedEntityTable("collection", slug, entry),
    ])
  );
  const service = new DynamicCollectionSchemaService(undefined, dialect);
  const up: JunctionDrop[] = [];
  const down: string[] = [];
  for (const { table, fields } of removedEntities(args, previousEntities)) {
    for (const field of fields.filter(each => usesJunctionTable(each))) {
      const shape = service.junctionShape(table, field, targets);
      const key = keyOf(shape.table);
      // Once each, however many fields name it, and never one that is another's too.
      if (kept.has(key)) continue;
      kept.add(key);
      const again = tables.has(shape.targetTable)
        ? madeAgain(service, table, field, targets)
        : [];
      // A table its DOWN could not make again (actions an earlier release recorded, which a link
      // table no longer takes) is left where it is, as before, rather than lost to a rollback.
      if (again === undefined) continue;
      up.push({
        links: [table, shape.targetTable],
        statement: `DROP TABLE IF EXISTS ${quoteIdent(shape.table, dialect)}`,
      });
      down.push(...again);
    }
  }
  return { up, down };
}

/**
 * `statements` with each of `drops` placed immediately before the first drop of a table it links, so
 * neither goes while the many-to-many table still points at it. Not at the head of the file, for
 * the reason `translationsDropsPlaced` gives.
 */
export function junctionDropsPlaced(
  statements: readonly string[],
  drops: readonly JunctionDrop[],
  dialect: SupportedDialect
): string[] {
  const out = [...statements];
  for (const { links, statement } of drops) {
    const at = links
      .flatMap(tableName =>
        generateStatements([{ type: "drop_table", tableName }], dialect, [])
      )
      .map(drop => out.indexOf(drop))
      .filter(index => index !== -1);
    out.splice(at.length === 0 ? out.length : Math.min(...at), 0, statement);
  }
  return out;
}

/**
 * A table's name as the database tells it from another: as written on PostgreSQL, whose names a
 * generated statement quotes, lower-cased where the database compares names without case.
 */
function tableNameKey(name: string, dialect: SupportedDialect): string {
  return dialect === "postgresql" ? name : name.toLowerCase();
}

/** The tables, by `tableNameKey`, no drop here may name. */
function keptTables({
  previous,
  remaining,
  droppedAlready,
  dialect,
}: Parameters<typeof droppedJunctions>[0]): Set<string> {
  return new Set(
    [
      ...previous.tables.map(table => table.name),
      ...[...remaining.collections, ...remaining.singles].flatMap(entity => [
        entity.tableName,
        ...junctionTablesOf(
          entity.tableName,
          entity.fields as readonly FieldDefinition[]
        ),
      ]),
      ...droppedAlready,
    ].map(name => tableNameKey(name, dialect))
  );
}

/** The collections and Singles the migration removes. */
function removedEntities(
  { operations, remaining }: Parameters<typeof droppedJunctions>[0],
  record: EntitySettingsRecord
): RemovedEntity[] {
  const dropped = new Set(
    operations.flatMap(op => (op.type === "drop_table" ? [op.tableName] : []))
  );
  const removedOf = (
    kind: "collection" | "single",
    recorded: Readonly<Record<string, RecordedEntitySettings>>,
    declared: readonly RemainingEntity[]
  ) =>
    Object.entries(recorded)
      .filter(([slug]) => !declared.some(entity => entity.slug === slug))
      .map(([slug, entry]) => ({
        table: recordedEntityTable(kind, slug, entry),
        fields: fieldsOf(entry),
      }))
      .filter(({ table }) => dropped.has(table));
  return [
    ...removedOf("collection", record.collections, remaining.collections),
    ...removedOf("single", record.singles, remaining.singles),
  ];
}

/** A recorded entity's own fields. */
function fieldsOf(entry: RecordedEntitySettings): FieldDefinition[] {
  const { fields } = entry.settings;
  return Array.isArray(fields) ? (fields as unknown as FieldDefinition[]) : [];
}

/**
 * The statements that make a many-to-many table again, with its keys and indexes; undefined where
 * the field's recorded actions are ones no link table takes.
 */
function madeAgain(
  service: DynamicCollectionSchemaService,
  table: string,
  field: FieldDefinition,
  targets: ReadonlyMap<string, string>
): string[] | undefined {
  try {
    return service
      .generateJunctionTable(table, field, targets)
      .split("--> statement-breakpoint")
      .map(statement => statement.trim().replace(/;$/, ""))
      .filter(statement => statement !== "");
  } catch (error) {
    if (NextlyError.is(error)) return undefined;
    throw error;
  }
}
