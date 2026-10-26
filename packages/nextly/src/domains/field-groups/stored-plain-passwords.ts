/**
 * Passwords an earlier release stored as given inside a container, found and
 * hashed in place.
 *
 * A password in a field group held inline in a group or repeater, of a
 * collection, a Single or another field group, was once kept in that
 * container's stored value exactly as written. Every write now hashes it; this
 * finds the values written before, in each entity's own table and, for a
 * translated container, on its companion row in each language, and replaces
 * each with a hash of itself, so the password still verifies.
 *
 * A value already a hash, bcrypt's or one another hasher writes (argon2,
 * scrypt, pbkdf2, a hex salt and digest), is left as it is, so a second run
 * finds nothing. It reports counts and never a value.
 *
 * Content tables are read and written through the adapter by name, so each
 * entity's runtime tables are registered on the resolver the caller installed
 * (`installRegistryResolver`) before they are read.
 *
 * @module domains/field-groups/stored-plain-passwords
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SqlParam, WhereClause } from "@nextlyhq/adapter-drizzle/types";

import { isPasswordHash } from "../../auth/password";
import type { FieldConfig } from "../../collections/fields/types";
import type { SchemaRegistry } from "../../database/schema-registry";
import { registerEntityRuntimeTables } from "../../di/register-runtime-tables";
import { NextlyError } from "../../errors";
import {
  hashStoredPlainPasswords,
  reachesPasswordField,
  storedPasswordValues,
  storedPlainPasswords,
  stripSnapshotPasswords,
  type FieldGroupReach,
} from "../../shared/lib/password-fields";
import type { Logger } from "../../shared/types";
import { CollectionRegistryService } from "../collections/services/collection-registry-service";
import {
  COMPANION_LOCALE_COLUMN,
  COMPANION_PARENT_COLUMN,
} from "../i18n/companion-columns";
import { buildCompanionSchema } from "../i18n/runtime/companion-io";
import { SingleRegistryService } from "../singles/services/single-registry-service";
import { isOtherHasherFormat } from "../users/services/plaintext-password-cleanup";

import { passwordReachOf } from "./password-reach";
import { FieldGroupRegistryService } from "./services/field-group-registry-service";
import { registerComponentSchemas } from "./services/register-field-group-schemas";

/** Rows read per page, so a large table is never read whole. */
const PAGE_SIZE = 500;

/** Whether a stored value is already a hash, of core's hasher or another's. */
const isHashed = (value: string): boolean =>
  isPasswordHash(value) || isOtherHasherFormat(value);

/** How many passwords stored as given one entity holds, or held. */
export interface StoredPlainPasswordCount {
  kind: "collection" | "single" | "field group";
  slug: string;
  count: number;
}

/** A group or repeater, by the name its value is stored under. */
type Container = FieldConfig & { name: string };

/** One table to read, the key of its rows, and the containers it holds. */
interface StoredTable {
  table: string;
  key: readonly string[];
  containers: readonly Container[];
}

/** An entity whose containers can hold a password, and where they are stored. */
interface StoredEntity {
  kind: StoredPlainPasswordCount["kind"];
  slug: string;
  fields: FieldConfig[];
  reach: FieldGroupReach;
  tables: StoredTable[];
}

/** The groups and repeaters of a level, through its layout containers. */
function containersOf(fields: readonly FieldConfig[]): Container[] {
  const found: Container[] = [];
  for (const field of fields) {
    const nested = (field as { fields?: FieldConfig[] }).fields;
    if (!field.name && nested) found.push(...containersOf(nested));
    else if (
      field.name &&
      (field.type === "group" || field.type === "repeater")
    ) {
      found.push(field as Container);
    }
  }
  return found;
}

const whereKey = (key: readonly string[], row: Record<string, unknown>) =>
  ({
    and: key.map(column => ({
      column,
      op: "=" as const,
      value: row[column] as SqlParam,
    })),
  }) as WhereClause;

/** Where the passwords are read from and written to. */
export interface StoredPasswordsSource {
  adapter: DrizzleAdapter;
  /** Rows read per page; 500 unless a test reads smaller pages. */
  pageSize?: number;
  /** The resolver's registry, on which each entity's tables are registered. */
  registry: SchemaRegistry;
  logger: Logger;
}

/** How many passwords stored as given each entity holds. Changes nothing. */
export function countPasswordsStoredAsGiven(
  source: StoredPasswordsSource
): Promise<StoredPlainPasswordCount[]> {
  return visit(source, false);
}

