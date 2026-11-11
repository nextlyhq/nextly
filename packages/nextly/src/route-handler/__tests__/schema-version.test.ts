/**
 * What the schema version check costs a server copy, and when it reloads.
 *
 * The stored version is read through the real reader from a stub database
 * handle that counts its reads, and the definitions' reload is stubbed and
 * counted, so each case states exactly how many of each a run of requests
 * makes: one read shared by every concurrent request, none while the last
 * read is fresh, one reload per change and none without one, and a change
 * marked in this process read at once and answered with the new version
 * rather than the one before it. A read or reload slower than the interval
 * still answers, and schedules only later reads; a reload that failed leaves
 * the served version where it was and is tried again, and while it has not
 * loaded no metadata read is tagged, so no tag answers "unchanged" for a
 * schema this copy's definitions do not hold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => ({
  seq: 1,
  count: 0,
  gate: null as null | Promise<void>,
  /** How long each read takes, on the faked clock. */
  takesMs: 0,
}));
const reloads = vi.hoisted(() => ({
  count: 0,
  /** What each reload answers: whether every entity registered. */
  loads: true,
  takesMs: 0,
}));
/** Moves the faked clock, as a slow read or reload would. */
const clock = vi.hoisted(() => ({ spend: (_ms: number) => {} }));
const forgets = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../init/reload-dynamic-tables", () => ({
  reloadDynamicTables: () => {
    reloads.count += 1;
    clock.spend(reloads.takesMs);
    return Promise.resolve(reloads.loads);
  },
}));
vi.mock("../../di/service-access", () => ({
  isServicesRegistered: () => true,
}));
// The permission version and the caller's roles, as a metadata tag reads
// them: settled, so a tag depends on the schema version alone here.
vi.mock("../../services/lib/rbac-epoch", () => ({
  refreshEpoch: () => Promise.resolve("g:1"),
  epochIsTrustworthy: () => true,
  currentEpoch: () => "g:1",
}));
vi.mock("../../services/lib/permissions", () => ({
  resolveUserRoles: () =>
    Promise.resolve({ roleIds: new Set(["r"]), validUntil: undefined }),
}));

/** The one statement the reader sends, `select … from … where … limit`. */
const database = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          read.count += 1;
          if (read.gate) await read.gate;
          // A slow read, but not forever: a check that reads again because its
          // own read took long finds a quick one from the fourth on, so it
          // stops and the count says how often it read.
          if (read.count <= 3) clock.spend(read.takesMs);
          return [
            { value: JSON.stringify({ migration: null, seq: read.seq }) },
          ];
        },
      }),
    }),
  }),
};

import { container } from "../../di/container";
// Loaded before any case, so the reload the module under test imports on
// first use is the stub.
import "../../init/reload-dynamic-tables";
import { metadataEtag } from "../metadata-etag";
import {
  bumpSchemaVersion,
  SCHEMA_VERSION_READ_INTERVAL_MS,
  servedSchemaVersion,
} from "../schema-version";

const adapter = {
  getDrizzle: () => database,
  getCapabilities: () => ({ dialect: "sqlite" }),
};
const handler = {
  forgetCollectionSchemas: () => {
    forgets.count += 1;
  },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["performance"] });
  clock.spend = ms => vi.advanceTimersByTime(ms);
  read.takesMs = 0;
  reloads.loads = true;
  reloads.takesMs = 0;
  // A process that has read nothing yet.
  delete (globalThis as { __nextly_servedSchema?: unknown })
    .__nextly_servedSchema;
  read.seq = 1;
  read.count = 0;
  read.gate = null;
  reloads.count = 0;
  forgets.count = 0;
  // A fresh adapter object per case, as a new start's would be.
  container.registerSingleton("adapter", () => ({ ...adapter }));
  container.registerSingleton("collectionsHandler", () => handler);
});

afterEach(() => {
  vi.useRealTimers();
  container.clear();
});

