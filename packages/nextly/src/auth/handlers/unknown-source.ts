/**
 * Which budget an auth request from an unresolvable client address counts
 * against.
 *
 * With no address to key on, a request is keyed on the account it names: the
 * body's email, spelled as the account lookup spells it, whether or not an
 * account has that address, so a refusal says nothing about which addresses
 * exist. A request that names its account through a token (a reset, an email
 * verification, an invite, or a pending sign-in) is keyed on the account the
 * token belongs to, so tokens that belong to nobody cannot spend a real
 * account's budget, or be spent by it. Anything else (a body naming no
 * address, a token that binds to no account) shares one account-less budget
 * that no keyed request touches.
 *
 * Every admission also spends a ceiling of {@link UNKNOWN_SOURCE_CEILING_MULTIPLE}
 * times the budget, shared by all of them, so inventing addresses buys no
 * capacity. The counting rules themselves are in
 * `auth/middleware/unknown-source-counter`.
 *
 * @module auth/handlers/unknown-source
 */
import { createHmac, hkdfSync } from "node:crypto";

import type { RateLimitStore } from "../../middleware/rate-limit";
import { presentedPendingToken } from "../cookies/pending-cookie";
import { normalizeAccountEmail } from "../credentials/account-email";
import { authRateLimiter } from "../middleware/rate-limiter";
import {
  memoryUnknownSourceCounter,
  StoreUnknownSourceCounter,
  type UnknownSourceCounter,
  type UnknownSourceLimits,
  type UnknownSourceVerdict,
} from "../middleware/unknown-source-counter";
import { namesAccountKey } from "../pipeline/password-strategy";
import { verifyPendingToken } from "../pipeline/pending-token";
import { limitKeyFor } from "../pipeline/strategy-chain";
import type { AuthStrategy } from "../pipeline/types";

import type { AuthRouterDeps } from "./router";

/**
 * The ceiling on every unknown-source admission, as a multiple of the
 * per-account budget: 3,000 an hour at the default 30. Sized so ordinary
 * sign-in traffic never reaches it while unbounded credential stuffing still
 * cannot run.
 */
export const UNKNOWN_SOURCE_CEILING_MULTIPLE = 100;

/** The stored tokens whose owner the limiter can ask about. */
export type StoredTokenKind = "reset" | "verification" | "invite";

/**
 * The routes that consume a token, and where it is read from. A pending token
 * is signed and names its account; the others are looked up in the database.
 */
const TOKEN_ROUTES: Readonly<Record<string, StoredTokenKind | "pending">> = {
  "reset-password": "reset",
  "verify-email": "verification",
  "accept-invite": "invite",
  "set-initial-password": "pending",
  "challenge/resolve": "pending",
};

/** The budget shared by requests that bind to no account. */
const ACCOUNTLESS_KEY = "auth-unknown:no-account";

/** What this use of the install's secret is called, so its derived key is its own. */
const ACCOUNT_KEY_INFO = "nextly auth limit account keys";

/**
 * The key an account's budget is counted under.
 *
 * An HMAC under a key derived from the install's secret for this use alone,
 * not a bare hash: an email address has too little entropy for a hash to hide
 * it, so anyone who could read a shared store's keys could recover addresses
 * by hashing a list of guesses. Without the secret, a key names nothing.
 */
function accountKey(email: string | null, secret: string): string {
  if (email === null) return ACCOUNTLESS_KEY;
  const normalized = normalizeAccountEmail(email);
  if (normalized === "") return ACCOUNTLESS_KEY;
  return `auth-unknown:account:${keyedDigest(ACCOUNT_KEY_INFO, normalized, secret)}`;
}

/**
 * The HMAC every limiter key is made of: under a key derived from the
 * install's secret for the use `info` names alone, so no two uses share a
 * key, and a stored key names nothing without the secret.
 */
function keyedDigest(info: string, input: string, secret: string): string {
  const derived = Buffer.from(hkdfSync("sha256", secret, "", info, 32));
  return createHmac("sha256", derived).update(input).digest("hex");
}

/** What the strategy-key use of the install's secret is called. */
const STRATEGY_KEY_INFO = "nextly auth limit strategy keys";