/** Hash each one in place; returns how many each entity had. */
export function hashPasswordsStoredAsGiven(
  source: StoredPasswordsSource
): Promise<StoredPlainPasswordCount[]> {
  return visit(source, true);
}

async function visit(
  source: StoredPasswordsSource,
  apply: boolean
): Promise<StoredPlainPasswordCount[]> {
  const counts: StoredPlainPasswordCount[] = [];
  for (const entity of await entities(source)) {
    let count = 0;
    for (const stored of entity.tables) {
      count += await visitTable(source, entity, stored, apply);
    }
    if (count > 0) {
      counts.push({ kind: entity.kind, slug: entity.slug, count });
    }
  }
  return counts;
}

/**
 * The entities whose containers can hold a password, with their tables
 * registered for reading. An entity with none is never read.
 */
async function entities(
  source: StoredPasswordsSource
): Promise<StoredEntity[]> {
  const { dialect } = source.adapter.getCapabilities();
  const components = await new FieldGroupRegistryService(
    source.adapter,
    source.logger
  ).getAllComponents();
  const fieldsBySlug = new Map(
    components.map(component => [component.slug, component.fields])
  );
  const reader = {
    getComponentFields: (slug: string) =>
      Promise.resolve(fieldsBySlug.get(slug) ?? null),
  };
  await registerComponentSchemas({
    adapter: source.adapter,
    registry: source.registry,
    dialect,
    logger: source.logger,
  });

  const entries: Array<{
    kind: StoredEntity["kind"];
    slug: string;
    tableName: string;
    fields: FieldConfig[];
    localized: boolean;
    status: boolean;
    register: boolean;
  }> = [
    ...(
      await new CollectionRegistryService(
        source.adapter,
        source.logger
      ).getAllCollections()
    ).map(record => ({
      kind: "collection" as const,
      slug: record.slug,
      tableName: record.tableName,
      fields: record.fields,
      localized: record.localized === true,
      status: record.status === true,
      register: true,
    })),
    ...(
      await new SingleRegistryService(
        source.adapter,
        source.logger
      ).getAllSingles()
    ).map(record => ({
      kind: "single" as const,
      slug: record.slug,
      tableName: record.tableName,
      fields: record.fields,
      localized: record.localized === true,
      status: record.status === true,
      register: true,
    })),
    // Registered above, with their companions.
    ...components.map(record => ({
      kind: "field group" as const,
      slug: record.slug,
      tableName: record.tableName,
      fields: record.fields,
      localized: record.localized === true,
      status: false,
      register: false,
    })),
  ];

  const entities: StoredEntity[] = [];
  for (const entry of entries) {
    const reach = await passwordReachOf(entry.fields, reader);
    const containers = containersOf(entry.fields).filter(field =>
      reachesPasswordField([field], reach)
    );
    if (containers.length === 0) continue;
    if (entry.register) {
      registerEntityRuntimeTables(
        source.registry,
        {
          slug: entry.slug,
          tableName: entry.tableName,
          fields: entry.fields as Parameters<
            typeof registerEntityRuntimeTables
          >[1]["fields"],
          status: entry.status,
          localized: entry.localized,
        },
        dialect
      );
    }
    // A translated container is stored on the companion row, per language.
    const companion = entry.localized
      ? buildCompanionSchema({
          slug: entry.slug,
          tableName: entry.tableName,
          fields: entry.fields as Parameters<
            typeof buildCompanionSchema
          >[0]["fields"],
          dialect,
          status: entry.status,
        })
      : null;
    const translated = new Set(
      companion?.localizedFields.map(field => field.name) ?? []
    );
    const tables: StoredTable[] = [];
    const own = containers.filter(field => !translated.has(field.name));
    if (own.length > 0) {
      tables.push({ table: entry.tableName, key: ["id"], containers: own });
    }
    const onCompanion = containers.filter(field => translated.has(field.name));
    if (companion && onCompanion.length > 0) {
      tables.push({
        table: companion.companionTableName,
        key: [COMPANION_PARENT_COLUMN, COMPANION_LOCALE_COLUMN],
        containers: onCompanion,
      });
    }
    entities.push({
      kind: entry.kind,
      slug: entry.slug,
      fields: entry.fields,
      reach,
      tables,
    });
  }
  return entities;
}