describe("the schema version a server copy serves", () => {
  it("is read once for every request arriving together, and the first read reloads once", async () => {
    let open = () => {};
    read.gate = new Promise(resolve => {
      open = resolve;
    });
    const asked = Array.from({ length: 20 }, () => servedSchemaVersion());
    open();
    expect(await Promise.all(asked)).toEqual(Array(20).fill(1));
    expect(read.count).toBe(1);
    // Nothing says which version the start loaded the definitions at.
    expect(reloads.count).toBe(1);
    expect(forgets.count).toBe(1);
  });

  it("reads nothing while the last read is fresh, and reloads nothing when nothing changed", async () => {
    await servedSchemaVersion();
    for (let i = 0; i < 50; i += 1) await servedSchemaVersion();
    expect(read.count).toBe(1);

    vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS + 1);
    expect(await servedSchemaVersion()).toBe(1);
    expect(read.count).toBe(2);
    expect(reloads.count).toBe(1);
  });

  it("reloads the definitions once another copy's change is read", async () => {
    await servedSchemaVersion();
    read.seq = 2;
    // Within the interval the change is not yet read.
    expect(await servedSchemaVersion()).toBe(1);
    vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS + 1);
    expect(await servedSchemaVersion()).toBe(2);
    expect(reloads.count).toBe(2);
    expect(forgets.count).toBe(2);
  });

  it("answers a change marked in this process with the new version, read at once", async () => {
    await servedSchemaVersion();
    read.seq = 2;
    bumpSchemaVersion();
    // Within the interval, and still the new version: the mark forces the read.
    expect(await servedSchemaVersion()).toBe(2);
    expect(read.count).toBe(2);
  });

  it("answers a read slower than the interval with what it read, and reads nothing more at once", async () => {
    read.takesMs = SCHEMA_VERSION_READ_INTERVAL_MS + 500;
    expect(await servedSchemaVersion()).toBe(1);
    expect(read.count).toBe(1);
    // The interval runs from the read's answer: the next request is within it.
    read.takesMs = 0;
    expect(await servedSchemaVersion()).toBe(1);
    expect(read.count).toBe(1);
  });

  it("reads nothing at once after a reload slower than the interval", async () => {
    reloads.takesMs = SCHEMA_VERSION_READ_INTERVAL_MS + 500;
    expect(await servedSchemaVersion()).toBe(1);
    expect(await servedSchemaVersion()).toBe(1);
    expect(read.count).toBe(1);
    expect(reloads.count).toBe(1);
  });

  it("answers no request with the version before a change marked here while the read of it runs", async () => {
    await servedSchemaVersion();
    read.seq = 2;
    bumpSchemaVersion();
    let open = () => {};
    read.gate = new Promise(resolve => {
      open = resolve;
    });
    // The first request starts the read the mark asked for; the second
    // arrives while it runs, within the interval of the read before it.
    const first = servedSchemaVersion();
    await vi.waitFor(() => expect(read.count).toBe(2));
    const second = servedSchemaVersion();
    open();
    expect(await Promise.all([first, second])).toEqual([2, 2]);
  });

  it("keeps the served version where a reload failed, and tries it again", async () => {
    await servedSchemaVersion();
    read.seq = 2;
    reloads.loads = false;
    vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS + 1);
    // The definitions did not load: the change is not served, nor said to be.
    expect(await servedSchemaVersion()).toBe(1);
    expect(reloads.count).toBe(2);

    reloads.loads = true;
    vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS + 1);
    expect(await servedSchemaVersion()).toBe(2);
    expect(reloads.count).toBe(3);
  });

  it("tags no metadata read while a reload has not loaded, and tags again once it has", async () => {
    const tag = async () =>
      metadataEtag(new Request("http://localhost/admin/api/collections"), {
        service: "collections",
        method: "getCollection",
        caller: {
          userId: "u",
          permissions: [],
          roles: [],
          authMethod: "session",
        },
        schemaVersion: await servedSchemaVersion(),
        config: null,
      });
    expect(await tag()).toMatch(/^W\//);

    read.seq = 2;
    reloads.loads = false;
    vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS + 1);
    // The served version stays where it was, and no tag stands for it.
    expect(await servedSchemaVersion()).toBe(1);
    expect(await tag()).toBeUndefined();

    reloads.loads = true;
    vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS + 1);
    expect(await tag()).toMatch(/^W\//);
  });

  it("starts afresh on another database connection", async () => {
    await servedSchemaVersion();
    container.clear();
    container.registerSingleton("adapter", () => ({ ...adapter }));
    container.registerSingleton("collectionsHandler", () => handler);
    await servedSchemaVersion();
    expect(read.count).toBe(2);
    expect(reloads.count).toBe(2);
  });
});
