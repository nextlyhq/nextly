/**
 * Retention pass gating.
 *
 * There is no scheduler to hang retention off, so passes are gated on a stored
 * marker instead. Any caller may offer to run one; the claim decides.
 */
import { describe, expect, it, vi } from "vitest";

import {
  claimRetentionPass,
  MetaRetentionGate,
  RETENTION_GATE_KEY,
} from "../retention-gate";

const T0 = new Date("2026-07-21T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

/** A store that records how it was asked, so the claim contract is visible. */
function recordingStore(result: boolean) {
  const calls: { key: string; dueBefore: Date; now: Date }[] = [];
  return {
    calls,
    claim: async (
      key: string,
      dueBefore: Date,
      now: Date
    ): Promise<boolean> => {
      calls.push({ key, dueBefore, now });
      return result;
    },
  };
}

describe("claimRetentionPass", () => {
  it("asks the store to claim the marker as of one interval ago", async () => {
    const store = recordingStore(true);
    await expect(claimRetentionPass(store, HOUR, T0)).resolves.toBe(true);
    expect(store.calls[0].key).toBe(RETENTION_GATE_KEY);
    expect(store.calls[0].dueBefore).toEqual(new Date(T0.getTime() - HOUR));
  });

  it("does not run when the claim is refused", async () => {
    const store = recordingStore(false);
    await expect(claimRetentionPass(store, HOUR, T0)).resolves.toBe(false);
  });

  it("declines rather than pruning ungated when the store fails", async () => {
    // If the gate cannot be claimed, an ungated pass could run on every write.
    const broken = {
      claim: vi.fn(async () => {
        throw new Error("meta table unavailable");
      }),
    };
    await expect(claimRetentionPass(broken, HOUR, T0)).resolves.toBe(false);
  });
});

describe("MetaRetentionGate", () => {
  /** A `nextly_meta` stand-in whose key is unique, as the real primary key is. */
  function fakeAdapter(existing?: { updatedAt: Date }) {
    let row = existing ? { ...existing } : undefined;
    const ops: string[] = [];
    return {
      ops,
      get row() {
        return row;
      },
      adapter: {
        delete: async (
          _t: string,
          where: { and: { column: string; value?: unknown }[] }
        ): Promise<number> => {
          ops.push("delete");
          const before = where.and.find(c => c.column === "updatedAt")
            ?.value as Date;
          if (row && row.updatedAt < before) {
            row = undefined;
            return 1;
          }
          return 0;
        },
        insert: async (
          _t: string,
          data: Record<string, unknown>
        ): Promise<unknown> => {
          ops.push("insert");
          // The primary key rejects a second row for the same marker.
          if (row) throw new Error("duplicate key");
          row = { updatedAt: data.updated_at as Date };
          return data;
        },
      },
    };
  }

  it("claims when no marker exists yet", async () => {
    const f = fakeAdapter();
    const gate = new MetaRetentionGate(f.adapter);
    await expect(
      gate.claim(RETENTION_GATE_KEY, new Date(T0.getTime() - HOUR), T0)
    ).resolves.toBe(true);
    expect(f.row?.updatedAt).toEqual(T0);
  });

  it("claims by removing a stale marker, then restamping it", async () => {
    const f = fakeAdapter({ updatedAt: new Date(T0.getTime() - 2 * HOUR) });
    const gate = new MetaRetentionGate(f.adapter);
    await expect(
      gate.claim(RETENTION_GATE_KEY, new Date(T0.getTime() - HOUR), T0)
    ).resolves.toBe(true);
    // The conditional delete IS the claim; the insert only restamps it.
    expect(f.ops).toEqual(["delete", "insert"]);
    expect(f.row?.updatedAt).toEqual(T0);
  });

  it("refuses while the marker is still current", async () => {
    const f = fakeAdapter({ updatedAt: new Date(T0.getTime() - 60_000) });
    const gate = new MetaRetentionGate(f.adapter);
    await expect(
      gate.claim(RETENTION_GATE_KEY, new Date(T0.getTime() - HOUR), T0)
    ).resolves.toBe(false);
    // Nothing stale to delete, and the primary key rejects a duplicate.
    expect(f.ops).toEqual(["delete", "insert"]);
  });

  it("lets exactly one of two racing callers through", async () => {
    // The point of the atomic claim: without it every instance of a
    // multi-instance deployment would run its own pass each interval.
    const f = fakeAdapter({ updatedAt: new Date(T0.getTime() - 2 * HOUR) });
    const gate = new MetaRetentionGate(f.adapter);
    const dueBefore = new Date(T0.getTime() - HOUR);

    const first = await gate.claim(RETENTION_GATE_KEY, dueBefore, T0);
    const second = await gate.claim(RETENTION_GATE_KEY, dueBefore, T0);

    expect([first, second]).toEqual([true, false]);
  });
});
