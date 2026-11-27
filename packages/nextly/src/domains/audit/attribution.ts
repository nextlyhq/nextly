/**
 * Who stands behind a caller, beyond the caller itself: an agent and the
 * person it acted for, the door the call came through, the credential by id,
 * an approval, a standing grant, an undo, or a deployment.
 *
 * One mapping for every trail that records it. The activity log and the audit
 * log both store these facts in the same columns, and both take them from
 * `attributionColumns`, so the two can never disagree about what a door or an
 * approval is stored as.
 *
 * The person an agent acted for is NOT stored here: it is the row's own actor
 * (`activity_log.user_id`, `audit_log.actor_user_id`), so erasing that person
 * erases them from these rows exactly as it erases a staff user's own rows,
 * while the agent's name, which is not personal data, stays.
 *
 * @module domains/audit/attribution
 */

import { looksLikeSecret } from "../../observability/credential-shapes";
import { getNextlyLogger } from "../../observability/logger";
import { ATTRIBUTION_NAME_LENGTH } from "../../schemas/audit/widths";

/**
 * The ways a call reaches a site, as a row records them.
 *
 * - `local`: the CLI on the person's own machine, straight to the database;
 * - `command`: the site's command door, with a CLI sign-in or an agent pass;
 * - `chat-app`: the chat-app door, with a chat app's connection;
 * - `rest-key`: the REST API, with a key an admin marked as an agent's;
 * - `deploy`: a deploy pipeline running the CLI against the live database.
 */
const ATTRIBUTION_DOORS = [
  "local",
  "command",
  "chat-app",
  "rest-key",
  "deploy",
] as const;

export type AttributionDoor = (typeof ATTRIBUTION_DOORS)[number];

/** Where a person said yes to an approval request. */
const APPROVAL_PLACES = ["phone", "browser", "admin"] as const;

export type ApprovalPlace = (typeof APPROVAL_PLACES)[number];

/**
 * The deployment that ran a command: a pipeline, named by its host and the
 * commit it built (`null` when the host gave none), or a person's own machine
 * running against a live database, named by the machine.
 */
export type DeploymentAttribution =
  | { pipeline: string; commit: string | null }
  | { machine: string };

/**
 * Everything a caller can say about who stands behind it. Every part is
 * optional: a staff user in the admin carries none of it.
 *
 * Ids only, never a secret. A pass, connection or key is named by its own id;
 * the value that authenticates it never reaches a row.
 */
export interface ActorAttribution {
  /** How the call arrived. Implied by `deployment` when that is given. */
  door?: AttributionDoor;
  /** The agent that acted, for the row's own actor. */
  agent?: {
    /** The agent's name as its pass, connection or key names it: "Claude Code". */
    name: string;
    /** The agent session the call belongs to. */
    sessionId?: string;
  };
  /** The pass, chat-app connection or key the call used, by its own id. */
  credentialId?: string;
  /** The approval request this call ran under, and who said yes, where. */
  approval?: {
    requestId: string;
    /** The user who approved, by id. */
    approvedBy: string;
    via: ApprovalPlace;
  };
  /** The standing grant ("always allow") that let this call run unasked. */
  grantId?: string;
  /** The agent session this call puts back ("undo this agent's work"). */
  undoesSessionId?: string;
  /** The deployment that ran this call. */
  deployment?: DeploymentAttribution;
}

/** The stored form: one nullable column per fact, on both trails. */
export interface AttributionColumns {
  agentName: string | null;
  agentSessionId: string | null;
  door: AttributionDoor | null;
  credentialId: string | null;
  approvalRequestId: string | null;
  approvedByUserId: string | null;
  approvedVia: ApprovalPlace | null;
  grantId: string | null;
  undoesSessionId: string | null;
  deploymentHost: string | null;
  deploymentCommit: string | null;
}

/** The columns of a row nothing stands behind. */
export const EMPTY_ATTRIBUTION_COLUMNS: Readonly<AttributionColumns> =
  Object.freeze({
    agentName: null,
    agentSessionId: null,
    door: null,
    credentialId: null,
    approvalRequestId: null,
    approvedByUserId: null,
    approvedVia: null,
    grantId: null,
    undoesSessionId: null,
    deploymentHost: null,
    deploymentCommit: null,
  });

