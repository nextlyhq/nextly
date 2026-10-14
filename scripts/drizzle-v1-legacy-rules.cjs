/**
 * The source-text rules of the drizzle v1 legacy gate that need more than a
 * line-based grep, kept apart from the gate so a test can hold each one to
 * the forms it must refuse and the forms it must leave alone.
 */

/**
 * The removed RQB callback filter: `where: (table, { operators }) =>`. Drizzle
 * v1 silently IGNORES a function passed as `where:` (it has no enumerable
 * keys, so it filters nothing), and `findMany` then returns every row.
 *
 * - **Two parameters:** the second is the operator bag, which is what makes
 *   the form a filter callback.
 * - **One or zero parameters:** left alone. Those are a builder's own
 *   `where` method: a mock's `where: () => chain`, an implementation's
 *   `where: condition =>`, and a declaration's `where: (cond: SQL) => this`.
 *   This is a limit, not a guarantee: a filter written with one parameter,
 *   `where: (t) => eq(t.id, 1)` with `eq` imported, is NOT refused, because
 *   by its syntax alone it cannot be told from a builder's method.
 * - **`where` must begin its key:** a key that only ends in it, such as
 *   `signOutEverywhere:` or `somewhere:`, names something else.
 * - **Line breaks:** `\s` spans them, so a filter whose parameters are on a
 *   later line than `where:` is still found when a whole file is scanned.
 */
const RQB_CALLBACK_FILTER =
  /(?<![\w$])where\s*:\s*(?:async\s*)?\(\s*[A-Za-z_$][\w$]*\s*,\s*[{A-Za-z_$]/g;

/**
 * The 1-based lines of `text` on which an RQB callback filter begins. A match
 * on a line that starts as a comment (`//`, `*` or `/*`) is skipped, so a
 * documented example does not trip the gate.
 */
function rqbCallbackFilterLines(text) {
  const lines = [];
  for (const match of text.matchAll(RQB_CALLBACK_FILTER)) {
    const before = text.slice(0, match.index);
    const lineStart = before.lastIndexOf("\n") + 1;
    if (/^\s*(\/\/|\*|\/\*)/.test(text.slice(lineStart, match.index))) continue;
    lines.push(before.split("\n").length);
  }
  return lines;
}

module.exports = { rqbCallbackFilterLines };
