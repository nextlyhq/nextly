/**
 * The note of pages whose plain-text copy failed: each address kept whole,
 * since a cut one names another page and is never taken off, and the note
 * kept inside a MySQL `TEXT` column by letting the oldest failures go.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copyFailures, noteCopyResults } from "../copy-failures";

/** The address record's notes, as one map. */
const notes = vi.hoisted(() => new Map<string, string>());

vi.mock("../../address-record/store", () => ({
  noteKey: (name: string) => `meta:${name}`,
  readNotes: async (_ctx: unknown, keys: readonly string[]) => ({
    notes: new Map(
      keys.flatMap(key => {
        const value = notes.get(key);
        return value === undefined ? [] : [[key, value] as const];
      })
    ),
    pending: false,
  }),
  putNote: async (_ctx: unknown, key: string, value: string) => {
    notes.set(key, value);
  },
}));

const ctx = { logger: { warn: vi.fn() } } as unknown as PluginContext;

beforeEach(() => notes.clear());

describe("the pages whose plain-text copy failed", () => {
  it("keeps a long address whole, and takes it off once its copy is made", async () => {
    const url = `https://acme.example/${"a".repeat(800)}`;
    await noteCopyResults(
      ctx,
      [{ url, reason: "status 500", retry: `${url}.md` }],
      []
    );
    expect(
      (await copyFailures(ctx)).map(each => [each.url, each.retry])
    ).toEqual([[url, `${url}.md`]]);
    await noteCopyResults(ctx, [], [url]);
    expect(await copyFailures(ctx)).toEqual([]);
  });

  it("lets the oldest failures go before the note outgrows its column", async () => {
    for (let n = 0; n < 40; n += 1) {
      const url = `https://acme.example/${n}/${"b".repeat(1500)}`;
      await noteCopyResults(
        ctx,
        [{ url, reason: "status 500", retry: url }],
        []
      );
    }
    const kept = await copyFailures(ctx);
    const stored = [...notes.values()][0] ?? "";
    expect(new TextEncoder().encode(stored).length).toBeLessThanOrEqual(60_000);
    // The newest first, the oldest let go.
    expect(kept[0]?.url).toContain("/39/");
    expect(kept.length).toBeLessThan(40);
    expect(kept.length).toBeGreaterThan(10);
  });
});