/**
 * The key a strategy's budget for `key` is counted under, as `accountKey` is
 * for an email: an HMAC under a key derived for this use alone, so a stored
 * key names no credential. The strategy's name is part of what is hashed, so
 * two strategies naming the same string share nothing, and every key is one
 * size however long the credential a strategy names.
 */
function strategyKey(name: string, key: string | null, secret: string): string {
  if (key === null || key === "") return ACCOUNTLESS_KEY;
  return `auth-unknown:strategy:${keyedDigest(STRATEGY_KEY_INFO, `${name}\0${key}`, secret)}`;
}

/** What the plugin-route use of the install's secret is called. */
const PLUGIN_ROUTE_KEY_INFO = "nextly plugin auth route limit keys";

/**
 * The key a plugin auth route's budget for the identity `key` is counted
 * under, as `strategyKey` is for a strategy: an HMAC under a key derived for
 * this use alone. The plugin's name is part of what is hashed, so two plugins
 * naming the same identity share no budget. `null` when the route named none.
 */
export function pluginRouteLimitKey(
  pluginName: string,
  key: string | null,
  secret: string
): string | null {
  if (key === null || key === "") return null;
  return `plugin-auth-unknown:identity:${keyedDigest(PLUGIN_ROUTE_KEY_INFO, `${pluginName}\0${key}`, secret)}`;
}

/**
 * Whether a sign-in's key is the strategies' to name: the app has a strategy
 * of its own, and the first in the chain can answer the question. With no
 * strategy of its own, the password strategy's email keying applies exactly
 * as for every other route; with a first strategy that cannot answer, the
 * chain cannot be asked at all.
 */
function strategiesNameTheKey(strategies: readonly AuthStrategy[]): boolean {
  const [first] = strategies;
  return (
    first?.limitKey !== undefined &&
    strategies.some(strategy => !namesAccountKey(strategy))
  );
}

/** The key a sign-in is counted under, from what its strategies answered. */
function signInKey(
  named: Awaited<ReturnType<typeof limitKeyFor>>,
  body: Record<string, unknown>,
  secret: string
): string {
  if (named === "unanswerable") {
    // A strategy that cannot answer may claim the request, so the chain is
    // keyed as a sign-in with no strategies of its own is.
    const email = stringField(body, "email");
    return accountKey(email === "" ? null : email, secret);
  }
  if (named.strategy === null) return ACCOUNTLESS_KEY;
  return namesAccountKey(named.strategy)
    ? accountKey(named.key, secret)
    : strategyKey(named.strategy.name, named.key, secret);
}

/**
 * The most of a body the limiter reads to find the address or token it
 * names. Those are short strings near the top of a small JSON object; a body
 * larger than this names nothing the limiter will act on, and counts against
 * the account-less budget. The handler still reads the whole body.
 */
const LIMITER_BODY_BYTES = 32 * 1024;

/** The first `limit` bytes of a request's body, or `null` past them. */
async function boundedBody(
  request: Request,
  limit: number
): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  // A clone, because the handler that runs next reads the body itself.
  const stream = request.clone().body;
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      // A declared length can be absent or wrong; stop reading here either
      // way. Not awaited: cancelling one branch of a cloned body settles only
      // once the other branch is cancelled too, and the handler is about to
      // read that one to its end.
      reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** What the limiter made of a request's body. */
interface LimiterBodyRead {
  /** The JSON object it carries, or an empty one. */
  body: Record<string, unknown>;
  /**
   * Whether the body is larger than the limiter reads, so it stopped with
   * the rest unread: the handler that runs next still reads all of it, at
   * whatever pace the client sends it.
   */
  overLimit: boolean;
}

/** The limiter's one read of a body, for every caller that judges by it. */
async function readBodyForLimiter(request: Request): Promise<LimiterBodyRead> {
  let bytes: Uint8Array | null;
  try {
    bytes = await boundedBody(request, LIMITER_BODY_BYTES);
  } catch {
    // An aborted or failed read: the body is gone, so nothing is left to send.
    return { body: {}, overLimit: false };
  }
  if (bytes === null) return { body: {}, overLimit: true };
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return {
      body:
        body !== null && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : {},
      overLimit: false,
    };
  } catch {
    return { body: {}, overLimit: false };
  }
}

