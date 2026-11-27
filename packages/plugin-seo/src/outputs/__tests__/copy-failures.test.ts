/**
 * The pages whose plain-text copy failed, each its own note: an address is
 * kept whole, since a cut one names another page and is never taken off;
 * two requests finishing at once keep each other's results; and the list
 * shows the most recent failures first.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copyFailures, noteCopyResults } from "../copy-failures";

/** The address record's notes, by key, with their kinds. */
const notes = vi.hoisted(
  () => new Map<string, { kind: string; value: string }>()
);

/** A turn of the event loop, as a database round trip takes. */
const roundTrip = () => new Promise(done => setTimeout(done, 1));

vi.mock("../../address-record/store", () => ({
  noteKey: (name: string) => `meta:${name}`,
  readNotes: async (_ctx: unknown, keys: readonly string[]) => {
    await roundTrip();
    return {
      notes: new Map(
        keys.flatMap(key => {
          const note = notes.get(key);
          return note === undefined ? [] : [[key, note.value] as const];
        })
      ),
      pending: false,
    };
  },
  putNote: async (
    _ctx: unknown,
    key: string,
    value: string,
    { kind = "meta" }: { kind?: string } = {}
  ) => {
    await roundTrip();
    notes.set(key, { kind, value });
  },
  forgetNotes: async (_ctx: unknown, keys: readonly string[]) => {
    await roundTrip();
    for (const key of keys) notes.delete(key);
  },
  notesOfKind: async (_ctx: unknown, kind: string, limit: number) => {
    await roundTrip();
    return [...notes]
      .filter(([, note]) => note.kind === kind)
      .slice(0, limit)
      .map(([key, note]) => ({ key, kind, value: note.value }));
  },
}));

const ctx = { logger: { warn: vi.fn() } } as unknown as PluginContext;

const failure = (url: string) => ({ url, reason: "status 500", retry: url });

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

  it("keeps both of two failures noted at once, and a page settled beside them", async () => {
    await noteCopyResults(ctx, [failure("https://acme.example/old")], []);
    await Promise.all([
      noteCopyResults(ctx, [failure("https://acme.example/a")], []),
      noteCopyResults(ctx, [failure("https://acme.example/b")], []),
      noteCopyResults(ctx, [], ["https://acme.example/old"]),
    ]);
    expect((await copyFailures(ctx)).map(each => each.url).sort()).toEqual([
      "https://acme.example/a",
      "https://acme.example/b",
    ]);
  });

  it("lists the most recent failures first, and no more than forty", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let n = 0; n < 45; n += 1) {
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, n)));
        await noteCopyResults(ctx, [failure(`https://acme.example/${n}`)], []);
      }
    } finally {
      vi.useRealTimers();
    }
    const listed = await copyFailures(ctx);
    expect(listed).toHaveLength(40);
    expect(listed[0]?.url).toBe("https://acme.example/44");
  });
});