/** Count, or hash, the passwords stored as given in one table's rows. */
async function visitTable(
  source: StoredPasswordsSource,
  entity: StoredEntity,
  stored: StoredTable,
  apply: boolean
): Promise<number> {
  let count = 0;
  await forEachRow(
    source,
    stored.table,
    stored.key,
    [...stored.key, ...stored.containers.map(field => field.name)],
    undefined,
    async row => {
      const found = storedPlainPasswords(
        containersIn(stored, row),
        entity.fields,
        entity.reach,
        isHashed
      ).length;
      if (found === 0) return;
      count += apply ? await hashRow(source, entity, stored, row) : found;
    }
  );
  return count;
}

/**
 * Visit each row of `table` that `where` selects, a page at a time, paged by
 * the rows' key from the last row read, so a later page never walks past
 * the earlier ones.
 */
async function forEachRow(
  source: StoredPasswordsSource,
  table: string,
  key: readonly string[],
  columns: readonly string[],
  where: WhereClause | undefined,
  visit: (row: Record<string, unknown>) => Promise<void>
): Promise<void> {
  const pageSize = source.pageSize ?? PAGE_SIZE;
  let after: Record<string, unknown> | undefined;
  for (;;) {
    const page = [
      ...(where ? [where] : []),
      ...(after ? [afterKey(key, after)] : []),
    ];
    const rows = await source.adapter.select<Record<string, unknown>>(table, {
      columns: [...columns],
      ...(page.length > 0 ? { where: { and: page } } : {}),
      orderBy: key.map(column => ({ column })),
      limit: pageSize,
    });
    for (const row of rows) await visit(row);
    if (rows.length < pageSize) return;
    after = rows[rows.length - 1];
  }
}

/**
 * The rows whose key sorts after `row`'s, by the key's columns in order: for
 * a companion's `(_parent, _locale)`, a later parent, or the same parent in a
 * later language.
 */
function afterKey(
  key: readonly string[],
  row: Record<string, unknown>
): WhereClause {
  const value = (column: string) => row[column] as SqlParam;
  return {
    or: key.map((column, index) => ({
      and: [
        ...key.slice(0, index).map(earlier => ({
          column: earlier,
          op: "=" as const,
          value: value(earlier),
        })),
        { column, op: ">" as const, value: value(column) },
      ],
    })),
  };
}

/**
 * Hash one row's passwords, re-read under a row lock in a transaction of its
 * own: a write made since the page was read is what is hashed, and one made
 * while the hashes are made waits rather than being overwritten.
 */
function hashRow(
  source: StoredPasswordsSource,
  entity: StoredEntity,
  stored: StoredTable,
  row: Record<string, unknown>
): Promise<number> {
  return rewriteRow(
    source,
    { kind: entity.kind, slug: entity.slug, table: stored.table },
    [...stored.key, ...stored.containers.map(field => field.name)],
    whereKey(stored.key, row),
    async current => {
      const data = containersIn(stored, current);
      const hashed = await hashStoredPlainPasswords(
        data,
        entity.fields,
        entity.reach,
        isHashed
      );
      return hashed > 0 ? { data, changed: hashed } : undefined;
    }
  );
}

/**
 * Rewrite one row, re-read with a row lock in a transaction of its own, by
 * what `change` makes of it; returns how many things it changed. A failure
 * is reported by entity and table, never by the database's text or cause,
 * which can quote the statement's parameters and so the values written.
 */
async function rewriteRow(
  source: StoredPasswordsSource,
  where: { kind: string; slug: string; table: string },
  columns: readonly string[],
  key: WhereClause,
  change: (
    current: Record<string, unknown>
  ) => Promise<{ data: Record<string, unknown>; changed: number } | undefined>
): Promise<number> {
  try {
    return await source.adapter.transaction(async tx => {
      const [current] = await tx.select<Record<string, unknown>>(where.table, {
        columns: [...columns],
        where: key,
        forUpdate: true,
      });
      if (!current) return 0;
      const next = await change(current);
      if (!next) return 0;
      await tx.update(where.table, next.data, key);
      return next.changed;
    });
  } catch (error) {
    throw NextlyError.internal({
      logContext: {
        reason: "stored-password-rewrite-failed",
        kind: where.kind,
        slug: where.slug,
        table: where.table,
        errorName: error instanceof Error ? error.name : typeof error,
      },
    });
  }
}

/** The table each version is stored in. */
const VERSIONS_TABLE = "nextly_versions";

/** A versioned entity whose fields can hold a password, at any depth. */
interface VersionedEntity {
  kind: "collection" | "single";
  slug: string;
  fields: FieldConfig[];
  fieldsOf: (slug: string) => readonly FieldConfig[] | undefined;
}

