/**
 * The allowlist has THREE answers, and collapsing any two is a defect.
 *
 * Both list endpoints that scope by permission read this, and the registries
 * turn its result into a WHERE clause — so `undefined` and `[]` are not two
 * spellings of "nothing to filter by". One means every row, the other means no
 * rows, and a caller that treats them alike shows a reader with no grants the
 * entire install.
 *
 * And the list is DERIVED from the shared read decision, not from the stored
 * grants: a slug the decision admits is listed whether or not a grant row
 * exists for it, and a slug it refuses is not listed whatever the grants say.
 *
 * @module services/lib/readable-slug-allowlist.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReadAccessCaller } from "../../auth/entity-read-access";

const isSuperAdmin = vi.fn();
const readableEntities = vi.fn();
const registeredSlugsOfKind = vi.fn();

// The collaborators are stubbed; the resolver under test is the real one. It
// lives in its own module precisely so this substitution works — a function
// calling its neighbours through module-local references cannot have them
// replaced, and the test would then drive the real permission service.
vi.mock("./permissions", () => ({ isSuperAdmin }));
vi.mock("../../auth/entity-read-access", () => ({ readableEntities }));
vi.mock("./registered-content-slugs", () => ({ registeredSlugsOfKind }));

const { readableSlugAllowlist } = await import("./readable-slug-allowlist");

const session: ReadAccessCaller = {
  userId: "u1",
  authMethod: "session",
  permissions: [],
  roles: ["editor"],
};
const apiKey: ReadAccessCaller = {
  userId: "u1",
  authMethod: "api-key",
  permissions: ["read-posts"],
  roles: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  isSuperAdmin.mockResolvedValue(false);
  registeredSlugsOfKind.mockResolvedValue({
    slugs: ["posts", "secrets", "notes"],
    reachable: true,
  });
});

describe("which slugs a caller may read", () => {
  it("answers UNDEFINED for a session super admin, which means no filter", async () => {
    isSuperAdmin.mockResolvedValue(true);
    expect(await readableSlugAllowlist(session, "collection")).toBeUndefined();
    // Nothing else was asked: the bypass is the whole answer.
    expect(readableEntities).not.toHaveBeenCalled();
  });

  it("answers UNDEFINED for no caller at all", async () => {
    expect(await readableSlugAllowlist(undefined, "single")).toBeUndefined();
    expect(readableEntities).not.toHaveBeenCalled();
  });

  it("does NOT bypass for an API key, however privileged its owner", async () => {
    // 🔴 The owner's standing is not the key's. `canReadEntity` judges a key on
    // its own stamped scope, and a bypass here would make a read-only key
    // issued by an administrator equivalent to their whole account on the two
    // endpoints that list the most.
    isSuperAdmin.mockResolvedValue(true);
    readableEntities.mockResolvedValue(new Set(["posts"]));
    expect(await readableSlugAllowlist(apiKey, "collection")).toEqual([
      "posts",
    ]);
    expect(readableEntities).toHaveBeenCalledWith(
      ["posts", "secrets", "notes"],
      apiKey
    );
  });

  it("lists exactly what the shared read decision admits, in registry order", async () => {
    // Neither a grant row nor its absence is consulted here: the decision is
    // `readableEntities`' alone, and this returns its verdict as a list.
    readableEntities.mockResolvedValue(new Set(["notes", "posts"]));
    expect(await readableSlugAllowlist(session, "collection")).toEqual([
      "posts",
      "notes",
    ]);
  });

  it("asks about the registry of the KIND being listed", async () => {
    readableEntities.mockResolvedValue(new Set());
    await readableSlugAllowlist(session, "single");
    expect(registeredSlugsOfKind).toHaveBeenCalledWith("single");
  });

  it("answers an EMPTY LIST for a caller admitted to nothing", async () => {
    readableEntities.mockResolvedValue(new Set());
    expect(await readableSlugAllowlist(session, "collection")).toEqual([]);
  });

  it("answers an EMPTY LIST when the registry could not be enumerated", async () => {
    // 🔴 Fails CLOSED. A registry that could not be reached is not "no
    // content", and it is not "every row" either -- it is an access decision
    // with no candidates, and admitting nothing is the safe direction. The
    // decision itself is not even asked, so it cannot answer from a floor.
    registeredSlugsOfKind.mockResolvedValue({ slugs: [], reachable: false });
    expect(await readableSlugAllowlist(session, "single")).toEqual([]);
    expect(readableEntities).not.toHaveBeenCalled();
  });
});
