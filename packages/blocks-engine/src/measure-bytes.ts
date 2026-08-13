/**
 * Bounded serialized-size measurement.
 *
 * A document that stays under the node and depth caps can still hide a single
 * enormous string or an enormous map, so size has to be checked too — and the
 * obvious way to check it is the one that loses. `JSON.stringify` followed by a
 * length comparison materializes the whole hostile input first, which is the
 * allocation the cap exists to prevent.
 *
 * So this counts bytes and stops the moment the budget is passed, never
 * building the string. It lives in its own module, with no imports, because
 * both the canonical validator and the published format checker have to reach
 * exactly this answer: two measurements of "how large is this document" would
 * disagree about which documents are refused, and the disagreement would show
 * up only on the inputs that matter.
 *
 * @module measure-bytes
 */

/**
 * UTF-8 byte length of a string, counted code unit by code unit so a huge
 * string is never materialized into a buffer, stopping once `budget` is passed.
 */
export function utf8ByteLength(s: string, budget: number): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) {
      // Serialized size counts JSON escaping. Backspace, tab, newline, form
      // feed, and carriage return have two-byte short escapes; other control
      // characters expand to a six-byte \uXXXX; quote and backslash are two.
      if (
        code === 0x08 ||
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0c ||
        code === 0x0d
      ) {
        bytes += 2;
      } else if (code < 0x20) bytes += 6;
      else if (code === 0x22 || code === 0x5c) bytes += 2;
      else bytes += 1;
    } else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A high surrogate is a 4-byte code point only when a low surrogate
      // follows. A lone one is not valid UTF-8 and serializes as a six-byte
      // \uXXXX escape, and must not consume the next unit.
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6; // lone low surrogate → \uXXXX
    } else bytes += 3;
    if (bytes > budget) return bytes;
  }
  return bytes;
}

/**
 * Estimate a document's serialized byte size, aborting as soon as `limit` is
 * passed and WITHOUT materializing the full JSON string — so a document that
 * stays under the node/depth caps but hides a huge string cannot force a giant
 * allocation before being rejected. Iterative, so deep nesting cannot overflow.
 * When the walk completes under the limit, `bytes` is an exact-enough estimate;
 * when `exceeded` is true it stopped early.
 */
export function measureBytes(
  root: unknown,
  limit: number
): { bytes: number; exceeded: boolean } {
  let bytes = 0;
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === "string") {
      bytes += 2 + utf8ByteLength(value, limit - bytes);
    } else if (typeof value === "number" || typeof value === "boolean") {
      bytes += String(value).length;
    } else if (value === null || value === undefined) {
      bytes += 4;
    } else if (Array.isArray(value)) {
      // Count the array's own structural bytes (brackets + commas) and bail
      // BEFORE enqueuing elements: a huge array's comma count alone can exceed
      // the cap, so millions of entries must never be pushed first.
      bytes += 2 + Math.max(0, value.length - 1);
      if (bytes > limit) return { bytes, exceeded: true };
      for (const item of value) stack.push(item);
    } else if (typeof value === "object") {
      bytes += 2; // braces
      if (bytes > limit) return { bytes, exceeded: true };
      for (const [key, val] of Object.entries(
        value as Record<string, unknown>
      )) {
        bytes += utf8ByteLength(key, limit) + 3; // quotes + colon + comma
        if (bytes > limit) return { bytes, exceeded: true };
        stack.push(val);
      }
    }
    if (bytes > limit) return { bytes, exceeded: true };
  }
  return { bytes, exceeded: false };
}