/**
 * The collections and Singles whose versions can hold a password: a
 * snapshot holds every field group's instances inline, so their fields are
 * followed wherever they are placed.
 */
async function versionedEntities(
  source: StoredPasswordsSource
): Promise<VersionedEntity[]> {
  const components = await new FieldGroupRegistryService(
    source.adapter,
    source.logger
  ).getAllComponents();
  const fieldsBySlug = new Map(
    components.map(component => [component.slug, component.fields])
  );
  const fieldsOf = (slug: string) => fieldsBySlug.get(slug);
  const records: Array<Omit<VersionedEntity, "fieldsOf">> = [
    ...(
      await new CollectionRegistryService(
        source.adapter,
        source.logger
      ).getAllCollections()
    ).map(record => ({
      kind: "collection" as const,
      slug: record.slug,
      fields: record.fields,
    })),
    ...(
      await new SingleRegistryService(
        source.adapter,
        source.logger
      ).getAllSingles()
    ).map(record => ({
      kind: "single" as const,
      slug: record.slug,
      fields: record.fields,
    })),
  ];
  return records
    .map(record => ({ ...record, fieldsOf }))
    .filter(entity =>
      reachesPasswordField(entity.fields, { fieldsOf, direct: true })
    );
}

/** Whether a version's snapshot holds a password, at any depth. */
function holdsPassword(snapshot: unknown, entity: VersionedEntity): boolean {
  const open = parsedSnapshot(snapshot);
  return (
    open !== undefined &&
    storedPasswordValues(open, entity.fields, {
      fieldsOf: entity.fieldsOf,
      direct: true,
    }).size > 0
  );
}

function parsedSnapshot(value: unknown): Record<string, unknown> | undefined {
  let open = value;
  if (typeof open === "string") {
    try {
      open = JSON.parse(open) as unknown;
    } catch {
      return undefined;
    }
  }
  return open !== null && typeof open === "object" && !Array.isArray(open)
    ? (open as Record<string, unknown>)
    : undefined;
}

/** Count, or strip, the versions of each entity whose snapshot holds one. */
async function visitVersions(
  source: StoredPasswordsSource,
  apply: boolean
): Promise<StoredPlainPasswordCount[]> {
  const counts: StoredPlainPasswordCount[] = [];
  for (const entity of await versionedEntities(source)) {
    let count = 0;
    await forEachRow(
      source,
      VERSIONS_TABLE,
      ["id"],
      ["id", "snapshot"],
      {
        and: [
          { column: "scopeKind", op: "=", value: entity.kind },
          { column: "scopeSlug", op: "=", value: entity.slug },
        ],
      },
      async row => {
        if (!holdsPassword(row.snapshot, entity)) return;
        count += apply ? await stripVersion(source, entity, row) : 1;
      }
    );
    if (count > 0) counts.push({ kind: entity.kind, slug: entity.slug, count });
  }
  return counts;
}

/** Strip the passwords out of one version's snapshot. */
function stripVersion(
  source: StoredPasswordsSource,
  entity: VersionedEntity,
  row: Record<string, unknown>
): Promise<number> {
  return rewriteRow(
    source,
    { kind: entity.kind, slug: entity.slug, table: VERSIONS_TABLE },
    ["id", "snapshot"],
    whereKey(["id"], row),
    current => {
      const snapshot = parsedSnapshot(current.snapshot);
      if (!snapshot || !holdsPassword(snapshot, entity)) {
        return Promise.resolve(undefined);
      }
      // An instance whose field group is gone is left as it is: its fields
      // cannot be told apart.
      stripSnapshotPasswords(
        snapshot,
        entity.fields,
        entity.fieldsOf,
        () => {}
      );
      return Promise.resolve({ data: { snapshot }, changed: 1 });
    }
  );
}

/**
 * How many versions of each collection and Single hold a password in their
 * snapshot. A snapshot never keeps one; an earlier release could. Changes
 * nothing.
 */
export function countVersionsHoldingPasswords(
  source: StoredPasswordsSource
): Promise<StoredPlainPasswordCount[]> {
  return visitVersions(source, false);
}

/** Strip the passwords out of each such snapshot; returns how many each had. */
export function removePasswordsFromVersions(
  source: StoredPasswordsSource
): Promise<StoredPlainPasswordCount[]> {
  return visitVersions(source, true);
}

/** A row's container values, by field name, as the walk reads an entry. */
function containersIn(
  stored: StoredTable,
  row: Record<string, unknown>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of stored.containers) {
    if (row[field.name] != null) {
      data[field.name] = row[field.name];
    }
  }
  return data;
}
