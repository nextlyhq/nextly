/**
 * Which install secret the database limit store's entries were written
 * under.
 *
 * Limits key their entries with a value derived from the install's secret, so
 * rotating the secret starts every count again, as a store that restarts
 * empty does. The entries written under the earlier secret can then never be
 * read by the new one. Each entry records the generation it was written
 * under, and the bound is counted per generation, so another generation's
 * entries never count against this one's. They are removed once they expire:
 * not sooner, since during a rolling deployment the earlier generation's
 * instances are still counting with them.
 *
 * @module domains/limits/store-generation
 */
import { createHmac } from "node:crypto";

/** The generation of an install with no secret, which keys nothing. */
const UNKEYED_GENERATION = "unkeyed";

/**
 * A short name for the generation `secret` writes under: an HMAC of a fixed
 * label, keyed by the secret, so the name reveals nothing of it.
 *
 * @param secret - The install's current secret, or undefined when none is set
 */
export function limitStoreGeneration(secret: string | undefined): string {
  if (secret === undefined || secret === "") return UNKEYED_GENERATION;
  return createHmac("sha256", secret)
    .update("nextly limit store generation")
    .digest("hex")
    .slice(0, 16);
}
