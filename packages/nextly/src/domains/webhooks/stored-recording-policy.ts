/**
 * Webhook domain — publishing registry-stored recording decisions at boot.
 *
 * A Builder-authored collection or single has no code-first config, so its
 * recording opt-out exists only on the registry's `webhooks` column. This reads
 * those rows once at boot and publishes them into the process-level policy that
 * the outbox choke point already consults.
 *
 * Precedence: a `source: 'code'` row MIRRORS the live config, which the config
 * publisher has already applied and which may be newer than the row. Such rows
 * are skipped, as is any slug the live config still owns, so code always
 * outranks storage.
 *
 * @module domains/webhooks/stored-recording-policy
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { isNotNull } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";

import { NextlyError } from "../../errors";
import { dynamicCollectionsMysql } from "../../schemas/dynamic-collections/mysql";
import { dynamicCollectionsPg } from "../../schemas/dynamic-collections/postgres";
import { dynamicCollectionsSqlite } from "../../schemas/dynamic-collections/sqlite";
import type { StoredWebhookRecording } from "../../schemas/dynamic-collections/types";
import { dynamicSinglesMysql } from "../../schemas/dynamic-singles/mysql";
import { dynamicSinglesPg } from "../../schemas/dynamic-singles/postgres";
import { dynamicSinglesSqlite } from "../../schemas/dynamic-singles/sqlite";

import {
  applyStoredRecordingDecisions,
  currentRecordingGeneration,
  markStoredRecordingFresh,
} from "./recording-policy";
import type { WebhookRecordingScope } from "./recording-policy";
import { isConfigOwnedSource } from "./recording-provenance";

/** The three registry columns this read needs, on any dialect's table. */
interface PolicyTable {
  slug: AnyColumn;
  source: AnyColumn;
  webhooks: AnyColumn;
}

interface StoredPolicyRow {
  slug: string | null;
  source: string | null;
  webhooks: StoredWebhookRecording | string | null;
}

/**
 * The slice of the Drizzle query builder this uses. `getDrizzle` is generic so a
 * caller can name the surface it needs instead of depending on one dialect's
 * full builder type.
 */
interface PolicyQuery {
  select(fields: Record<string, AnyColumn>): {
    from(table: PolicyTable): {
      where(condition: SQL): Promise<StoredPolicyRow[]>;
    };
  };
}

/** The adapter surface this needs; narrow so tests can supply a stub. */
export interface RecordingPolicyReader {
  getDrizzle<T>(): T;
  getCapabilities(): { dialect: SupportedDialect };
}

/** Slugs the live code-first config owns, per scope. */
export interface ConfigOwnedSlugs {
  collections: Set<string>;
  singles: Set<string>;
}

/**
 * A registry table lacking the `webhooks` column — what a database upgraded but
 * not yet migrated looks like. The column is additive, so this one case may fail
 * open (keep recording, the previous behavior); no other failure may be mistaken
 * for it. Matches the classification `loadDynamicTables` already applies to the
 * same registry tables.
 */
function isPreMigrationRegistry(error: unknown): boolean {
  // Drizzle wraps driver failures, so the recognizable text is on the cause, not
  // the wrapper ("Failed query: ..."). Both are searched, mirroring
  // `isMissingCompanionTableError`.
  const message = [
    error instanceof Error ? error.message : String(error),
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "",
  ].join(" ");

  const missingColumn =
    /no such column/i.test(message) ||
    /unknown column/i.test(message) ||
    (/column/i.test(message) && /does not exist/i.test(message));
  if (missingColumn) {
    // Only a missing `webhooks` is the tolerated upgrade case. A damaged
    // registry missing some OTHER selected column produces the same generic
    // wording, and treating that as "nothing stored" would silently drop every
    // opt-out instead of surfacing the broken schema.
    return /webhooks/i.test(message);
  }

  const missingTable =
    /no such table/i.test(message) ||
    /doesn't exist/i.test(message) ||
    (/relation/i.test(message) && /does not exist/i.test(message));
  // A missing registry table means there are no entities at all, so there are no
  // opt-outs to lose and recording everything is correct. Tolerating it also
  // keeps the deliberately failure-safe first-run path intact: when
  // `initializeSchemaRegistry` swallows a provisioning failure so boot can reach
  // the recovery/migration path, this read must not turn that into a hard abort.
  return missingTable && /dynamic_(collections|singles)/i.test(message);
}

/**
 * Whether a stored column value is an explicit opt-out. Tolerates both shapes
 * the dialects return — SQLite hands back raw JSON text while Postgres and MySQL
 * parse it — and treats a malformed value as "no opt-out" rather than throwing
 * during boot.
 */
function isStoredOptOut(value: StoredPolicyRow["webhooks"]): boolean {
  if (value === null || value === undefined) return false;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return false;
    }
  }
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { record?: unknown }).record === false
  );
}

