import { hkdfSync, randomBytes } from "node:crypto";

import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

import { NextlyError } from "../../errors/nextly-error";

/**
 * Scoped, short-lived tokens that let someone read ONE unpublished entry.
 *
 * Showing a reviewer a draft otherwise costs a full API key, which grants the
 * whole API to answer "look at this one page". A preview token names a single
 * document and carries no other authority at all.
 *
 * @module auth/preview/preview-token
 */

const ALGORITHM = "HS256";

/**
 * The audience every preview token carries, and the only one accepted.
 *
 * Belt and braces beside the key separation below: if a future change ever
 * reunites the keys, the audience check still refuses a session token here.
 */
const PREVIEW_AUDIENCE = "nextly:preview";

/**
 * Domain-separation label for the preview signing key.
 *
 * Preview tokens are derived from the same `NEXTLY_SECRET` as sessions but MUST
 * NOT be interchangeable with them. A shared key would make that a matter of
 * checking claims correctly on every path forever; deriving a distinct key
 * makes it arithmetic — a session token presented as a preview token, or a
 * preview token presented as a session cookie, fails the signature itself
 * rather than a validation rule someone has to remember to write.
 *
 * Versioned so the derivation can change later without silently accepting
 * tokens minted under the old rule.
 */
const PREVIEW_KEY_INFO = "nextly:preview-token:v1";

/** Bytes of HKDF output; HS256 wants a 256-bit key. */
const PREVIEW_KEY_BYTES = 32;

/** How long a preview link lives when the caller states no preference. */
export const DEFAULT_PREVIEW_TTL_SECONDS = 60 * 60;

/** The single document a preview token authorizes, and nothing else. */
export interface PreviewTokenScope {
  /** Collection slug the entry belongs to. */
  collection: string;
  /** The entry's id. Ids, not slugs: a slug can be edited on the draft itself. */
  entryId: string;
  /** Locale to preview, when the entry is localized. */
  locale?: string;
}

export interface SignPreviewTokenOptions {
  /** Seconds the link stays usable. */
  ttlSeconds?: number;
  /**
   * The site's current revocation generation.
   *
   * Every token records the generation it was minted under, and verification
   * refuses any token that does not match the current one. Raising it
   * invalidates every outstanding preview link at once without touching
   * sessions, and without a denylist to store, sweep and replicate.
   *
   * Passed in rather than read here so this module stays pure: where the
   * generation is stored is the caller's concern, and a test needs no database
   * to exercise revocation.
   */
  generation: number;
}

export type PreviewVerifyResult =
  | { valid: true; scope: PreviewTokenScope; expiresAt: Date }
  /** Signature, audience, shape, or anything else that makes it not a token. */
  | { valid: false; reason: "invalid" }
  | { valid: false; reason: "expired" }
  /** Well-formed and unexpired, but minted before the last revoke-all. */
  | { valid: false; reason: "revoked" };

/** The signing key for preview tokens, distinct from the session key by construction. */
function previewKey(secret: string): Uint8Array {
  return new Uint8Array(
    hkdfSync("sha256", secret, "", PREVIEW_KEY_INFO, PREVIEW_KEY_BYTES)
  );
}

/**
 * Mint a link that reads exactly one draft.
 *
 * The returned `expiresAt` is the `exp` claim rather than a second clock
 * reading, so what a caller shows a user is what the token actually holds.
 */
