/**
 * What a plugin's write expires: the entry's or Single's derived tags and its
 * configured extra ones, and nothing when it opts out of revalidation, read
 * from the registry record as every content write reads it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import type { RevalidationIntent } from "../../../revalidation/types";
import { expireContentTarget } from "../expire-content-target";

let flushed: RevalidationIntent[];
let collectionRecord: () => Promise<unknown>;
let singleRecord: () => Promise<unknown>;
let registryReads: number;

beforeEach(() => {
  container.clear();
  flushed = [];
  registryReads = 0;
  collectionRecord = () => Promise.resolve({ slug: "posts" });
  singleRecord = () => Promise.resolve({ slug: "banner" });
  container.registerSingleton("cacheRevalidator", () => ({
    flush: (intents: RevalidationIntent[]) => {
      flushed.push(...intents);
    },
  }));
  container.registerSingleton("collectionRegistryService", () => ({
    getCollectionBySlug: () => {
      registryReads++;
      return collectionRecord();
    },
  }));
  container.registerSingleton("singleRegistryService", () => ({
    getSingleBySlug: () => {
      registryReads++;
      return singleRecord();
    },
  }));
});

afterEach(() => {
  container.clear();
  vi.restoreAllMocks();
});

const entry = { kind: "collection", slug: "posts", id: "p1" } as const;
const single = { kind: "single", slug: "banner" } as const;

describe("expireContentTarget", () => {
  it("expires an entry's tags and its collection's extra ones", async () => {
    collectionRecord = () =>
      Promise.resolve({ slug: "posts", revalidate: { tags: ["home"] } });
    await expireContentTarget(entry);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.tags).toEqual(
      expect.arrayContaining(["nextly:posts", "nextly:posts:id:p1", "home"])
    );
  });

  it("expires nothing for a collection that opts out", async () => {
    collectionRecord = () =>
      Promise.resolve({ slug: "posts", revalidate: { disable: true } });
    await expireContentTarget(entry);
    expect(flushed).toEqual([]);
  });

  it("expires a Single's tag and its extra ones", async () => {
    singleRecord = () =>
      Promise.resolve({ slug: "banner", revalidate: { tags: ["layout"] } });
    await expireContentTarget(single);
    expect(flushed[0]?.tags).toEqual(
      expect.arrayContaining(["nextly:single:banner", "layout"])
    );
  });

  it("expires nothing for a Single that opts out", async () => {
    singleRecord = () =>
      Promise.resolve({ slug: "banner", revalidate: { disable: true } });
    await expireContentTarget(single);
    expect(flushed).toEqual([]);
  });

  it("still expires the derived tags when the registry cannot be read", async () => {
    collectionRecord = () => Promise.reject(new Error("registry down"));
    await expireContentTarget(entry);
    expect(flushed[0]?.tags).toEqual(
      expect.arrayContaining(["nextly:posts", "nextly:posts:id:p1"])
    );
  });

  it("reads no registry where no revalidator is registered", async () => {
    container.clear();
    container.registerSingleton("collectionRegistryService", () => ({
      getCollectionBySlug: () => {
        registryReads++;
        return collectionRecord();
      },
    }));
    await expireContentTarget(entry);
    expect(registryReads).toBe(0);
    expect(flushed).toEqual([]);
  });

  it("does not throw when the flush fails", async () => {
    container.registerSingleton("cacheRevalidator", () => ({
      flush: () => Promise.reject(new Error("flush failed")),
    }));
    await expect(expireContentTarget(entry)).resolves.toBeUndefined();
  });
});
