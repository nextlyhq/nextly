/**
 * The allowlist has THREE answers, and collapsing any two is a defect.
 *
 * Both list endpoints that scope by permission read this, and the registries
 * turn its result into a WHERE clause — so `undefined` and `[]` are not two
 * spellings of "nothing to filter by". One means every row, the other means no
 * rows, and a caller that treats them alike shows a reader with no grants the
 * entire install.
 *
 * @module services/lib/readable-slug-allowlist.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const isSuperAdmin = vi.fn();
const listEffectivePermissions = vi.fn();

// The two collaborators are stubbed; the resolver under test is the real one.
// It lives in its own module precisely so this substitution works — a function
// calling its neighbours through module-local references cannot have them
// replaced, and the test would then drive the real permission service.
vi.mock("./permissions", () => ({ isSuperAdmin, listEffectivePermissions }));

const { readableSlugAllowlist } = await import("./readable-slug-allowlist");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("which slugs a caller may read", () => {
  it("answers UNDEFINED for a super admin, which means no filter", async () => {
    isSuperAdmin.mockResolvedValue(true);

    await expect(readableSlugAllowlist("admin")).resolves.toBeUndefined();
    // The grants are never read: a super admin's answer does not depend on
    // them, and asking would be a query per listing for a decided outcome.
    expect(listEffectivePermissions).not.toHaveBeenCalled();
  });

  it("answers UNDEFINED for no caller at all", async () => {
    // Unauthenticated callers are gated at the route layer; reaching here with
    // no id is not a licence to filter by an empty set.
    await expect(readableSlugAllowlist(undefined)).resolves.toBeUndefined();
    expect(isSuperAdmin).not.toHaveBeenCalled();
  });

  it("answers an EMPTY LIST for a caller granted no reads", async () => {
    // 🔴 Distinct from `undefined`, and this is the whole gate. Returning
    // `undefined` here would mean "no filter" and hand every collection and
    // single in the install to a caller holding none.
    isSuperAdmin.mockResolvedValue(false);
    listEffectivePermissions.mockResolvedValue(["media:write", "users:update"]);

    await expect(readableSlugAllowlist("u1")).resolves.toEqual([]);
  });

  it("keeps only the READ half of each grant, de-duplicated", async () => {
    // A write grant is not a read grant, and the resource is the half before
    // the colon. Passing pairs through whole would filter on strings no slug
    // column ever holds, which reads as "this caller may see nothing".
    isSuperAdmin.mockResolvedValue(false);
    listEffectivePermissions.mockResolvedValue([
      "posts:read",
      "pages:read",
      "posts:read",
      "posts:delete",
    ]);

    const allowlist = await readableSlugAllowlist("u1");

    expect([...(allowlist ?? [])].sort()).toEqual(["pages", "posts"]);
  });
});
