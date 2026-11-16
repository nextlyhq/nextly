/**
 * Which collection or Single each table a run deletes from belongs to, so a
 * data-loss consent naming an entity's main table covers the rest of it.
 *
 * An entity's main table is the one its registry row names. It also owns its
 * translation table and its junction tables (`collectionOwnTables`, the one
 * answer every delete path asks), and a consent naming the main table covers
 * every deletion in each of them, as naming the table itself would. A table
 * belongs to an entity only because its registry row says so: a name that
 * merely looks like a translation or junction table owns nothing, and neither
 * does a table two entities claim, or one that is another entity's main table.
 * Each of those must be named itself.
 *
 * A plugin's entities and Nextly's own are left out: a plugin's are retired by
 * its uninstall, never by an app migration, so a consent here never reaches
 * them through an owner.
 *
 * @module domains/schema/migrate/entity-coverage
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { querySqlRows } from "../pipeline/classifier/count-helpers";
import { introspectTableNames } from "../pipeline/diff/introspect-live";
import { collectionOwnTables } from "../services/field-column-descriptor";

import type { Deletion, EntityRef } from "./data-loss-consent";

/** A collection or Single a consent can name, by its main table, with every table it owns. */
export interface CoveredEntity extends EntityRef {
  /** Its main table, the one its registry row names. */
  table: string;
  /** Every table it owns, its main table first (`collectionOwnTables`). */
  tables: readonly string[];
}

/** The registry sources whose entities an app migration retires: the app's code and the Schema Builder. */
const COVERED_SOURCES: ReadonlySet<string> = new Set(["code", "ui", "builder"]);

/**
 * The entity a registry row describes, or undefined for one a consent never
 * reaches through its owner (a plugin's, or Nextly's own). Its fields may be
 * stored as text; fields that cannot be read name no junction table, so the
 * entity owns less, never a guessed table.
 */
export function coveredEntity(row: {
  kind: EntityRef["kind"];
  slug: string;
  tableName: string;
  fields?: unknown;
  source?: unknown;
}): CoveredEntity | undefined {
  if (typeof row.source === "string" && !COVERED_SOURCES.has(row.source)) {
    return undefined;
  }
  return {
    kind: row.kind,
    slug: row.slug,
    table: row.tableName,
    tables: collectionOwnTables(row.tableName, fieldsOf(row.fields)),
  };
}

/** A registry row's fields as a list, parsed when stored as text; none when unreadable. */
function fieldsOf(raw: unknown): { name?: string }[] {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  return Array.isArray(value)
    ? value.filter(
        (field): field is { name?: string } =>
          typeof field === "object" && field !== null
      )
    : [];
}

/** Whose each table is: the entity it is the main table of, and the entity owning it otherwise. */
export interface EntityOwners {
  /** The entity whose main table `table` is. */
  mainOf(table: string): CoveredEntity | undefined;
  /** The one entity owning `table` other than as its main table. */
  ownerOf(table: string): CoveredEntity | undefined;
}

/**
 * Whose each of `entities`' tables is, compared without regard to case as a
 * statement may spell a name. A table more than one entity claims, or one
 * that is any entity's main table, has no owner besides itself.
 */
export function entityOwners(entities: readonly CoveredEntity[]): EntityOwners {
  const mains = new Map<string, CoveredEntity>();
  for (const entity of entities) mains.set(entity.table.toLowerCase(), entity);
  const claims = new Map<string, CoveredEntity[]>();
  for (const entity of entities) {
    // Each table once per entity: a field declared twice names its junction twice.
    const owned = new Set(entity.tables.slice(1).map(t => t.toLowerCase()));
    for (const key of owned) {
      if (mains.has(key)) continue;
      claims.set(key, [...(claims.get(key) ?? []), entity]);
    }
  }
  return {
    mainOf: table => mains.get(table.toLowerCase()),
    ownerOf: table => {
      const claimed = claims.get(table.toLowerCase());
      return claimed?.length === 1 ? claimed[0] : undefined;
    },
  };
}

/**
 * `deletions` with the owner set on each deletion in a table an entity owns
 * besides its main table: dropping it, dropping one of its columns, or
 * removing its rows. An owner already set is kept.
 */
export function withOwners(
  deletions: readonly Deletion[],
  owners: EntityOwners
): Deletion[] {
  return deletions.map(deletion => {
    if (deletion.kind === "unnamed" || deletion.owner !== undefined) {
      return deletion;
    }
    const owner = owners.ownerOf(deletion.table);
    return owner === undefined ? deletion : { ...deletion, owner: owner.table };
  });
}

/** One registry's rows, as far as the coverage reads them. */
interface RegistryRow {
  slug: unknown;
  table_name: unknown;
  fields: unknown;
  source: unknown;
}

const REGISTRIES = [
  { kind: "collection", table: "dynamic_collections" },
  { kind: "single", table: "dynamic_singles" },
] as const;

/**
 * The collections and Singles the database's registries record, read on the
 * run's own connection. A registry that is absent or cannot be read adds no
 * entity, so its tables are covered only where they are named.
 */
export async function readCoveredEntities(
  db: unknown,
  dialect: SupportedDialect
): Promise<CoveredEntity[]> {
  let present: Set<string>;
  try {
    present = new Set(
      (
        await introspectTableNames(
          db,
          dialect,
          REGISTRIES.map(r => r.table)
        )
      ).map(name => name.toLowerCase())
    );
  } catch {
    return [];
  }
  const entities: CoveredEntity[] = [];
  for (const registry of REGISTRIES) {
    if (!present.has(registry.table)) continue;
    let rows: RegistryRow[];
    try {
      rows = await querySqlRows<RegistryRow>(
        db,
        dialect,
        sql`SELECT ${sql.identifier("slug")}, ${sql.identifier("table_name")}, ${sql.identifier("fields")}, ${sql.identifier("source")} FROM ${sql.identifier(registry.table)}`
      );
    } catch {
      continue;
    }
    for (const row of rows) {
      if (typeof row.slug !== "string" || typeof row.table_name !== "string") {
        continue;
      }
      const entity = coveredEntity({
        kind: registry.kind,
        slug: row.slug,
        tableName: row.table_name,
        fields: row.fields,
        source: row.source,
      });
      if (entity !== undefined) entities.push(entity);
    }
  }
  return entities;
}
