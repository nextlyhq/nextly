/**
 * The marks' stored rows: the admin's change locks and reports what it was,
 * and a change made in code is reported once, when it first takes effect.
 */
import { describe, expect, it, vi } from "vitest";

import {
  applyDeclaredClosedMarks,
  readStoredClosedMarks,
  writeStoredClosedMark,
} from "./closed-to-super-admin-marks";

/** A `nextly_meta` stand-in holding JSON text, as the table does. */
function fakeMeta() {
  const rows = new Map<string, string>();
  return {
    rows,
    getEntry: vi.fn(async (key: string) => {
      const raw = rows.get(key);
      return raw === undefined
        ? { present: false as const }
        : { present: true as const, value: JSON.parse(raw) };
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      rows.set(key, JSON.stringify(value));
    }),
    insertIfAbsent: vi.fn(async (key: string, value: unknown) => {
      if (!rows.has(key)) rows.set(key, JSON.stringify(value));
    }),
  };
}

const run = (meta: ReturnType<typeof fakeMeta>) => ({
  meta,
  transaction: async (work: (executor: unknown) => Promise<void>) => work("tx"),
});

describe("the admin's change", () => {
  it("reads the row locked on the transaction, and says what the mark was", async () => {
    const meta = fakeMeta();
    expect(await writeStoredClosedMark(meta, "tx", "health", true)).toBe(false);
    expect(await writeStoredClosedMark(meta, "tx", "health", true)).toBe(true);
    expect(await readStoredClosedMarks(meta)).toEqual(["health"]);
    expect(await writeStoredClosedMark(meta, "tx", "health", false)).toBe(true);
    expect(await readStoredClosedMarks(meta)).toEqual([]);
    expect(meta.getEntry).toHaveBeenCalledWith(
      "collections-closed-to-super-admin",
      "tx",
      { lock: true }
    );
    // The row is made before it is read locked, so there is one to lock.
    expect(meta.insertIfAbsent.mock.invocationCallOrder[0]).toBeLessThan(
      meta.getEntry.mock.invocationCallOrder[0]
    );
  });
});

describe("a change made in code", () => {
  it("is reported once, the first run that applies it", async () => {
    const meta = fakeMeta();
    const collections = [
      { slug: "pay", closedToSuperAdmin: true },
      { slug: "posts" },
    ];
    expect(await applyDeclaredClosedMarks(run(meta), collections)).toEqual([
      { collection: "pay", before: false, after: true },
    ]);
    expect(await applyDeclaredClosedMarks(run(meta), collections)).toEqual([]);
  });

  it("reports a mark the code takes off, and one it stops saying, against the admin's", async () => {
    const meta = fakeMeta();
    await applyDeclaredClosedMarks(run(meta), [
      { slug: "pay", closedToSuperAdmin: true },
      { slug: "health", closedToSuperAdmin: true },
    ]);
    await writeStoredClosedMark(meta, "tx", "health", true);
    // The code opens pay, and stops speaking for health, which the admin
    // keeps closed: only pay changed.
    expect(
      await applyDeclaredClosedMarks(run(meta), [
        { slug: "pay", closedToSuperAdmin: false },
      ])
    ).toEqual([{ collection: "pay", before: true, after: false }]);
  });

  it("reports nothing for a code mark matching what the admin had", async () => {
    const meta = fakeMeta();
    await writeStoredClosedMark(meta, "tx", "health", true);
    expect(
      await applyDeclaredClosedMarks(run(meta), [
        { slug: "health", closedToSuperAdmin: true },
      ])
    ).toEqual([]);
  });
});
