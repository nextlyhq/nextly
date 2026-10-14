import { createHash } from "node:crypto";

/**
 * The key a stored outside identifier (a catalogue's reference, a payment
 * provider's own reference) is found and kept unique by: its SHA-256, in hex.
 *
 * A database compares text by its collation, and MySQL's default collation
 * takes two strings that differ only in case, in accents or in trailing
 * spaces as the same, where PostgreSQL and SQLite tell them apart. A source's
 * references are its own identifiers and the contract compares them exactly,
 * so a table keyed by the reference itself would hold two such items as one
 * on MySQL alone. A hex digest is lower-case ASCII of a fixed length, which
 * every collation compares byte for byte, so the key behaves the same on
 * every dialect. The reference is still stored beside it, for reading.
 */
export function referenceKey(reference: string): string {
  return createHash("sha256").update(reference, "utf8").digest("hex");
}

/**
 * The key a provider's reference is kept unique by: the account it was issued
 * in and the reference, taken together and exactly. Two accounts at one
 * provider may issue the same reference, and account ids may differ only in
 * case, which MySQL's default collation would take as one.
 */
export function providerReferenceKey(
  account: string,
  providerReference: string
): string {
  return referenceKey(JSON.stringify([account, providerReference]));
}
