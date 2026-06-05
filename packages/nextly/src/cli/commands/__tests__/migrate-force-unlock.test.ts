import { describe, expect, it, vi } from "vitest";

import { maybeForceUnlock } from "../migrate";

function fakeDb() {
  const calls: string[] = [];
  return {
    calls,
    execute: vi.fn(async (q: unknown) => {
      calls.push(JSON.stringify(q));
      return { rows: [] };
    }),
  };
}

describe("migrate --force-unlock", () => {
  it("clears the lock (DELETE nextly_migrate_lock) when the flag is set", async () => {
    const db = fakeDb();
    await maybeForceUnlock({ forceUnlock: true }, db, "postgresql");
    expect(
      db.calls.some(
        c => c.includes("DELETE") && c.includes("nextly_migrate_lock")
      )
    ).toBe(true);
  });

  it("does nothing without the flag", async () => {
    const db = fakeDb();
    await maybeForceUnlock({ forceUnlock: false }, db, "postgresql");
    expect(db.execute).not.toHaveBeenCalled();
  });
});
