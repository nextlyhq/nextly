/**
 * The entries one of nextly's cache handlers keeps in memory, least recently
 * used first out once their total size passes a bound.
 *
 * Entries live only in this process. A restart starts empty, so nothing stored
 * before a write made while the app was down can be served after it starts.
 *
 * @module runtime/cache/bounded-entries
 */

/** The default bound on the bytes one handler keeps: 50 MB. */
const DEFAULT_MAX_ENTRY_BYTES = 50 * 1024 * 1024;

export class BoundedEntries<V> {
  private readonly entries = new Map<string, { value: V; bytes: number }>();
  private total = 0;

  constructor(private readonly maxBytes: number = DEFAULT_MAX_ENTRY_BYTES) {}

  get(key: string): V | undefined {
    const found = this.entries.get(key);
    if (found === undefined) return undefined;
    // Read again, so it is the most recently used.
    this.entries.delete(key);
    this.entries.set(key, found);
    return found.value;
  }

  set(key: string, value: V, bytes: number): void {
    this.delete(key);
    // One entry larger than the whole bound is not kept at all.
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes });
    this.total += bytes;
    for (const [oldest, { bytes: size }] of this.entries) {
      if (this.total <= this.maxBytes) break;
      this.entries.delete(oldest);
      this.total -= size;
    }
  }

  delete(key: string): void {
    const found = this.entries.get(key);
    if (found === undefined) return;
    this.entries.delete(key);
    this.total -= found.bytes;
  }

  /** The bytes held, for the bound's tests. */
  get bytes(): number {
    return this.total;
  }
}
