/**
 * A migration that drops a collection or Single something still uses is refused before it runs,
 * as the Schema Builder refuses its delete (`assertNothingDependsOn`): a field of a declared entity
 * naming it, a foreign key a plugin or the app declares on its own table, or another owner's
 * element on one of its tables. Whether `migrate:create` wrote the drop or a person did, nothing is
 * removed and the refusal names what uses it.
 *
 * Judged from the files' statements: a DROP TABLE of a registered entity's main table, not created
 * again under its name, drops the entity, and its other tables go with it. Read before any file runs, so on MySQL, where each
 * drop commits as it runs, no attempt is recorded for a file that would be refused part-way.
 *
 * What uses the entity is judged as it will be once the run's files have applied, so a run that
 * first removes the field or the key, then drops what it named, goes ahead:
 * - the fields, from the newest snapshot of the migrations applied or about to apply
 *   (`readRegistrySource`), over the registry rows, which hold an entity no snapshot records;
 * - the database's foreign keys, less those the files remove: the table holding one dropped and
 *   not created again, its constraint dropped by name, or one of its columns dropped. Into a
 *   collection's tables too, which the Builder's delete leaves to the field that holds a key: a
 *   key whose field the run removes and that the run leaves standing would be stripped by a
 *   `CASCADE`, or refuse the drop part-way on MySQL.
 *
 * @module domains/schema/migrate/used-entity-drops
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import {
  assertNothingDependsOn,
  databaseDependentsSources,
  type DependentsAdapter,
  type DependentsSources,
  type EntityKind,
  type FieldOwner,
} from "../../collections/services/collection-dependents";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import type {
  EntitySettingsRecord,
  SettingsEntityKind,
} from "../migrate-create/entity-settings";
import type {
  ExtensionSchemaRecord,
  LiveKeyInto,
} from "../ownership/dependent-elements";
import { tablesCreatedBy } from "../ownership/drop-guard";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";

import { readCoveredEntities } from "./entity-coverage";
import { readRegistrySource } from "./registry-source";
import {
  tablesTheStatementsDrop,
  tablesTheStatementsRetire,
} from "./retired-documents";
import { elementsDroppedBy } from "./statement-judgement";
import {
  type AddedForeignKey,
  foreignKeysAddedBy,
  postgresDropSpellings,
} from "./statement-targets";

/** The run's files, as the ledger names them, with their statements. */
interface RunFile {
  label: string;
  statements: readonly string[];
}

/** What the refusal reads. */
export interface UsedEntityDropsArgs {
  adapter: DependentsAdapter;
  db: unknown;
  dialect: SupportedDialect;
  /** The app files this run applies, in order. */
  units: readonly RunFile[];
  migrationsDir: string;
  extensionSchema: () => Promise<ExtensionSchemaRecord | null>;
}

/**
 * Refuses the run when `units` drop the main table of a collection or Single something still
 * uses once they have applied. A plugin's entity, or Nextly's own, is not an app migration's to
 * retire, and is left to the guard that refuses another owner's drop.
 */
export async function refuseDropsOfUsedEntities(
  args: UsedEntityDropsArgs
): Promise<void> {
  const statements = args.units.flatMap(unit => unit.statements);
  // A table the files rebuild in place keeps its entity, and what uses it.
  const dropped = tablesTheStatementsRetire(statements, args.dialect);
  if (dropped.size === 0) return;
  const retires = retiredTableMatcher(dropped, statements, args.dialect);
  const retiring = (await readCoveredEntities(args.db, args.dialect)).filter(
    entity =>
      entity.excluded !== true &&
      entity.kind !== "fieldGroup" &&
      retires(entity.table)
  );
  if (retiring.length === 0) return;
  await assertNothingDependsOn(
    retiring.map(entity => ({
      kind: entity.kind,
      slug: entity.slug,
      tables: entity.tables,
    })),
    sourcesAfterRun(args, statements),
    // The fields of the collections dropped together go with them.
    {
      fieldsGoWith: retiring
        .filter(entity => entity.kind === "collection")
        .map(entity => entity.slug),
    }
  );
  await refuseKeysIntoRetiredCollections(args, retiring, statements);
}