/**
 * An id as these columns accept one: a uuid, or a short id of letters, digits
 * and hyphens, at most 32 characters, which a key's own id (24 hex digits)
 * fits.
 *
 * It is the guard that keeps a secret off the row, so it is shaped by the
 * secrets rather than by the ids. A whole API key carries underscores
 * (`nx_live_<id>_<secret>`), a signed token carries dots, and an
 * authorization header's value carries a space. The secrets that use an id's
 * own alphabet are long: a reset, invite or CSRF token is 64 hex digits and a
 * key's secret 43 base64url characters, so a value past 32 characters is an
 * id only when it has a uuid's exact shape.
 */
const ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9-]{1,32})$/i;

/** A commit as a host reports one: 7 to 40 hexadecimal digits. */
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * The parts of one attribution refused so far, by field. Each reader below
 * stores what it accepts and records what it refuses here, so every part is
 * judged once and the caller hears about each refusal.
 */
type Refused = string[];

/**
 * Whether `value` is an id as the attribution columns store one. Exported so
 * a reader filtering by one (an agent session) refuses exactly what a writer
 * would never have stored.
 */
export function isAttributionId(value: unknown): value is string {
  // The shape first, then the repository's own catalogue of credential
  // shapes: a short token (`glpat-` and twenty characters) fits an id's
  // length and alphabet, and only its known shape tells it apart.
  return (
    typeof value === "string" && ID_PATTERN.test(value) && !looksLikeSecret(value)
  );
}

/**
 * An id as it is stored and matched: in lower case. MySQL compares these
 * columns without regard to case and PostgreSQL and SQLite do not, so one
 * spelling makes a filter answer the same rows on every database.
 */
export function storedId(value: string): string {
  return value.toLowerCase();
}

/**
 * A name as the attribution columns store one, trimmed, or `undefined` when
 * empty or too long to store. Exported so a reader filtering by an agent's
 * name matches it as it was stored.
 */
export function storedName(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed !== "" &&
    trimmed.length <= ATTRIBUTION_NAME_LENGTH &&
    !holdsControlCharacter(trimmed)
    ? trimmed
    : undefined;
}

/**
 * Whether `value` holds a control character, NUL among them: PostgreSQL
 * cannot store a NUL, so a name holding one would fail the write being
 * recorded, and no name a person reads holds one.
 */
function holdsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** An id-valued part: stored when it is an id, refused when given and not. */
function idOf(refused: Refused, field: string, value: unknown): string | null {
  if (value === undefined) return null;
  if (isAttributionId(value)) return storedId(value);
  refused.push(field);
  return null;
}

/** A display name, trimmed: refused when empty or too long to store. */
function nameOf(
  refused: Refused,
  field: string,
  value: unknown
): string | null {
  const name = storedName(value);
  if (name !== undefined) return name;
  refused.push(field);
  return null;
}

/** One of a fixed set of words: refused when given and not one of them. */
function wordOf<T extends string>(
  refused: Refused,
  field: string,
  values: readonly T[],
  value: unknown
): T | null {
  if (value === undefined) return null;
  if ((values as readonly unknown[]).includes(value)) return value as T;
  refused.push(field);
  return null;
}

function agentColumns(
  refused: Refused,
  agent: ActorAttribution["agent"]
): Partial<AttributionColumns> {
  if (!agent) return {};
  return {
    agentName: nameOf(refused, "agent.name", agent.name),
    agentSessionId: idOf(refused, "agent.sessionId", agent.sessionId),
  };
}

function approvalColumns(
  refused: Refused,
  approval: ActorAttribution["approval"]
): Partial<AttributionColumns> {
  if (!approval) return {};
  return {
    approvalRequestId: idOf(refused, "approval.requestId", approval.requestId),
    approvedByUserId: idOf(refused, "approval.approvedBy", approval.approvedBy),
    // Required whenever an approval is named: where the yes was given is
    // half of what the row says about it.
    approvedVia: wordOf(
      refused,
      "approval.via",
      APPROVAL_PLACES,
      approval.via ?? ""
    ),
  };
}

