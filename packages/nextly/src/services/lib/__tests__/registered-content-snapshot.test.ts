/**
 * "There is no such registry" and "the registry could not answer" are different
 * facts, and this file exists because they look identical.
 *
 * 🔴 Both produce an empty slug set, and callers treat them oppositely: a
 * COMPLETE empty answer is an install with no content of that kind, while a
 * FLOOR means a dependency failed and anything counted or authorized against it
 * is a shortfall. The activity feed refuses on the second and must not refuse on
 * the first, or an ordinary install never renders a feed at all.
 *
 * Told apart by which operation failed. An earlier version discriminated on
 * `container.has`, which a container may answer differently from `get` — that
 * emptied the candidate set for every caller, not just the one asking about
 * degradation, and took the dashboard's whole read scope with it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const containerGet = vi.fn();
const containerHas = vi.fn();

vi.mock("../../../di/container", () => ({
  container: {
    get: (name: string) => containerGet(name) as unknown,
    has: (name: string) => containerHas(name) as boolean,
  },
}));

import { registeredContentSnapshot } from "../registered-content-slugs";

const collections = { getAllCollections: vi.fn() };
const singles = { getAllSingles: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  collections.getAllCollections.mockResolvedValue([{ slug: "posts" }]);
  singles.getAllSingles.mockResolvedValue([{ slug: "site-settings" }]);
  containerHas.mockReturnValue(true);
  containerGet.mockImplementation((name: string) => {
    if (name === "collectionRegistryService") return collections;
    if (name === "singleRegistryService") return singles;
    throw new Error(`unexpected container.get("${name}")`);
  });
});

describe("enumerating the content registries", () => {
  it("reports both kinds, with the registry that owns each slug", async () => {
    const snapshot = await registeredContentSnapshot();

    expect(snapshot.kinds.get("posts")).toBe("collection");
    expect(snapshot.kinds.get("site-settings")).toBe("single");
    expect(snapshot.degraded).toBe(false);
  });

  it("is NOT degraded when a registry is simply not registered", async () => {
    // An install with no singles has no singles, and that is a whole answer.
    // Marking it a floor makes every caller that refuses on one refuse forever.
    containerHas.mockImplementation(
      (name: string) => name === "collectionRegistryService"
    );

    const snapshot = await registeredContentSnapshot();

    expect(snapshot.degraded).toBe(false);
    expect(snapshot.kinds.get("posts")).toBe("collection");
  });

  it("IS degraded when a registered registry cannot answer", async () => {
    // The case the flag exists for: a registered registry that throws has said
    // nothing about how much it holds, so its empty result is a floor.
    collections.getAllCollections.mockRejectedValue(new Error("pool timeout"));

    const snapshot = await registeredContentSnapshot();

    expect(snapshot.degraded).toBe(true);
  });

  it("IS degraded when a registered service FAILS TO CONSTRUCT", async () => {
    // 🔴 `Container.get` invokes the factory, so a lazy singleton whose
    // construction throws propagates from `get` exactly as an unregistered name
    // does -- while `has` is true. Catching around `get` and calling that
    // "absent" reports a failed dependency as an intentionally empty install,
    // which is the direction that lets a caller treat missing kinds as
    // install-level events and admit them unauthorized.
    containerGet.mockImplementation((name: string) => {
      if (name === "singleRegistryService") return singles;
      throw new Error("factory blew up during initialization");
    });

    const snapshot = await registeredContentSnapshot();

    expect(snapshot.degraded).toBe(true);
  });
});
