import { SignJWT, jwtVerify } from "jose";

import { derivePurposeKey, TRANSACTION_KEY_LABEL } from "./keys";

/**
 * How long a started login may sit unfinished before its transaction expires.
 *
 * Ten minutes is enough for a consent screen, a password prompt and a second
 * factor at the provider, and short enough that an abandoned transaction stops
 * being a replayable artifact quickly.
 */
export const TRANSACTION_TTL_SECONDS = 600;

/** The `typ` claim marking a token as an SSO transaction record. */
const TRANSACTION_TYP = "sso-transaction";

/**
 * The prefix every transaction cookie name shares. The full name appends a
 * short tag derived from `state`; see {@link transactionCookieName}.
 */
const COOKIE_PREFIX = "nx_sso_txn_";

/**
 * The path the transaction cookie is scoped to.
 *
 * Core scopes its own session cookies to `/admin` and the Nextly request
 * handler is mounted beneath it, so this plugin's routes live at
 * `/admin/api/plugins/...` and a `/admin` cookie reaches them. Scoping wider
 * would send the transaction to every request on the site for no benefit.
 */
const COOKIE_PATH = "/admin";

/** What a transaction remembers across the redirect to the provider. */
export interface TransactionRecord {
  /** Provider key this transaction was started for, e.g. `"google"`. */
  provider: string;
  /** CSRF anchor echoed by the provider on the callback. */
  state: string;
  /** OIDC nonce; echoed inside the ID token where the provider issues one. */
  nonce: string;
  /** PKCE code verifier, exchanged for tokens on the callback. */
  verifier: string;
  /** Same-origin path to land on after a successful login. */
  next: string;
}

/** Thrown when a transaction cookie is missing, expired, tampered, or foreign. */
export class InvalidTransactionError extends Error {
  constructor(reason: string) {
    super(`invalid sso transaction: ${reason}`);
    this.name = "InvalidTransactionError";
  }
}

/**
 * The cookie name for a given `state`.
 *
 * Named per transaction rather than once for the plugin so that two logins
 * started in two tabs do not overwrite each other. With one fixed name the
 * second `/authorize` clobbers the first tab's verifier, and the first tab then
 * fails its callback with a state mismatch that looks exactly like an attack.
 * The tag is a prefix of `state`, which the callback already carries, so the
 * right cookie is addressable without enumerating them.
 *
 * A prefix rather than the whole value keeps the header small; it selects the
 * cookie but proves nothing, because the signature over the full record is what
 * establishes the transaction is ours and `state` is compared in full.
 */
export function transactionCookieName(state: string): string {
  return `${COOKIE_PREFIX}${state.slice(0, 8)}`;
}

/** Sign a transaction record into a cookie value. */
export async function mintTransaction(
  record: TransactionRecord,
  secret: string,
  ttlSeconds: number = TRANSACTION_TTL_SECONDS
): Promise<string> {
  const key = derivePurposeKey(secret, TRANSACTION_KEY_LABEL);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    typ: TRANSACTION_TYP,
    provider: record.provider,
    state: record.state,
    nonce: record.nonce,
    verifier: record.verifier,
    next: record.next,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(key);
}

/**
 * Verify a transaction cookie and return the record it carries.
 *
 * `expectedState` is the value the provider echoed on the callback. It is
 * compared here rather than by the caller so that no callback path can forget
 * to: a transaction that verifies cryptographically but belongs to a different
 * authorization request is exactly the CSRF `state` exists to catch.
 *
 * @throws InvalidTransactionError on expiry, tampering, the wrong token type,
 *   or a state mismatch.
 */
export async function verifyTransaction(
  token: string,
  secret: string,
  expectedState: string
): Promise<TransactionRecord> {
  const key = derivePurposeKey(secret, TRANSACTION_KEY_LABEL);
  let payload: Record<string, unknown>;
  try {
    // The algorithm is pinned rather than read from the header: an unpinned
    // verifier accepts whatever the token claims to be signed with, which is
    // how `alg: none` and HS-vs-RS confusion become forgeries.
    const result = await jwtVerify(token, key, { algorithms: ["HS256"] });
    payload = result.payload;
  } catch (err) {
    throw new InvalidTransactionError(
      err instanceof Error ? err.message : "verification-failed"
    );
  }

  if (payload.typ !== TRANSACTION_TYP) {
    throw new InvalidTransactionError("wrong-type");
  }
  if (
    typeof payload.state !== "string" ||
    payload.state.length !== expectedState.length ||
    payload.state !== expectedState
  ) {
    throw new InvalidTransactionError("state-mismatch");
  }
  if (
    typeof payload.provider !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.verifier !== "string" ||
    typeof payload.next !== "string"
  ) {
    throw new InvalidTransactionError("malformed");
  }

  return {
    provider: payload.provider,
    state: payload.state,
    nonce: payload.nonce,
    verifier: payload.verifier,
    next: payload.next,
  };
}

/**
 * Serialize the `Set-Cookie` header that carries a transaction.
 *
 * `SameSite=Lax` is required, not merely chosen: the provider returns the user
 * through a top-level GET navigation, which Lax permits and `Strict` would
 * strip — the callback would then never see its own transaction. It is also why
 * every provider adapter must request `response_mode=query`; a cross-site form
 * POST back is not a navigation Lax covers.
 */
export function serializeTransactionCookie(
  state: string,
  value: string,
  isProduction: boolean,
  ttlSeconds: number = TRANSACTION_TTL_SECONDS
): string {
  const parts = [
    `${transactionCookieName(state)}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=${COOKIE_PATH}`,
    `Max-Age=${ttlSeconds}`,
  ];
  // Only in production: a `Secure` cookie is dropped over plain HTTP, and local
  // development runs on http://localhost.
  if (isProduction) parts.splice(1, 0, "Secure");
  return parts.join("; ");
}

/** Serialize the header that clears a consumed transaction cookie. */
export function serializeClearTransactionCookie(state: string): string {
  return [
    `${transactionCookieName(state)}=`,
    "HttpOnly",
    "SameSite=Lax",
    `Path=${COOKIE_PATH}`,
    "Max-Age=0",
  ].join("; ");
}

/**
 * Read a transaction cookie for a given `state` off a request.
 *
 * Split rather than matched with a constructed pattern: the cookie name embeds
 * a slice of `state`, which arrives from the query string, so building a regular
 * expression around it would let request data reach the regex compiler. Equality
 * on the split name is also exact by construction, where a pattern has to be
 * anchored correctly to avoid matching a cookie whose name merely ends with
 * ours.
 */
export function readTransactionCookie(
  request: Request,
  state: string
): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const name = transactionCookieName(state);
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(pair.slice(eq + 1).trim());
  }
  return null;
}
