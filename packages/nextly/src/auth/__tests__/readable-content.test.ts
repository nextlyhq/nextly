/**
 * The composition: which content a caller may read, and whether one named
 * entity is in reach.
 *
 * Neither function decides anything of its own. What is tested here is that
 * they compose the registry, the caller conversion and the per-entity decision
 * the same way, because a caller admitted by one and refused by the other is
 * exactly the drift they share a module to prevent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { checkAccessSpy, registeredAccessSpy, snapshotSpy } = vi.hoisted(() => ({
  checkAccessSpy: vi.fn(),
  registeredAccessSpy: vi.fn(),
  snapshotSpy: vi.fn(),
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
}));

import { canReadContent, readableContent } from "../readable-content";

/** A signed-in person, whose grants `checkAccess` resolves. */
const session = { user: { id: "user-1", roles: ["editor"] } };

function registry(
  entries: [string, "collection" | "single"][],
  degraded = false
) {
  snapshotSpy.mockResolvedValue({ kinds: new Map(entries), degraded });
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
