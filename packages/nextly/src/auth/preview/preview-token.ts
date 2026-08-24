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
/** One entry of a collection. */
export interface PreviewEntryScope {
  /**
   * Optional, and that is what keeps every already-minted link working.
   *
   * Tokens signed before this type gained a discriminant carry no `kind` claim
   * at all, so requiring one would kill every outstanding link the moment this
   * shipped — an editor who shared a draft last week would find it dead with no
   * explanation. An absent kind reads as an entry, which is what those tokens
   * are.
   */
  kind?: "entry";
  /** Collection slug the entry belongs to. */
  collection: string;
  /** The entry's id. Ids, not slugs: a slug can be edited on the draft itself. */
  entryId: string;
  /** Locale to preview, when the entry is localized. */
  locale?: string;
}

/**
 * One Single.
 *
 * Addressed by slug and not by id, because there is exactly one of it and its
 * identity IS the slug. Reusing the entry shape would mean inventing an id that
 * names nothing and having `previewTokenCovers` compare two made-up values.
 */
export interface PreviewSingleScope {
  kind: "single";
  /** The Single's slug. */
  single: string;
  /** Locale to preview, when the Single is localized. */
  locale?: string;
}

/**
 * The ONE document a preview token authorizes.
 *
 * A union rather than a widened entry shape, so a comparison cannot accidentally
 * satisfy one kind with the other: a Single named `pages` and a collection named
 * `pages` are different documents.
 */
export type PreviewTokenScope = PreviewEntryScope | PreviewSingleScope;

/** Whether a scope names a Single rather than a collection entry. */
export function isSingleScope(
  scope: PreviewTokenScope
): scope is PreviewSingleScope {
  return scope.kind === "single";
}

export interface SignPreviewTokenOptions {
  /** Seconds the link stays usable. */
  ttlSeconds?: number;
  /**
   * The id of the user who shared the link, recorded so the page can be
   * rendered through their field-level permissions rather than through none.
   *
   * **This does NOT authenticate anybody, and the distinction is the whole
   * point.** The bearer is still anonymous and still gets exactly the one
   * document the scope names. What the claim decides is which fields of that
   * document are visible: without it the render skips field-level read rules
   * entirely, so a link would show its recipient fields the person sharing it
   * cannot see — a way to read past your own permissions by sending yourself a
   * link.
   *
   * **Required when signing, and merely REPORTED when verifying — the
   * asymmetry is deliberate and it is not a compatibility allowance.**
   * Verification answers what a token holds; whether an absent record is
   * acceptable is a policy question, and it belongs where the policy is. The
   * draft gate refuses such a token outright, because a draft rendered as
   * nobody is a draft rendered with no field rules at all.
   */
  minter: string;
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
  | {
      valid: true;
      scope: PreviewTokenScope;
      /**
       * Who shared the link, when the token records it.
       *
       * Beside the scope rather than inside it, deliberately. The scope is the
       * DOCUMENT a token names and `previewTokenCovers` compares scopes for
       * equality — folding an identity in would make two links to one document
       * compare unequal because different people sent them.
       *
       * Absent on every token minted before this claim existed; the signer
       * refuses to produce one without it now. A reader must handle the absence
       * rather than assume it away — and must fail CLOSED on it, since a draft
       * with no recorded sender cannot be judged by anyone's field rules. See
       * {@link SignPreviewTokenOptions.minter}.
       */
      minter?: string;
      expiresAt: Date;
    }
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
  // Refused for the same reason an empty locale is: verification reads an
  // unusable claim as ABSENT, and an absent single slug would leave a token
  // that names no document at all.
  if (isSingleScope(scope) && scope.single.length === 0) {
    throw NextlyError.validation({
      errors: [
        {
          path: "single",
          code: "INVALID_FORMAT",
          message: "A preview token's single slug must be a non-empty string.",
        },
      ],
    });
  }

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

