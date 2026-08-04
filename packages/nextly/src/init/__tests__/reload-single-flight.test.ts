/**
 * Reloads are serialized, and an edit arriving mid-run still gets read.
 *
 * The reload captures the process-global field-type registry and then lets
 * `loadConfig` clear and rebuild it. Two runs overlapping would let one capture
 * a registry the other is halfway through replacing, and an abandoned run would
 * restore a set that was never live. HMR refuses to schedule while its own
 * reload is pending, but `boot-apply` calls straight through, so the two can
 * still meet without this.
 *
 * Handing a mid-run caller the running promise would serialize them but lose
 * their edit: HMR drains its reload flag before calling, and the run already
 * going may have read the config before that edit landed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import { reloadNextlyConfig } from "../reload-config";

const loadConfig = vi.hoisted(() => vi.fn());
vi.mock("../../cli/utils/config-loader", () => ({
  loadConfig,
  clearConfigCache: () => undefined,
}));

// The in-flight and queued runs are pinned to `globalThis`, so one test's
// leftovers would otherwise be answered to the next test's callers.
const reloadGlobals = globalThis as unknown as {
  __nextly_reloadInFlight?: Promise<void>;
  __nextly_reloadQueued?: Promise<void>;
};

afterEach(() => {
  vi.restoreAllMocks();
  loadConfig.mockReset();
  delete reloadGlobals.__nextly_reloadInFlight;
  delete reloadGlobals.__nextly_reloadQueued;
});

// No services are registered in these tests, so a reload returns at its
// DI-resolution guard shortly after `loadConfig` resolves.
const RESULT = { config: { collections: [] }, configPath: "/tmp/c.ts" };

describe("reloadNextlyConfig serialization", () => {
  it("reads the config again for a caller that arrived mid-run", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let started = 0;
    loadConfig.mockImplementation(async () => {
      started += 1;
      if (started === 1) await gate;
      return RESULT;
    });

    const first = reloadNextlyConfig();
    const second = reloadNextlyConfig();

    // Not the same promise: the second caller is waiting on a run that has yet
    // to read the file, not on the one already past that point.
    expect(second).not.toBe(first);

    release();
    await Promise.all([first, second]);
    expect(loadConfig).toHaveBeenCalledTimes(2);
  });

  it("never lets two runs overlap", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let active = 0;
    let maxActive = 0;
    let call = 0;
    loadConfig.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      call += 1;
      if (call === 1) await gate;
      active -= 1;
      return RESULT;
    });

    const first = reloadNextlyConfig();
    const second = reloadNextlyConfig();
    release();
    await Promise.all([first, second]);

    expect(maxActive).toBe(1);
  });

  it("collapses several mid-run callers into one trailing run", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let call = 0;
    loadConfig.mockImplementation(async () => {
      call += 1;
      if (call === 1) await gate;
      return RESULT;
    });

    const first = reloadNextlyConfig();
    const waiters = [
      reloadNextlyConfig(),
      reloadNextlyConfig(),
      reloadNextlyConfig(),
    ];

    // They all want the same thing — the state after the last edit — so one
    // trailing run answers all three.
    expect(waiters[1]).toBe(waiters[0]);
    expect(waiters[2]).toBe(waiters[0]);

    release();
    await Promise.all([first, ...waiters]);
    expect(loadConfig).toHaveBeenCalledTimes(2);
  });

  it("still runs the trailing reload when the one before it fails", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let call = 0;
    loadConfig.mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        await gate;
        throw new Error("bad config edit");
      }
      return RESULT;
    });

    const first = reloadNextlyConfig();
    const second = reloadNextlyConfig();
    release();
    await Promise.all([first, second]);

    // A reload that cannot read the config keeps the previous one and reports
    // it rather than throwing, so the trailing run is chained off a promise
    // that resolves. It still has to happen: the edit that arrived during the
    // bad save is the one likely to fix it.
    expect(loadConfig).toHaveBeenCalledTimes(2);
  });

  it("lets a later caller start a fresh run once the first settles", async () => {
    loadConfig.mockResolvedValue(RESULT);

    await reloadNextlyConfig();
    await reloadNextlyConfig();

    // Serialization is only about overlap: a reload after the previous one
    // finished has to read the config again, or an edit made in between is
    // never seen.
    expect(loadConfig).toHaveBeenCalledTimes(2);
  });
});