function collectionsTable(dialect: SupportedDialect): PolicyTable {
  switch (dialect) {
    case "mysql":
      return dynamicCollectionsMysql;
    case "sqlite":
      return dynamicCollectionsSqlite;
    case "postgresql":
      return dynamicCollectionsPg;
  }
}

function singlesTable(dialect: SupportedDialect): PolicyTable {
  switch (dialect) {
    case "mysql":
      return dynamicSinglesMysql;
    case "sqlite":
      return dynamicSinglesSqlite;
    case "postgresql":
      return dynamicSinglesPg;
  }
}

async function collectScope(
  db: PolicyQuery,
  scope: WebhookRecordingScope,
  table: PolicyTable,
  configSlugs: Set<string>
): Promise<Array<{ scope: WebhookRecordingScope; slug: string }>> {
  // Three named columns rather than a full select, so this read stays
  // independent of every other column the registry may gain. Only rows carrying
  // an override are fetched: recording is the default, so a null column has
  // nothing to publish.
  const rows = await db
    .select({
      slug: table.slug,
      source: table.source,
      webhooks: table.webhooks,
    })
    .from(table)
    .where(isNotNull(table.webhooks));

  const optOuts: Array<{ scope: WebhookRecordingScope; slug: string }> = [];
  for (const row of rows) {
    const slug = row.slug;
    if (!slug) continue;
    // Config-owned rows (`code` and `plugin:<name>`) are skipped: the config
    // publisher already applied them, and republishing as `db` would let the
    // next refresh — which replaces the whole `db` set — drop a decision config
    // owns, including the form-builder's submissions opt-out.
    if (isConfigOwnedSource(row.source) || configSlugs.has(slug)) continue;
    if (isStoredOptOut(row.webhooks)) optOuts.push({ scope, slug });
  }
  return optOuts;
}

/**
 * Publish every registry-stored opt-out that the code-first config does not
 * already own.
 *
 * Only opt-OUTs are published. An absent decision already defaults to recording,
 * so writing opt-ins would add nothing while risking the override of a code or
 * plugin decision that arrived first.
 *
 * Fails open ONLY where there is genuinely nothing to read: a database predating
 * the `webhooks` column, or a registry table that does not exist yet (no
 * entities, so no opt-outs). Every other read failure surfaces as a
 * `NextlyError`: a transient error is indistinguishable from "no opt-outs" here,
 * and booting on regardless would deliver exactly the content an operator asked
 * to withhold.
 */
export async function publishStoredWebhookRecordingPolicies(
  adapter: RecordingPolicyReader,
  configSlugs: ConfigOwnedSlugs
): Promise<void> {
  const dialect = adapter.getCapabilities().dialect;
  const db = adapter.getDrizzle<PolicyQuery>();

  // Captured BEFORE reading so a local toggle that lands mid-read discards this
  // snapshot rather than being erased by it.
  const generation = currentRecordingGeneration();

  // Each scope tolerates its own missing column. An upgrade interrupted between
  // the two ALTERs — plausible on MySQL, where DDL auto-commits — would
  // otherwise let the un-migrated table's failure discard the opt-outs already
  // read from the migrated one, silently re-enabling recording for them.
  const collections = await collectScopeTolerantly(
    db,
    "collection",
    collectionsTable(dialect),
    configSlugs.collections
  );
  const singles = await collectScopeTolerantly(
    db,
    "single",
    singlesTable(dialect),
    configSlugs.singles
  );

  if (collections === null && singles === null) {
    // Neither table has the column: nothing to apply, but the snapshot is as
    // current as it can be. Marking it fresh stops every later write scheduling
    // another failing query until the migration runs.
    markStoredRecordingFresh();
    return;
  }

  applyStoredRecordingDecisions(
    [...(collections ?? []), ...(singles ?? [])],
    generation
  );
}

/**
 * Read one scope, or `null` when that table predates the `webhooks` column.
 * Every other failure propagates so a transient error cannot masquerade as an
 * empty policy.
 */
async function collectScopeTolerantly(
  db: PolicyQuery,
  scope: WebhookRecordingScope,
  table: PolicyTable,
  configSlugs: Set<string>
): Promise<Array<{ scope: WebhookRecordingScope; slug: string }> | null> {
  try {
    return await collectScope(db, scope, table, configSlugs);
  } catch (error) {
    if (isPreMigrationRegistry(error)) return null;
    // Anything else is a real failure that must not be mistaken for "no
    // opt-outs". Normalized to the canonical error type, preserving the driver
    // error as the cause so the classification is not lost.
    throw NextlyError.internal({
      cause: error instanceof Error ? error : undefined,
      logContext: {
        reason: "webhook-recording-policy-read-failed",
        scope,
        // Preserved for the non-Error case, which `cause` cannot carry.
        detail: error instanceof Error ? undefined : String(error),
      },
    });
  }
}
