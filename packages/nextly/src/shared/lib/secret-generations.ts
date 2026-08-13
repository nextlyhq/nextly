/**
 * Every generation of `NEXTLY_SECRET` this install can still read with.
 *
 * Rotating a secret re-keys everything derived from it, and the derived values
 * already written do not move. Whether that matters depends on what the value
 * is for: a webhook signing secret that no longer decrypts is an endpoint an
 * operator must re-enter, which fails loudly and is fine. A recipient digest
 * that no longer matches is an erasure request that reports success having
 * matched nothing, which is the opposite of loud.
 *
 * So retired secrets are kept for READING and never for writing. Nothing here
 * chooses which key to write with — that stays `NEXTLY_SECRET` — and a caller
 * that wants to reach older data asks for the whole list.
 *
 * Ordered newest first, because the current generation matches the
 * overwhelming majority of rows and a caller comparing in order finds it first.
 *
 * @module shared/lib/secret-generations
 */

/**
 * The current secret followed by every retired one.
 *
 * Empty when no secret is configured at all, which is only reachable outside
 * production — `NEXTLY_SECRET` is required there and validated at env parse.
 * Callers must handle the empty list rather than assume a key exists, because
 * the unkeyed development path hashes without one.
 *
 * Takes the values rather than reading `env` itself. The env object is
 * re-exported under two paths in this package, and a module that picks one
 * silently bypasses a test double installed against the other — which is how
 * this first surfaced. A pure function has no such choice to get wrong.
 */
export function secretGenerations(
  current: string | undefined,
  retiredList: string | undefined
): SecretGeneration[] {
  const retired = retiredSecrets(retiredList);
  return current === undefined ? retired : [current, ...retired];
}

/**
 * One generation this install can read with.
 *
 * `undefined` is the UNKEYED generation, not a missing value. A development
 * install with no `NEXTLY_SECRET` hashes without a key, and rows written then
 * carry a plain SHA-256 digest that no HMAC reproduces — so enabling a secret
 * later strands them unless that generation can still be named.
 */
export type SecretGeneration = string | undefined;

/**
 * A JSON array of secrets, or null for anything else.
 *
 * `null` inside the array is the UNKEYED generation, which is the only way to
 * express it: it is the absence of a key, and no string denotes that.
 *
 * Anything else includes values that parse as JSON but are not a list of
 * secrets — a bare number, a quoted string, an object. Those fall through to
 * the comma form rather than being coerced, because a secret that happens to
 * look like JSON is still a secret.
 */
function jsonSecretArray(raw: string): SecretGeneration[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.every(entry => typeof entry === "string" || entry === null)
      ? parsed.map(entry => (entry === null ? undefined : (entry as string)))
      : null;
  } catch {
    return null;
  }
}

/**
 * The retired secrets, in either of the two accepted spellings.
 *
 * `NEXTLY_SECRET` is an arbitrary string, so a comma-separated list cannot
 * express every value it accepts: a secret containing a comma is torn into two
 * keys that were never used, and one with significant leading or trailing
 * whitespace is trimmed into a different key. Both then match nothing, and the
 * cost is an erasure request that reports success having reached no rows —
 * silent, and exactly what listing the secret was meant to prevent.
 *
 * So a JSON array is accepted as well, and it round-trips anything:
 * `NEXTLY_SECRET_PREVIOUS='["old,with,commas","  spaced  "]'`. Entries there
 * are taken verbatim, since JSON already delimits them and trimming would
 * reintroduce the defect this form exists to avoid.
 *
 * The comma form stays the ordinary one because it is what almost every secret
 * can use and it reads plainly in a `.env`. The two are told apart by whether
 * the value parses as a JSON array, which leaves one ambiguity worth naming: a
 * retired secret that is itself literally an array literal is read as the JSON
 * form. Such a value must use the JSON form, quoted inside it.
 *
 * The two forms also differ deliberately on EMPTY entries, and that difference
 * is the point rather than an inconsistency:
 *
 * - In the comma form an empty entry is dropped, because it is almost always a
 *   trailing comma. Nothing about `older,` says the author meant a second key.
 * - In the JSON form `""` is KEPT, because writing it is an explicit act. An
 *   install that ran with `NEXTLY_SECRET=""` really did key its digests with
 *   the empty string — `digestWith` only takes the unkeyed branch for
 *   `undefined` — so dropping it would strand every row that install wrote.
 *
 * (An earlier version of this comment justified dropping empty entries by
 * claiming an empty HMAC key hashes every address alike. That is false, and
 * measured: HMAC pads a short key with zeros and remains a PRF, so two
 * addresses under `""` give different digests. The reason to drop it in the
 * comma form is the trailing comma, and nothing more.)
 */
function retiredSecrets(raw: string | undefined): SecretGeneration[] {
  const value = raw ?? "";
  if (value.trim().length === 0) return [];

  const asJson = jsonSecretArray(value.trim());
  if (asJson) return asJson;

  return value
    .split(",")
    .map(part => part.trim())
    .filter(entry => entry.length > 0);
}
