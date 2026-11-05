/**
 * A fingerprint of a stored blocks value, for telling whether it changed.
 *
 * Two reads of one value must agree however the database hands it back:
 * PostgreSQL's `jsonb` reorders an object's keys, SQLite stores JSON as text,
 * and the Direct API answers parsed values. So the value is decoded when it is
 * text and its keys are sorted before it is hashed. Arrays keep their order,
 * which is part of what a document means.
 *
 * @module host-rewrite/stored-hash
 */

/** What an absent value hashes as: no stored value, distinct from any JSON. */
const ABSENT = "\u0000absent";

/** The value as JSON with every object's keys sorted. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== "object" || Array.isArray(inner)) {
      return inner;
    }
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(inner).sort()) {
      sorted[key] = (inner as Record<string, unknown>)[key];
    }
    return sorted;
  });
}

/** Stored text decoded; a string that is not JSON is kept as the string it is. */
function decoded(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * The SHA-256 of a stored value in its canonical form, as hex. `undefined`
 * and `null` (nothing stored) hash alike, and unlike every stored value.
 */
export async function storedHash(value: unknown): Promise<string> {
  const plain = decoded(value);
  const text =
    plain === undefined || plain === null ? ABSENT : canonicalJson(plain);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
