import { describe, it, expect } from "vitest";

import {
  WebhookEndpointRegistry,
  type WebhookEndpointReader,
} from "../endpoint-registry";

// A reader that counts loads and resolves each on demand, so concurrency and
// invalidation ordering can be driven deterministically.
class FakeReader implements WebhookEndpointReader {
  calls = 0;
  private resolvers: Array<(rows: Record<string, unknown>[]) => void> = [];

  select<T = unknown>(): Promise<T[]> {
    this.calls += 1;
    return new Promise<T[]>(resolve => {
      this.resolvers.push(resolve as (rows: Record<string, unknown>[]) => void);
    }) as Promise<T[]>;
  }

  resolveNext(rows: Record<string, unknown>[]): void {
    const resolve = this.resolvers.shift();
    resolve?.(rows);
  }
}

function row(id: string): Record<string, unknown> {
  return {
    id,
    name: id,
    url: "https://example.com",
    enabled: true,
    eventTypes: ["entry.updated"],
    filter: null,
    headers: null,
    secretHash: [],
    secretPrefix: "",
    fieldAllowlist: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("WebhookEndpointRegistry", () => {
  it("coalesces concurrent first-loads into a single query", async () => {
    const reader = new FakeReader();
    const registry = new WebhookEndpointRegistry(reader);

    const a = registry.getEnabledEndpoints();
    const b = registry.getEnabledEndpoints();
    expect(reader.calls).toBe(1);

    reader.resolveNext([row("wh_1")]);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.map(e => e.id)).toEqual(["wh_1"]);
    expect(rb).toBe(ra);

    // Cache hit: no further query.
    await registry.getEnabledEndpoints();
    expect(reader.calls).toBe(1);
  });

  it("starts a fresh load for callers arriving after invalidate(), not the stale in-flight one", async () => {
    const reader = new FakeReader();
    const registry = new WebhookEndpointRegistry(reader);

    const before = registry.getEnabledEndpoints(); // load 1, in flight
    registry.invalidate();
    const after = registry.getEnabledEndpoints(); // must NOT reuse load 1
    expect(reader.calls).toBe(2);

    reader.resolveNext([row("stale")]); // resolves load 1 (pre-invalidation caller)
    reader.resolveNext([row("fresh")]); // resolves load 2
    expect((await before).map(e => e.id)).toEqual(["stale"]);
    expect((await after).map(e => e.id)).toEqual(["fresh"]);
  });

  it("normalizes a malformed array column to an array (no throw during matching)", async () => {
    const reader = new FakeReader();
    const registry = new WebhookEndpointRegistry(reader);
    const p = registry.getEnabledEndpoints();
    // A legacy/manual write stored event_types as a bare string.
    reader.resolveNext([{ ...row("wh_bad"), eventTypes: "entry.updated" }]);
    const [endpoint] = await p;
    expect(Array.isArray(endpoint.eventTypes)).toBe(true);
    expect(endpoint.eventTypes).toEqual([]);
  });

  it("normalizes a malformed v1 filter so matching cannot throw", async () => {
    const reader = new FakeReader();
    const registry = new WebhookEndpointRegistry(reader);
    const p = registry.getEnabledEndpoints();
    // A legacy/manual write stored changedFields as a bare string; matchesFilter
    // would call .some(...) on it and throw.
    reader.resolveNext([
      { ...row("wh"), filter: { version: 1, changedFields: "title" } },
    ]);
    const [endpoint] = await p;
    expect(endpoint.filter).toMatchObject({ version: 1, changedFields: null });
  });

  it("reloads after the TTL elapses (bounds cross-process staleness)", async () => {
    let clock = 1000;
    const reader = new FakeReader();
    const registry = new WebhookEndpointRegistry(reader, {
      ttlMs: 500,
      now: () => clock,
    });

    const first = registry.getEnabledEndpoints();
    reader.resolveNext([row("v1")]);
    expect((await first).map(e => e.id)).toEqual(["v1"]);

    // Within the TTL: cache hit, no reload.
    clock = 1400;
    await registry.getEnabledEndpoints();
    expect(reader.calls).toBe(1);

    // Past the TTL: reload.
    clock = 1600;
    const stale = registry.getEnabledEndpoints();
    expect(reader.calls).toBe(2);
    reader.resolveNext([row("v2")]);
    expect((await stale).map(e => e.id)).toEqual(["v2"]);
  });

  it("getEnabledEndpointsFresh bypasses a warm cache and reloads", async () => {
    const reader = new FakeReader();
    const registry = new WebhookEndpointRegistry(reader, { ttlMs: 60_000 });

    const first = registry.getEnabledEndpoints();
    reader.resolveNext([row("v1")]);
    expect((await first).map(e => e.id)).toEqual(["v1"]);

    // A warm cache within the TTL serves v1 again with no query.
    await registry.getEnabledEndpoints();
    expect(reader.calls).toBe(1);

    // The fresh read reloads regardless, so fan-out sees a subscriber another
    // process created before the TTL would have expired.
    const fresh = registry.getEnabledEndpointsFresh();
    expect(reader.calls).toBe(2);
    reader.resolveNext([row("v1"), row("v2")]);
    expect((await fresh).map(e => e.id)).toEqual(["v1", "v2"]);
  });

  it("does not let a load that finishes after invalidate() repopulate the cache", async () => {
    const reader = new FakeReader();
    const registry = new WebhookEndpointRegistry(reader);

    const first = registry.getEnabledEndpoints();
    // CRUD changes an endpoint mid-load and invalidates.
    registry.invalidate();
    reader.resolveNext([row("stale")]);
    await first;

    // The stale result must not have been cached; the next read reloads.
    const second = registry.getEnabledEndpoints();
    expect(reader.calls).toBe(2);
    reader.resolveNext([row("fresh")]);
    expect((await second).map(e => e.id)).toEqual(["fresh"]);
  });
});
