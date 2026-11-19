/**
 * The external identities' table, per dialect, the digest its uniqueness is
 * enforced with, and the one row builder every attaching door writes through.
 *
 * @module schemas/external-identities
 */

import { createHash, randomUUID } from "node:crypto";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

// Re-exported from the leaf that declares it, so this barrel stays one of
// the readers rather than becoming a second author. See `./table-name`.
export { EXTERNAL_IDENTITIES_TABLE } from "./table-name";

/** The external identities' table for the requested dialect, as a schema fragment. */
export function externalIdentitiesTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyExternalIdentities } = loadedDialect(dialect).tables;
  return { nextlyExternalIdentities };
}

/**
 * The digest an identity's key is held under: 64 hex characters, SHA-256
 * over the provider key, the issuer and the subject, in that order.
 *
 * PLAIN SHA-256, never a keyed digest: uniqueness must survive a rotation of
 * any secret, so the hash may depend on the identity's own facts and nothing
 * else. SHA-256 makes a collision a 2^-128 event bounded by the algorithm,
 * not by anything an install configures.
 *
 * Each part is LENGTH-FRAMED — its byte length, then its bytes — rather than
 * joined by a separator: any of the three may contain any character, so no
 * separator can be made safe, while a length cannot be confused with the
 * bytes it counts. Without framing, ("ab", "c") and ("a", "bc") would share
 * a digest and two identities would collapse into one row.
 *
 * The writer that hands sign-ins to core (#272) calls this; the table's
 * unique index holds its output alone, so every writer derives the same
 * spelling of one identity's key.
 */
export function externalIdentityKeyDigest(
  providerKey: string,
  issuer: string,
  subject: string
): string {
  const hash = createHash("sha256");
  for (const part of [providerKey, issuer, subject]) {
    const bytes = Buffer.from(part, "utf8");
    // Four bytes, big-endian: a fixed-width frame before a variable payload.
    const frame = Buffer.alloc(4);
    frame.writeUInt32BE(bytes.length);
    hash.update(frame);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

/**
 * The facts that pick out one external identity: the stamped provider key,
 * the issuer as the table stores it ("" where the provider has none), the
 * subject, the digest of those three the table holds uniqueness by, and the
 * address the provider asserted.
 *
 * What both a sign-in hand-off and an explicit link are validated down to
 * before anything is written — the shape the attaching doors hand each
 * other, so neither has to know the other's internal parse result. The
 * digest travels WITH the facts, computed once where they were parsed
 * (`externalIdentityKeyDigest`), so no writer recomputes it.
 */
export interface ExternalIdentityFacts {
  readonly providerKey: string;
  readonly issuer: string;
  readonly subject: string;
  readonly keyDigest: string;
  readonly address: string | null;
}

/**
 * The row one attached identity writes, built the one way every attaching
 * door stores it: the explicit link's own insert, and the user-creation
 * transaction a provisioning sign-in runs.
 *
 * One builder because the doors are routes to one question — what a stored
 * identity row is — and two spellings of it would drift the first time a
 * column is added to one and not the other.
 */
export function newExternalIdentityRow(
  facts: ExternalIdentityFacts,
  userId: string
): {
  id: string;
  providerKey: string;
  issuer: string;
  subject: string;
  keyDigest: string;
  address: string | null;
  userId: string;
  createdAt: Date;
} {
  return {
    id: randomUUID(),
    providerKey: facts.providerKey,
    issuer: facts.issuer,
    subject: facts.subject,
    keyDigest: facts.keyDigest,
    address: facts.address,
    userId,
    createdAt: new Date(),
  };
}
