/**
 * Retention pass gating.
 *
 * There is no scheduler to hang retention off, so passes are gated on a stored
 * timestamp instead. Any caller may offer to run one; at most one gets through
 * per interval per install.
 */
import { describe, expect, it, vi } from "vitest";

import { claimRetentionPass, RETENTION_GATE_KEY } from "../retention-gate";

function memoryStore(initial?: unknown) {
  const values = new Map<string, unknown>();
  if (initial !== undefined) values.set(RETENTION_GATE_KEY, initial);
  return {
    values,
    get: async <T>(key: string): Promise<T | null> =>
      (values.get(key) as T) ?? null,
    set: async (key: string, value: unknown): Promise<void> => {
      values.set(key, value);
    },
  };
}

const T0 = new Date("2026-07-21T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

describe("claimRetentionPass", () => {
  it("lets the first caller through when nothing is recorded", async () => {
    const store = memoryStore();
    await expect(claimRetentionPass(store, HOUR, T0)).resolves.toBe(true);
  });

  it("holds off a second caller inside the interval", async () => {
    const store = memoryStore();
    await claimRetentionPass(store, HOUR, T0);
    const soon = new Date(T0.getTime() + 60_000);
    await expect(claimRetentionPass(store, HOUR, soon)).resolves.toBe(false);
  });

  it("lets a caller through once the interval has elapsed", async () => {
    const store = memoryStore();
    await claimRetentionPass(store, HOUR, T0);
    const later = new Date(T0.getTime() + HOUR + 1);
    await expect(claimRetentionPass(store, HOUR, later)).resolves.toBe(true);
  });

  it("records the attempt BEFORE the pass runs", async () => {
    // A pass that throws must still hold off the next one for a full interval,
    // or every subsequent write would retry a failing prune.
    const store = memoryStore();
    await claimRetentionPass(store, HOUR, T0);
    expect(store.values.get(RETENTION_GATE_KEY)).toBe(T0.toISOString());
  });

  it("reads a stored ISO string back", async () => {
    const store = memoryStore(T0.toISOString());
    const soon = new Date(T0.getTime() + 1000);
    await expect(claimRetentionPass(store, HOUR, soon)).resolves.toBe(false);
  });

  it("treats an unreadable marker as never having run", async () => {
    const store = memoryStore({ unexpected: "shape" });
    await expect(claimRetentionPass(store, HOUR, T0)).resolves.toBe(true);
  });

  it("declines rather than pruning ungated when the store fails", async () => {
    // If the gate cannot be read, an ungated pass could run on every write.
    const broken = {
      get: vi.fn(async () => {
        throw new Error("meta table unavailable");
      }),
      set: vi.fn(async () => {}),
    };
    await expect(claimRetentionPass(broken, HOUR, T0)).resolves.toBe(false);
  });
});
