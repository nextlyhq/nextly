/**
 * One-purpose secrets core lends plugins as `ctx.security.secrets`: a long
 * token for a link, or a short code a person types, each for one purpose and
 * one subject, spent once.
 *
 * Every secret lives in one core table, `nextly_one_time_secrets`, stored only
 * as an HMAC under a key derived from the install's secret for this use alone,
 * so a copy of the database cannot recover a short code by trying every value.
 * A secret minted under the install's previous secret is still accepted while
 * that secret is configured for reading.
 *
 * Single use holds through the database, never the limit store: spending is
 * one conditional update that only one caller can win, on every instance. A
 * code's wrong tries are counted the same way, each a compare-and-set of the
 * count just read, so a burst over several instances spends no more than the
 * code's budget.
 *
 * Writes run inside a transaction: the plugin's own when it passes one
 * (`{ tx }`), or one of their own, never as a lone statement. Called without
 * one while the calling flow has a transaction open, a write is refused rather
 * than silently joining it. A code's spend never joins one: a wrong code's
 * charge must outlive any rollback, so `consumeCode` takes no transaction and
 * is refused inside one.
 *
 * @module plugins/security/one-time-secrets
 */

import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  TransactionContext,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";

import { safeCode } from "../../database/errors";
import { NextlyError } from "../../errors/nextly-error";
import { ONE_TIME_SECRETS_TABLE } from "../../schemas/one-time-secrets";
import { assertNoOpenTransaction } from "../../shared/lib/open-transaction";
import type { SecretGeneration } from "../../shared/lib/secret-generations";
import { isUniqueViolation } from "../../shared/lib/unique-violation";
import type { PluginTransaction } from "../database/plugin-database";
import { linkedTransaction } from "../database/plugin-transaction-link";

import { isWellFormed } from "./well-formed";

/** @experimental A secret's data: stored in clear, at most 1 KB serialised. */
export type SecretData = Record<string, string | number | boolean | null>;

/** @experimental The plugin's own open transaction, for a write that commits with it. */
export interface TxOption {
  /**
   * The handle `ctx.db.transaction(async tx => …)` hands its callback: the
   * write commits or rolls back with it. Without one, the write runs in a
   * transaction of its own; and if the calling flow has a transaction open,
   * the call is refused with an error.
   */
  tx?: PluginTransaction;
}

/**
 * @experimental One-purpose secrets for a plugin (`ctx.security.secrets`): a
 * long token for a link, a short code to type.
 */
export interface OneTimeSecrets {
  mintToken(
    input: {
      /** `[a-z][a-z0-9.-]{0,63}`; core keeps it within this plugin's namespace. */
      purpose: string;
      /** The plugin's choice, such as an account id; at most 255 characters. */
      subject: string;
      /** 1 minute to 30 days. */
      expiresInMs: number;
      /** Stored in clear, at most 1 KB serialised. */
      data?: SecretData;
      /** Void this plugin's unspent tokens of this purpose and subject. */
      voidEarlier?: boolean;
    },
    options?: TxOption
  ): Promise<{ token: string; expiresAt: Date }>;

  /** A new code always voids the earlier unspent code of this purpose and subject. */
  mintCode(
    input: {
      purpose: string;
      subject: string;
      /** 1 to 60 minutes. */
      expiresInMs: number;
      /** Default 6. */
      digits?: 6 | 7 | 8;
      /** 1 to 10: the code's own backstop. */
      maxWrongTries: number;
      data?: SecretData;
    },
    options?: TxOption
  ): Promise<{ code: string; expiresAt: Date }>;

  /**
   * Reads without spending, for a page that shows what a link will do. Reads
   * through the plugin's transaction when given one, so it sees what that
   * transaction wrote; refused inside an open transaction that passes none,
   * as a write is, so a read answers the same on every dialect.
   */
  peekToken(
    input: {
      purpose: string;
      token: string;
    },
    options?: TxOption
  ): Promise<
    | { ok: true; subject: string; data: SecretData | null; expiresAt: Date }
    | { ok: false; reason: "invalid" | "expired" | "spent" }
  >;

