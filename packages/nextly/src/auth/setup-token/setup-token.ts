/**
 * The one-time token that opens first-administrator setup in production.
 *
 * Until an install has an administrator, whoever reaches its setup route could
 * create one. In production the route therefore needs this token: either the
 * operator's own (`NEXTLY_SETUP_TOKEN`), or one generated at the first start,
 * printed once to the server's output and kept only as a digest, in
 * `nextly_meta`, where every server instance reads it.
 *
 * A generated token is valid for 24 hours. Creating, printing and replacing it
 * are serialised through compare-and-set writes on its one row, so the token
 * printed last is always the one setup accepts: a start prints only the token
 * it marked printed itself, and a replacement waits for a creation in progress
 * to print before replacing it.
 *
 * @module auth/setup-token
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** The `nextly_meta` key the generated token's record lives under. */
export const SETUP_TOKEN_META_KEY = "auth.setup-token";

/** The environment variable an operator sets their own token in. */
export const SETUP_TOKEN_ENV = "NEXTLY_SETUP_TOKEN";

/** How long a generated token is accepted. */
export const SETUP_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * How long a replacement waits for a creation in progress to print. A record
 * still unprinted after this is taken as lost (its creator stopped between
 * storing and printing), and is replaced.
 */
export const SETUP_TOKEN_PRINT_GRACE_MS = 10_000;

/** The searchable prefix of every line this module prints. */
export const SETUP_TOKEN_LOG_PREFIX = "[nextly] SETUP TOKEN";

/**
 * The fewest characters, and distinct characters, an operator's token may
 * have. A valid token opens setup whatever the auth rate limit holds, so the
 * token's own strength is what makes guessing it infeasible: 43 random
 * base64url characters carry 256 bits.
 */
export const OPERATOR_TOKEN_MIN_LENGTH = 43;
export const OPERATOR_TOKEN_MIN_DISTINCT = 16;

/** The stored record of a generated token. Never the token itself. */
export interface SetupTokenRecord {
  digest: string;
  createdAt: number;
  printed: boolean;
}

/** The slice of `MetaService` the token's row is read and written through. */
export interface SetupTokenMeta {
  getEntry<T>(
    key: string
  ): Promise<{ present: true; value: T | null } | { present: false }>;
  insertIfAbsent(key: string, value: unknown): Promise<void>;
  compareAndSet(
    key: string,
    expected: unknown,
    next: unknown
  ): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/** What the operator's environment says about the token. */
export type OperatorToken =
  | { kind: "absent" }
  | { kind: "weak" }
  | { kind: "set"; value: string };

/**
 * Read the operator's token. Set but empty, shorter than 43 characters, or
 * made of fewer than 16 distinct characters is `weak`: setup then stays
 * closed rather than open to guessing.
 */
export function operatorSetupToken(
  env: Readonly<Record<string, string | undefined>> = process.env
): OperatorToken {
  const value = env[SETUP_TOKEN_ENV];
  if (value === undefined) return { kind: "absent" };
  if (
    value.length < OPERATOR_TOKEN_MIN_LENGTH ||
    new Set(value).size < OPERATOR_TOKEN_MIN_DISTINCT
  ) {
    return { kind: "weak" };
  }
  return { kind: "set", value };
}

/** A fresh token: 32 random bytes, 43 base64url characters, 256 bits. */
export function generateSetupToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The digest a token is kept and compared as. */
export function setupTokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Whether two digests are equal, compared in constant time. */
function digestsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function isRecord(value: unknown): value is SetupTokenRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.digest === "string" &&
    typeof record.createdAt === "number" &&
    typeof record.printed === "boolean"
  );
}

/** The stored generated token's record, or `null` when there is none. */
export async function readSetupTokenRecord(
  meta: SetupTokenMeta
): Promise<SetupTokenRecord | null> {
  const entry = await meta.getEntry<unknown>(SETUP_TOKEN_META_KEY);
  return entry.present && isRecord(entry.value) ? entry.value : null;
}

function expired(record: SetupTokenRecord, now: number): boolean {
  return now - record.createdAt >= SETUP_TOKEN_LIFETIME_MS;
}

