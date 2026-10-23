/**
 * Whether a watcher's output has announced something, read across the chunks a
 * stream delivers.
 *
 * A child's stdout arrives in pieces of whatever size the pipe hands over, so
 * a line can be split between two `data` events. Testing each chunk alone
 * misses a phrase that straddles the boundary, and a runner waiting for it
 * then waits for ever. This keeps the end of what was read, long enough to
 * hold all but the last character of the phrase, and tests that end together
 * with each new chunk.
 *
 * Its own module, with no side effects, so the rule can be tested without
 * starting a watcher.
 *
 * @module watch-readiness
 */

/**
 * A reader for one stream: call it with each chunk, and it answers whether
 * `phrase` has appeared in the stream so far, at that chunk or earlier.
 *
 * @param {string} phrase - the text that announces readiness.
 * @returns {(chunk: string) => boolean}
 */
export function announcementReader(phrase) {
  let tail = "";
  let seen = false;
  return chunk => {
    if (seen) return true;
    const text = tail + chunk;
    seen = text.includes(phrase);
    tail = text.slice(-(phrase.length - 1));
    return seen;
  };
}