/**
 * The JSON object a request carries, or an empty one when it carries none or
 * one too large to be worth reading.
 */
export async function readLimiterBody(
  request: Request
): Promise<Record<string, unknown>> {
  return (await readBodyForLimiter(request)).body;
}

/**
 * Unknown-source bodies this process is reading right now, across every
 * deployment counter: what a client holding bodies open occupies is this
 * process's connections and reads, whichever store keeps the windows.
 */
let bodiesBeingRead = 0;

/**
 * How long a request refused for want of a reading place is told to wait. A
 * place frees when any body being read ends, which no window predicts, so
 * this is the shortest wait a client is ever told.
 */
const READING_PLACE_RETRY_MS = 1_000;

/**
 * The limiter's view of a request's body, or the ceiling's refusal when as
 * many bodies are already being read as the ceiling admits.
 *
 * A body is read before the request spends anything, because a plain sign-in
 * may spend the ceiling only once its budget admits it, and its budget is the
 * account the body names. Nothing else bounded those reads, so a client could
 * hold any number of bodies open below the ceiling, none counted until it
 * completed. Counting the reads themselves bounds that without spending: a
 * refused request reads nothing, and spends no budget and no ceiling place.
 * The place is given back once the read ends, completed or aborted. A body
 * over the byte limit is not done when the limiter stops: its handler reads
 * the rest, which the client can hold open, so its place comes back with it,
 * as {@link ReadingPlace}, to be given back once that handler has answered.
 */
async function readWithinReadingBound(
  request: Request,
  limits: UnknownSourceLimits
): Promise<
  | { body: Record<string, unknown>; place?: ReadingPlace }
  | Extract<UnknownSourceVerdict, { allowed: false }>
> {
  if (bodiesBeingRead >= limits.ceiling) {
    return {
      allowed: false,
      by: "ceiling",
      resetAt: Date.now() + READING_PLACE_RETRY_MS,
    };
  }
  bodiesBeingRead++;
  let place: ReadingPlace | undefined;
  try {
    const read = await readBodyForLimiter(request);
    if (read.overLimit) place = heldReadingPlace();
    return { body: read.body, place };
  } finally {
    if (place === undefined) bodiesBeingRead--;
  }
}

/**
 * A reading place still held once the limiter is done with a request, for a
 * body its handler is still to read. Giving it back twice gives back one.
 */
export interface ReadingPlace {
  release(): void;
}

function heldReadingPlace(): ReadingPlace {
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      bodiesBeingRead--;
    },
  };
}

function stringField(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  return typeof value === "string" ? value : "";
}

/**
 * The address of the account `token` belongs to, or `null` when it belongs to
 * none or cannot be told. Reads only: the handler still consumes the token.
 * A failure is `null` rather than a throw: the request then counts against
 * the account-less budget, and the handler answers it as it would anyway.
 */
