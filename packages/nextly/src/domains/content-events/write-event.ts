/**
 * Record a core content event from a write path, in that write's own
 * transaction.
 *
 * The one way core's write paths record their events: the actor is taken from
 * the request's acting identity, an API key is named by its own name, and a
 * plugin-defined person already reported deleted is written erased. A write
 * path names what happened; how the event is assembled lives here.
 *
 * @module domains/content-events/write-event
 * @experimental
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { RequestActor } from "../../auth/request-actor";
import { getDialectTables } from "../../database/index";
import { env } from "../../lib/env";
import { rowLockServer } from "../audit/audit-log-writer";
import {
  principalDigestTablesOf,
  readPrincipalDigests,
  type PrincipalDigestDb,
} from "../audit/principal-digest";
import { pluginSettingsSecrets } from "../plugins/settings-service";

import { contentEventActor } from "./actor";
import {
  CORE_CONTENT_EVENT_KINDS,
  ensureCoreContentEventKinds,
  type CoreContentEventKind,
} from "./core-kinds";
import {
  recordContentEvent,
  type ContentEventInput,
  type ContentEventSubject,
} from "./record";

/**
 * One event a write path records.
 *
 * @experimental
 */
export interface WriteEventInput {
  subject: ContentEventSubject;
  kind: CoreContentEventKind;
  /** Who made the write, as the write path resolved it. */
  actor: RequestActor;
  /**
   * The person's display name, when the write path has it. An API key is
   * named by its own name, read here; the system is named by nothing.
   */
  personName?: string | null;
  /** The languages the event involved, and whether the shared fields were. */
  parts?: ContentEventInput["parts"];
  fromState?: string | null;
  toState?: string | null;
  /** The version the write produced or points at. */
  versionNo?: number | null;
  payload?: Record<string, unknown> | null;
}

/**
 * What the writer needs besides the transaction.
 *
 * @experimental
 */
export interface WriteEventDeps {
  /** The adapter the transaction belongs to: its dialect and locking. */
  adapter: Pick<DrizzleAdapter, "getCapabilities">;
  /** The install's secrets, current first. Defaults to the environment's. */
  secrets?: () => readonly string[];
}

/** An API key's own name, read on the write's transaction. */
async function apiKeyName(
  tx: TransactionContext,
  id: string
): Promise<string | null> {
  const [row] = await tx.select<{ name: string }>("api_keys", {
    columns: ["name"],
    where: { and: [{ column: "id", op: "=", value: id }] },
    limit: 1,
  });
  return row?.name ?? null;
}

/** The name kept with the event, by the kind of actor. */
async function actorName(
  tx: TransactionContext,
  input: WriteEventInput
): Promise<string | null> {
  if (input.actor.type === "apiKey" && input.actor.id) {
    return apiKeyName(tx, input.actor.id);
  }
  if (input.actor.type === "system") return null;
  return input.personName ?? null;
}

/**
 * Record `input` on `tx`, the transaction of the write it records.
 *
 * @experimental
 */
export async function recordWriteEvent(
  tx: TransactionContext,
  deps: WriteEventDeps,
  input: WriteEventInput
): Promise<{ id: string }> {
  ensureCoreContentEventKinds();
  const actor = contentEventActor(input.actor, await actorName(tx, input));
  const dialect = deps.adapter.getCapabilities().dialect;
  // Read under the shared deleted-people lock only for a plugin-defined
  // person: no other actor can have been reported deleted.
  const principals =
    actor.kind === "principal"
      ? await readPrincipalDigests(
          tx.getDrizzle<PrincipalDigestDb>(),
          rowLockServer(deps.adapter, dialect),
          principalDigestTablesOf(getDialectTables(dialect)),
          "shared",
          (deps.secrets ?? (() => pluginSettingsSecrets(env)))()
        )
      : undefined;
  return recordContentEvent(
    tx,
    {
      subject: input.subject,
      kind: CORE_CONTENT_EVENT_KINDS[input.kind].name,
      actor,
      parts: input.parts,
      fromState: input.fromState ?? null,
      toState: input.toState ?? null,
      versionNo: input.versionNo ?? null,
      payload: input.payload ?? null,
    },
    { principals }
  );
}
