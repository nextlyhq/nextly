/**
 * The claim a send with an idempotency key takes before any provider is
 * contacted, so the key's message goes out once however often it is sent.
 *
 * A claim names its send by keyed digests only: of the caller's scope and key,
 * and of the message, which is everything that reaches the provider, under
 * the install's stored digest key, which survives rotations of the secret. The first
 * successful send's result is kept on it, with recipients by position and no
 * address, and a repeat is answered from it. A failed send leaves the claim
 * open to a retry of the same message; a different message under the key is
 * refused.
 *
 * Two sends with one key race on the unique key digest, which includes the
 * scope: one
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

import { createHash, randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { and, eq } from "drizzle-orm";

import { toDbError } from "../../database/errors";
import { getDialectTables } from "../../database/index";
import { getStaticRelations } from "../../database/static-relations";
import { NextlyError } from "../../errors";
import type { PrincipalRef } from "../../plugins/principals/types";
import { emailDeliveriesMysql } from "../../schemas/email-deliveries/mysql";
import { emailDeliveriesPg } from "../../schemas/email-deliveries/postgres";
import { emailDeliveriesSqlite } from "../../schemas/email-deliveries/sqlite";
import { emailSendClaimsMysql } from "../../schemas/email-send-claims/mysql";
import { emailSendClaimsPg } from "../../schemas/email-send-claims/postgres";
import { emailSendClaimsSqlite } from "../../schemas/email-send-claims/sqlite";
import { assertNoOpenTransaction } from "../../shared/lib/open-transaction";
import { runAdapterTransaction } from "../../shared/lib/run-adapter-transaction";
import { isUniqueViolation } from "../../shared/lib/unique-violation";
import { rowLockServer } from "../audit/audit-log-writer";
import {
  principalDigestTablesOf,
  readPrincipalDigests,
  type PrincipalDigestDb,
  type PrincipalDigests,
} from "../audit/principal-digest";

import { CLAIM_TAKEOVER_MS } from "./send-timing";
import type { EmailSendOutcome } from "./services/send-failures";
import type { ResolvedAttachment } from "./types";

/** The scope of the site's own server code: the Direct API. */
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

export { CLAIM_TAKEOVER_MS };

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
 * attachment's bytes, the person named. An attachment is named by a plain
 * digest of its bytes; the whole string is digested under the claim's key.
 */
export function messageIdentity(message: ClaimedMessage): string {
  return JSON.stringify([
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
      createHash("sha256").update(attachment.content).digest("hex"),
    ]),
    message.person ? [message.person.kind, message.person.id] : null,
  ]);
}

/** A send's key and message, as the claim names them before digesting. */
export interface SendKey {
  scope: string;
  key: string;
  message: string;
}

/** What a keyed send is claimed by. */
export function sendKeyOf(
  scope: string,
  key: string,
  message: ClaimedMessage
): SendKey {
  return { scope, key, message: messageIdentity(message) };
}

/**
 * The digests a claim stores, under the install's stored digest key: the one
 * that names deleted people, sealed under `NEXTLY_SECRET` and kept across its
 * rotations, so every instance of a rolling deployment computes the same
 * digest, before a rotation and after it. Each kind of value is digested
 * under a kind of its own, so none can stand for another.
 */
interface ClaimDigests {
  key: string;
  message: string;
  /** The provider's key for one call of the send. */
  providerKey: (call: ProviderCall) => string;
}

/** The recipients of one provider call. */
interface ProviderCall {
  to: readonly string[];
  cc?: readonly string[];
  bcc?: readonly string[];
}

