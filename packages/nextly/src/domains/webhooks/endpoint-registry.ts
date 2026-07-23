/**
 * Webhook domain — enabled-endpoint registry.
 *
 * Provides the set of enabled endpoints the drain fans events out to, cached in
 * memory so a drain pass loads them once rather than per event. The cache is
 * loaded lazily on first use and dropped by `invalidate()` — the webhook CRUD
 * surface (a later slice) calls that on create/update/delete so changes take
 * effect without a restart.
 *
 * @module domains/webhooks/endpoint-registry
 */

import type {
  FilterSpec,
  WebhookEndpoint,
  WebhookEventSubscription,
  WebhookEventType,
} from "./types";

/**
 * Normalize a stored filter so a malformed value can't throw during matching.
 * For the v1 shape, coerce each array field to an array (or drop it): a legacy
 * or manual write of `{ version: 1, changedFields: "title" }` would otherwise
 * make `matchesFilter` call `.some(...)` on a string and throw, stalling the
 * batch. A non-object is treated as no filter; a non-v1 shape is passed through
 * unchanged (matchesFilter rejects unknown versions on its own).
 */
function normalizeFilter(raw: unknown): FilterSpec | null {
  if (raw == null || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  if (f.version !== 1) return f as unknown as FilterSpec;
  const asArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? (v as string[]) : undefined;
  return {
    version: 1,
    eventTypes: asArray(f.eventTypes) as WebhookEventType[] | undefined,
    collections: asArray(f.collections) ?? null,
    changedFields: asArray(f.changedFields) ?? null,
  };
}

/** The narrow read surface the registry needs (satisfied by the DB adapter). */
export interface WebhookEndpointReader {
  select<T = unknown>(
    table: string,
    options?: {
      where?: {
        and: Array<{ column: string; op: string; value: unknown }>;
      };
    }
  ): Promise<T[]>;
}

/**
 * Map a raw `nextly_webhooks` row (Drizzle returns camelCased columns with the
 * JSON columns already parsed) to the typed endpoint. JSON columns are declared
 * `unknown`, so each is narrowed to its stored shape here.
 */
function toEndpoint(row: Record<string, unknown>): WebhookEndpoint {
  // Normalize the JSON array columns to arrays: a malformed row (e.g. a legacy
  // or manual write that stored a non-array) must not later throw inside
  // `.includes(...)`/`new Set(...)` during matching and stall the drain.
  return {
    id: row.id as string,
    name: row.name as string,
    url: row.url as string,
    enabled: Boolean(row.enabled),
    eventTypes: Array.isArray(row.eventTypes)
      ? (row.eventTypes as WebhookEventSubscription[])
      : [],
    filter: normalizeFilter(row.filter),
    headers: (row.headers as Record<string, string> | null) ?? null,
    secretHash: Array.isArray(row.secretHash)
      ? (row.secretHash as string[])
      : [],
    secretPrefix: (row.secretPrefix as string) ?? "",
    fieldAllowlist: Array.isArray(row.fieldAllowlist)
      ? (row.fieldAllowlist as string[])
      : null,
    createdBy: (row.createdBy as string | null) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

export class WebhookEndpointRegistry {
  private cache: readonly WebhookEndpoint[] | null = null;
  private cachedAtMs = 0;
  // A single in-flight load shared by concurrent callers (no stampede), tagged
  // with the generation it was started at. `invalidate()` bumps the generation
  // so a load started before it is neither cached nor reused by later callers.
  private inFlight: Promise<readonly WebhookEndpoint[]> | null = null;
  private inFlightGeneration = -1;
  private generation = 0;
  private readonly ttlMs?: number;
  private readonly now: () => number;

  /**
   * `invalidate()` handles same-process CRUD changes. `ttlMs` additionally
   * bounds staleness from OTHER processes (a webhook created/enabled elsewhere
   * that can't call this instance's `invalidate()`): after `ttlMs` the next read
   * reloads. Omit it (the default) to cache until `invalidate()` — appropriate
   * for a short-lived registry built fresh per drain run.
   */
  constructor(
    private readonly reader: WebhookEndpointReader,
    options?: { ttlMs?: number; now?: () => number }
  ) {
    this.ttlMs = options?.ttlMs;
    this.now = options?.now ?? (() => Date.now());
  }

  private isExpired(): boolean {
    return (
      this.ttlMs !== undefined && this.now() - this.cachedAtMs > this.ttlMs
    );
  }

  /** Enabled endpoints, loaded once and cached until `invalidate()` (or TTL). */
  async getEnabledEndpoints(): Promise<readonly WebhookEndpoint[]> {
    if (this.cache !== null && !this.isExpired()) return this.cache;
    // Join an in-flight load only if it was started under the current
    // generation; a load from before an invalidation must not be reused.
    if (this.inFlight !== null && this.inFlightGeneration === this.generation) {
      return this.inFlight;
    }

    const gen = this.generation;
    const load = this.load().then(
      rows => {
        // Commit to the cache only if no invalidation happened while loading.
        if (gen === this.generation) {
          this.cache = rows;
          this.cachedAtMs = this.now();
        }
        if (this.inFlight === load) this.inFlight = null;
        return rows;
      },
      err => {
        if (this.inFlight === load) this.inFlight = null;
        throw err;
      }
    );
    this.inFlight = load;
    this.inFlightGeneration = gen;
    return load;
  }

  /** Drop the cache so the next read reloads from the database. */
  invalidate(): void {
    this.cache = null;
    this.generation++;
  }

  /**
   * Enabled endpoints read fresh from the database, bypassing the TTL cache.
   *
   * Fan-out uses this rather than {@link getEnabledEndpoints}: a fanned-out
   * event is marked done permanently and never reconsidered, so serving a stale
   * cross-process list — an endpoint another instance created within the TTL —
   * would drop that new subscriber's deliveries forever. Correctness there beats
   * saving a per-round query; delivery and other readers can still use the cache.
   */
  async getEnabledEndpointsFresh(): Promise<readonly WebhookEndpoint[]> {
    this.invalidate();
    return this.getEnabledEndpoints();
  }

  private async load(): Promise<WebhookEndpoint[]> {
    const rows = await this.reader.select<Record<string, unknown>>(
      "nextly_webhooks",
      {
        where: {
          and: [
            { column: "enabled", op: "=", value: true },
            // A retired endpoint is cleared to disabled on delete, so the
            // enabled filter already excludes it; this makes the intent
            // explicit and holds even if a row were re-enabled out of band.
            { column: "deletedAt", op: "IS NULL", value: null },
          ],
        },
      }
    );
    return rows.map(toEndpoint);
  }
}
