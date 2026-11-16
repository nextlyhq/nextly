/**
 * How much content the site holds, for the diagnostics report: how many
 * collections, Singles and users, and the site's language codes.
 *
 * Only numbers and language codes leave here. The registries are asked for
 * their lists and only the lengths are kept; the users table is counted in
 * the database, and no row is read.
 *
 * Each count is read on its own: one that fails is `null`, and the report
 * says "unknown" for it while the others still answer.
 *
 * @module domains/health/content-counts
 */

import { count } from "drizzle-orm";

import { loadedDialect } from "../../database/dialect-tables";
import { container } from "../../di/container";
import { NextlyError } from "../../errors/nextly-error";
import { appLocalization } from "../i18n/configured-locales";

import type { ContentCounts } from "./diagnostics-report";

/** The select chain this read makes, in the form all three dialects share. */
interface CountDb {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => Promise<Record<string, unknown>[]>;
  };
}

/** What `read` answered, or `null` when it failed. */
async function orNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/** How many items a registry lists, by its own list call. */
async function registryLength(
  service: string,
  list: "getAllCollections" | "getAllSingles"
): Promise<number> {
  const registry =
    container.get<Partial<Record<typeof list, () => Promise<unknown[]>>>>(
      service
    );
  const read = registry[list];
  if (read === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "registry-cannot-list", service },
    });
  }
  return (await read.call(registry)).length;
}

/** How many users the database holds, counted there. */
async function userCount(
  db: unknown,
  dialect: "postgresql" | "mysql" | "sqlite"
): Promise<number> {
  const { users } = loadedDialect(dialect).tables;
  const [row] = await (db as CountDb).select({ n: count() }).from(users);
  // count() answers a string or a bigint on some drivers.
  const n = Number(row?.n);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw NextlyError.internal({
      logContext: { reason: "user-count-not-whole" },
    });
  }
  return n;
}

/** The site's language codes; none with localization off. */
function localeCodes(): string[] {
  const localization = appLocalization();
  return localization === undefined
    ? []
    : localization.locales.map(locale => locale.code);
}

/** How much content the site holds, through the database `db` reaches. */
export async function readContentCounts(
  db: unknown,
  dialect: "postgresql" | "mysql" | "sqlite"
): Promise<ContentCounts> {
  const [collections, singles, users, locales] = await Promise.all([
    orNull(() =>
      registryLength("collectionRegistryService", "getAllCollections")
    ),
    orNull(() => registryLength("singleRegistryService", "getAllSingles")),
    orNull(() => userCount(db, dialect)),
    orNull(() => Promise.resolve(localeCodes())),
  ]);
  return { collections, singles, users, locales };
}
