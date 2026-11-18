/**
 * Where the provider that carried an email came from, as the Activity shows
 * it and filters by it.
 *
 * - `stored`: a provider row that still exists, named by its id.
 * - `code`: the site's configured provider, which has no row.
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
  inArray,
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
 * written with, if any, and `stored` the provider ids that exist.
 */
export function providerRead(
  type: string,
  providerId: string | null,
  recorded: string | null,
  stored: ReadonlySet<string>
): ProviderRead {
  const exists = providerId !== null && stored.has(providerId);
  const origin: ProviderOrigin = exists
    ? "stored"
    : recorded === "code"
      ? "code"
      : recorded === "stored" || providerId !== null
        ? "deleted"
        : "not-recorded";
  return { id: exists ? providerId : null, type, origin };
}

/** The Drizzle surface reading which providers exist needs. */
interface ProvidersDb {
  select(fields: Record<string, unknown>): {
    from(table: unknown): { where(condition: unknown): PromiseLike<unknown[]> };
  };
}

/** Which of `ids` name a provider row that exists now. */
export async function storedProviderIds(
  db: ProvidersDb,
  dialect: string,
  ids: readonly (string | null)[]
): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Set();
  const providers = loadedDialect(dialect).tables.emailProviders;
  const rows = (await db
    .select({ id: providers.id })
    .from(providers)
    .where(inArray(providers.id, wanted))) as Array<{ id: string }>;
  return new Set(rows.map(row => String(row.id)));
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
  dialect: string
): SQL {
  const providers = loadedDialect(dialect).tables.emailProviders;
  const { providerId, providerOrigin } = table;
  const asText = (value: SQL | Column) =>
    dialect === "postgresql" ? sql`${value}::text` : sql`${value}`;
  const exists = and(
    isNotNull(providerId),
    sql`exists (select 1 from ${providers} where ${asText(providers.id)} = ${asText(providerId)})`
  ) as SQL;
  if (origin === "stored") return exists;
  if (origin === "code") return eq(providerOrigin, "code");
  return and(
    not(exists),
    or(eq(providerOrigin, "stored"), isNotNull(providerId))
  ) as SQL;
}
