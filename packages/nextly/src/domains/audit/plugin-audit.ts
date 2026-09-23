/**
 * Letting a plugin write to the audit trail, without letting it write anything.
 *
 * A plugin that authenticates people, links identities or revokes access has
 * things worth recording, and the alternative to this is each one keeping its
 * own log that no audit view can read. But the trail is also the one place
 * where what is stored has to be bounded: rows are retained, some carry no
 * actor and so can never be found by a later deletion, and a plugin is
 * arbitrary code.
 *
 * So a plugin declares the kinds it writes and the metadata keys each may
 * carry, and this drops anything it did not declare. The allowlist per kind is
 * DERIVED from that declaration rather than maintained beside it, so the two
 * cannot drift.
 *
 * @module domains/audit/plugin-audit
 * @since 1.0.0
 */
import { getTableColumns } from "drizzle-orm";

import { getNextlyLogger } from "../../observability/logger";
import { resolutionError } from "../../plugins/resolution-error";
import { auditLog as postgresAuditLog } from "../../schemas/audit/postgres";

/** What a plugin says it will write. */
export interface PluginAuditKind {
  kind: string;
  metadataKeys?: string[];
}

/** One audit event a plugin asks to record. */
export interface PluginAuditEvent {
  kind: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  request?: Request;
  metadata?: Record<string, string | number | boolean>;
}

/** A metadata string longer than this is truncated away rather than stored. */
const MAX_VALUE_LENGTH = 256;

/**
 * The longest kind the trail's own column can hold, read from the table
 * definition rather than restated beside it.
 *
 * Postgres and MySQL declare `kind` as a bounded varchar; SQLite declares
 * text, which holds anything, so the bounded declaration is the one that
 * decides. A kind longer than it is a declaration whose every write fails at
 * the column — and audit writes are fail-safe by design, so the failure is a
 * log line nobody reads and the security event the plugin promised to record
 * simply never exists.
 */
const KIND_COLUMN_MAX = (() => {
  const kind: unknown = getTableColumns(postgresAuditLog).kind;
  const length = (kind as { length?: unknown }).length;
  return typeof length === "number" ? length : Number.MAX_SAFE_INTEGER;
})();

/** A JWT, which is three base64url segments separated by dots. */
const JWT_SHAPE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;

/**
 * Whether a value looks like a credential rather than a fact.
 *
 * Not a general secret detector, and not trying to be: it catches the two
 * shapes that actually end up in a plugin's metadata by accident — the token
 * it just exchanged, and a webhook signing secret. A retained row is the wrong
 * place for either, and neither is what the event is about.
 */
export function looksLikeSecret(value: string): boolean {
  return JWT_SHAPE.test(value) || value.startsWith("whsec_");
}

/**
 * Whether a metadata value is one the row can actually hold.
 *
 * The contribution contract says string, number or boolean, and everything
 * downstream — the secret shapes, the length bound, the column itself — is
 * written for those. A non-finite number is refused with them: `NaN` and the
 * infinities have no JSON form, so one would be stored as `null` and read back
 * as a fact nobody recorded.
 */
