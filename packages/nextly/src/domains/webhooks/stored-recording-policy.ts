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

import { dynamicCollectionsMysql } from "../../schemas/dynamic-collections/mysql";
import { dynamicCollectionsPg } from "../../schemas/dynamic-collections/postgres";
import { dynamicCollectionsSqlite } from "../../schemas/dynamic-collections/sqlite";
import type { StoredWebhookRecording } from "../../schemas/dynamic-collections/types";
import { dynamicSinglesMysql } from "../../schemas/dynamic-singles/mysql";
import { dynamicSinglesPg } from "../../schemas/dynamic-singles/postgres";
import { dynamicSinglesSqlite } from "../../schemas/dynamic-singles/sqlite";

import { applyStoredRecordingDecisions } from "./recording-policy";
import type { WebhookRecordingScope } from "./recording-policy";

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
function isMissingWebhooksColumn(error: unknown): boolean {
  // Drizzle wraps driver failures, so the recognizable text is on the cause, not
  // the wrapper ("Failed query: ..."). Both are searched, mirroring
  // `isMissingCompanionTableError`. Matching only the missing-COLUMN wordings
  // keeps a missing table — a genuinely broken registry — on the fail-closed
  // path: SQLite says `no such column`, Postgres `column "x" does not exist`,
  // MySQL `Unknown column`.
  const message = [
    error instanceof Error ? error.message : String(error),
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "",
  ].join(" ");
  return (
    /no such column/i.test(message) ||
    /unknown column/i.test(message) ||
    (/column/i.test(message) && /does not exist/i.test(message))
  );
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
    if (row.source === "code" || configSlugs.has(slug)) continue;
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
 * Fails open ONLY for a database predating the `webhooks` column, where there is
 * nothing to read and recording everything is the correct previous behavior.
 * Every other read failure is rethrown: a transient error is indistinguishable
 * from "no opt-outs" here, and booting on regardless would deliver exactly the
 * content an operator asked to withhold.
 */
export async function publishStoredWebhookRecordingPolicies(
  adapter: RecordingPolicyReader,
  configSlugs: ConfigOwnedSlugs
): Promise<void> {
  const dialect = adapter.getCapabilities().dialect;
  const db = adapter.getDrizzle<PolicyQuery>();

  try {
    // Both scopes are read BEFORE anything is applied, so a failure part-way
    // through cannot leave the policy holding half of one snapshot and half of
    // the previous one.
    const optOuts = [
      ...(await collectScope(
        db,
        "collection",
        collectionsTable(dialect),
        configSlugs.collections
      )),
      ...(await collectScope(
        db,
        "single",
        singlesTable(dialect),
        configSlugs.singles
      )),
    ];
    applyStoredRecordingDecisions(optOuts);
  } catch (error) {
    if (isMissingWebhooksColumn(error)) return;
    throw error;
  }
}