  /** Spends it once, by one write only one caller can win, on every instance. */
  consumeToken(
    input: { purpose: string; token: string },
    options?: TxOption
  ): Promise<
    | { ok: true; subject: string; data: SecretData | null }
    | { ok: false; reason: "invalid" | "expired" | "spent" }
  >;

  /**
   * Takes no transaction: a wrong code's charge and a right code's spend
   * commit on their own, so no rollback gives a wrong try back. Throws when
   * the calling flow has a transaction open. Spend the code first, then open
   * the transaction that applies its effect; if that transaction fails, the
   * code stays spent and the visitor asks for a new one.
   */
  consumeCode(input: {
    purpose: string;
    subject: string;
    code: string;
  }): Promise<
    | { ok: true; data: SecretData | null }
    | { ok: false; reason: "wrong"; triesLeft: number }
    | { ok: false; reason: "none" | "expired" | "spent" }
  >;

  /** Voids unspent secrets of a subject, all purposes or the ones named. */
  voidFor(
    input: { subject: string; purposes?: readonly string[] },
    options?: TxOption
  ): Promise<{ voided: number }>;
}

/** What the helper needs from the database adapter. */
export type SecretsAdapter = Pick<
  DrizzleAdapter,
  "transaction" | "transactionOpenInFlow" | "select"
>;

/** What the helper is built from. */
export interface OneTimeSecretsOptions {
  /** The plugin's name: every secret it mints is kept within it. */
  owner: string;
  /** The adapter, resolved per call: the context can be built before it connects. */
  adapter: () => SecretsAdapter;
  /** The install's secrets that may be read with, current first. */
  /**
   * The install's secret generations that may be read with, current first.
   * `undefined` is the unkeyed generation (no `NEXTLY_SECRET`), which an
   * operator keeps readable with `NEXTLY_SECRET_PREVIOUS='[null]'`.
   */
  secrets: () => readonly SecretGeneration[];
  /** The clock; injectable for tests. */
  now?: () => Date;
}

const MINUTE = 60_000;
const DAY = 86_400_000;
const BOUNDS = {
  tokenExpiry: { lowest: MINUTE, highest: 30 * DAY },
  codeExpiry: { lowest: MINUTE, highest: 60 * MINUTE },
  maxWrongTries: { lowest: 1, highest: 10 },
  subjectLength: 255,
  dataBytes: 1024,
} as const;
const PURPOSE = /^[a-z][a-z0-9.-]{0,63}$/;
const DIGITS = new Set([6, 7, 8]);
const TOKEN_BYTES = 32;
const KEY_INFO = "nextly/one-time-secrets/v1";

/** A row as the helper reads it. */
interface SecretRow {
  id: string;
  subject: string;
  secretHash: string;
  data: string | null;
  expiresAt: Date;
  spentAt: Date | null;
  voidedAt: Date | null;
  wrongTries: number;
  maxWrongTries: number | null;
  createdAt: Date;
  issueSeq: number | null;
}

