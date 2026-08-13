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
  const retired = (retiredList ?? "")
    .split(",")
    .map(entry => entry.trim())
    // A trailing comma is the likeliest way to write this list, and an empty
    // entry would otherwise become a zero-length key that hashes every address
    // to the same value — a collision across every recipient, silently.
    .filter(entry => entry.length > 0);

  return current === undefined ? retired : [current, ...retired];
}
