/**
 * Webhook domain — the stored signing-secret entry shape and its lifecycle.
 *
 * `secret.ts` owns the crypto (generate, encrypt, decrypt, display prefix). This
 * module owns the SHAPE of what a `nextly_webhooks.secret_hash` cell holds and
 * the rules for a rotation with an overlap window.
 *
 * The column is a JSON array so rotation is additive without a migration. It
 * started life as an array of bare ciphertext strings; this module widens each
 * entry to carry its display prefix and lifecycle timestamps, and reads the old
 * bare-string form back transparently so existing endpoints keep signing without
 * a data migration.
 *
 * A secret with `expiresAt === null` is the live primary — the one new
 * deliveries are prefixed by and the one a reveal reports first. A rotation
 * stamps the previous primary with an `expiresAt` in the future (the overlap
 * window) so a receiver that has not yet switched still verifies; once that
 * passes the entry is no longer live and is pruned on the next write.
 *
 * @module domains/webhooks/secret-entries
 */

import { encryptWebhookSecret, webhookSecretPrefix } from "./secret";

/**
 * One stored signing secret. `ciphertext` is the AES-GCM value `secret.ts`
 * produces; `prefix` is the display-only fragment shown in the admin so an
 * operator can tell secrets apart during a rotation; `createdAt`/`expiresAt` are
 * ISO-8601 instants. `expiresAt === null` marks the live primary.
 */
export interface StoredSecretEntry {
  ciphertext: string;
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
}

/** No overlap: the previous secret is retired immediately on rotation. */
export const WEBHOOK_ROTATION_MIN_OVERLAP_SECONDS = 0;

/**
 * The longest overlap a rotation may request. A month is generous slack for a
 * receiver to redeploy with the new secret; beyond it the old key is a standing
 * liability rather than a migration aid.
 */
export const WEBHOOK_ROTATION_MAX_OVERLAP_SECONDS = 30 * 24 * 60 * 60;

/**
 * The default overlap when a rotation does not name one: two days, enough to
 * span a weekend deploy freeze without keeping the old key alive for a week.
 */
export const WEBHOOK_ROTATION_DEFAULT_OVERLAP_SECONDS = 48 * 60 * 60;

/** Whether an entry is still usable for signing at `now`. */
export function isSecretEntryLive(
  entry: StoredSecretEntry,
  now: Date
): boolean {
  if (entry.expiresAt === null) return true;
  const expiresMs = Date.parse(entry.expiresAt);
  // A malformed expiry cannot be trusted to be in the future, so treat it as
  // expired rather than let an unparseable value keep a secret alive forever.
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs > now.getTime();
}

/**
 * Build a fresh primary entry from a plaintext secret. `expiresAt` defaults to
 * null (a primary); a rotation passes a future instant to make it an
 * overlapping, soon-to-retire secret instead.
 */
export function newSecretEntry(
  secret: string,
  now: Date,
  expiresAt: string | null = null
): StoredSecretEntry {
  return {
    ciphertext: encryptWebhookSecret(secret),
    prefix: webhookSecretPrefix(secret),
    createdAt: now.toISOString(),
    expiresAt,
  };
}

/** A stored value read as one entry, or null when it is unusable. */
function coerceEntry(
  value: unknown,
  fallback: { prefix: string; createdAt: string }
): StoredSecretEntry | null {
  // Legacy form: a bare ciphertext string. It is the single primary the
  // endpoint was created with, so it inherits the row's display prefix and
  // creation time and never auto-expires.
  if (typeof value === "string") {
    if (value.length === 0) return null;
    return {
      ciphertext: value,
      prefix: fallback.prefix,
      createdAt: fallback.createdAt,
      expiresAt: null,
    };
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.ciphertext !== "string" || record.ciphertext.length === 0) {
    return null;
  }
  return {
    ciphertext: record.ciphertext,
    prefix: typeof record.prefix === "string" ? record.prefix : fallback.prefix,
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : fallback.createdAt,
    expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : null,
  };
}

/**
 * Read a stored `secret_hash` cell into entries, tolerating both the current
 * object form and the legacy bare-string form. `fallback` supplies the prefix
 * and creation time a legacy entry lacks (the row's own `secret_prefix` and
 * `created_at`). A non-array or fully-malformed cell reads as no entries.
 */
export function normalizeSecretEntries(
  stored: unknown,
  fallback: { prefix: string; createdAt: string }
): StoredSecretEntry[] {
  if (!Array.isArray(stored)) return [];
  const entries: StoredSecretEntry[] = [];
  for (const value of stored) {
    const entry = coerceEntry(value, fallback);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * The entries still usable at `now`, primary first. Ordering matters: the
 * signing path prefixes with the first secret, and a reveal reports it as the
 * current one, so the never-expiring primary is always placed ahead of the
 * overlapping secrets (themselves ordered soonest-to-expire last).
 */
export function liveSecretEntries(
  entries: StoredSecretEntry[],
  now: Date
): StoredSecretEntry[] {
  const live = entries.filter(entry => isSecretEntryLive(entry, now));
  const primary = live.filter(entry => entry.expiresAt === null);
  const overlapping = live
    .filter(entry => entry.expiresAt !== null)
    .sort((a, b) => Date.parse(b.expiresAt!) - Date.parse(a.expiresAt!));
  return [...primary, ...overlapping];
}
