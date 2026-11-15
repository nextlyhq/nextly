/**
 * The head and structured data of a page built in code, where Nextly is
 * unavailable while the page renders.
 *
 * What each case pins:
 * - for production, `next build` included, a start that failed or a read
 *   that found the database unreachable or busy fails the render, so Next.js
 *   keeps the page's last good render and a build fails rather than shipping
 *   the page without its SEO;
 * - a read that failed any other way is the page's own, and its route's own
 *   head is served, as before;
 * - in development every failure serves the route's own head.
 *
 * Nextly is stood in for at the two places the page asks it: its start
 * (`getCachedNextly`) and the cached read of the address's SEO
 * (`cachedFind`). The policy itself is the SDK's real one.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the next start and the next read do. */
const nextly = vi.hoisted(() => ({
  startFails: undefined as unknown,
  readFails: undefined as unknown,
}));

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  getCachedNextly: async () => {
    if (nextly.startFails !== undefined) throw nextly.startFails;
    return {};
  },
}));

vi.mock("nextly/runtime", () => ({
  cachedFind: async () => {
    if (nextly.readFails !== undefined) throw nextly.readFails;
    return null;
  },
}));

const { seoMetadata, seoStructuredData } = await import("../metadata");

/** The database unreachable, as an adapter reports it. */
const unreachable = (): Error =>
  Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
    name: "DatabaseError",
    kind: "connection",
  });

const own = { title: "Pricing" };

beforeEach(() => {
  nextly.startFails = undefined;
  nextly.readFails = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a production render where Nextly is unavailable", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  it("fails the head and the structured data where Nextly could not be started", async () => {
    nextly.startFails = unreachable();
    await expect(
      seoMetadata("/pricing", { metadata: own })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(
      seoStructuredData("/pricing", { metadata: own })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("fails the head where the address's SEO could not be read for a busy database", async () => {
    const busy = NextlyError.databaseBusy();
    nextly.readFails = busy;
    await expect(seoMetadata("/pricing", { metadata: own })).rejects.toBe(busy);
  });

  it("fails the head where a read after the start lost its connection, as the driver threw it", async () => {
    // The address's SEO is read through Drizzle directly, so an outage after
    // the start reaches here as PostgreSQL's own error under Drizzle's.
    nextly.readFails = new Error("Failed query: select * from seo_code_pages", {
      cause: Object.assign(new Error("Connection terminated unexpectedly"), {
        code: "08006",
        severity: "FATAL",
      }),
    });
    await expect(
      seoMetadata("/pricing", { metadata: own })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("fails while `next build` prerenders under another NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    nextly.readFails = unreachable();
    await expect(
      seoMetadata("/pricing", { metadata: own })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("still serves the route's own head where the read failed for a reason of its own", async () => {
    nextly.readFails = new TypeError("cannot read properties of undefined");
    expect(await seoMetadata("/pricing", { metadata: own })).toBe(own);
    expect(
      await seoStructuredData("/pricing", { metadata: own })
    ).toBeUndefined();
  });
});

describe("a development render where Nextly is unavailable", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  it("serves the route's own head where Nextly could not be started", async () => {
    nextly.startFails = unreachable();
    expect(await seoMetadata("/pricing", { metadata: own })).toBe(own);
  });

  it("serves the route's own head where the database is busy", async () => {
    nextly.readFails = NextlyError.databaseBusy();
    expect(await seoMetadata("/pricing", { metadata: own })).toBe(own);
    expect(
      await seoStructuredData("/pricing", { metadata: own })
    ).toBeUndefined();
  });
});