/** Build the helper a plugin receives as `ctx.security.secrets`. */
export function createOneTimeSecrets(
  options: OneTimeSecretsOptions
): OneTimeSecrets {
  const { owner } = options;
  const now = options.now ?? (() => new Date());

  /** Every key the install can read with, current first. */
  const keys = (): Buffer[] => {
    const generations = options.secrets();
    // No secret configured, which production refuses at boot: one key from
    // the empty secret, so development still works and stays consistent. The
    // unkeyed generation derives that same key, so what was minted before a
    // secret was configured stays readable while it is kept.
    return (generations.length > 0 ? generations : [undefined]).map(
      generation => secretKey(generation ?? "")
    );
  };
  const tokenHashes = (purpose: string, token: string): string[] =>
    keys().map(key => hmac(key, ["token", owner, purpose, token]));
  const codeHash = (
    key: Buffer,
    purpose: string,
    subject: string,
    code: string
  ) => hmac(key, ["code", owner, purpose, subject, code]);
  // What a subject's secrets are found by: compared as lower-case hex, it is
  // exact on every dialect, where the subject itself is not on MySQL, whose
  // default collation matches "Alice" to "alice" and ignores trailing spaces.
  const subjectKeyFor = (subject: string): string =>
    createHash("sha256")
      .update([owner, subject].join("\u0000"), "utf8")
      .digest("hex");
  const liveKeyFor = (
    purpose: string,
    subject: string,
    kind: "code" | "token" = "code"
  ): string =>
    createHash("sha256")
      .update(
        (kind === "code"
          ? [owner, purpose, subject]
          : ["token", owner, purpose, subject]
        ).join("\u0000"),
        "utf8"
      )
      .digest("hex");

  /**
   * Run a write on the plugin's transaction when it passed one, else in a
   * transaction of its own, refused when the calling flow has one open.
   */
  const write = <R>(
    operation: string,
    tx: PluginTransaction | undefined,
    work: (adapterTx: TransactionContext) => Promise<R>
  ): Promise<R> => {
    if (tx !== undefined) return linkedTransaction(tx, operation).run(work);
    const adapter = options.adapter();
    assertNoOpenTransaction(adapter, operation);
    return adapter.transaction(work);
  };

  const ownerWhere = (purpose: string) => [
    { column: "owner", op: "=" as const, value: owner },
    { column: "purpose", op: "=" as const, value: purpose },
  ];
  const unspent = [
    { column: "spentAt", op: "IS NULL" as const },
    { column: "voidedAt", op: "IS NULL" as const },
  ];

  const readTokenRow = async (
    purpose: string,
    token: string,
    reader: Pick<TransactionContext, "select"> | SecretsAdapter
  ): Promise<SecretRow | null> => {
    const rows = await reader.select<SecretRow>(ONE_TIME_SECRETS_TABLE, {
      where: {
        and: [
          ...ownerWhere(purpose),
          { column: "kind", op: "=", value: "token" },
          {
            column: "secretHash",
            op: "IN",
            value: tokenHashes(purpose, token),
          },
        ],
      },
    });
    return rows[0] ?? null;
  };

  return {
    async mintToken(input, txOption) {
      const purpose = checkPurpose(input.purpose);
      const subject = checkSubject(input.subject);
      const expiresInMs = checkWhole(
        "expiresInMs",
        input.expiresInMs,
        BOUNDS.tokenExpiry
      );
      const data = serialiseData(input.data);
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + expiresInMs);
      const [current] = keys();
      // A token minted to replace the earlier ones takes the subject's token
      // live key, whose unique index admits one holder: two such mints at once
      // cannot both commit with the other's token left unvoided, as each would
      // under PostgreSQL's isolation. The loser runs again and voids the
      // winner's token. Tokens minted alongside others take no key.
      const tokenLiveKey = input.voidEarlier
        ? liveKeyFor(purpose, subject, "token")
        : null;
      const mint = async (adapterTx: TransactionContext): Promise<void> => {
        if (input.voidEarlier) {
          await adapterTx.updateCount(
            ONE_TIME_SECRETS_TABLE,
            { voidedAt: createdAt, liveKey: null },
            subjectWhere(subjectKeyFor(subject), [purpose], "token")
          );
        }
        await adapterTx.insert(ONE_TIME_SECRETS_TABLE, {
          id: randomUUID(),
          owner,
          purpose,
          subject,
          subjectKey: subjectKeyFor(subject),
          kind: "token",
          secretHash: hmac(current ?? secretKey(""), [
            "token",
            owner,
            purpose,
            token,
          ]),
          liveKey: tokenLiveKey,
          issueSeq: null,
          data,
          expiresAt,
          spentAt: null,
          voidedAt: null,
          wrongTries: 0,
          maxWrongTries: null,
          createdAt,
        });
      };
      if (txOption?.tx !== undefined || tokenLiveKey === null) {
        // In the plugin's transaction a lost race cannot be retried (the
        // failed insert ends it): it surfaces, and nothing is minted.
        await write("secrets.mintToken", txOption?.tx, mint);
      } else {
        await retryLostRace(() => write("secrets.mintToken", undefined, mint));
      }
      return { token, expiresAt };
    },

    async mintCode(input, txOption) {
      const purpose = checkPurpose(input.purpose);
      const subject = checkSubject(input.subject);
      const expiresInMs = checkWhole(
        "expiresInMs",
        input.expiresInMs,
        BOUNDS.codeExpiry
      );
      const maxWrongTries = checkWhole(
        "maxWrongTries",
        input.maxWrongTries,
        BOUNDS.maxWrongTries
      );
      const digits = input.digits ?? 6;
      if (!DIGITS.has(digits))
        throw invalid("digits", "digits must be 6, 7 or 8.");
      const data = serialiseData(input.data);
      const draw = (): string =>
        String(randomInt(0, 10 ** digits)).padStart(digits, "0");
      let code = draw();
      const liveKey = liveKeyFor(purpose, subject);
      const [current] = keys();

      const mint = async (adapterTx: TransactionContext): Promise<Date> => {
        const createdAt = now();
        // The new code never repeats the live one it replaces: a holder of the
        // earlier code could otherwise spend its successor, with a fresh
        // budget of tries. Compared under every key the install reads with.
        const [live] = await adapterTx.select<Pick<SecretRow, "secretHash">>(
          ONE_TIME_SECRETS_TABLE,
          {
            columns: ["secretHash"],
            where: { and: [{ column: "liveKey", op: "=", value: liveKey }] },
          }
        );
        const repeatsLive = (candidate: string): boolean =>
          live !== undefined &&
          keys().some(key =>
            sameHex(codeHash(key, purpose, subject, candidate), live.secretHash)
          );
        while (repeatsLive(code)) code = draw();
        // The earlier live code is voided in the same transaction as the new
        // one is inserted, and the new row takes the plugin, purpose and
        // subject's live key, whose unique index admits one holder at a time.
        await adapterTx.updateCount(
          ONE_TIME_SECRETS_TABLE,
          { voidedAt: createdAt, liveKey: null },
          { and: [{ column: "liveKey", op: "=", value: liveKey }] }
        );
        // The issue order a code's status is read by: one more than the
        // subject's newest code, never a timestamp, which SQLite and MySQL
        // keep in whole seconds so two codes can share one. The unique index
        // on it makes a mint racing for the same number lose and run again.
        const [latest] = await adapterTx.select<Pick<SecretRow, "issueSeq">>(
          ONE_TIME_SECRETS_TABLE,
          {
            columns: ["issueSeq"],
            where: { and: codesOf(subjectKeyFor(subject), purpose) },
            orderBy: [{ column: "issueSeq", direction: "desc" }],
            limit: 1,
          }
        );
        const issueSeq = (latest?.issueSeq ?? 0) + 1;
        const expiresAt = new Date(createdAt.getTime() + expiresInMs);
        await adapterTx.insert(ONE_TIME_SECRETS_TABLE, {
          id: randomUUID(),
          owner,
          purpose,
          subject,
          subjectKey: subjectKeyFor(subject),
          kind: "code",
          secretHash: codeHash(
            current ?? secretKey(""),
            purpose,
            subject,
            code
          ),
          liveKey,
          issueSeq,
          data,
          expiresAt,
          spentAt: null,
          voidedAt: null,
          wrongTries: 0,
          maxWrongTries,
          createdAt,
        });
        return expiresAt;
      };

      if (txOption?.tx !== undefined) {
        // Inside the plugin's transaction a lost race cannot be retried, since
        // the failed insert ends that transaction: it surfaces, and the
        // plugin's transaction rolls back with nothing minted.
        const expiresAt = await write("secrets.mintCode", txOption.tx, mint);
        return { code, expiresAt };
      }
      // Two mints at once for one subject: the second insert meets the
      // first's live key once the first commits, or the database ends one of
      // the two as a deadlock (MySQL does). Run again, it voids that code and
      // takes the key, so exactly one code is live after both.
      const expiresAt = await retryLostRace(() =>
        write("secrets.mintCode", undefined, mint)
      );
      return { code, expiresAt };
    },

    async peekToken(input, txOption) {
      const purpose = checkPurpose(input.purpose);
      const tx = txOption?.tx;
      let row: SecretRow | null;
      if (tx !== undefined) {
        row = await linkedTransaction(tx, "secrets.peekToken").run(adapterTx =>
          readTokenRow(purpose, input.token, adapterTx)
        );
      } else {
        // A read made beside an open transaction would see its uncommitted
        // writes on SQLite's one connection and not on another dialect's
        // pooled one, so it is refused as a write is.
        const adapter = options.adapter();
        assertNoOpenTransaction(adapter, "secrets.peekToken");
        row = await readTokenRow(purpose, input.token, adapter);
      }
      const reason = refusal(row, now());
      if (reason !== null || row === null) {
        return { ok: false, reason: reason ?? "invalid" };
      }
      return {
        ok: true,
        subject: row.subject,
        data: parseData(row.data),
        expiresAt: row.expiresAt,
      };
    },

    async consumeToken(input, txOption) {
      const purpose = checkPurpose(input.purpose);
      return write("secrets.consumeToken", txOption?.tx, async adapterTx => {
        const at = now();
        // The spend: one conditional update, won by exactly one caller.
        const spent = await adapterTx.updateCount(
          ONE_TIME_SECRETS_TABLE,
          // The live key goes with the spend, so a later replacing mint does
          // not meet this spent token on the key's unique index.
          { spentAt: at, liveKey: null },
          {
            and: [
              ...ownerWhere(purpose),
              { column: "kind", op: "=", value: "token" },
              {
                column: "secretHash",
                op: "IN",
                value: tokenHashes(purpose, input.token),
              },
              ...unspent,
              { column: "expiresAt", op: ">", value: at },
            ],
          }
        );
        const row = await readTokenRow(purpose, input.token, adapterTx);
        if (spent === 1 && row !== null) {
          return { ok: true, subject: row.subject, data: parseData(row.data) };
        }
        return { ok: false, reason: refusal(row, at) ?? "spent" };
      });
    },

    async consumeCode(input) {
      const purpose = checkPurpose(input.purpose);
      const subject = checkSubject(input.subject);
      const adapter = options.adapter();
      // Before anything is read: a code's charge must never join a
      // transaction that could roll it back.
      assertNoOpenTransaction(adapter, "secrets.consumeCode");
      const liveKey = liveKeyFor(purpose, subject);

      // The live code this attempt is judged against: the first one read. A
      // retry that finds another in its place lost to a replacing mint, and
      // the submitted code answered the earlier code, not this one: it is
      // neither accepted nor charged against the replacement.
      let judged: string | undefined;
      for (let attempt = 0; attempt < 32; attempt++) {
        const at = now();
        const [row] = await adapter.select<SecretRow>(ONE_TIME_SECRETS_TABLE, {
          where: { and: [{ column: "liveKey", op: "=", value: liveKey }] },
        });
        if (row === undefined) return { ok: false, reason: await noLiveCode() };
        judged ??= row.id;
        if (row.id !== judged) return { ok: false, reason: "none" };
        if (row.expiresAt.getTime() <= at.getTime()) {
          return { ok: false, reason: "expired" };
        }
        const max = row.maxWrongTries ?? 1;
        const right = keys().some(key =>
          sameHex(codeHash(key, purpose, subject, input.code), row.secretHash)
        );
        const settled = await adapter.transaction(adapterTx =>
          adapterTx.updateCount(
            ONE_TIME_SECRETS_TABLE,
            right
              ? { spentAt: at, liveKey: null }
              : row.wrongTries + 1 >= max
                ? {
                    wrongTries: row.wrongTries + 1,
                    voidedAt: at,
                    liveKey: null,
                  }
                : { wrongTries: row.wrongTries + 1 },
            {
              and: [
                { column: "id", op: "=", value: row.id },
                // The count just read: a charge made meanwhile on another
                // instance makes this one lose, and it reads again.
                { column: "wrongTries", op: "=", value: row.wrongTries },
                ...unspent,
              ],
            }
          )
        );
        if (settled !== 1) continue;
        if (right) return { ok: true, data: parseData(row.data) };
        return {
          ok: false,
          reason: "wrong",
          triesLeft: Math.max(0, max - (row.wrongTries + 1)),
        };
      }
      throw NextlyError.conflict({
        logContext: { operation: "secrets.consumeCode", reason: "contention" },
      });

      /**
       * Why there is no live code: the newest one issued for the subject says,
       * newest by issue number. Not by expiry, as a short code minted after a
       * long one expires first, and not by issue time, which ties within a
       * second on SQLite and MySQL.
       */
      async function noLiveCode(): Promise<"none" | "expired" | "spent"> {
        const [newest] = await adapter.select<Pick<SecretRow, "spentAt">>(
          ONE_TIME_SECRETS_TABLE,
          {
            columns: ["spentAt"],
            where: { and: codesOf(subjectKeyFor(subject), purpose) },
            orderBy: [{ column: "issueSeq", direction: "desc" }],
            limit: 1,
          }
        );
        return newest?.spentAt ? "spent" : "none";
      }
    },

    async voidFor(input, txOption) {
      const subject = checkSubject(input.subject);
      const purposes = input.purposes?.map(checkPurpose);
      const voided = await write("secrets.voidFor", txOption?.tx, adapterTx =>
        adapterTx.updateCount(
          ONE_TIME_SECRETS_TABLE,
          { voidedAt: now(), liveKey: null },
          subjectWhere(subjectKeyFor(subject), purposes)
        )
      );
      return { voided };
    },
  };
}

