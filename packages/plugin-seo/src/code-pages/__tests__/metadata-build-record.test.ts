/**
 * A page built in code is recorded as one its build has whenever
 * `seoMetadata` is called while `next build` renders it, even where its head
 * comes from a cache an earlier build filled and the site's page-metadata
 * provider is never asked; and never outside the build.
 *
 * Nextly is stood in for where the page asks it: its start, the cached read
 * of the address's SEO, and the head, answered from a cache without asking
 * the provider. The record itself is watched where it is written.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => ({ db: {} }) as unknown as PluginContext);
const recordBuiltPage = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  getCachedNextly: async () => ({}),
}));

vi.mock("../../not-found/report", () => ({ keptSeoContext: () => ctx }));

vi.mock("../build-record", () => ({ recordBuiltPage }));

// The head as a cache kept it: the provider, where pages are recorded as
// their head is answered, is never asked.
vi.mock("nextly/runtime", () => ({
  cachedFind: async () => ({ collection: "nx_seo_code_pages", row: null }),
  contentPageMetadata: async () => ({ title: "Kept" }),
}));

const { keepCodeRoutes } = await import("../connections");
const { seoMetadata } = await import("../metadata");

afterEach(() => {
  vi.unstubAllEnvs();
  recordBuiltPage.mockClear();
});

describe("a page built in code while the site is built", () => {
  it("is recorded for its build though its head came from a cache", async () => {
    keepCodeRoutes({ read: async () => [], buildDir: () => "/site/.next" });
    vi.stubEnv("NEXT_PHASE", "phase-production-build");

    expect((await seoMetadata("/docs/a")).title).toBe("Kept");

    expect(recordBuiltPage).toHaveBeenCalledWith(ctx, "/site/.next", "/docs/a");
  });

  it("is not recorded while the site is served", async () => {
    keepCodeRoutes({ read: async () => [], buildDir: () => "/site/.next" });

    await seoMetadata("/docs/a");

    expect(recordBuiltPage).not.toHaveBeenCalled();
  });
});