function claimDigests(
  digest: PrincipalDigests["digest"],
  sendKey: SendKey
): ClaimDigests {
  const key = digest({
    kind: "nextly.email.idempotency-key",
    id: JSON.stringify([sendKey.scope, sendKey.key]),
  });
  const message = digest({ kind: "nextly.email.message", id: sendKey.message });
  return {
    key,
    message,
    // The same for every retry of the call, and different between the calls
    // of a split send. Never the caller's key, which may name an address.
    providerKey: call =>
      `nextly-${digest({
        kind: "nextly.email.provider-key",
        id: JSON.stringify([
          key,
          message,
          [...call.to],
          [...(call.cc ?? [])],
          [...(call.bcc ?? [])],
        ]),
      })}`,
  };
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

/**
 * The claim table beside a dialect's delivery table, for an erasure handed
 * only the latter. Undefined for a table that is neither.
 */
export function sendClaimsTableBeside(
  deliveries: unknown
): EmailSendClaimsTable | undefined {
  if (deliveries === emailDeliveriesPg) return emailSendClaimsPg;
  if (deliveries === emailDeliveriesMysql) return emailSendClaimsMysql;
  if (deliveries === emailDeliveriesSqlite) return emailSendClaimsSqlite;
  return undefined;
}

/** A claim row, as the three dialect tables produce it. */
interface ClaimRow {
  id: string;
  keyDigest: string | null;
  messageDigest: string | null;
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
  /** The key handed to a provider that takes one, for one call. */
  providerKey: (call: ProviderCall) => string;
  /**
   * The recipients an earlier attempt already had accepted, by line and
   * position in the envelope (`recipientSlot`): a retry sends only to the
   * others, whatever provider carries it.
   */
  acceptedRecipients: ReadonlySet<string>;
}

/** The recipients a partly delivered claim recorded, from its stored result. */
function acceptedRecipientsOf(row: ClaimRow | undefined): Set<string> {
  // `claimed` too: a send that took a partly delivered claim over and then
  // stopped leaves the recorded recipients in place.
  if (row?.state !== "partial" && row?.state !== "claimed") return new Set();
  try {
    const stored = JSON.parse(row.result ?? "null") as {
      accepted?: unknown;
    } | null;
    const slots = Array.isArray(stored?.accepted) ? stored.accepted : [];
    return new Set(
      slots.filter((slot): slot is string => typeof slot === "string")
    );
  } catch {
    return new Set();
  }
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
export function ownTransaction(adapter: DrizzleAdapter) {
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
  digests: ClaimDigests,
  now: number
): ClaimDecision | undefined {
  if (row.messageDigest !== digests.message) {
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
  digests: ClaimDigests,
  context: { scope: string; now: number }
): Promise<ClaimDecision | undefined> {
  const { now } = context;
  const [found] = (await db
    .select()
    .from(table)
    .where(eq(table.keyDigest, digests.key))
    .limit(1)) as ClaimRow[];
  const holder = randomUUID();
  const held = (id: string): ClaimDecision => ({
    kind: "claimed",
    claim: {
      id,
      holder,
      keyDigest: digests.key,
      providerKey: digests.providerKey,
      acceptedRecipients: acceptedRecipientsOf(found),
    },
  });
  if (!found) {
    const id = randomUUID();
    await db.insert(table).values({
      id,
      holder,
      scope: context.scope,
      keyDigest: digests.key,
      messageDigest: digests.message,
      state: "claimed",
      result: null,
      claimedAt: now,
      leaseExpiresAt: now + CLAIM_TAKEOVER_MS,
      settledAt: null,
    });
    return held(id);
  }
  const decided = decisionOn(found, digests, now);
  if (decided) return decided;
  // Taken over only as it was read: a send that took it first has changed the
  // holder, and a lapsed holder that settled it since has changed its state,
  // and either way this one reads the claim again. The recorded legs are kept
  // until this send settles it.
  await db
    .update(table)
    .set({
      state: "claimed",
      holder,
      claimedAt: now,
      leaseExpiresAt: now + CLAIM_TAKEOVER_MS,
      settledAt: null,
    })
    .where(
      and(
        eq(table.id, found.id),
        eq(table.holder, found.holder),
        eq(table.state, found.state),
        eq(table.leaseExpiresAt, found.leaseExpiresAt)
      )
    );
  const [after] = (await db
    .select({ holder: table.holder })
    .from(table)
    .where(eq(table.id, found.id))
    .limit(1)) as Array<{ holder: string }>;
  return after?.holder === holder ? held(found.id) : undefined;
}

/**
 * Claim a key for a send, before any provider is contacted.
 *
 * @param secrets - The install's secrets, current first, that open the stored
 *   digest key.
 * @throws {NextlyError} `INTERNAL_ERROR` when the calling flow has a
 *   transaction open, and a database error when the claim cannot be read or
 *   written: nothing has been sent either way.
 */
export async function claimSendKey(
  adapter: DrizzleAdapter,
  sendKey: SendKey,
  secrets: readonly string[],
  now: number = Date.now()
): Promise<ClaimDecision> {
  assertNoOpenTransaction(adapter, "A send with an idempotency key");
  const dialect = adapter.getCapabilities().dialect;
  const table = sendClaimsTableFor(dialect);
  const transact = ownTransaction(adapter);
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    try {
      const decided = await transact(async db => {
        const stored = await readPrincipalDigests(
          db as unknown as PrincipalDigestDb,
          rowLockServer(adapter, dialect),
          principalDigestTablesOf(getDialectTables(dialect)),
          "shared",
          secrets
        );
        const digests = claimDigests(
          subject => stored.digest(subject),
          sendKey
        );
        return attemptClaim(db, table, digests, {
          scope: sendKey.scope,
          now,
        });
      });
      if (decided) return decided;
    } catch (error) {
      if (!lostToAnotherSend(adapter, error)) throw error;
    }
  }
  return { kind: "in-progress" };
}

/**
 * Push a held claim's lease on, between the provider calls of a send, so a
 * send of several messages is not taken over while it is still sending.
 * Written only while this send still holds the claim.
 */
export async function renewSendClaim(
  adapter: DrizzleAdapter,
  claim: HeldClaim,
  now: number = Date.now()
): Promise<void> {
  const table = sendClaimsTableFor(adapter.getCapabilities().dialect);
  await ownTransaction(adapter)(async db => {
    await db
      .update(table)
      .set({ leaseExpiresAt: now + CLAIM_TAKEOVER_MS })
      .where(
        and(
          eq(table.id, claim.id),
          eq(table.holder, claim.holder),
          eq(table.state, "claimed")
        )
      );
  });
}

/**
 * Record a claimed send's outcome: a successful send's result, which a repeat
 * returns, or a failure, which lets the next send with the key try again. A
 * failure after some recipients were accepted is `partial`: it records them by
 * position, so a retry sends only to the rest, and is kept as long as a
 * successful claim. `keep: false` removes the claim instead, whatever the
 * outcome, for a site that keeps no delivery history.
 *
 * Written only while this send still holds the claim.
 */
export async function settleSendClaim(
  adapter: DrizzleAdapter,
  claim: HeldClaim,
  outcome: EmailSendOutcome,
  options: SettleOptions
): Promise<void> {
  const dialect = adapter.getCapabilities().dialect;
  await ownTransaction(adapter)(db =>
    settleClaimIn(db, dialect, claim, outcome, options)
  );
}

/** How a claim is settled. */
export interface SettleOptions {
  keep: boolean;
  acceptedRecipients?: readonly string[];
  now?: number;
}

/**
 * {@link settleSendClaim} inside a transaction the caller holds, so the
 * claim's outcome commits with whatever else that transaction writes: the
 * send's delivery records.
 */
export async function settleClaimIn(
  db: unknown,
  dialect: string,
  claim: HeldClaim,
  outcome: EmailSendOutcome,
  options: SettleOptions
): Promise<void> {
  const claims = db as ClaimDb;
  const table = sendClaimsTableFor(dialect);
  const now = options.now ?? Date.now();
  const held = and(eq(table.id, claim.id), eq(table.holder, claim.holder));
  if (!options.keep) {
    await claims.delete(table).where(held);
    return;
  }
  const accepted = options.acceptedRecipients ?? [];
  await claims
    .update(table)
    .set(
      outcome.success
        ? { state: "sent", result: JSON.stringify(outcome), settledAt: now }
        : {
            state: accepted.length > 0 ? "partial" : "failed",
            result: accepted.length > 0 ? JSON.stringify({ accepted }) : null,
            leaseExpiresAt: now,
            settledAt: now,
          }
    )
    .where(held);
}
