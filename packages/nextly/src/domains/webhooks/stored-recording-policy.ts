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

import { setWebhookRecording } from "./recording-policy";
import type { WebhookRecordingScope } from "./recording-policy";

/** The minimal adapter surface this needs; narrow so tests can fake it. */
interface RecordingPolicyReader {
  executeQuery<T>(sql: string): Promise<T[]>;
}

/** Slugs the live code-first config owns, per scope. */
export interface ConfigOwnedSlugs {
  collections: Set<string>;
  singles: Set<string>;
}

interface StoredPolicyRow {
  slug?: string | null;
  source?: string | null;
  webhooks?: string | Record<string, unknown> | null;
}

/**
 * Whether a stored column value is an explicit opt-out. Tolerates both shapes
 * the dialects return — SQLite hands back raw JSON text while Postgres and
 * MySQL parse it — and treats a malformed value as "no opt-out" rather than
 * throwing during boot.
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

async function publishScope(
  adapter: RecordingPolicyReader,
  scope: WebhookRecordingScope,
  table: string,
  configSlugs: Set<string>
): Promise<void> {
  // Raw select rather than a typed Drizzle query: this has to run against a
  // database that may predate the column, where a typed select throws and boot
  // must continue. `loadDynamicTables` reads the same registry the same way for
  // the same reason.
  const rows = await adapter.executeQuery<StoredPolicyRow>(
    `SELECT slug, source, webhooks FROM ${table}`
  );
  for (const row of rows) {
    const slug = row.slug;
    if (!slug) continue;
    if (row.source === "code" || configSlugs.has(slug)) continue;
    if (isStoredOptOut(row.webhooks)) {
      setWebhookRecording(scope, slug, false, "db");
    }
  }
}

/**
 * Publish every registry-stored opt-out that the code-first config does not
 * already own.
 *
 * Only opt-OUTs are published. An absent decision already defaults to
 * recording, so writing opt-ins would add nothing while risking the override of
 * a code or plugin decision that arrived first.
 *
 * Never throws. A database not migrated since upgrading has no `webhooks`
 * column, and refusing to boot over an additive column would be a worse failure
 * than continuing with the previous behavior of recording everything.
 */
export async function publishStoredWebhookRecordingPolicies(
  adapter: RecordingPolicyReader,
  configSlugs: ConfigOwnedSlugs
): Promise<void> {
  try {
    await publishScope(
      adapter,
      "collection",
      "dynamic_collections",
      configSlugs.collections
    );
  } catch {
    // Missing column or unreadable registry: keep the recording default.
  }
  try {
    await publishScope(
      adapter,
      "single",
      "dynamic_singles",
      configSlugs.singles
    );
  } catch {
    // Caught separately so an unreadable singles registry cannot discard the
    // collection opt-outs published above.
  }
}
