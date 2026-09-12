/**
 * Who ends up able to READ a collection they create.
 *
 * Each case is a caller an earlier revision of this policy was wrong about: a
 * route to the grant it did not know existed, and a grant spelling it accepted
 * that names nothing anyone could create.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listRoleSlugsForUser } = vi.hoisted(() => ({
  listRoleSlugsForUser: vi.fn<(userId: string) => Promise<string[]>>(),
}));

vi.mock("../../services/lib/permissions", () => ({ listRoleSlugsForUser }));

import { isCreatableCollectionSlug } from "../../collections/config/collection-slug-rules";
import {
  NEW_COLLECTION_PROBE_SLUG,
  NEW_ENTITY_PERMISSION_ROLE,
  rolesThatWouldReadNewCollection,
  wouldReadOwnNewCollection,
  type NewEntityAccessCaller,
} from "../new-entity-access-policy";
import { presetsGrantingReadOf } from "../role-presets";

const session = (): NewEntityAccessCaller => ({
  userId: "user-1",
  isApiKey: false,
  permissions: [],
});

const key = (permissions: string[]): NewEntityAccessCaller => ({
  userId: "owner-1",
  isApiKey: true,
  permissions,
});

beforeEach(() => {
  vi.clearAllMocks();
  listRoleSlugsForUser.mockResolvedValue([]);
});

describe("the roles a new collection's read grant reaches", () => {
  it("names the role seeded at creation AND one a later boot grants", () => {
    // 🔴 Two routes, and the second is the one this policy originally missed.
    // `assignNewPermissionsToSuperAdmin` runs as the collection is created;
    // `seedRolePresets` re-resolves each preset at every boot, and `admin`'s
    // rule -- everything except escalation -- covers a content collection. An
    // admin therefore reaches what they made, one restart later.
    const eligible = rolesThatWouldReadNewCollection();

    expect(eligible).toContain(NEW_ENTITY_PERMISSION_ROLE);
    expect(eligible).toContain("admin");
  });

  it("asks the presets about a name a collection could be created under", () => {
    // The probe stands for a collection nobody has named yet, so it has to be
    // a name somebody could actually choose. A reserved one would ask the
    // presets a question no real caller can pose.
    expect(isCreatableCollectionSlug(NEW_COLLECTION_PROBE_SLUG)).toBe(true);
  });

  it("answers the same for every creatable slug, which is what lets one stand for all", () => {
    // The assumption the probe rests on, pinned rather than asserted in prose:
    // the presets are blind to WHICH creatable collection they are shown. A
    // preset that started discriminating by slug would fail here instead of
    // silently making the single probe the wrong question.
    const slugs = ["reports", "invoices", "team-updates", "b2"];
    for (const slug of slugs) {
      expect(isCreatableCollectionSlug(slug)).toBe(true);
    }

    const answers = [...slugs, NEW_COLLECTION_PROBE_SLUG].map(slug =>
      presetsGrantingReadOf(slug).join(",")
    );
    expect(new Set(answers).size).toBe(1);
  });
});

describe("a session caller", () => {
  it("is eligible through the preset a later boot re-resolves", async () => {
    listRoleSlugsForUser.mockResolvedValue(["admin"]);

    expect(await wouldReadOwnNewCollection(session())).toBe(true);
  });

  it("is eligible through the role seeded at creation", async () => {
    listRoleSlugsForUser.mockResolvedValue([NEW_ENTITY_PERMISSION_ROLE]);

    expect(await wouldReadOwnNewCollection(session())).toBe(true);
  });

  it("is refused in a role no seeder grants a new collection to", async () => {
    // The must-differ half. Without it "eligible for everyone" satisfies both
    // cases above, and a custom role really does get nothing: the seeder names
    // one role and the presets are the framework's own four.
    listRoleSlugsForUser.mockResolvedValue(["support"]);

    expect(await wouldReadOwnNewCollection(session())).toBe(false);
  });
});

describe("an API key", () => {
  it("is admitted on a read grant naming a collection it could create", async () => {
    expect(
      await wouldReadOwnNewCollection(key(["manage-settings", "read-reports"]))
    ).toBe(true);
  });

  it("is refused when its read grant names a system resource", async () => {
    // 🔴 `read-settings` passes any `read-` prefix test, and `canReadEntity`
    // admits a key on an EXACT `read-<slug>` match -- so this key finishes the
    // step only by creating a collection called `settings`, which is a system
    // resource and refused at creation. Offering the step hands it one it can
    // never complete.
    expect(
      await wouldReadOwnNewCollection(key(["manage-settings", "read-settings"]))
    ).toBe(false);
  });

  it("is refused when its read grant names a reserved route name", async () => {
    // `admin` is reserved without being a system resource, so this case fails
    // against a fix that tested only `isSystemResource` -- the reserved set is
    // wider than the system one, and a collection cannot take either name.
    expect(await wouldReadOwnNewCollection(key(["read-admin"]))).toBe(false);
  });

  it("is refused when it holds no read grant at all", async () => {
    expect(await wouldReadOwnNewCollection(key(["manage-settings"]))).toBe(
      false
    );
  });

  it("is judged on its stamped scope, never on its owner's roles", async () => {
    // A key is judged on the scope stamped into it when it was minted. Reading
    // its owner's roles would make a read-only key equivalent to the account
    // that issued it.
    listRoleSlugsForUser.mockResolvedValue(["admin"]);

    expect(await wouldReadOwnNewCollection(key(["read-settings"]))).toBe(false);
    expect(listRoleSlugsForUser).not.toHaveBeenCalled();
  });
});
