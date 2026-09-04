import { createHmac } from "node:crypto";

/**
 * Derive a purpose-scoped signing key from the application secret.
 *
 * Nothing this plugin signs may be signed with the raw `NEXTLY_SECRET`. Core
 * resolves a session by verifying an HS256 JWT against that secret and then
 * rejecting only the one `typ` it knows to be non-session (`pending-auth`, in
 * `auth/session/get-session.ts`). That is a denylist, so any OTHER token signed
 * with the same key and carrying a `sub` is accepted as a session — a handoff
 * token minted with the raw secret would be usable as a session cookie, which
 * defeats both its single-use property and its sixty-second lifetime.
 *
 * Domain separation removes the question rather than answering it: a token
 * signed under `derivePurposeKey(secret, "sso-handoff.v1")` cannot verify
 * against the raw secret, so it is inert everywhere except the one verifier
 * that derives the same label. The keys for the two purposes below are likewise
 * distinct from each other, so a transaction cookie is not a handoff token
 * either.
 *
 * A single HMAC extraction step is sufficient here because the input is already
 * a high-entropy application secret rather than a password: this is the extract
 * half of HKDF with the secret as keying material and the label as the message,
 * which is the standard construction for splitting one strong key into several.
 */
export function derivePurposeKey(secret: string, label: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", secret).update(label).digest());
}

/**
 * Label for the key that signs the transaction cookie carrying `state`, the
 * OIDC `nonce` and the PKCE verifier across the redirect to the provider.
 *
 * The labels are versioned so a future change to a payload's meaning can rotate
 * the key with it; every token minted under the old label stops verifying at
 * once, which is the desired behaviour for values whose lifetime is measured in
 * minutes.
 */
export const TRANSACTION_KEY_LABEL = "nextly-sso.transaction.v1";

/** Label for the key that signs the short-lived login handoff token. */
export const HANDOFF_KEY_LABEL = "nextly-sso.handoff.v1";
