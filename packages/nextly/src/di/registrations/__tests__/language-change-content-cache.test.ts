/**
 * What a language change reads to flush the content cache: each collection's and Single's slug
 * and `revalidate` setting, and nothing else of their records, and nothing at all where the
 * registered revalidator is the one that flushes nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NoopRevalidator } from "../../../revalidation/noop-revalidator";

const { services } = vi.hoisted(() => ({
  services: new Map<string, unknown>(),
}));

vi.mock("../../container", () => ({
  container: {
    has: (name: string) => services.has(name),
    get: (name: string) => services.get(name),
  },
}));

import { languageChangeContentCache } from "../language-change-content-cache";

const fullRead = vi.fn(() => Promise.reject(new Error("read every column")));

beforeEach(() => {
  services.clear();
  fullRead.mockClear();
  services.set("collectionRegistryService", {
    getAllCollections: fullRead,
    getAllRevalidateConfigs: () =>
      Promise.resolve([{ slug: "posts", revalidate: { tags: ["nav"] } }]),
  });
  services.set("singleRegistryService", {
    getAllSingles: fullRead,
    getAllRevalidateConfigs: () =>
      Promise.resolve([{ slug: "homepage", revalidate: null }]),
  });
});

describe("the content a language change flushes", () => {
  it("reads each collection's and Single's slug and revalidate setting only", async () => {
    const content = await languageChangeContentCache().content();

    expect(content).toEqual({
      collections: [{ slug: "posts", revalidate: { tags: ["nav"] } }],
      singles: [{ slug: "homepage", revalidate: null }],
    });
    expect(fullRead).not.toHaveBeenCalled();
  });

  it("has no revalidator to flush where the registered one flushes nothing", () => {
    services.set("cacheRevalidator", new NoopRevalidator());

    expect(languageChangeContentCache().revalidator()).toBeUndefined();
  });

  it("hands over a revalidator that flushes", () => {
    const flushing = { flush: vi.fn() };
    services.set("cacheRevalidator", flushing);

    expect(languageChangeContentCache().revalidator()).toBe(flushing);
  });
});
