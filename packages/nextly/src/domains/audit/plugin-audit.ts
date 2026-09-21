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
import { getNextlyLogger } from "../../observability/logger";

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
 * Every kind a plugin may write, and the keys each kind may carry.
 *
 * A kind must start with the plugin's own prefix, so one plugin cannot write
 * rows that read as another's — or as core's.
 */
export function collectPluginAuditKinds(
  pluginSlug: string,
  declared: readonly PluginAuditKind[]
): Map<string, Set<string>> {
  const kinds = new Map<string, Set<string>>();
  for (const entry of declared) {
    if (!entry.kind.startsWith(`${pluginSlug}.`)) continue;
    kinds.set(entry.kind, new Set(entry.metadataKeys ?? []));
  }
  return kinds;
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
    if (typeof value === "string") {
      if (value.length > MAX_VALUE_LENGTH) continue;
      if (looksLikeSecret(value)) {
        getNextlyLogger().warn({
          kind: "plugin-audit-secret-dropped",
          plugin: pluginName,
          auditKind: event.kind,
          metadataKey: key,
        });
        continue;
      }
    }
    metadata[key] = value;
  }

  return {
    kind: event.kind,
    actorUserId: event.actorUserId ?? null,
    targetUserId: event.targetUserId ?? null,
    request: event.request,
    metadata,
  };
}