/** Every code of a subject (by its key, which names the plugin too) and purpose. */
function codesOf(subjectKey: string, purpose: string): WhereClause["and"] {
  return [
    { column: "subjectKey", op: "=", value: subjectKey },
    { column: "purpose", op: "=", value: purpose },
    { column: "kind", op: "=", value: "code" },
  ];
}

/**
 * The unspent, unvoided secrets of a subject (by its key, which names the
 * plugin too), of the purposes named.
 */
function subjectWhere(
  subjectKey: string,
  purposes?: readonly string[],
  kind?: "token" | "code"
): WhereClause {
  return {
    and: [
      { column: "subjectKey", op: "=", value: subjectKey },
      ...(purposes
        ? [{ column: "purpose", op: "IN" as const, value: [...purposes] }]
        : []),
      ...(kind ? [{ column: "kind", op: "=" as const, value: kind }] : []),
      { column: "spentAt", op: "IS NULL" },
      { column: "voidedAt", op: "IS NULL" },
    ],
  };
}

/**
 * Run `attempt`, and run it again (up to three more times) when it loses a
 * race: one helper for every mint that takes a unique key, so the token and
 * code mints cannot drift apart in how they retry.
 */
async function retryLostRace<R>(attempt: () => Promise<R>): Promise<R> {
  for (let tries = 0; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      if (tries >= 3 || !lostRace(error)) throw error;
    }
  }
}

