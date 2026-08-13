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
): string[] {
  const retired = retiredSecrets(retiredList);
  return current === undefined ? retired : [current, ...retired];
}

/**
 * A JSON array of strings, or null for anything else.
 *
 * Anything else includes values that parse as JSON but are not a list of
 * secrets — a bare number, a quoted string, an object. Those fall through to
 * the comma form rather than being coerced, because a secret that happens to
 * look like JSON is still a secret.
 */
function jsonStringArray(raw: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.every(entry => typeof entry === "string") ? parsed : null;
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
 */
function retiredSecrets(raw: string | undefined): string[] {
  const value = raw ?? "";
  if (value.trim().length === 0) return [];

  const entries =
    jsonStringArray(value.trim()) ?? value.split(",").map(part => part.trim());

  // An empty entry is dropped in BOTH forms. A trailing comma is the likeliest
  // way to write the list, and `""` is a valid HMAC key that hashes every
  // address to one value — every recipient colliding with every other, with
  // nothing to show for it until an erasure deletes the wrong rows.
  return entries.filter(entry => entry.length > 0);
}
