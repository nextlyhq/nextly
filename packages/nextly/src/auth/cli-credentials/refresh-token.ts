/**
 * The refresh token of a CLI sign-in: how one is made, read back, and stored.
 *
 * A token reads `nxcli_<credential id>.<generation>.<random>.<tag>`:
 *
 * - the credential id finds the sign-in's row by its key, so the row needs no
 *   index over hashes;
 * - the generation is the count of replacements the token was issued at. The
 *   row keeps the current one, so a token from an earlier generation is one
 *   that was already replaced;
 * - the random part, 32 bytes, is what makes the token unguessable;
 * - the tag is an HMAC of the three parts under a key derived from the site's
 *   secret. It is what lets the site tell a replaced token presented again
 *   from a made-up one carrying a known id: only the first may revoke the
 *   sign-in, or anyone who learned a credential's id (the activity log shows
 *   them) could sign its holder out.
 *
 * The row stores only the SHA-256 of the whole token. The current token is
 * matched by that hash; the tag is read only for a token that does not
 * match. After the site's secret changes, earlier tokens' tags no longer
 * check, so a replayed one is refused without revoking anything, and the
 * current token keeps working, as its hash still matches.
 *
 * @module auth/cli-credentials/refresh-token
 */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const PREFIX = "nxcli_";

/** Separates the tag's key from any other key derived from the same secret. */
const TAG_KEY_LABEL = "nextly cli sign-in refresh token tag v1";

const TOKEN_PATTERN =
  /^nxcli_(ncc_[0-9a-f]{32})\.(0|[1-9][0-9]{0,8})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;

/** A refresh token's parts, once its shape has been read. */
export interface ParsedRefreshToken {
  credentialId: string;
  generation: number;
  random: string;
  /** The tag over the other parts, checked by {@link refreshTokenTagHolds}. */
  tag: string;
}

function tagKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(TAG_KEY_LABEL).digest();
}

function tagOf(
  secret: string,
  credentialId: string,
  generation: number,
  random: string
): string {
  return createHmac("sha256", tagKey(secret))
    .update(`${credentialId}.${generation}.${random}`)
    .digest("base64url");
}

/** A new refresh token for a credential at a generation. */
export function mintRefreshToken(
  secret: string,
  credentialId: string,
  generation: number
): string {
  const random = randomBytes(32).toString("base64url");
  const tag = tagOf(secret, credentialId, generation, random);
  return `${PREFIX}${credentialId}.${generation}.${random}.${tag}`;
}

/** The token's parts, or null when it is not a refresh token's shape. */
export function parseRefreshToken(token: string): ParsedRefreshToken | null {
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  return {
    credentialId: match[1],
    generation: Number(match[2]),
    random: match[3],
    tag: match[4],
  };
}

/**
 * Whether the token's tag is the site's own, so the token was issued by this
 * site under its current secret. Compared in constant time.
 */
export function refreshTokenTagHolds(
  secret: string,
  parsed: ParsedRefreshToken
): boolean {
  const expected = Buffer.from(
    tagOf(secret, parsed.credentialId, parsed.generation, parsed.random)
  );
  const presented = Buffer.from(parsed.tag);
  return (
    expected.length === presented.length && timingSafeEqual(expected, presented)
  );
}

/**
 * What the row stores for a refresh token: its SHA-256, hex-encoded. Plain
 * SHA-256 rather than a slow hash, because the token carries 256 random bits
 * and cannot be guessed from its digest.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A new credential id: `ncc_` and 128 random bits. */
export function newCredentialId(): string {
  return `ncc_${randomBytes(16).toString("hex")}`;
}