/**
 * Refuses the run when a foreign key the database holds into a retiring collection's tables, from
 * a table no retiring entity owns, is still there once `statements` have run (`keysLeftAfter`).
 */
async function refuseKeysIntoRetiredCollections(
  args: UsedEntityDropsArgs,
  retiring: readonly {
    kind: string;
    slug: string;
    tables: readonly string[];
  }[],
  statements: readonly string[]
): Promise<void> {
  const collections = retiring.filter(entity => entity.kind === "collection");
  if (collections.length === 0) return;
  const own = new Set(
    retiring.flatMap(entity => entity.tables.map(table => table.toLowerCase()))
  );
  const database = databaseDependentsSources(
    args.adapter,
    args.extensionSchema
  );
  const tables = collections.flatMap(entity => entity.tables);
  const live = (await database.liveKeysInto?.(tables)) ?? [];
  const left = [
    ...(await keysLeftAfter(live, args.db, args.dialect, statements)),
    ...keysAddedInto(tables, args.dialect, statements),
  ].filter(key => !own.has(key.table.toLowerCase()));
  if (left.length === 0) return;
  throw NextlyError.conflict({
    reason: "state",
    message: `${collections.map(entity => `"${entity.slug}"`).join(", ")} cannot be dropped while a foreign key still points into its tables after the migrations: ${left
      .map(key => `${key.table} → ${key.referencesTable}`)
      .join(", ")}. Drop those keys in a migration before the drop.`,
  });
}

/**
 * Whether a registered table is among those `statements` retire (`dropped`, lower-cased). On
 * PostgreSQL, which keeps a quoted name's case, a table registered in mixed case is retired only by
 * a drop spelling it so, and a lower-case one not by a drop of a mixed-case name that merely folds
 * to it; elsewhere names compare without regard to case.
 */
function retiredTableMatcher(
  dropped: ReadonlySet<string>,
  statements: readonly string[],
  dialect: SupportedDialect
): (table: string) => boolean {
  if (dialect !== "postgresql") {
    return table => dropped.has(table.toLowerCase());
  }
  const spelled = postgresDropSpellings(statements);
  const foldedOnly = new Set(
    [...spelled]
      .filter(
        name => name !== name.toLowerCase() && !spelled.has(name.toLowerCase())
      )
      .map(name => name.toLowerCase())
  );
  return table =>
    table !== table.toLowerCase()
      ? spelled.has(table)
      : dropped.has(table) && !foldedOnly.has(table);
}

/**
 * The foreign keys `statements` add into `tables` and leave standing, as keys whose owner is not
 * recorded: read in order, so a key a later statement takes away (its table dropped, its
 * constraint dropped by name, or one of its columns dropped) is not among them. What the database
 * holds into them once the run is done, beside the keys already there (`keysLeftAfter`).
 */
function keysAddedInto(
  tables: readonly string[],
  dialect: SupportedDialect,
  statements: readonly string[]
): LiveKeyInto[] {
  const into = new Set(tables.map(table => table.toLowerCase()));
  let standing: AddedForeignKey[] = [];
  for (const statement of statements) {
    const dropped = tablesTheStatementsDrop([statement], dialect);
    const removed = elementsDroppedBy([statement], dialect);
    standing = standing.filter(key => {
      const table = key.table.toLowerCase();
      if (dropped.has(table)) return false;
      if (
        key.name !== undefined &&
        removed.has(table, "constraint", key.name)
      ) {
        return false;
      }
      return !key.columns.some(column => removed.has(table, "column", column));
    });
    standing.push(
      ...foreignKeysAddedBy(statement, dialect).filter(key =>
        into.has(key.referencesTable.toLowerCase())
      )
    );
  }
  return standing.map(key => ({
    table: key.table,
    referencesTable: key.referencesTable,
    owner: null,
  }));
}

/** The database's dependents, read as they will be once `statements` have run. */
function sourcesAfterRun(
  args: UsedEntityDropsArgs,
  statements: readonly string[]
): DependentsSources {
  const database = databaseDependentsSources(
    args.adapter,
    args.extensionSchema
  );
  return {
    ...database,
    fieldOwners: async () =>
      fieldOwnersAfter(await database.fieldOwners(), args),
    liveKeysInto: async tables => [
      ...(await keysLeftAfter(
        (await database.liveKeysInto?.(tables)) ?? [],
        args.db,
        args.dialect,
        statements
      )),
      ...keysAddedInto(tables, args.dialect, statements),
    ],
  };
}

