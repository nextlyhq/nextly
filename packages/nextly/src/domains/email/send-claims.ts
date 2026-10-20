/**
 * The claim a send with an idempotency key takes before any provider is
 * contacted, so the key's message goes out once however often it is sent.
 *
 * A claim names its send by keyed digests only: of the caller's scope and key,
 * and of the message, which is everything that reaches the provider. The first
 * successful send's result is kept on it, with recipients by position and no
 * address, and a repeat is answered from it. A failed send leaves the claim
 * open to a retry of the same message; a different message under the key is
 * refused.
 *
 * Two sends with one key race on the unique (scope, key digest) index: one
 * inserts the row and sends, the other finds it and reports the send in
 * progress. A claim whose holder never recorded an outcome, because its process
 * stopped, may be taken over once its lease has lapsed.
 *
 * Every write commits in a transaction of its own, never joining one the
 * calling flow has open: a claim rolled back with a caller's work would leave a
 * sent message unclaimed, and the next send with its key would repeat it.
 *
 * @module domains/email/send-claims
 */

import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray, lt, or } from "drizzle-orm";

import { toDbError } from "../../database/errors";
import { getStaticRelations } from "../../database/static-relations";
import { NextlyError } from "../../errors";
import type { PrincipalRef } from "../../plugins/principals/types";
import { emailSendClaimsMysql } from "../../schemas/email-send-claims/mysql";
import { emailSendClaimsPg } from "../../schemas/email-send-claims/postgres";
import { emailSendClaimsSqlite } from "../../schemas/email-send-claims/sqlite";
import { assertNoOpenTransaction } from "../../shared/lib/open-transaction";
import { runAdapterTransaction } from "../../shared/lib/run-adapter-transaction";
import { isUniqueViolation } from "../../shared/lib/unique-violation";

import { keyedDigest, keyedDigests } from "./delivery-record";
import type { EmailSendOutcome } from "./services/send-failures";
import type { ResolvedAttachment } from "./types";

/** The scope of the site's own code: the Direct API and the REST routes. */
export const SITE_KEY_SCOPE = "site";

/** The scope of core's own sends, and of a caller that names no scope. */
export const CORE_KEY_SCOPE = "core";

/**
 * A plugin's scope: its own name, so two plugins' keys never meet. A context
 * no plugin owns sends as the site.
 */
export function pluginKeyScope(pluginName: string | undefined): string {
  return pluginName ? `plugin:${pluginName}` : SITE_KEY_SCOPE;
}

/**
 * `service` as `scope` sends through it: every key it is given is scoped to
 * that caller. A service without `scopedTo`, such as a test's stand-in, or
 * none at all, is used as it is.
 */
export function scopedSender<T>(service: T, scope: string): T {
  const scoped = (service as { scopedTo?: unknown } | null | undefined)
    ?.scopedTo;
  return typeof scoped === "function"
    ? (scoped as (scope: string) => T).call(service, scope)
    : service;
}

/** The longest idempotency key a send takes, as Resend's header does. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

/**
 * How long a claim with no outcome holds its key before a later send may take
 * it over: longer than the longest a built-in provider call can take, SMTP's
 * ten-minute socket timeout.
 */
export const CLAIM_TAKEOVER_MS = 15 * 60_000;

