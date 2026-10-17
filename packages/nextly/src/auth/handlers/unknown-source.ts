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
import { verifyPendingToken } from "../pipeline/pending-token";

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
  const key = Buffer.from(hkdfSync("sha256", secret, "", ACCOUNT_KEY_INFO, 32));
  const digest = createHmac("sha256", key).update(normalized).digest("hex");
  return `auth-unknown:account:${digest}`;
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

/**
 * The JSON object a request carries, or an empty one when it carries none or
 * one too large to be worth reading.
 */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const bytes = await boundedBody(request, LIMITER_BODY_BYTES);
    if (bytes === null) return {};
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
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

/** Where this deployment counts unknown-source admissions. */
function counterFor(deps: AuthRouterDeps): UnknownSourceCounter {
  const { unknownSourceCounter, store } = deps.authRateLimit;
  if (unknownSourceCounter) return unknownSourceCounter;
  return store === undefined
    ? memoryUnknownSourceCounter
    : new StoreUnknownSourceCounter(authRateLimiter(store));
}

/**
 * Admit or refuse an auth request whose client address cannot be resolved.
 * The caller has already established that the limiter is enabled.
 */
export async function admitUnknownSource(
  request: Request,
  authPath: string,
  deps: AuthRouterDeps
): Promise<UnknownSourceVerdict> {
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
  if (met) return met;
  const body = await readBody(request);

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