/** Codes a database gives a transaction it ended to resolve a race. */
const RACE_CODES = new Set(["40P01", "40001", "1213", "ER_LOCK_DEADLOCK"]);

/**
 * Whether the error is a transaction losing a race that running it again
 * resolves: a unique violation, a deadlock or a serialization failure,
 * anywhere in its cause chain.
 */
function lostRace(error: unknown): boolean {
  if (isUniqueViolation(error)) return true;
  for (let link = error, depth = 0; link != null && depth < 8; depth++) {
    const code = safeCode(link);
    if (code !== undefined && RACE_CODES.has(code)) return true;
    link = link instanceof Error ? link.cause : undefined;
  }
  return false;
}

/** Why a token row would be refused now, or null when it would be accepted. */
function refusal(
  row: SecretRow | null,
  at: Date
): "invalid" | "expired" | "spent" | null {
  if (row === null || row.voidedAt !== null) return "invalid";
  if (row.spentAt !== null) return "spent";
  if (row.expiresAt.getTime() <= at.getTime()) return "expired";
  return null;
}

/** The key for one of the install's secrets, derived for this use alone. */
const keyCache = new Map<string, Buffer>();
function secretKey(secret: string): Buffer {
  let key = keyCache.get(secret);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", secret, "", KEY_INFO, 32));
    keyCache.set(secret, key);
  }
  return key;
}