/** Refuse an idempotency key a send cannot use, before anything is sent. */
export function assertIdempotencyKey(key: unknown): asserts key is string {
  if (
    typeof key === "string" &&
    key.trim() !== "" &&
    key.length <= MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    return;
  }
  throw new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage: `An idempotency key must be text of 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
    logContext: { reason: "unusable-idempotency-key" },
  });
}

/** Everything of a message that reaches the provider. */
export interface ClaimedMessage {
  to: readonly string[];
  cc?: readonly string[];
  bcc?: readonly string[];
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: readonly ResolvedAttachment[];
  person: PrincipalRef | null;
}

/**
 * The message as one string, so any change to what reaches the provider is a
 * different message: a recipient, the sender, the rendered content, an
 * attachment's bytes, the person named.
 */
function messageIdentity(message: ClaimedMessage): string {
  return JSON.stringify([
    "message",
    [...message.to],
    [...(message.cc ?? [])],
    [...(message.bcc ?? [])],
    message.from,
    message.replyTo ?? null,
    message.subject,
    message.html,
    message.text ?? null,
    (message.attachments ?? []).map(attachment => [
      attachment.filename,
      attachment.mimeType,
      keyedDigest(attachment.content.toString("base64")),
    ]),
    message.person ? [message.person.kind, message.person.id] : null,
  ]);
}

/** The key as its scope sent it, as one string. */
function keyIdentity(scope: string, key: string): string {
  return JSON.stringify(["key", scope, key]);
}

/** A send's key and message, as a claim and its delivery records store them. */
export interface SendKey {
  scope: string;
  key: string;
  /** Under the current secret first, then every one still readable. */
  keyDigests: string[];
  messageDigests: string[];
}

/** The digests a keyed send is claimed and recorded by. */
export function sendKeyOf(
  scope: string,
  key: string,
  message: ClaimedMessage
): SendKey {
  return {
    scope,
    key,
    keyDigests: keyedDigests(keyIdentity(scope, key)),
    messageDigests: keyedDigests(messageIdentity(message)),
  };
}

/**
 * The key handed to a provider for one call: derived from the scope, the key,
 * that call's recipients and the message, so it is the same on every retry of
 * the call and differs between the calls of a split send. Never the caller's
 * key itself, which may be built from an address.
 */
export function providerKeyFor(
  sendKey: SendKey,
  call: {
    to: readonly string[];
    cc?: readonly string[];
    bcc?: readonly string[];
  }
): string {
  const derived = keyedDigest(
    JSON.stringify([
      "provider-key",
      sendKey.scope,
      sendKey.key,
      [...call.to],
      [...(call.cc ?? [])],
      [...(call.bcc ?? [])],
      sendKey.messageDigests[0],
    ])
  );
  return `nextly-${derived}`;
}

/** The claim table, as the three dialect bundles define it. */
export type EmailSendClaimsTable =
  | typeof emailSendClaimsPg
  | typeof emailSendClaimsMysql
  | typeof emailSendClaimsSqlite;

/** The claim table for a dialect. */
export function sendClaimsTableFor(dialect: string): EmailSendClaimsTable {
  switch (dialect) {
    case "postgresql":
      return emailSendClaimsPg;
    case "mysql":
      return emailSendClaimsMysql;
    case "sqlite":
      return emailSendClaimsSqlite;
    default:
      throw NextlyError.internal({
        logContext: {
          reason: "unsupported dialect for email send claims",
          dialect: String(dialect),
        },
      });
  }
}

/** A claim row, as the three dialect tables produce it. */
interface ClaimRow {
  id: string;
  keyDigest: string;
  messageDigest: string;
  state: string;
  holder: string;
  result: string | null;
  leaseExpiresAt: number;
}

/** The Drizzle surface the claim needs. */
interface ClaimDb {
  select(fields?: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(rows: number): PromiseLike<unknown[]>;
      };
    };
  };
  insert(table: unknown): { values(row: unknown): PromiseLike<unknown> };
  update(table: unknown): {
    set(values: unknown): { where(condition: unknown): PromiseLike<unknown> };
  };
  delete(table: unknown): { where(condition: unknown): PromiseLike<unknown> };
}

/** The claim this send holds, until it records the outcome. */
export interface HeldClaim {
  id: string;
  holder: string;
  /** The digest the send's delivery records carry. */
  keyDigest: string;
}

/** What claiming a key decided. */
export type ClaimDecision =
  | { kind: "claimed"; claim: HeldClaim }
  | { kind: "repeat"; result: EmailSendOutcome }
  | { kind: "in-progress" }
  | { kind: "different-message" };

/** Attempts at a claim another send keeps changing under it. */
const CLAIM_ATTEMPTS = 3;

/** A runner for work in a transaction of its own, never one the flow has open. */
function ownTransaction(adapter: DrizzleAdapter) {
  const relations = getStaticRelations(adapter.getCapabilities().dialect);
  return <T>(work: (db: ClaimDb) => Promise<T>): Promise<T> =>
    runAdapterTransaction<T, TransactionContext>(
      run => adapter.transaction(ctx => run(ctx)),
      ctx => work(ctx.drizzleWithRelations<ClaimDb>(relations))
    );
}

/**
 * Whether a claim attempt lost to another send's write: the unique index
 * refused a second row, or the database broke a deadlock between the two.
 * The next attempt reads what the other send wrote.
 */
function lostToAnotherSend(adapter: DrizzleAdapter, error: unknown): boolean {
  if (isUniqueViolation(error)) return true;
  const { kind } = toDbError(adapter.getCapabilities().dialect, error);
  return kind === "deadlock" || kind === "serialization-failure";
}

/** The first send's result, as a repeat returns it. */
function repeatOf(row: ClaimRow): EmailSendOutcome {
  try {
    const stored = JSON.parse(row.result ?? "null") as unknown;
    if (stored && typeof stored === "object") {
      return { ...(stored as EmailSendOutcome), success: true };
    }
  } catch {
    // An unreadable result still records that the send succeeded.
  }
  return { success: true };
}

/**
 * What an existing claim means for a send of `message` now, or `undefined`
 * when the send may take it over: its first send failed, or its holder's lease
 * lapsed without an outcome.
 */
function decisionOn(
  row: ClaimRow,
  sendKey: SendKey,
  now: number
): ClaimDecision | undefined {
  if (!sendKey.messageDigests.includes(row.messageDigest)) {
    return { kind: "different-message" };
  }
  if (row.state === "sent") return { kind: "repeat", result: repeatOf(row) };
  if (row.state === "claimed" && row.leaseExpiresAt > now) {
    return { kind: "in-progress" };
  }
  return undefined;
}

/** One attempt at the claim, in its own transaction. */
async function attemptClaim(
  db: ClaimDb,
  table: EmailSendClaimsTable,
  sendKey: SendKey,
  now: number
): Promise<ClaimDecision | undefined> {
  const [found] = (await db
    .select()
    .from(table)
    .where(
      and(
        eq(table.scope, sendKey.scope),
        inArray(table.keyDigest, sendKey.keyDigests)
      )
    )
    .limit(1)) as ClaimRow[];
  const holder = randomUUID();
  if (!found) {
    const claim = {
      id: randomUUID(),
      holder,
      keyDigest: sendKey.keyDigests[0],
    };
    await db.insert(table).values({
      ...claim,
      scope: sendKey.scope,
      messageDigest: sendKey.messageDigests[0],
      state: "claimed",
      result: null,
      claimedAt: now,
      leaseExpiresAt: now + CLAIM_TAKEOVER_MS,
      settledAt: null,
    });
    return { kind: "claimed", claim };
  }
  const decided = decisionOn(found, sendKey, now);
  if (decided) return decided;
  // Taken over only from the holder that was read: a send that took it first
  // has changed the holder, and this one then reads that claim again.
  await db
    .update(table)
    .set({
      state: "claimed",
      holder,
      result: null,
      claimedAt: now,
      leaseExpiresAt: now + CLAIM_TAKEOVER_MS,
      settledAt: null,
    })
    .where(and(eq(table.id, found.id), eq(table.holder, found.holder)));
  const [after] = (await db
    .select({ holder: table.holder })
    .from(table)
    .where(eq(table.id, found.id))
    .limit(1)) as Array<{ holder: string }>;
  return after?.holder === holder
    ? {
        kind: "claimed",
        claim: { id: found.id, holder, keyDigest: found.keyDigest },
      }
    : undefined;
}

/**
 * Claim a key for a send, before any provider is contacted.
 *
 * @throws {NextlyError} `INTERNAL_ERROR` when the calling flow has a
 *   transaction open, and a database error when the claim cannot be read or
 *   written: nothing has been sent either way.
 */
export async function claimSendKey(
  adapter: DrizzleAdapter,
  sendKey: SendKey,
  now: number = Date.now()
): Promise<ClaimDecision> {
  assertNoOpenTransaction(adapter, "A send with an idempotency key");
  const table = sendClaimsTableFor(adapter.getCapabilities().dialect);
  const transact = ownTransaction(adapter);
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    try {
      const decided = await transact(db =>
        attemptClaim(db, table, sendKey, now)
      );
      if (decided) return decided;
    } catch (error) {
      if (!lostToAnotherSend(adapter, error)) throw error;
    }
  }
  return { kind: "in-progress" };
}

/**
 * Record a claimed send's outcome: a successful send's result, which a repeat
 * returns, or a failure, which lets the next send with the key try again.
 * `keep: false` removes a successful claim instead, for a site that keeps no
 * delivery history.
 *
 * Written only while this send still holds the claim.
 */
export async function settleSendClaim(
  adapter: DrizzleAdapter,
  claim: HeldClaim,
  outcome: EmailSendOutcome,
  options: { keep: boolean; now?: number }
): Promise<void> {
  const table = sendClaimsTableFor(adapter.getCapabilities().dialect);
  const now = options.now ?? Date.now();
  const held = and(eq(table.id, claim.id), eq(table.holder, claim.holder));
  await ownTransaction(adapter)(async db => {
    if (outcome.success && !options.keep) {
      await db.delete(table).where(held);
      return;
    }
    await db
      .update(table)
      .set(
        outcome.success
          ? { state: "sent", result: JSON.stringify(outcome), settledAt: now }
          : { state: "failed", leaseExpiresAt: now, settledAt: now }
      )
      .where(held);
  });
}

/** Claims removed per sweep. */
const SWEEP_BATCH = 500;

/**
 * Remove claims past their lifetime: a successful one once the delivery log's
 * window has passed since it was sent (`false` keeps it as long as the log
 * keeps its records, which is for good), and one that failed or never got an
 * outcome a takeover period after its lease lapsed. One bounded batch.
 */
export async function sweepSendClaims(
  adapter: DrizzleAdapter,
  sentLifetimeMs: number | false,
  now: number = Date.now()
): Promise<number> {
  const table = sendClaimsTableFor(adapter.getCapabilities().dialect);
  const expired = or(
    and(
      inArray(table.state, ["claimed", "failed"]),
      lt(table.leaseExpiresAt, now - CLAIM_TAKEOVER_MS)
    ),
    sentLifetimeMs === false
      ? undefined
      : and(eq(table.state, "sent"), lt(table.settledAt, now - sentLifetimeMs))
  );
  return ownTransaction(adapter)(async db => {
    const rows = (await db
      .select({ id: table.id })
      .from(table)
      .where(expired)
      .limit(SWEEP_BATCH)) as Array<{ id: string }>;
    if (rows.length === 0) return 0;
    await db.delete(table).where(
      and(
        inArray(
          table.id,
          rows.map(row => row.id)
        ),
        expired
      )
    );
    return rows.length;
  });
}
