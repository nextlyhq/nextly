/**
 * What the share-preview browser tests need beyond the admin itself: the
 * suite server's signing secret, and a preview link as an earlier version of
 * Nextly minted it.
 *
 * @module e2e/support/preview-links
 */
import { createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * The suite server's `NEXTLY_SECRET`, set in its environment by the config so
 * that a link can be signed here as the server would sign it. The playground's
 * own `.env` may hold any value on a contributor's machine; the process
 * environment wins over it.
 */
export const E2E_NEXTLY_SECRET =
  "e2e-suite-preview-links-secret-not-a-real-deployment-key";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * A preview link for one entry as Nextly minted it before links were
 * recorded: the same signing key, audience and claims, and no `rec` claim, so
 * no row describes it. Built here because the current version no longer mints
 * one, and an upgraded install still holds such links for up to seven days.
 *
 * The key and claims are the format's, not a guess: an HMAC-SHA256 key derived
 * from the secret under `nextly:preview-token:v1`, audience `nextly:preview`.
 */
export function olderPreviewToken(input: {
  collection: string;
  entryId: string;
  /** The account that shared it, which the page renders as. */
  minter: string;
  /** The site's revocation generation, 0 until a site-wide revoke. */
  generation: number;
  ttlSeconds: number;
}): string {
  const key = Buffer.from(
    hkdfSync("sha256", E2E_NEXTLY_SECRET, "", "nextly:preview-token:v1", 32)
  );
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256" }));
  const payload = base64url(
    JSON.stringify({
      col: input.collection,
      eid: input.entryId,
      mnt: input.minter,
      gen: input.generation,
      aud: "nextly:preview",
      sub: `${input.collection}:${input.entryId}`,
      jti: randomBytes(16).toString("hex"),
      iat: now,
      exp: now + input.ttlSeconds,
    })
  );
  const signature = createHmac("sha256", key)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}
