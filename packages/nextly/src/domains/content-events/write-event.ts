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
import { statusEventsFor } from "../webhooks/status-events";

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

/**
 * One status move a write made: one language's, or the document's own.
 *
 * @experimental
 */
export interface StatusMove {
  /** The language that moved; absent for the document's own status. */
  locale?: string;
  from: string | null | undefined;
  to: unknown;
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

/**
 * Record a write's status moves in the document's history: one "published"
 * event naming the parts it published, and one "unpublished" for those it
 * unpublished. Decided by the rule that decides the webhook events, so the
 * two never disagree on what was a publish, and written whatever the
 * document's webhook settings.
 *
 * @experimental
 */
export async function recordTransitionEvents(
  tx: TransactionContext,
  deps: WriteEventDeps,
  write: Pick<
    WriteEventInput,
    "subject" | "actor" | "personName" | "versionNo"
  > & {
    isCreate?: boolean;
  },
  moves: readonly StatusMove[]
): Promise<void> {
  for (const kind of ["published", "unpublished"] as const) {
    const moved = moves.filter(
      m =>
        typeof m.to === "string" &&
        statusEventsFor({
          from: m.from ?? null,
          to: m.to,
          isCreate: write.isCreate === true,
        }).includes(`entry.${kind}`)
    );
    const first = moved[0];
    if (!first) continue;
    const locales = moved.flatMap(m => (m.locale ? [m.locale] : []));
    await recordWriteEvent(tx, deps, {
      subject: write.subject,
      kind,
      actor: write.actor,
      personName: write.personName,
      ...(locales.length > 0 ? { parts: { locales } } : {}),
      fromState: moved.length === 1 ? (first.from ?? null) : null,
      toState: typeof first.to === "string" ? first.to : null,
      versionNo: write.versionNo ?? null,
    });
  }
}

/**
 * Record a save in the document's history: a restore always, naming the
 * version it came from, and any other save only when it recorded a version,
 * so a save that changed nothing adds no event either.
 *
 * @experimental
 */
export async function recordSaveEvent(
  tx: TransactionContext,
  deps: WriteEventDeps,
  save: Pick<WriteEventInput, "subject" | "actor" | "personName"> & {
    locale?: string | null;
    toState?: string | null;
    versionNo: number | null;
    sourceVersionNo?: number | null;
  }
): Promise<void> {
  const from = save.sourceVersionNo;
  if (typeof from !== "number" && save.versionNo === null) return;
  await recordWriteEvent(tx, deps, {
    subject: save.subject,
    actor: save.actor,
    personName: save.personName,
    ...(save.locale ? { parts: { locales: [save.locale] } } : {}),
    toState: save.toState ?? null,
    versionNo: save.versionNo,
    ...(typeof from === "number"
      ? { kind: "restored" as const, payload: { from } }
      : { kind: "saved" as const }),
  });
}
