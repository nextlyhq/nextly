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
 * the served version where it was and is tried again until one loads, even
 * where the stored version is back to the one served.
 *
 * A routine read that waits (for a pooled connection, as a starved pool makes
 * it) holds no request past `SCHEMA_VERSION_WAIT_MS`: each is answered with
 * the version served before, the wait is logged once, and the read still
 * settles the version for the requests after it. A read a change marked here
 * asked for, and a reload, are waited for in full.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => ({
  seq: 1,
  count: 0,
  gate: null as null | Promise<void>,
  /** What each read rejects with, as a driver's error; none where null. */
  fails: null as null | Error,
  /** How long each read takes, on the faked clock. */
  takesMs: 0,
}));
const reloads = vi.hoisted(() => ({
  count: 0,
  /** What each reload answers: whether every entity registered. */
  loads: true,
  takesMs: 0,
  gate: null as null | Promise<void>,
}));
/** Moves the faked clock, as a slow read or reload would. */
const clock = vi.hoisted(() => ({ spend: (_ms: number) => {} }));
const forgets = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../init/reload-dynamic-tables", () => ({
  reloadDynamicTables: async () => {
    reloads.count += 1;
    if (reloads.gate) await reloads.gate;
    clock.spend(reloads.takesMs);
    return reloads.loads;
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
          if (read.fails) throw read.fails;
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
import {
  bumpSchemaVersion,
  SCHEMA_VERSION_READ_INTERVAL_MS,
  SCHEMA_VERSION_WAIT_MS,
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
  read.fails = null;
  reloads.count = 0;
  reloads.gate = null;
  forgets.count = 0;
  // A fresh adapter object per case, as a new start's would be.
  container.registerSingleton("adapter", () => ({ ...adapter }));
  container.registerSingleton("collectionsHandler", () => handler);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  container.clear();
});

/** A promise and the function that settles it. */
function opening(): { gate: Promise<void>; open: () => void } {
  let open = () => {};
  const gate = new Promise<void>(resolve => {
    open = resolve;
  });
  return { gate, open };
}

/** Records whether `answer` has settled, and with what. */
function watched<T>(answer: Promise<T>): { settled: boolean; value?: T } {
  const seen: { settled: boolean; value?: T } = { settled: false };
  void answer.then(value => {
    seen.settled = true;
    seen.value = value;
  });
  return seen;
}

describe("a request while the read of the stored version waits", () => {
  beforeEach(() => {
    // The bound is a timer: faked with the clock, so a case moves both.
    vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
    clock.spend = ms => vi.advanceTimersByTime(ms);
  });

  it("is answered within the bound with the version served before, and the wait is logged once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await servedSchemaVersion()).toBe(1);
    await vi.advanceTimersByTimeAsync(SCHEMA_VERSION_READ_INTERVAL_MS + 1);

    // The next read waits, as one waiting for a pooled connection does.
    const { gate, open } = opening();
    read.gate = gate;
    read.seq = 2;
    const answers = Array.from({ length: 3 }, () =>
      watched(servedSchemaVersion())
    );
    await vi.advanceTimersByTimeAsync(SCHEMA_VERSION_WAIT_MS - 1);
    expect(answers.map(answer => answer.settled)).toEqual([
      false,
      false,
      false,
    ]);
    await vi.advanceTimersByTimeAsync(1);
    // Every request goes on with the version served before, not the one
    // the read will find, and none waited past the bound.
    expect(answers).toEqual(Array(3).fill({ settled: true, value: 1 }));
    expect(read.count).toBe(2);
    const slow = warn.mock.calls.filter(([line]) =>
      String(line).includes("has not answered in")
    );
    expect(slow).toHaveLength(1);

    // The read goes on, and settles the version for the requests after it.
    open();
    await vi.waitFor(() => expect(reloads.count).toBe(2));
    expect(await servedSchemaVersion()).toBe(2);
    expect(read.count).toBe(2);
  });

  it("waits the read out where a change marked here asked for it", async () => {
    expect(await servedSchemaVersion()).toBe(1);
    const { gate, open } = opening();
    read.gate = gate;
    read.seq = 2;
    bumpSchemaVersion();
    const answer = watched(servedSchemaVersion());
    await vi.advanceTimersByTimeAsync(SCHEMA_VERSION_WAIT_MS * 3);
    // Its answer is the change itself: the version before it would tell the
    // admin its own save is not served.
    expect(answer.settled).toBe(false);
    open();
    await vi.waitFor(() => expect(answer).toEqual({ settled: true, value: 2 }));
  });

  it("waits out a reload the read found it needs", async () => {
    expect(await servedSchemaVersion()).toBe(1);
    await vi.advanceTimersByTimeAsync(SCHEMA_VERSION_READ_INTERVAL_MS + 1);
    const { gate, open } = opening();
    reloads.gate = gate;
    read.seq = 2;
    const answer = watched(servedSchemaVersion());
    await vi.waitFor(() => expect(reloads.count).toBe(2));
    await vi.advanceTimersByTimeAsync(SCHEMA_VERSION_WAIT_MS * 3);
    // Another copy changed the schema: the request is served once this
    // copy's definitions follow it.
    expect(answer.settled).toBe(false);
    open();
    await vi.waitFor(() => expect(answer).toEqual({ settled: true, value: 2 }));
  });
});

describe("a read of the stored version that fails", () => {
  it("is logged with its code when it begins and when the code changes, not while it lasts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failures = () =>
      warn.mock.calls.filter(([line]) =>
        String(line).includes("Could not read the stored schema version")
      );
    // A first read that succeeds, so the failures below begin after it.
    expect(await servedSchemaVersion()).toBe(1);

    read.fails = Object.assign(new Error("Waited 5000 ms for a connection"), {
      code: "NEXTLY_POOL_WAIT_TIMEOUT",
    });
    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS + 1);
      // The version served before, as ever for a failed read.
      expect(await servedSchemaVersion()).toBe(1);
    }
    expect(read.count).toBe(4);
    expect(failures()).toHaveLength(1);
    expect(String(failures()[0]?.[0])).toContain("(NEXTLY_POOL_WAIT_TIMEOUT)");

    // Found in the cause chain, as a query error wrapping the driver's.
    read.fails = new Error("Failed query", {
      cause: Object.assign(new Error("connection lost"), { code: "57P01" }),
    });
    vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS + 1);
    await servedSchemaVersion();
    expect(failures()).toHaveLength(2);
    expect(String(failures()[1]?.[0])).toContain("(57P01)");

    // A read that succeeds ends it: the next failure is logged again.
    read.fails = null;
    vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS + 1);
    await servedSchemaVersion();
    read.fails = new Error("connection lost again", {
      cause: Object.assign(new Error("gone"), { code: "57P01" }),
    });
    vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS + 1);
    await servedSchemaVersion();
    expect(failures()).toHaveLength(3);
  });
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

  it("loads the definitions again after a failed reload, even where the stored version is back", async () => {
    await servedSchemaVersion();
    read.seq = 2;
    reloads.loads = false;
    vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS + 1);
    expect(await servedSchemaVersion()).toBe(1);
    expect(reloads.count).toBe(2);

    // The stored version moved back to the one served, while the failed
    // reload may have left the definitions part-way: they are loaded again.
    read.seq = 1;
    reloads.loads = true;
    vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS + 1);
    expect(await servedSchemaVersion()).toBe(1);
    expect(reloads.count).toBe(3);
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
