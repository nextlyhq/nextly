/**
 * The start's background work runs one part after another: the catch-up,
 * the fingerprint upgrade, the not-found log's move and the staging
 * standing. Side by side they would hold up to four database connections at
 * once, every one a serverless pool has, while the admin's first requests
 * wait for one.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Each start part, as a promise the test settles, and how many run now. */
const parts = vi.hoisted(() => {
  const running = { now: 0, most: 0, order: [] as string[] };
  const pending = new Map<string, () => void>();
  /** A part that runs until the test finishes it. */
  const part = (name: string) => () => {
    running.order.push(name);
    running.now += 1;
    running.most = Math.max(running.most, running.now);
    return new Promise<void>(resolve => {
      pending.set(name, () => {
        running.now -= 1;
        resolve();
      });
    });
  };
  return { running, pending, part };
});

vi.mock("../address-record/catch-up", async importOriginal => ({
  ...(await importOriginal<typeof import("../address-record/catch-up")>()),
  startCatchUp: parts.part("catch-up"),
}));
vi.mock("../content-dates/upgrade", async importOriginal => {
  const real =
    await importOriginal<typeof import("../content-dates/upgrade")>();
  return {
    ...real,
    // The waiting for `after`, with the pass itself stood in for: the plugin
    // hands it the catch-up here, and `upgrade-after.test.ts` holds the real
    // function to reading nothing until that settles.
    startFingerprintUpgrade: (_ctx: unknown, after?: Promise<unknown>) =>
      (after ?? Promise.resolve())
        .catch(() => undefined)
        .then(parts.part("fingerprint-upgrade")),
  };
});
vi.mock("../not-found/log", async importOriginal => ({
  ...(await importOriginal<typeof import("../not-found/log")>()),
  moveLoggedRows: parts.part("not-found-move"),
}));
vi.mock("../staging/guard", async importOriginal => ({
  ...(await importOriginal<typeof import("../staging/guard")>()),
  decideStanding: parts.part("standing"),
}));
vi.mock("../address-record/store", async importOriginal => ({
  ...(await importOriginal<typeof import("../address-record/store")>()),
  recordReady: async () => undefined,
}));
vi.mock("../address-record/recheck", () => ({
  startRecheck: () => () => undefined,
}));

const { seoPlugin } = await import("../plugin");

/** A context with what `onReady` reaches, the database's bounds run as given. */
const ctx = {
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  db: {
    withTransactionBounds: (_bounds: unknown, run: () => Promise<unknown>) =>
      run(),
  },
} as unknown as PluginContext;

/** A few turns of the event loop, for the chain to move on. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}

afterEach(() => {
  for (const finish of parts.pending.values()) finish();
});

describe("the SEO plugin's start", () => {
  it("runs its background work one part at a time, the catch-up first", async () => {
    await seoPlugin({ collections: ["pages"] }).onReady?.(ctx);

    for (const name of [
      "catch-up",
      "fingerprint-upgrade",
      "not-found-move",
      "standing",
    ]) {
      await settle();
      expect(parts.running.order.at(-1)).toBe(name);
      expect(parts.running.now).toBe(1);
      parts.pending.get(name)?.();
    }
    await settle();

    expect(parts.running.most).toBe(1);
    expect(parts.running.order).toEqual([
      "catch-up",
      "fingerprint-upgrade",
      "not-found-move",
      "standing",
    ]);
  });
});
