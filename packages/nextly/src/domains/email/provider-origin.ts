/**
 * Where the provider that carried an email came from, as the Activity shows
 * it and filters by it.
 *
 * - `stored`: a provider row that still exists, named by its id.
 * - `code`: no provider row: the site's configured provider, or the
 *   built-in log provider an install with none configured falls back to.
 * - `deleted`: a provider row deleted since. PostgreSQL and SQLite null the
 *   record's provider id when the row goes, and MySQL keeps it dangling, so
 *   a record says `stored` when written and is read against the providers
 *   that exist now.
 * - `not-recorded`: a record from before origins were written, with no
 *   provider id: the configured provider and a since-deleted row look alike.
 *
 * A provider id is returned only while that provider exists, on every
 * dialect.
 *
 * @module domains/email/provider-origin
 */

import {
  and,
  eq,
  isNotNull,
  not,
  or,
  sql,
  type Column,
  type SQL,
} from "drizzle-orm";

import { loadedDialect } from "../../database/dialect-tables";

/** @experimental Where an email's provider came from. */
export type ProviderOrigin = "stored" | "code" | "deleted" | "not-recorded";

/** The origins a filter takes: a record not recorded matches none. */
export const FILTERABLE_ORIGINS = ["stored", "code", "deleted"] as const;
export type FilterableOrigin = (typeof FILTERABLE_ORIGINS)[number];

/** The provider of a record, as the Activity reads it. */
export interface ProviderRead {
  /** The stored provider's id, only while it exists. */
  id: string | null;
  type: string;
  origin: ProviderOrigin;
}

/**
 * A record's provider as it reads now: `recorded` is the origin it was
 * written with, if any, and `exists` whether its provider row exists, read
 * with the record in the same query (`providerExists`), so the filter and
 * the answer never disagree.
 */
export function providerRead(
  type: string,
  providerId: string | null,
  recorded: string | null,
  exists: unknown
): ProviderRead {
  // A boolean on PostgreSQL, 0 or 1 on MySQL and SQLite.
  const found = providerId !== null && Boolean(Number(exists));
  const origin: ProviderOrigin = found
    ? "stored"
    : recorded === "code"
      ? "code"
      : recorded === "stored" || providerId !== null
        ? "deleted"
        : "not-recorded";
  return { id: found ? providerId : null, type, origin };
}

/** Databases known to hold the providers table, by their Drizzle handle. */
const PROVIDERS_PRESENT = new WeakMap<object, true>();

/** The Drizzle surface the presence check needs. */
interface ProbeDb {
  select(fields: Record<string, unknown>): {
    from(table: unknown): { limit(count: number): PromiseLike<unknown[]> };
  };
}

/** Whether a thrown database error says a table does not exist. */
function missingTable(error: unknown): boolean {
  const texts: string[] = [];
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 5;
    current = current.cause, depth += 1
  ) {
    texts.push(current.message);
  }
  return /no such table|does not exist|doesn't exist/i.test(texts.join(" "));
}

/**
 * Whether the database holds the providers table. A SQLite database built by
 * the core-tables fallback has the delivery log before it has providers, and
 * a statement naming a table that isn't there fails outright; with no table,
 * no provider row exists, and every record's provider reads that way. Only a
 * found table is remembered, so one created later is seen.
 */
export async function providersTablePresent(
  db: ProbeDb,
  dialect: string
): Promise<boolean> {
  if (PROVIDERS_PRESENT.has(db)) return true;
  const providers = loadedDialect(dialect).tables.emailProviders;
  try {
    await db
      .select({ one: sql`1` })
      .from(providers)
      .limit(1);
  } catch (error) {
    if (missingTable(error)) return false;
    throw error;
  }
  PROVIDERS_PRESENT.set(db, true);
  return true;
}

/**
 * Whether a record's provider row exists now: selected with the record, and
 * the test the origin filter makes. The id is compared as text on
 * PostgreSQL, where the queue keeps it as text and the providers as a uuid.
 * `present` is whether the providers table exists at all
 * (`providersTablePresent`): without it, none does.
 */
export function providerExists(
  table: OriginColumns,
  dialect: string,
  present: boolean
): SQL {
  if (!present) return dialect === "postgresql" ? sql`false` : sql`0`;
  const providers = loadedDialect(dialect).tables.emailProviders;
  const asText = (value: SQL | Column) =>
    dialect === "postgresql" ? sql`${value}::text` : sql`${value}`;
  return and(
    isNotNull(table.providerId),
    sql`exists (select 1 from ${providers} where ${asText(providers.id)} = ${asText(table.providerId)})`
  ) as SQL;
}

/** The columns an origin is read from, on either table that keeps them. */
interface OriginColumns {
  providerId: Column;
  providerOrigin: Column;
}

/**
 * The condition for records whose provider reads as `origin`. The id is
 * compared as text on PostgreSQL, where the queue keeps it as text and the
 * providers as a uuid.
 */
export function originCondition(
  table: OriginColumns,
  origin: FilterableOrigin,
  dialect: string,
  present: boolean
): SQL {
  const { providerId, providerOrigin } = table;
  // Without the providers table no provider row exists: nothing is stored,
  // and every recorded stored provider has been deleted since.
  if (!present) {
    if (origin === "stored") return sql`1 = 0`;
    if (origin === "code") return eq(providerOrigin, "code");
    return or(eq(providerOrigin, "stored"), isNotNull(providerId)) as SQL;
  }
  const exists = providerExists(table, dialect, present);
  if (origin === "stored") return exists;
  if (origin === "code") return eq(providerOrigin, "code");
  return and(
    not(exists),
    or(eq(providerOrigin, "stored"), isNotNull(providerId))
  ) as SQL;
}
