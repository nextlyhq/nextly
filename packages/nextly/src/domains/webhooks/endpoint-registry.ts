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

import type { FilterSpec, WebhookEndpoint, WebhookEventType } from "./types";

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
  return {
    id: row.id as string,
    name: row.name as string,
    url: row.url as string,
    enabled: Boolean(row.enabled),
    eventTypes: (row.eventTypes as WebhookEventType[] | null) ?? [],
    filter: (row.filter as FilterSpec | null) ?? null,
    headers: (row.headers as Record<string, string> | null) ?? null,
    secretHash: (row.secretHash as string[] | null) ?? [],
    secretPrefix: (row.secretPrefix as string) ?? "",
    fieldAllowlist: (row.fieldAllowlist as string[] | null) ?? null,
    createdBy: (row.createdBy as string | null) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

export class WebhookEndpointRegistry {
  private cache: readonly WebhookEndpoint[] | null = null;
  // A single in-flight load shared by concurrent callers (no stampede), tagged
  // with the generation it was started at. `invalidate()` bumps the generation
  // so a load started before it is neither cached nor reused by later callers.
  private inFlight: Promise<readonly WebhookEndpoint[]> | null = null;
  private inFlightGeneration = -1;
  private generation = 0;

  constructor(private readonly reader: WebhookEndpointReader) {}

  /** Enabled endpoints, loaded once and cached until `invalidate()`. */
  async getEnabledEndpoints(): Promise<readonly WebhookEndpoint[]> {
    if (this.cache !== null) return this.cache;
    // Join an in-flight load only if it was started under the current
    // generation; a load from before an invalidation must not be reused.
    if (this.inFlight !== null && this.inFlightGeneration === this.generation) {
      return this.inFlight;
    }

    const gen = this.generation;
    const load = this.load().then(
      rows => {
        // Commit to the cache only if no invalidation happened while loading.
        if (gen === this.generation) this.cache = rows;
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

  private async load(): Promise<WebhookEndpoint[]> {
    const rows = await this.reader.select<Record<string, unknown>>(
      "nextly_webhooks",
      { where: { and: [{ column: "enabled", op: "=", value: true }] } }
    );
    return rows.map(toEndpoint);
  }
}