/** HMAC-SHA-256 of the parts, NUL-separated (no part may contain NUL), in hex. */
function hmac(key: Buffer, parts: readonly string[]): string {
  return createHmac("sha256", key)
    .update(parts.join("\u0000"), "utf8")
    .digest("hex");
}

function sameHex(a: string, b: string): boolean {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}

function invalid(path: string, message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path, code: "INVALID_INPUT", message }],
  });
}

function checkPurpose(purpose: string): string {
  if (typeof purpose === "string" && PURPOSE.test(purpose)) return purpose;
  throw invalid(
    "purpose",
    "purpose must be a lowercase letter followed by up to 63 lowercase letters, digits, dots or hyphens."
  );
}

function checkSubject(subject: string): string {
  if (
    typeof subject === "string" &&
    subject.length > 0 &&
    subject.length <= BOUNDS.subjectLength &&
    !subject.includes("\u0000") &&
    // Lone surrogates all encode to one replacement character, so two such
    // subjects would share a key and reach each other's secrets.
    isWellFormed(subject)
  ) {
    return subject;
  }
  throw invalid(
    "subject",
    `subject must be from 1 to ${BOUNDS.subjectLength} characters of well-formed Unicode.`
  );
}

function checkWhole(
  path: string,
  value: number,
  bound: { readonly lowest: number; readonly highest: number }
): number {
  if (
    Number.isInteger(value) &&
    value >= bound.lowest &&
    value <= bound.highest
  ) {
    return value;
  }
  throw invalid(
    path,
    `${path} must be a whole number from ${bound.lowest} to ${bound.highest}.`
  );
}

