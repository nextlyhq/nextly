import { isPlainRecord } from "./plain-record";

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
 * When the walk completes under the limit, `bytes` counts every byte JSON would
 * emit — braces, brackets, quotes, colons and separating commas — so a document
 * measured under the cap really is under it. When `exceeded` is true it stopped
 * early and `bytes` is a lower bound.
 */
export function measureBytes(
  root: unknown,
  limit: number
): { bytes: number; exceeded: boolean; unserializable: boolean } {
  let bytes = 0;
  let unserializable = false;
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === "string") {
      bytes += 2 + utf8ByteLength(value, limit - bytes);
    } else if (typeof value === "number") {
      // `NaN` and the infinities are not JSON. The serializer writes `null` in
      // their place, so a document holding one comes back with a different
      // value than the one validated — the silent-rewrite case rather than the
      // throw, which is the worse of the two.
      if (!Number.isFinite(value)) unserializable = true;
      bytes += String(value).length;
    } else if (typeof value === "boolean") {
      bytes += String(value).length;
    } else if (value === null) {
      bytes += 4;
    } else if (value === undefined) {
      // JSON has no `undefined`: a property holding one is OMITTED entirely and
      // an array element becomes `null`. Either way the stored document differs
      // from the one that was checked.
      unserializable = true;
      bytes += 4;
    } else if (Array.isArray(value)) {
      // Count the array's own structural bytes (brackets + commas) and bail
      // BEFORE enqueuing elements: a huge array's comma count alone can exceed
      // the cap, so millions of entries must never be pushed first.
      bytes += 2 + Math.max(0, value.length - 1);
      if (bytes > limit) return { bytes, exceeded: true, unserializable };
      for (const item of value) stack.push(item);
    } else if (
      typeof value === "bigint" ||
      typeof value === "function" ||
      typeof value === "symbol"
    ) {
      // Not JSON. A document holding one of these cannot be stored — the
      // serializer throws on a BigInt and silently drops the other two — so the
      // walk records it rather than skipping past a value it cannot count.
      unserializable = true;
    } else if (typeof value === "object") {
      // Counting and judging are separate questions, and merging them was
      // wrong: an object whose prototype is another plain object serializes
      // exactly like a record, so treating "not a plain record" as "do not
      // count this" reported 2 bytes where JSON emits 9. The count below walks
      // own enumerable properties, which is what JSON does; the FLAG records
      // that the value is not a plain record, which is a question about whether
      // it belongs in a document at all.
      if (!isPlainRecord(value)) unserializable = true;
      bytes += 2; // braces
      if (bytes > limit) return { bytes, exceeded: true, unserializable };
      // `for...in` rather than `Object.entries`: the latter builds the complete
      // array of key/value pairs before the loop can compare even the first key
      // against the limit, so a props object with hundreds of thousands of keys
      // forces exactly the allocation this counter exists to avoid. The own
      // check is what makes `for...in` safe — it walks the prototype chain.
      let properties = 0;
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        // Quotes around the key, the colon, and — for every property after the
        // first — the comma separating it from the previous one. Omitting the
        // comma undercounts by one byte per property, which sounds negligible
        // and is not: a document of 170,000 empty props measured 1,928,973
        // bytes against a real 2,098,977, so an over-cap document was accepted
        // by the bound that exists to refuse it.
        bytes += utf8ByteLength(key, limit) + 3 + (properties > 0 ? 1 : 0);
        properties += 1;
        if (bytes > limit) return { bytes, exceeded: true, unserializable };
        stack.push((value as Record<string, unknown>)[key]);
      }
    }
    if (bytes > limit) return { bytes, exceeded: true, unserializable };
  }
  return { bytes, exceeded: false, unserializable };
}