/**
 * The door: a deployment's own when there is one, since a pipeline and a
 * machine each arrive one way only, and a stated door that disagrees with it
 * is refused; otherwise the one the caller named.
 */
function doorOf(
  refused: Refused,
  stated: unknown,
  deployment: DeploymentAttribution | undefined
): AttributionDoor | null {
  if (!deployment) return wordOf(refused, "door", ATTRIBUTION_DOORS, stated);
  const own: AttributionDoor = "machine" in deployment ? "local" : "deploy";
  if (stated !== undefined && stated !== own) refused.push("door");
  return own;
}

function deploymentColumns(
  refused: Refused,
  deployment: DeploymentAttribution | undefined
): Partial<AttributionColumns> {
  if (!deployment) return {};
  if ("machine" in deployment) {
    return {
      deploymentHost: nameOf(refused, "deployment.host", deployment.machine),
    };
  }
  const { commit } = deployment;
  const valid = commit !== null && COMMIT_PATTERN.test(commit);
  if (commit !== null && !valid) refused.push("deployment.commit");
  return {
    deploymentHost: nameOf(refused, "deployment.host", deployment.pipeline),
    deploymentCommit: valid ? commit.toLowerCase() : null,
  };
}

/** What a writer knows about the row it stores attribution on. */
export interface AttributionOptions {
  /** Whether the row's actor is a person, whose erasure reaches the row. */
  actorIsPerson?: boolean;
}

/**
 * The columns a caller's attribution is stored as, and the parts refused.
 *
 * Never throws: both trails record from inside a write the person is waiting
 * on, and a malformed part must not fail it. A refused part is stored as NULL
 * and named in `refused` (by field, never by value, since the value may be a
 * secret) for the caller to report; every other part still lands, so the row
 * keeps saying what it can.
 */
export function attributionColumns(
  given: ActorAttribution | null | undefined,
  options: AttributionOptions = {}
): { columns: AttributionColumns; refused: string[] } {
  const refused: Refused = [];
  if (!given) {
    return { columns: { ...EMPTY_ATTRIBUTION_COLUMNS }, refused };
  }
  // A deployment is the Deployment actor's own. A row whose actor is a person
  // is erased with that person, and a machine's name can name them, so such a
  // row stores no deployment at all rather than one their erasure misses.
  let attribution = given;
  if (options.actorIsPerson && given.deployment) {
    refused.push("deployment");
    attribution = { ...given, deployment: undefined };
  }
  const columns: AttributionColumns = {
    ...EMPTY_ATTRIBUTION_COLUMNS,
    ...agentColumns(refused, attribution.agent),
    credentialId: idOf(refused, "credentialId", attribution.credentialId),
    ...approvalColumns(refused, attribution.approval),
    grantId: idOf(refused, "grantId", attribution.grantId),
    undoesSessionId: idOf(
      refused,
      "undoesSessionId",
      attribution.undoesSessionId
    ),
    door: doorOf(refused, attribution.door, attribution.deployment),
    ...deploymentColumns(refused, attribution.deployment),
  };
  return { columns, refused };
}

/**
 * The columns a trail stores for `attribution`, reporting any part refused.
 *
 * The one place a writer turns attribution into columns: the activity log,
 * the audit log and the record of content events all call it, so a refusal is
 * reported the same way whichever trail met it. The report names the trail
 * and the refused fields, never their values, since a refused value may be
 * exactly the secret the refusal kept off the row.
 */
export function storedAttribution(
  attribution: ActorAttribution | null | undefined,
  trail: "activity" | "audit" | "content-event",
  options: AttributionOptions = {}
): AttributionColumns {
  const { columns, refused } = attributionColumns(attribution, options);
  if (refused.length > 0) {
    getNextlyLogger().warn({
      kind: "attribution-part-refused",
      trail,
      fields: refused,
    });
  }
  return columns;
}