/**
 * The line that hands the operator a token: a fixed prefix to search any
 * host's logs for, the token, and where to use it.
 */
export function setupTokenLine(token: string, address: string): string {
  return (
    `${SETUP_TOKEN_LOG_PREFIX} ${token} — open ${address} and enter it to ` +
    "create the first administrator. Valid for 24 hours and for one setup. " +
    "Lost it? Run `nextly setup-token` against this database for a new one."
  );
}

/**
 * Where an operator opens setup. The host when the platform says what it is
 * (Vercel's production URL), the path otherwise.
 */
export function setupAddress(
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  const host = env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}/admin/setup` : "/admin/setup on this site";
}

/** What a production start did about the token, for its caller to log. */
export type BootTokenOutcome =
  | { kind: "administrator-exists" }
  | { kind: "operator-token" }
  | { kind: "operator-token-weak" }
  | { kind: "printed"; line: string }
  | { kind: "already-issued" };

/** A new token and the record it is stored as. */
function freshRecord(
  createdAt: number,
  printed: boolean
): { token: string; record: SetupTokenRecord } {
  const token = generateSetupToken();
  return {
    token,
    record: { digest: setupTokenDigest(token), createdAt, printed },
  };
}

/**
 * Store `next` in place of `current`, or as the first record when there is
 * none; true when this write is the one stored. Both ways are conditional, so
 * of two writers racing from one reading exactly one wins.
 */
async function storeOver(
  meta: SetupTokenMeta,
  current: SetupTokenRecord | null,
  next: SetupTokenRecord
): Promise<boolean> {
  if (current) {
    return meta.compareAndSet(SETUP_TOKEN_META_KEY, current, next);
  }
  await meta.insertIfAbsent(SETUP_TOKEN_META_KEY, next);
  const stored = await readSetupTokenRecord(meta);
  return stored?.digest === next.digest;
}

/**
 * A creation in progress: stored but not printed yet, and younger than the
 * print grace. One older than that is taken as lost.
 */
function creationInProgress(
  record: SetupTokenRecord | null,
  now: number
): boolean {
  return (
    record !== null &&
    !record.printed &&
    now - record.createdAt < SETUP_TOKEN_PRINT_GRACE_MS
  );
}

/**
 * Discard any generated token when none is needed, and say why: the install
 * has an administrator, or the operator's variable sets the token (so a token
 * printed before the variable was set never becomes valid again, even after it
 * is removed). Null when a generated token is needed.
 */
async function discardWhenNotNeeded(
  meta: SetupTokenMeta,
  hasAdministrator: () => Promise<boolean>,
  env: Readonly<Record<string, string | undefined>>
): Promise<BootTokenOutcome | null> {
  if (await hasAdministrator()) {
    await meta.delete(SETUP_TOKEN_META_KEY);
    return { kind: "administrator-exists" };
  }
  const operator = operatorSetupToken(env);
  if (operator.kind === "absent") return null;
  await meta.delete(SETUP_TOKEN_META_KEY);
  return {
    kind: operator.kind === "weak" ? "operator-token-weak" : "operator-token",
  };
}

/**
 * At a production start: make sure an install with no administrator has a
 * usable token, printing a new one once.
 *
 * With an administrator, any stored token is discarded. With the operator's
 * variable set, any generated token is discarded, so a token printed before the
 * variable was set never becomes valid again, even after it is removed. Else a
 * token is created when none is stored, or replaced when the stored one has
 * expired, and printed by the start that marked it printed: of two starts
 * against one database, exactly one prints.
 */
export async function ensureSetupTokenAtBoot(input: {
  meta: SetupTokenMeta;
  hasAdministrator: () => Promise<boolean>;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
}): Promise<BootTokenOutcome> {
  const { meta, hasAdministrator } = input;
  const env = input.env ?? process.env;
  const now = input.now ?? Date.now;

  const notNeeded = await discardWhenNotNeeded(meta, hasAdministrator, env);
  if (notNeeded) return notNeeded;

  const current = await readSetupTokenRecord(meta);
  if (current && !expired(current, now())) return { kind: "already-issued" };
  const { token, record: fresh } = freshRecord(now(), false);
  if (!(await storeOver(meta, current, fresh))) {
    return { kind: "already-issued" };
  }
  // Marked printed before printing, and printed only if that write wins: a
  // replacement made in between fails it, and its token is the one printed.
  const printed: SetupTokenRecord = { ...fresh, printed: true };
  if (!(await meta.compareAndSet(SETUP_TOKEN_META_KEY, fresh, printed))) {
    return { kind: "already-issued" };
  }
  return { kind: "printed", line: setupTokenLine(token, setupAddress(env)) };
}

/** What a replacement did, for the command to print. */
export type ReplaceTokenOutcome =
  | { kind: "operator-token" }
  | { kind: "printed"; line: string };

/**
 * Replace the generated token and return the line with the new one, for a
 * platform whose server output is hard to reach.
 *
 * Refused while the operator's variable sets the token: there is no generated
 * one, and the variable is changed where it is set. A creation in progress
 * (stored, not yet printed, younger than the print grace) is waited for, so
 * its token is never printed after this one; one older than that is taken as
 * lost and replaced.
 */
export async function replaceSetupToken(input: {
  meta: SetupTokenMeta;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}): Promise<ReplaceTokenOutcome> {
  const { meta } = input;
  const env = input.env ?? process.env;
  const now = input.now ?? Date.now;
  const wait =
    input.wait ??
    ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  if (operatorSetupToken(env).kind !== "absent") {
    return { kind: "operator-token" };
  }

  for (;;) {
    const current = await readSetupTokenRecord(meta);
    if (creationInProgress(current, now())) {
      await wait(250);
      continue;
    }
    const { token, record } = freshRecord(now(), true);
    if (await storeOver(meta, current, record)) {
      return {
        kind: "printed",
        line: setupTokenLine(token, setupAddress(env)),
      };
    }
  }
}

/**
 * Discard the stored generated token, once the install has its
 * administrator: no token opens setup again. Every path that creates the
 * first administrator spends it through this, so none leaves a token behind.
 */
export async function spendSetupToken(meta: SetupTokenMeta): Promise<void> {
  await meta.delete(SETUP_TOKEN_META_KEY);
}

/** Whether a presented token opens setup now. */
export type TokenVerdict = "valid" | "invalid" | "closed";

/**
 * Judge a presented token against the operator's variable, or else the stored
 * generated token. `closed` when the variable is set but too weak: no token
 * then opens setup. Wrong, missing and expired tokens are all `invalid`, so
 * none can be told from another.
 *
 * `readRecord` answers the stored record; the caller keeps it current, so a
 * replaced token is refused everywhere within a second.
 */
export async function verifySetupToken(input: {
  presented: unknown;
  readRecord: () => Promise<SetupTokenRecord | null>;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
}): Promise<TokenVerdict> {
  const env = input.env ?? process.env;
  const now = input.now ?? Date.now;
  const operator = operatorSetupToken(env);
  if (operator.kind === "weak") return "closed";
  const presented = typeof input.presented === "string" ? input.presented : "";
  const digest = setupTokenDigest(presented);
  if (operator.kind === "set") {
    return digestsEqual(digest, setupTokenDigest(operator.value))
      ? "valid"
      : "invalid";
  }
  const record = await input.readRecord();
  if (!record || expired(record, now())) return "invalid";
  return digestsEqual(digest, record.digest) ? "valid" : "invalid";
}

/**
 * A reader of the stored record that answers from a copy at most `maxAgeMs`
 * old, so a flood of wrong tokens costs one row read a second per process,
 * and a replacement is seen everywhere within that second.
 */
export function cachedRecordReader(
  meta: SetupTokenMeta,
  maxAgeMs = 1000,
  now: () => number = Date.now
): () => Promise<SetupTokenRecord | null> {
  let copy: { record: SetupTokenRecord | null; readAt: number } | undefined;
  return async () => {
    const at = now();
    if (copy && at - copy.readAt < maxAgeMs) return copy.record;
    const record = await readSetupTokenRecord(meta);
    copy = { record, readAt: at };
    return record;
  };
}
