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

/**
 * Whether a record's provider row exists now: selected with the record, and
 * the test the origin filter makes. The id is compared as text on
 * PostgreSQL, where the queue keeps it as text and the providers as a uuid.
 */
export function providerExists(table: OriginColumns, dialect: string): SQL {
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
  dialect: string
): SQL {
  const { providerId, providerOrigin } = table;
  const exists = providerExists(table, dialect);
  if (origin === "stored") return exists;
  if (origin === "code") return eq(providerOrigin, "code");
  return and(
    not(exists),
    or(eq(providerOrigin, "stored"), isNotNull(providerId))
  ) as SQL;
}
