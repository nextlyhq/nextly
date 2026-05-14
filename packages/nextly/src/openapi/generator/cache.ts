/**
 * Tiny LRU cache for serialized OpenAPI spec buffers.
 *
 * Capacity is intentionally small (default ~4) because the cache stores
 * already-rendered specs and one Nextly process realistically holds at
 * most: { json, yaml } × { current schemaHash, in-flight new schemaHash }.
 * Anything beyond that is staleness we'd rather drop than retain.
 *
 * Not using an external LRU library for ~4 entries — Map's insertion order
 * combined with delete-then-set gives the same semantics in ~30 lines.
 *
 * @module nextly/openapi/generator/cache
 */

export interface OpenApiCacheOptions {
  /** Maximum number of entries. Excess entries are evicted oldest-first. */
  max: number;
}

export class OpenApiCache {
  private readonly max: number;
  private readonly map = new Map<string, Buffer>();

  constructor(opts: OpenApiCacheOptions) {
    this.max = opts.max;
  }

  /**
   * Look up an entry. Reinserts on hit so the entry becomes most-recently-used.
   * Returns the cached Buffer, or `undefined` on miss.
   */
  get(key: string): Buffer | undefined {
    const v = this.map.get(key);
    if (v) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  /** Store an entry. Evicts oldest entries when over capacity. */
  set(key: string, value: Buffer): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /** Drop every entry whose key starts with `prefix`. Used for invalidation. */
  invalidateByPrefix(prefix: string): void {
    for (const k of Array.from(this.map.keys())) {
      if (k.startsWith(prefix)) this.map.delete(k);
    }
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}