function isStorableValue(value: unknown): value is string | number | boolean {
  if (typeof value === "string" || typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Every kind a plugin may write, and the keys each kind may carry.
 *
 * A kind must start with the plugin's own prefix, so one plugin cannot write
 * rows that read as another's — or as core's.
 *
 * A mis-prefixed kind is REFUSED, not dropped. Dropping it let the application
 * boot with `ctx.audit` present and the declaration apparently accepted, while
 * every write of that kind was discarded at runtime behind a warning nobody
 * reads — so the operator has no trail for exactly the security event the
 * manifest said would be recorded, and nothing before the incident says so. A
 * misspelled prefix is a configuration error like an incompatible version, and
 * it is only observable here. Same treatment, and the same reason, as a hook
 * point declared outside its plugin's prefix.
 */
export function collectPluginAuditKinds(
  pluginSlug: string,
  declared: readonly PluginAuditKind[],
  pluginName: string = pluginSlug
): Map<string, Set<string>> {
  const kinds = new Map<string, Set<string>>();
  for (const entry of declared) {
    if (!entry.kind.startsWith(`${pluginSlug}.`)) {
      throw resolutionError(
        "plugin-audit-kind-outside-prefix",
        `Plugin "${pluginName}" declares the audit kind "${entry.kind}", which must start with "${pluginSlug}.".`,
        {
          plugin: pluginName,
          auditKind: entry.kind,
          expectedPrefix: pluginSlug,
        }
      );
    }
    // A kind the column cannot hold is refused here, at the same place the
    // prefix is, and for the same reason: this is the only point where the
    // declaration is observable before it silently stops recording.
    if (entry.kind.length > KIND_COLUMN_MAX) {
      throw resolutionError(
        "plugin-audit-kind-too-long",
        `Plugin "${pluginName}" declares the audit kind "${entry.kind}", which is longer than the ${KIND_COLUMN_MAX} characters the audit trail's kind column holds.`,
        {
          plugin: pluginName,
          auditKind: entry.kind,
          maxLength: KIND_COLUMN_MAX,
        }
      );
    }
    kinds.set(entry.kind, new Set(entry.metadataKeys ?? []));
  }
  return kinds;
}

/**
 * One metadata value, or `undefined` when the row must not carry it.
 *
 * Three refusals, in the order their cost justifies. The TYPE first, because
 * everything after it reads strings: an object or array slipped past all of
 * them, so a nested access token was retained without ever meeting
 * `looksLikeSecret` or the length bound, and a cyclic value made the writer
 * drop the whole security event. A plugin is arbitrary code and a JavaScript
 * one has no types at all, so the contract is checked rather than assumed.
 *
 * Its own function so the projection stays a walk over declared keys rather
 * than also being the policy for each one.
 */
function storableMetadataValue(
  value: unknown,
  at: { plugin: string; auditKind: string; metadataKey: string }
): string | number | boolean | undefined {
  if (!isStorableValue(value)) {
    getNextlyLogger().warn({
      kind: "plugin-audit-metadata-type-dropped",
      ...at,
    });
    return undefined;
  }
  if (typeof value !== "string") return value;
  if (value.length > MAX_VALUE_LENGTH) return undefined;
  if (looksLikeSecret(value)) {
    getNextlyLogger().warn({ kind: "plugin-audit-secret-dropped", ...at });
    return undefined;
  }
  return value;
}

/**
 * Reduce an event to what its declaration allows, or null to drop it.
 *
 * Returning the projection rather than writing it keeps the decision testable
 * without a database, and keeps the one thing that touches SQL out of the
 * policy.
 */
export function projectPluginAuditEvent(
  event: PluginAuditEvent,
  kinds: Map<string, Set<string>>,
  pluginName: string
): PluginAuditEvent | null {
  const allowedKeys = kinds.get(event.kind);
  if (!allowedKeys) {
    // Logged rather than thrown: a plugin's audit write is a side effect of
    // whatever it was really doing, and failing that operation because its
    // logging was misdeclared would be worse than the missing row.
    getNextlyLogger().warn({
      kind: "plugin-audit-undeclared-kind",
      plugin: pluginName,
      auditKind: event.kind,
    });
    return null;
  }

  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(event.metadata ?? {})) {
    if (!allowedKeys.has(key)) continue;
    const kept = storableMetadataValue(value, {
      plugin: pluginName,
      auditKind: event.kind,
      metadataKey: key,
    });
    if (kept !== undefined) metadata[key] = kept;
  }

  return {
    kind: event.kind,
    actorUserId: event.actorUserId ?? null,
    targetUserId: event.targetUserId ?? null,
    request: event.request,
    metadata,
  };
}
