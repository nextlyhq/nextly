/**
 * UUIDv7 — a sortable identifier (RFC 9562 §5.7).
 *
 * Chosen over v4 for primary keys because the leading 48 bits are a
 * millisecond timestamp, so ids generated over time are ASCENDING. A v4 key is
 * uniformly random, which scatters inserts across a B-tree and makes every
 * page a write target; a v7 key appends, and range queries over "recent rows"
 * become a scan rather than a lookup per row.
 *
 * Layout, most significant bit first:
 *
 *   0                   1                   2                   3
 *   |unix_ts_ms (48 bits)              |ver|rand_a |var|rand_b (62 bits)|
 *
 * @module utils/uuid-v7
 * @since 1.0.0
 */

/**
 * The last millisecond a value was issued in, and the counter within it.
 *
 * RFC 9562 §6.2 method 1: within a single millisecond the `rand_a` field
 * carries a counter rather than random bits, so ids issued in the same tick
 * still sort in issue order. Without it a tight loop produces ids that share a
 * timestamp and order randomly, which defeats the reason for choosing v7.
 */
let lastTimestamp = -1;
let counterTimestamp = -1;
let counter = 0;

/** `rand_a` is 12 bits, so the counter wraps there. */
const COUNTER_MAX = 0xfff;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * One UUIDv7, as the canonical 36-character string.
 *
 * With no argument the clock is read here and the result is guaranteed to be
 * strictly greater than the previous one, even if the system clock moves
 * backwards — an id that sorts before one already handed out would insert a
 * row behind existing data.
 *
 * With an EXPLICIT `now` that guarantee does not apply, because the caller has
 * asked for a specific moment and silently substituting a later one would make
 * the timestamp a lie. Callers passing a timestamp are choosing where the id
 * sorts.
 */
export function uuidV7(now?: number): string {
  const explicit = now !== undefined;
  const timestamp = explicit ? now : nextMonotonicTimestamp(Date.now());
  return formatUuidV7(timestamp, nextCounter(timestamp));
}

/**
 * The timestamp to issue from, never going backwards.
 *
 * A clock that steps back — an NTP correction, a virtual machine resuming —
 * would otherwise produce ids that sort before ones already issued.
 */
function nextMonotonicTimestamp(clock: number): number {
  if (clock > lastTimestamp) {
    lastTimestamp = clock;
    return clock;
  }
  // At or behind the last issue. Stay where we are; `nextCounter` orders
  // within the millisecond and rolls forward when it runs out of room.
  return lastTimestamp;
}

/**
 * The counter for this millisecond (RFC 9562 §6.2 method 1).
 *
 * Within a single millisecond `rand_a` carries a counter rather than random
 * bits, so ids issued in the same tick still sort in issue order. Without it a
 * tight loop produces ids sharing a timestamp that order randomly, which
 * defeats the reason for choosing v7.
 */
function nextCounter(timestamp: number): number {
  if (timestamp !== counterTimestamp) {
    counterTimestamp = timestamp;
    counter = 0;
    return counter;
  }
  counter += 1;
  if (counter > COUNTER_MAX) {
    // Out of counter space. Borrowing the next millisecond keeps ids strictly
    // increasing, at the cost of a timestamp at most 1ms early.
    counterTimestamp += 1;
    lastTimestamp = Math.max(lastTimestamp, counterTimestamp);
    counter = 0;
  }
  return counter;
}

/** Lay the timestamp, version, counter, variant and random bits into 16 bytes. */
function formatUuidV7(timestamp: number, counterValue: number): string {
  const bytes = new Uint8Array(16);

  // 48-bit big-endian timestamp. Split rather than using BigInt: the value
  // fits in a double exactly until the year 10889.
  const high = Math.floor(timestamp / 0x1_0000_0000);
  const low = timestamp >>> 0;
  bytes[0] = (high >>> 8) & 0xff;
  bytes[1] = high & 0xff;
  bytes[2] = (low >>> 24) & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;

  // Version 7 in the top nibble of byte 6, then the 12-bit counter.
  bytes[6] = 0x70 | ((counterValue >>> 8) & 0x0f);
  bytes[7] = counterValue & 0xff;

  bytes.set(randomBytes(8), 8);
  // Variant `10` in the top two bits of byte 8.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The millisecond a UUIDv7 was issued in, or null when it is not one.
 *
 * Exported because it is what makes the timestamp claim TESTABLE: a generator
 * whose leading bits were random would pass every uniqueness and format check
 * ever written, and fails this one immediately.
 */
export function uuidV7Timestamp(id: string): number | null {
  const hex = id.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  if ((parseInt(hex.slice(12, 13), 16) & 0xf) !== 7) return null;
  return Number.parseInt(hex.slice(0, 12), 16);
}
