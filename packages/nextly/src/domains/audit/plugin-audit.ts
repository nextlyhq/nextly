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
// The credential shapes a metadata value is refused for are the ones every
// log writer takes out of what it writes: one list, so the trail and the logs
// agree on what a credential looks like. A retained row is the wrong place
// for any of them.
import { looksLikeSecret } from "../../observability/credential-shapes";
import { getNextlyLogger } from "../../observability/logger";
import { principalRefOf } from "../../plugins/principals/ref";
import { getPrincipalKind } from "../../plugins/principals/registry";
import type { PrincipalRef } from "../../plugins/principals/types";

/** One audit event a plugin asks to record. */
export interface PluginAuditEvent {
  kind: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  /** A plugin-defined person who acted, never in `actorUserId`. */
  actorPrincipal?: PrincipalRef | null;
  /** A plugin-defined person the event is about, never in `targetUserId`. */
  targetPrincipal?: PrincipalRef | null;
  request?: Request;
  metadata?: Record<string, string | number | boolean>;
}

/** A metadata string longer than this is truncated away rather than stored. */
const MAX_VALUE_LENGTH = 256;

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

  const people = projectPeople(event, pluginName);
  if (!people) return null;

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
    actorPrincipal: people.actor,
    targetPrincipal: people.target,
    request: event.request,
    metadata,
  };
}

/**
 * The people an event names, by kind and id only, or null to drop the event.
 *
 * Dropped rather than written without them: a row that lost the person it
 * names is a record about nobody, and one naming both a staff user and a
 * person in one role says two different things about who acted. Logged, as an
 * undeclared kind is, since the write is a side effect of what the plugin was
 * really doing.
 */
function projectPeople(
  event: PluginAuditEvent,
  pluginName: string
): { actor: PrincipalRef | null; target: PrincipalRef | null } | null {
  const refuse = (role: "actor" | "target", reason: string): null => {
    getNextlyLogger().warn({
      kind: "plugin-audit-person-refused",
      plugin: pluginName,
      auditKind: event.kind,
      role,
      reason,
    });
    return null;
  };
  const actor = personInRole(event.actorPrincipal, event.actorUserId);
  if (typeof actor === "string") return refuse("actor", actor);
  const target = personInRole(event.targetPrincipal, event.targetUserId);
  if (typeof target === "string") return refuse("target", target);
  return { actor, target };
}

/**
 * The person one role names: their kind and id, null for none, or why the
 * value cannot stand there.
 */
function personInRole(
  value: unknown,
  userId: string | null | undefined
):
  | PrincipalRef
  | null
  | "not-a-person"
  | "kind-not-registered"
  | "names-a-user-too" {
  if (value === undefined || value === null) return null;
  const ref = principalRefOf(value);
  if (!ref) return "not-a-person";
  // A kind no running plugin registers, a misspelling most likely, is one no
  // deletion report can name: `reportDeleted` takes only the reporting
  // plugin's own kinds. A row kept under it would outlive the person it is
  // about, so the event is dropped as one naming nobody is.
  if (!getPrincipalKind(ref.kind)) return "kind-not-registered";
  return userId === undefined || userId === null ? ref : "names-a-user-too";
}