/**
 * The data as stored: JSON of a flat record of primitives, at most 1 KB. Only
 * a plain object qualifies: a `Date`, a class instance or anything with its
 * own serialisation would store a shape other than the one validated. Its
 * entries are read once and those are what is serialised, so a getter cannot
 * answer one thing to the check and another to the store.
 */
function serialiseData(data: SecretData | undefined): string | null {
  if (data === undefined) return null;
  const entries = plainEntries(data);
  const json =
    entries !== undefined && entries.every(([, value]) => isStoredValue(value))
      ? JSON.stringify(Object.fromEntries(entries))
      : undefined;
  if (
    json === undefined ||
    Buffer.byteLength(json, "utf8") > BOUNDS.dataBytes
  ) {
    throw invalid(
      "data",
      `data must be a plain object: a flat record of strings, finite numbers, booleans and nulls, at most ${BOUNDS.dataBytes} bytes as JSON.`
    );
  }
  return json;
}

/** The entries of a plain object (plain or null prototype), read once; else undefined. */
function plainEntries(value: unknown): [string, unknown][] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? Object.entries(value)
    : undefined;
}

/** A value `data` may hold: a string, a finite number, a boolean or null. */
function isStoredValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function parseData(stored: string | null): SecretData | null {
  return stored === null ? null : (JSON.parse(stored) as SecretData);
}