  // The TYPE makes this required and the type is not a boundary. A JavaScript
  // caller omits it and compiles nothing; a typed one can pass `""`. Either way
  // the claim below would be dropped, verification would read the result as a
  // token minted before the claim existed, and the draft gate would omit
  // redaction — rendering every field to whoever holds the link. That is the
  // whole defect this claim closes, reachable through the front door.
  //
  // Refused rather than defaulted: there is no safe stand-in for "whose
  // permissions is this seen through", and inventing one would authorize a view
  // nobody asked for.
  if (
    typeof options.minter !== "string" ||
    options.minter.trim().length === 0
  ) {
    throw NextlyError.validation({
      errors: [
        {
          path: "minter",
          code: "REQUIRED",
          message:
            "A preview token must record who minted it, so the page can be " +
            "rendered through that person's field-level permissions.",
        },
      ],
    });
  }

  const ttlSeconds = options.ttlSeconds ?? DEFAULT_PREVIEW_TTL_SECONDS;
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttlSeconds;

  // An entry scope is signed WITHOUT a `kind` claim, byte-identical to what
  // this signer produced before Singles existed. That keeps the common token
  // unchanged rather than migrating every outstanding link.
  const claims = isSingleScope(scope)
    ? { kind: "single" as const, sng: scope.single }
    : { col: scope.collection, eid: scope.entryId };

  const token = await new SignJWT({
    ...claims,
    ...(scope.locale === undefined ? {} : { loc: scope.locale }),
    // `mnt`, not `sub`: the subject below names the DOCUMENT, and a reader that
    // mistook this for an authenticated principal would be reading a bearer
    // token as a session. It is a redaction basis and nothing more.
    mnt: options.minter,
    gen: options.generation,
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setAudience(PREVIEW_AUDIENCE)
    // `sub` names the document rather than a user: nobody is authenticated by
    // this token, and reading it as a user id is the mistake worth preventing.
    .setSubject(
      isSingleScope(scope)
        ? `single:${scope.single}`
        : `${scope.collection}:${scope.entryId}`
    )
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
 * The document a verified payload names, or `null` when it names none.
 *
 * Split out of the verifier so the two questions stay separate: that function
 * answers "is this token real", and this one answers "what does it point at".
 * The locale is deliberately NOT read here — it qualifies whichever document
 * this returns, and folding it in would make one function answer both.
 *
 * An absent `kind` is an ENTRY, which is what every token minted before Singles
 * existed carries. A kind that is present but unrecognised is refused rather
 * than defaulted: one this version cannot judge is not one to guess at, and
 * treating it as an entry would read `col`/`eid` claims never meant to be an
 * entry's. A token missing what its kind requires names no document at all, so
 * it is malformed rather than a grant over everything.
 */
function decodeScope(
  payload: Record<string, unknown>
): PreviewTokenScope | null {
  const kind = payload.kind;

  if (kind === "single") {
    const single = readString(payload.sng);
    return single === null ? null : { kind: "single", single };
  }

  if (kind !== undefined) return null;

  const collection = readString(payload.col);
  const entryId = readString(payload.eid);
  if (collection === null || entryId === null) return null;
  return { collection, entryId };
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

  const scope = decodeScope(payload);
  if (scope === null) return { valid: false, reason: "invalid" };

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

  const minter = readString(payload.mnt);

  return {
    valid: true,
    scope: locale === null ? scope : { ...scope, locale },
    ...(minter === null ? {} : { minter }),
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
  // The KIND first, so one kind can never satisfy the other: a Single named
  // `pages` and a collection named `pages` are different documents, and a
  // comparison that only looked at names would let one link open the other.
  if (isSingleScope(scope) !== isSingleScope(requested)) return false;

  if (isSingleScope(scope) && isSingleScope(requested)) {
    if (scope.single !== requested.single) return false;
  } else if (!isSingleScope(scope) && !isSingleScope(requested)) {
    if (scope.collection !== requested.collection) return false;
    if (scope.entryId !== requested.entryId) return false;
  }

  // An absent locale covers every locale, deliberately: a link minted without
  // one is a link to the document rather than to one translation of it.
  if (scope.locale === undefined) return true;
  return scope.locale === requested.locale;
}
