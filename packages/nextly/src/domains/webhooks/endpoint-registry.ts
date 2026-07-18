/**
 * Webhook domain — enabled-endpoint registry.
 *
 * Provides the set of enabled endpoints the capture choke-point fans out to,
 * cached in memory so the write path never issues a query per content change.
 * The cache is loaded lazily on first use and dropped by `invalidate()` — the
 * webhook CRUD surface (a later slice) calls that on create/update/delete so
 * changes take effect without a restart.
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
  // A single in-flight load shared by concurrent callers (no stampede), plus a
  // generation counter so a load that resolves after an `invalidate()` cannot
  // repopulate the cache with data that is already stale.
  private inFlight: Promise<readonly WebhookEndpoint[]> | null = null;
  private generation = 0;

  constructor(private readonly reader: WebhookEndpointReader) {}

  /** Enabled endpoints, loaded once and cached until `invalidate()`. */
  async getEnabledEndpoints(): Promise<readonly WebhookEndpoint[]> {
    if (this.cache !== null) return this.cache;
    if (this.inFlight !== null) return this.inFlight;

    const gen = this.generation;
    this.inFlight = this.load().then(
      rows => {
        // Commit to the cache only if no invalidation happened while loading.
        if (gen === this.generation) this.cache = rows;
        this.inFlight = null;
        return rows;
      },
      err => {
        this.inFlight = null;
        throw err;
      }
    );
    return this.inFlight;
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
