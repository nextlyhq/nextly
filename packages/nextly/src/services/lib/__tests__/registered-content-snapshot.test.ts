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

import {
  registeredContentKindOf,
  registeredContentSnapshot,
} from "../registered-content-slugs";

const collections = { getAllSlugs: vi.fn(), getCollectionBySlug: vi.fn() };
const singles = { getAllSlugs: vi.fn(), getSingleBySlug: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  collections.getAllSlugs.mockResolvedValue(["posts"]);
  singles.getAllSlugs.mockResolvedValue(["site-settings"]);
  // Absence is the default, so each case below opts INTO the state it is
  // about. A default of `present` would let a case pass while exercising
  // the wrong branch.
  collections.getCollectionBySlug.mockResolvedValue(null);
  singles.getSingleBySlug.mockResolvedValue(null);
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
    collections.getAllSlugs.mockRejectedValue(new Error("pool timeout"));

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

/**
 * The same distinction the file above is about, asked one slug at a time.
 *
 * 🔴 The point lookup has a caller the enumeration does not: a DISCLOSURE
 * decision, which reads absence as permission because a name that is not
 * registered content is safe to publish. That inverts the safe direction. An
 * access decision refuses on both "absent" and "could not tell", so a boolean
 * serves it fine; a disclosure decision must withhold on the second and may
 * publish on the first, and a boolean silently picks the wrong one.
 *
 * These cases exist so the three-valued answer cannot quietly collapse back
 * into two.
 */
describe("asking the registries about ONE slug", () => {
  it("names the registry that holds it", async () => {
    collections.getCollectionBySlug.mockResolvedValue({ slug: "posts" });

    expect(await registeredContentKindOf("posts")).toEqual({
      kind: "collection",
      known: true,
    });
  });

  it("finds a single when no collection claims the slug", async () => {
    singles.getSingleBySlug.mockResolvedValue({ slug: "site-settings" });

    expect(await registeredContentKindOf("site-settings")).toEqual({
      kind: "single",
      known: true,
    });
  });

  it("prefers the collection when both registries answer", async () => {
    // The same precedence the snapshot gets by writing collections last. The
    // registries do not permit the overlap; pinning it keeps the two readings
    // from disagreeing if they ever do.
    collections.getCollectionBySlug.mockResolvedValue({ slug: "both" });
    singles.getSingleBySlug.mockResolvedValue({ slug: "both" });

    expect((await registeredContentKindOf("both")).kind).toBe("collection");
  });

  it("reports a slug neither registry holds as KNOWN to be absent", async () => {
    // Both lookups answered, and both said no. That is an observation, and a
    // caller may act on it.
    expect(await registeredContentKindOf("ghost")).toEqual({ known: true });
  });

  it("reports a FAILED lookup as unknown, never as absent", async () => {
    // The case the third value exists for. A registry that threw has not said
    // the slug is missing, and a caller that reads it as missing publishes the
    // name of an entity it was refused, exactly while the install is degraded.
    collections.getCollectionBySlug.mockRejectedValue(
      new Error("pool timeout")
    );

    const answer = await registeredContentKindOf("posts");

    expect(answer.known).toBe(false);
    expect(answer.kind).toBeUndefined();
  });

  it("reports a service that FAILS TO CONSTRUCT as unknown too", async () => {
    // `Container.get` invokes the factory, so a lazy singleton whose
    // construction throws propagates exactly as an unregistered name does while
    // `has` is true. The snapshot above draws the same distinction for the same
    // reason; drawing it there and not here would leave the point lookup
    // reporting a broken dependency as an empty install.
    containerGet.mockImplementation((name: string) => {
      if (name === "singleRegistryService") return singles;
      throw new Error("factory blew up during initialization");
    });

    expect((await registeredContentKindOf("posts")).known).toBe(false);
  });

  it("still reports absence when a registry is simply NOT REGISTERED", async () => {
    // The control for the two cases above. An install with no singles has no
    // singles, and treating that as unknown would make every disclosure
    // decision withhold forever on an ordinary install.
    containerHas.mockImplementation(
      (name: string) => name === "collectionRegistryService"
    );

    expect(await registeredContentKindOf("ghost")).toEqual({ known: true });
  });
});