/** The registry's name for each kind's entities in a snapshot's record. */
const RECORD_KEYS: Record<EntityKind, keyof EntitySettingsRecord> = {
  collection: "collections",
  single: "singles",
  fieldGroup: "fieldGroups",
};

/**
 * `owners` as the newest snapshot of the migrations applied or about to apply declares them: each
 * entity it records with the fields it records, and the others as the registry holds them.
 */
async function fieldOwnersAfter(
  owners: readonly FieldOwner[],
  args: UsedEntityDropsArgs
): Promise<FieldOwner[]> {
  const running = new Set(args.units.map(unit => unit.label));
  const ledger = new SchemaEventsRepository(args.db, args.dialect);
  const source = await readRegistrySource({
    migrationsDir: args.migrationsDir,
    isApplied: async name => running.has(name) || ledger.isFileApplied(name),
  });
  if (source.kind !== "snapshot") return [...owners];
  const record = source.entities;
  const declared = (kind: EntityKind, slug: string): unknown[] | undefined => {
    const settings = record[RECORD_KEYS[kind]][slug]?.settings as
      | { fields?: unknown }
      | undefined;
    return Array.isArray(settings?.fields) ? settings.fields : undefined;
  };
  const after: FieldOwner[] = owners.map(owner => ({
    ...owner,
    fields: declared(owner.entityType, owner.entitySlug) ?? owner.fields,
  }));
  // An entity the run's files add, which the registry does not hold yet.
  const held = new Set(owners.map(o => `${o.entityType}:${o.entitySlug}`));
  for (const kind of Object.keys(RECORD_KEYS) as SettingsEntityKind[]) {
    for (const slug of Object.keys(record[RECORD_KEYS[kind]])) {
      const fields = declared(kind, slug);
      if (fields !== undefined && !held.has(`${kind}:${slug}`)) {
        after.push({ entityType: kind, entitySlug: slug, fields });
      }
    }
  }
  return after;
}

/**
 * The foreign keys among `keys` still there once `statements` have run: a key whose table they
 * drop and do not create again goes, and so does one whose every constraint into the table it
 * points at they drop by name or by one of its columns. A table they drop and create again keeps
 * its keys, as what the new table declares is not read.
 */
async function keysLeftAfter(
  keys: readonly LiveKeyInto[],
  db: unknown,
  dialect: SupportedDialect,
  statements: readonly string[]
): Promise<LiveKeyInto[]> {
  if (keys.length === 0) return [];
  const dropped = tablesTheStatementsDrop(statements, dialect);
  const created = new Set(
    tablesCreatedBy(statements, dialect).map(name => name.toLowerCase())
  );
  const removed = elementsDroppedBy(statements, dialect);
  const left: LiveKeyInto[] = [];
  for (const key of keys) {
    const table = key.table.toLowerCase();
    if (dropped.has(table)) {
      if (created.has(table)) left.push(key);
      continue;
    }
    if (!removed.tables.has(table)) {
      left.push(key);
      continue;
    }
    const constraints = await constraintsInto(db, dialect, key);
    const stays =
      constraints.length === 0 ||
      constraints.some(
        constraint =>
          !removed.has(table, "constraint", constraint.name) &&
          !constraint.columns.some(column =>
            removed.has(table, "column", column)
          )
      );
    if (stays) left.push(key);
  }
  return left;
}

/** The foreign key constraints `key`'s table holds into the table it points at, as the catalog names them. */
async function constraintsInto(
  db: unknown,
  dialect: SupportedDialect,
  key: LiveKeyInto
): Promise<{ name: string; columns: string[] }[]> {
  const { tables } = await introspectLiveSnapshot(db, dialect, [key.table]);
  const into = key.referencesTable.toLowerCase();
  return (tables[0]?.foreignKeys ?? []).filter(
    foreignKey => foreignKey.referencesTable.toLowerCase() === into
  );
}
