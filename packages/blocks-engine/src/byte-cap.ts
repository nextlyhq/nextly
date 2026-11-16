/**
 * Whether an edit fits the byte cap: one home for the question the op layer
 * asks of every edit that can grow a document.
 *
 * @module byte-cap
 */
import { keptJsonBytes } from "./kept-sizes";
import { documentTooLargeMessage } from "./limits";
import { measureBytes } from "./measure-bytes";

/**
 * Why `result` may not replace `before` under a byte cap of `maxBytes`, or
 * nothing when it may. `verb` names the edit in the one refusal that is not
 * the server's own words.
 */
export function byteCapRefusal(
  before: unknown,
  result: unknown,
  maxBytes: number,
  verb: string
): string | undefined {
  // Size as well as count. A single large string passes a node count and still
  // puts the document past what the engine will store, with the same result:
  // the edit applies, enters history, and every save afterwards is refused.
  //
  // COUNTED rather than produced. `documentBytes` answers by building the JSON
  // string and then a UTF-8 buffer of it, so deciding "is this too big" would
  // first allocate two copies of the thing being called too big — and an op
  // carrying a value far past the cap could exhaust the editor before the
  // refusal it earns. The engine's `measureBytes` walks and counts, stopping
  // as soon as the answer is settled, and the validator already decides this
  // question with it.
  //
  // The ceiling is what makes one bounded pass decisive. The rule is that an
  // edit is refused when it crosses the cap or worsens an existing overage —
  // equivalently, when the result is larger than both the cap and the document
  // it started from. So the ceiling is the larger of the two, and the common
  // case never pays for measuring `before` in full: a document already inside
  // the cap settles it, and only one already over the cap needs its exact size,
  // which is the repair case a site creates by lowering its own limit.
  //
  // From the sizes KEPT against each part when both documents are plain data,
  // which is every document the editor builds from its own operations: the
  // starting document was measured once, on its first check, and the result
  // shares every part it did not change, so only the edited path is measured.
  // The answer is the full measurement's; a document that is not plain data
  // has no kept size and takes the full measurement below, which probes every
  // object for a value the writer refuses.
  const keptResult = keptJsonBytes(result);
  const keptBefore =
    keptResult === undefined ? undefined : keptJsonBytes(before);
  if (keptResult !== undefined && keptBefore !== undefined) {
    const keptCeiling = keptBefore > maxBytes ? keptBefore : maxBytes;
    return keptResult > keptCeiling
      ? documentTooLargeMessage(maxBytes)
      : undefined;
  }
  const startingSize = measureBytes(before, maxBytes);
  const ceiling = startingSize.exceeded
    ? measureBytes(before, Number.POSITIVE_INFINITY).bytes
    : maxBytes;
  const size = measureBytes(result, ceiling);
  // Unstorable and too large are different verdicts, and the message says which.
  // A cyclic document, or one holding `undefined`, a function or a `Date`,
  // cannot be written at any size — reporting that as an overage would tell an
  // author their two-node page had outgrown a two-megabyte cap and send them
  // deleting content that was never the problem.
  //
  // `exceeded` covers BOTH, which is why the refusal is one branch rather than
  // two: a caller asking only whether the document fits still refuses one that
  // has no stored form. Reading a separate flag for that is fail-open, and was
  // measured to be — it silently stopped this guard refusing cyclic documents
  // until a second check was added by hand.
  if (!size.exceeded) return undefined;
  return size.reason === "unwritable"
    ? `${verb}: this would leave the document holding a value that cannot ` +
        `be stored — a cycle, or something JSON does not preserve. The ` +
        `edit would apply and then fail to save.`
    : // The server's words for an over-size document, so an author
      // refused here reads the reason a save would have given.
      documentTooLargeMessage(maxBytes);
}