async function tokenOwner(
  kind: StoredTokenKind | "pending",
  token: string,
  deps: AuthRouterDeps
): Promise<string | null> {
  try {
    if (kind !== "pending") {
      return (await deps.findTokenOwner?.(kind, token)) ?? null;
    }
    const pending = await verifyPendingToken(token, deps.secret);
    return (await deps.findUserById(pending.userId))?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Where core's own limits count for these deps: `counts`, or a store given
 * directly as `store` where nothing registered `counts`.
 */
export function countsOf(
  limits: Pick<AuthRouterDeps["authRateLimit"], "counts" | "store">
): RateLimitStore | undefined {
  return limits.counts ?? limits.store;
}

/** Where this deployment counts unknown-source admissions. */
function counterFor(deps: AuthRouterDeps): UnknownSourceCounter {
  const { unknownSourceCounter } = deps.authRateLimit;
  if (unknownSourceCounter) return unknownSourceCounter;
  const counts = countsOf(deps.authRateLimit);
  return counts === undefined
    ? memoryUnknownSourceCounter
    : new StoreUnknownSourceCounter(authRateLimiter(counts));
}

/**
 * The limiter's answer for an unknown-source auth request: its verdict, and
 * for an admitted request whose body is still to be read past the limiter's
 * bound, the reading place its handler gives back once it has answered.
 */
export interface UnknownSourceAdmission {
  verdict: UnknownSourceVerdict;
  place?: ReadingPlace;
}

/**
 * Admit or refuse an auth request whose client address cannot be resolved.
 * The caller has already established that the limiter is enabled.
 */
export async function admitUnknownSource(
  request: Request,
  authPath: string,
  deps: AuthRouterDeps
): Promise<UnknownSourceAdmission> {
  const budget = deps.authRateLimit.requestsPerHour;
  const limits: UnknownSourceLimits = {
    budget,
    ceiling: budget * UNKNOWN_SOURCE_CEILING_MULTIPLE,
    windowMs: deps.authRateLimit.windowMs,
  };
  const counter = counterFor(deps);
  // A met ceiling refuses every request it would, so it refuses before the
  // body is read: past the ceiling, a request costs no reading and no parse.
  const met = await counter.ceilingMet(limits);
  if (met) return { verdict: met };
  const read = await readWithinReadingBound(request, limits);
  if ("allowed" in read) return { verdict: read };
  let verdict: UnknownSourceVerdict;
  try {
    verdict = await judgeByBody(
      request,
      authPath,
      deps,
      counter,
      limits,
      read.body
    );
  } catch (error) {
    read.place?.release();
    throw error;
  }
  // A refused request never reaches its handler, so a held place is given
  // back now; an admitted one keeps it until the handler has answered.
  if (!verdict.allowed) {
    read.place?.release();
    return { verdict };
  }
  return { verdict, place: read.place };
}

/** The verdict for a request whose body the limiter has read. */
async function judgeByBody(
  request: Request,
  authPath: string,
  deps: AuthRouterDeps,
  counter: UnknownSourceCounter,
  limits: UnknownSourceLimits,
  body: Record<string, unknown>
): Promise<UnknownSourceVerdict> {
  const strategies = deps.authStrategies ?? [];
  if (authPath === "login" && strategiesNameTheKey(strategies)) {
    // Asking the strategies is the work the ceiling bounds, so the ceiling is
    // spent first, as a token route spends it before its lookup.
    const arrival = await counter.arrive(limits);
    if (!arrival.allowed) return arrival;
    const named = await limitKeyFor(strategies, { request, body });
    return counter.admitArrived(
      signInKey(named, body, deps.secret),
      limits,
      arrival.at
    );
  }

  const tokenKind = TOKEN_ROUTES[authPath];
  if (tokenKind === undefined) {
    // The email the body names is the credential the built-in password
    // strategy consumes. A strategy an app adds that authenticates from
    // another field is not keyed on what it reads, so its requests are bounded
    // by the ceiling alone rather than per identity.
    const email = stringField(body, "email");
    return counter.admit(
      accountKey(email === "" ? null : email, deps.secret),
      limits
    );
  }
  return judgeTokenRequest(request, tokenKind, deps, counter, limits, body);
}

/** The verdict for a request that names its account through a token. */
async function judgeTokenRequest(
  request: Request,
  tokenKind: StoredTokenKind | "pending",
  deps: AuthRouterDeps,
  counter: UnknownSourceCounter,
  limits: UnknownSourceLimits,
  body: Record<string, unknown>
): Promise<UnknownSourceVerdict> {
  const token =
    tokenKind === "pending"
      ? presentedPendingToken(body, request)
      : stringField(body, "token");
  // No token, no lookup: such a request is classified without any work, so it
  // is admitted as any other is, ceiling and budget judged together.
  if (token === "") return counter.admit(ACCOUNTLESS_KEY, limits);

  // The lookup is the work the ceiling bounds, so the ceiling is spent first,
  // and a met ceiling refuses before anything is looked up.
  const arrival = await counter.arrive(limits);
  if (!arrival.allowed) return arrival;
  const owner = await tokenOwner(tokenKind, token, deps);
  return counter.admitArrived(
    accountKey(owner, deps.secret),
    limits,
    arrival.at
  );
}
