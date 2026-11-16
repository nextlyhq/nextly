/**
 * The role version's state survives a dev server's module reload on
 * `globalThis`, so the state an older build of this module made is still
 * there when the new one runs, and that build may still be running beside it,
 * a read of its own under way. Before the shared read moved onto `coalesce`,
 * that state held the read under way as `inFlight`, a promise or null. The
 * reloaded module must not trip over the old shape, and must never start a
 * read while the older build's is under way: two reads at once would each
 * publish the same owed invalidations (taking the count below zero), and the
 * older one finishing last would put an older epoch back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../di/container";

const holder = globalThis as unknown as Record<string, unknown>;
const KEY = "__nextly_rbacEpoch";

function chain(result: unknown) {
  const self: Record<string, unknown> = {
    from: () => self,
    where: () => self,
    set: () => self,
    values: () => self,
    limit: () => self,
    then: (resolve: (value: unknown) => unknown) => resolve(result),
  };
  return self;
}

/** A fake database whose shared row reads `revision`, counting reads and writes. */
function countingAdapter(revision: () => number) {
  const counts = { reads: 0, writes: 0 };
  return {
    counts,
    adapter: {
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      getDrizzle: () => ({
        select: () => {
          counts.reads += 1;
          return chain([{ revision: revision(), generation: "g" }]);
        },
        update: () => {
          counts.writes += 1;
          return chain([{ changes: 1 }]);
        },
        insert: () => {
          counts.writes += 1;
          return chain([{ changes: 1 }]);
        },
      }),
    },
  };
}

let previous: unknown;
afterEach(() => {
  if (previous === undefined) delete holder[KEY];
  else holder[KEY] = previous;
  vi.resetModules();
});

describe("the role version across a module reload", () => {
  it("reads past the state an older build of the module left on globalThis", async () => {
    previous = holder[KEY];
    // The state as the module kept it before its read moved onto
    // `coalesce`: the read under way a promise or null.
    holder[KEY] = {
      revision: 0,
      generation: "",
      readAt: 0,
      inFlight: null,
      pendingBumps: 0,
      observed: true,
      retirements: 0,
      degraded: false,
      unannounced: 0,
    };
    vi.resetModules();
    const { refreshEpoch, currentEpoch } = await import("./rbac-epoch");
    container.register("adapter", () => ({
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      getDrizzle: () => ({
        select: () => chain([{ revision: 7, generation: "g" }]),
        update: () => chain([{ changes: 1 }]),
        insert: () => chain([{ changes: 1 }]),
      }),
    }));

    const read = await refreshEpoch({ force: true });

    expect(read).toBe(currentEpoch());
    expect(read).toContain("7");
  });

  it("never reads beside a read an older build left under way, and keeps the newest epoch", async () => {
    previous = holder[KEY];
    // An older build's read, under way: it has claimed the owed bump and will
    // publish it, and on settling adopts the row as it read it.
    let finishOld!: () => void;
    const legacy: Record<string, unknown> = {
      revision: 4,
      generation: "g",
      readAt: 0,
      pendingBumps: 1,
      observed: true,
      retirements: 0,
      degraded: false,
      unannounced: 0,
    };
    legacy.inFlight = new Promise<string>(resolve => {
      finishOld = () => {
        // What the older build's read does as it ends: the bump it sent is
        // no longer owed, the row it read is adopted, its slot cleared.
        legacy.pendingBumps = Number(legacy.pendingBumps) - 1;
        legacy.revision = 5;
        legacy.readAt = Date.now();
        legacy.inFlight = null;
        resolve("g:5");
      };
    });
    holder[KEY] = legacy;
    vi.resetModules();
    const { refreshEpoch, currentEpoch } = await import("./rbac-epoch");
    let row = 5;
    const db = countingAdapter(() => row);
    container.register("adapter", () => db.adapter);

    // An ordinary caller joins the older build's read; a forced one waits it
    // out. Neither touches the database while it runs.
    const joined = refreshEpoch();
    const forced = refreshEpoch({ force: true });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(db.counts).toEqual({ reads: 0, writes: 0 });

    // Another instance moves the row while the older read is still out.
    row = 6;
    finishOld();
    expect(await joined).toBe("g:5");
    const newest = await forced;

    // One publication of the owed bump in all (the older build's): this
    // build published nothing, and the count never went below zero.
    expect(db.counts.writes).toBe(0);
    expect(legacy.pendingBumps).toBe(0);
    // The forced read began after the older one ended, so the newest epoch
    // stands.
    expect(newest).toBe(currentEpoch());
    expect(newest).toContain("6");
    expect(legacy.revision).toBe(6);
  });

  it("is joined by an older build while its own read is under way", async () => {
    previous = holder[KEY];
    delete holder[KEY];
    vi.resetModules();
    const { refreshEpoch } = await import("./rbac-epoch");
    const db = countingAdapter(() => 3);
    container.register("adapter", () => db.adapter);

    const reading = refreshEpoch({ force: true });
    // An older build looks for the read under way in `inFlight` alone.
    const state = holder[KEY] as { inFlight: Promise<string> | null };
    expect(state.inFlight).not.toBeNull();
    const seenByOld = state.inFlight;
    expect(await reading).toBe(await seenByOld);
    expect(db.counts.reads).toBe(1);
    expect(state.inFlight).toBeNull();
  });
});
