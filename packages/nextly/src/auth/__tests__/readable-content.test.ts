/**
 * The composition: which content a caller may read, and whether one named
 * entity is in reach.
 *
 * Neither function decides anything of its own. What is tested here is that
 * they compose the registry, the caller conversion and the per-entity decision
 * the same way, because a caller admitted by one and refused by the other is
 * exactly the drift they share a module to prevent.
 *
 * The two reach the registry differently and that is deliberate: the set
 * enumerates, the single answer takes a point lookup, because a caller walking
 * the entities the set just listed would otherwise scan both registries once
 * per entity. Both registry readings are driven from ONE fixture here, so these
 * cases are about the COMPOSITION rather than about the two registry paths
 * agreeing. That they agree against real registries is a property of the
 * registries and is asserted where real ones exist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { checkAccessSpy, registeredAccessSpy, snapshotSpy, kindOfSpy } =
  vi.hoisted(() => ({
    checkAccessSpy: vi.fn(),
    registeredAccessSpy: vi.fn(),
    snapshotSpy: vi.fn(),
    kindOfSpy: vi.fn(),
  }));

vi.mock("../../di/container", () => ({
  container: {
    has: () => true,
    get: () => ({
      checkAccess: checkAccessSpy,
      getRegisteredAccess: registeredAccessSpy,
    }),
  },
}));

vi.mock("../../services/lib/registered-content-slugs", () => ({
  registeredContentSnapshot: snapshotSpy,
  registeredContentKindOf: kindOfSpy,
}));

import { canReadContent, readableContent } from "../readable-content";

/** A signed-in person, whose grants `checkAccess` resolves. */
const session = { user: { id: "user-1", roles: ["editor"] } };

/**
 * One registry state, answered through BOTH readings.
 *
 * Written from a single map on purpose. Setting the enumeration and the point
 * lookup independently would let a case pass while describing an install whose
 * two registry reads disagree, which is a state nothing can produce and which
 * would make the agreement case below vacuous.
 */
function registry(
  entries: [string, "collection" | "single"][],
  degraded = false
) {
  const kinds = new Map(entries);
  snapshotSpy.mockResolvedValue({ kinds, degraded });
  kindOfSpy.mockImplementation((slug: string) =>
    Promise.resolve(kinds.get(slug))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  registeredAccessSpy.mockReturnValue(undefined);
});

describe("which content a caller may read", () => {
  it("keeps only what the decision admits, with the kind beside it", async () => {
    registry([
      ["posts", "collection"],
      ["homepage", "single"],
      ["secrets", "collection"],
    ]);
    checkAccessSpy.mockImplementation(({ resource }: { resource: string }) =>
      Promise.resolve(resource !== "secrets")
    );

    const { entities, complete } = await readableContent(session);

    expect(entities).toEqual([
      { slug: "posts", kind: "collection" },
      { slug: "homepage", kind: "single" },
    ]);
    expect(complete).toBe(true);
  });

  it("reports an unenumerable registry as incomplete rather than as empty", async () => {
    // The floor. An access decision is right to treat this as nothing readable;
    // a DESCRIPTION reporting the same thing tells a reader the install holds
    // no content, which was never observed.
    registry([["posts", "collection"]], true);
    checkAccessSpy.mockResolvedValue(true);

    const { entities, complete } = await readableContent(session);

    expect(entities).toEqual([{ slug: "posts", kind: "collection" }]);
    expect(complete).toBe(false);
  });
});

describe("whether one named entity is in reach", () => {
  it("admits a registered entity the decision allows", async () => {
    registry([["posts", "collection"]]);
    checkAccessSpy.mockResolvedValue(true);

    expect(await canReadContent("posts", session)).toBe(true);
  });

  it("refuses a registered entity the decision denies", async () => {
    registry([["secrets", "collection"]]);
    checkAccessSpy.mockResolvedValue(false);

    expect(await canReadContent("secrets", session)).toBe(false);
  });

  it("refuses an UNREGISTERED slug the decision would have allowed", async () => {
    // The case only a privileged caller reaches, and the reason the registry
    // check is not redundant. `checkAccess` short-circuits on super-admin
    // before it reads any rule, so it answers yes for a slug that exists
    // nowhere. A scoped key never gets here, because its grant list cannot
    // contain a permission for an entity that was never registered, which is
    // why an integration test driven by keys alone cannot see this.
    registry([["posts", "collection"]]);
    checkAccessSpy.mockResolvedValue(true);

    expect(await canReadContent("ghost", session)).toBe(false);
    expect(
      checkAccessSpy,
      "the decision must not even be asked about a slug with no registry entry"
    ).not.toHaveBeenCalled();
  });

  it("asks the registry for the ONE slug it was given", async () => {
    // Asserted on the ARGUMENTS rather than the answer, because enumerating
    // both registries and searching the result in memory returns exactly the
    // same kind. The cost is what differs, and only the call can show it: a
    // caller inspecting the N entities a description listed would otherwise
    // scan every registry row N times to ask N questions that each name one
    // slug.
    registry([["posts", "collection"]]);
    checkAccessSpy.mockResolvedValue(true);

    await canReadContent("posts", session);

    expect(kindOfSpy).toHaveBeenCalledWith("posts");
    expect(
      snapshotSpy,
      "a point question must not enumerate the registries"
    ).not.toHaveBeenCalled();
  });

  it("agrees with the set, entity for entity", async () => {
    // The property the module exists for. Whatever the list contains, the
    // single answer admits; whatever it omits, the single answer refuses.
    registry([
      ["posts", "collection"],
      ["homepage", "single"],
      ["secrets", "collection"],
    ]);
    checkAccessSpy.mockImplementation(({ resource }: { resource: string }) =>
      Promise.resolve(resource !== "secrets")
    );

    const { entities } = await readableContent(session);
    const listed = new Set(entities.map(e => e.slug));

    for (const slug of ["posts", "homepage", "secrets", "ghost"]) {
      expect(await canReadContent(slug, session), slug).toBe(listed.has(slug));
    }
  });
});