export async function signPreviewToken(
  scope: PreviewTokenScope,
  secret: string,
  options: SignPreviewTokenOptions
): Promise<{ token: string; expiresAt: Date }> {
  // A locale that is present but unusable must not be minted. Verification
  // reads an unreadable `loc` as ABSENT, and an absent locale deliberately
  // covers every locale — so an empty string would quietly widen a
  // locale-specific link into an all-locales grant. Refusing at the mint is
  // where the caller can still be told.
  if (scope.locale !== undefined && scope.locale.length === 0) {
    throw NextlyError.validation({
      errors: [
        {
          path: "locale",
          code: "INVALID_FORMAT",
          message:
            "A preview token's locale must be a non-empty string when present.",
        },
      ],
    });
  }

  const ttlSeconds = options.ttlSeconds ?? DEFAULT_PREVIEW_TTL_SECONDS;
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttlSeconds;

  const token = await new SignJWT({
    col: scope.collection,
    eid: scope.entryId,
    ...(scope.locale === undefined ? {} : { loc: scope.locale }),
    gen: options.generation,
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setAudience(PREVIEW_AUDIENCE)
    // `sub` names the document rather than a user: nobody is authenticated by
    // this token, and reading it as a user id is the mistake worth preventing.
    .setSubject(`${scope.collection}:${scope.entryId}`)
    .setJti(randomBytes(16).toString("hex"))
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(previewKey(secret));

  return { token, expiresAt: new Date(expiresAt * 1000) };
}

/** Whether a decoded claim value is a usable, non-empty string. */
function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Check a preview token and report the ONE document it authorizes.
 *
 * Returns a result rather than throwing, matching the session verifier: a
 * failed preview link is an ordinary request outcome, not an exception.
 */
export async function verifyPreviewToken(
  token: string,
  secret: string,
  options: { generation: number | (() => number | Promise<number>) }
): Promise<PreviewVerifyResult> {
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, previewKey(secret), {
      audience: PREVIEW_AUDIENCE,
    });
    payload = verified.payload;
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      return { valid: false, reason: "expired" };
    }
    return { valid: false, reason: "invalid" };
  }

  const collection = readString(payload.col);
  const entryId = readString(payload.eid);
  // A token missing either half names no document, so there is nothing it could
  // authorize. Treated as malformed rather than as a grant over everything.
  if (collection === null || entryId === null) {
    return { valid: false, reason: "invalid" };
  }

  // Checked AFTER the shape, so a malformed token is never reported as merely
  // revoked — the two need different answers from a caller.
  // Resolved HERE rather than by the caller, and that placement is the point.
  // Reading the revocation counter means a database query, and every check
  // above this line needs only the secret — so resolving it up front would let
  // any unauthenticated request carrying arbitrary bytes force a settings read,
  // on this endpoint and on every content request that consults a preview
  // cookie. Nothing reaches this line without a valid signature.
  const generation =
    typeof options.generation === "function"
      ? await options.generation()
      : options.generation;

  if (payload.gen !== generation) {
    return { valid: false, reason: "revoked" };
  }

  const expiresAt =
    typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null;
  if (expiresAt === null) return { valid: false, reason: "invalid" };

  // Present-but-unreadable is NOT the same as absent. An absent locale covers
  // every locale by design, so silently dropping a malformed one would widen
  // the grant rather than narrow it — the one direction a scope check must
  // never fail in.
  const localeClaim = payload.loc;
  const locale = readString(localeClaim);
  if (localeClaim !== undefined && locale === null) {
    return { valid: false, reason: "invalid" };
  }

  return {
    valid: true,
    scope: {
      collection,
      entryId,
      ...(locale === null ? {} : { locale }),
    },
    expiresAt,
  };
}

/**
 * Whether a verified token authorizes the document being requested.
 *
 * Separate from verification because the two failures are different: a token
 * can be perfectly valid and still be the wrong token for this URL. Callers get
 * this as a function rather than comparing fields themselves, so "the token is
 * valid" can never be mistaken for "the token covers this".
 *
 * A token minted without a locale covers the entry in any locale; one minted
 * with a locale covers only that locale, so a reviewer sent the German draft
 * cannot read the French one with the same link.
 */
export function previewTokenCovers(
  scope: PreviewTokenScope,
  requested: PreviewTokenScope
): boolean {
  if (scope.collection !== requested.collection) return false;
  if (scope.entryId !== requested.entryId) return false;
  if (scope.locale === undefined) return true;
  return scope.locale === requested.locale;
}
