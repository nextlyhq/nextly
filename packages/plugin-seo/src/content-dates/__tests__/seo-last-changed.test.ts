/**
 * `seoLastChanged` where it reads no content date: the ask it refuses, and
 * what it answers where the SEO plugin is not running here or Nextly could
 * not be started. Its reads of kept dates are pinned on every dialect in
 * `content-dates.integration.test.ts`.
 *
 * Nextly's start (`getCachedNextly`) is stood in for; the policy for a start
 * that failed is the SDK's real one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the next start does. */
const nextly = vi.hoisted(() => ({ startFails: undefined as unknown }));

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  getCachedNextly: async () => {
    if (nextly.startFails !== undefined) throw nextly.startFails;
    return {};
  },
}));

const { seoLastChanged } = await import("../../index");

/** The database unreachable, as an adapter reports it. */
const unreachable = (): Error =>
  Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
    name: "DatabaseError",
    kind: "connection",
  });

const post = { id: "p1", updatedAt: "2026-05-06T07:08:09.000Z" };
const other = { id: 2, updatedAt: new Date("2026-06-07T08:09:10.000Z") };

beforeEach(() => {
  nextly.startFails = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("seoLastChanged", () => {
  it("refuses an ask that names neither a collection nor a Single, or both", async () => {
    await expect(
      seoLastChanged({ entry: post } as unknown as Parameters<
        typeof seoLastChanged
      >[0])
    ).rejects.toThrow(/one collection or one Single/);
    await expect(
      seoLastChanged({
        collection: "posts",
        single: "home",
        entry: post,
      } as unknown as Parameters<typeof seoLastChanged>[0])
    ).rejects.toThrow(/one collection or one Single/);
    await expect(
      seoLastChanged({ collection: " ", entry: post })
    ).rejects.toThrow(/one collection or one Single/);
  });

  it("gives each entry its own last save where the SEO plugin is not running", async () => {
    expect(await seoLastChanged({ collection: "posts", entry: post })).toBe(
      "2026-05-06T07:08:09.000Z"
    );
    const dates = await seoLastChanged({
      collection: "posts",
      entries: [post, other, { id: "p3" }],
    });
    expect([...dates]).toEqual([
      ["p1", "2026-05-06T07:08:09.000Z"],
      [2, "2026-06-07T08:09:10.000Z"],
    ]);
  });

  it("takes documents as Nextly hands them back with no generated types, ids typed unknown", async () => {
    // `nextly.find` without generated types reads `Record<string, unknown>`,
    // and the call takes it as it is: the docs' sitemap sample, compiled by
    // `check:doc-samples`, holds the types. Here, the map is keyed by the ids
    // as given.
    const untyped: Record<string, unknown>[] = [
      { id: "u1", updatedAt: "2026-05-06T07:08:09.000Z" },
      { updatedAt: "2026-06-07T08:09:10.000Z" },
    ];
    const dates = await seoLastChanged({
      collection: "posts",
      entries: untyped,
    });
    expect(dates.get(untyped[0]?.id)).toBe("2026-05-06T07:08:09.000Z");
    // An entry with no id is still dated, by its own last save.
    expect(dates.get(undefined)).toBe("2026-06-07T08:09:10.000Z");
  });

  it("gives each entry its own last save in development where Nextly could not be started", async () => {
    nextly.startFails = unreachable();
    expect(await seoLastChanged({ single: "home", entry: post })).toBe(
      "2026-05-06T07:08:09.000Z"
    );
  });

  it("fails a production render where Nextly could not be started", async () => {
    vi.stubEnv("NODE_ENV", "production");
    nextly.startFails = unreachable();
    await expect(
      seoLastChanged({ collection: "posts", entries: [post] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
