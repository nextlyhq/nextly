/**
 * What the schema version check costs a server copy, and when it reloads.
 *
 * The stored version is read through the real reader from a stub database
 * handle that counts its reads, and the definitions' reload is stubbed and
 * counted, so each case states exactly how many of each a run of requests
 * makes: one read shared by every concurrent request, none while the last
 * read is fresh, one reload per change and none without one, and a change
 * marked in this process read at once and answered with the new version
 * rather than the one before it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => ({
  seq: 1,
  count: 0,
  gate: null as null | Promise<void>,
}));
const reloads = vi.hoisted(() => ({ count: 0 }));
const forgets = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../init/reload-dynamic-tables", () => ({
  reloadDynamicTables: () => {
    reloads.count += 1;
    return Promise.resolve();
  },
}));
vi.mock("../../di/service-access", () => ({
  isServicesRegistered: () => true,
}));

/** The one statement the reader sends, `select … from … where … limit`. */
const database = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          read.count += 1;
          if (read.gate) await read.gate;
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
