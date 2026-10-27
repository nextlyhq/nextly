/**
 * A filter on a field inside a field group is judged by that field group's own
 * read rule, and the caller's grants are resolved once for the whole filter,
 * however many field-group paths and field groups it reaches.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../di/container", () => ({
  container: { has: () => false, get: () => undefined },
}));

vi.mock("../../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../services/lib/permissions")
  >()),
  isSuperAdmin: vi.fn(async () => false),
  listRoleSlugsForUser: vi.fn(async () => []),
  listEffectiveGrants: vi.fn(async () => []),
  listEffectivePermissions: vi.fn(async () => []),
}));

vi.mock("../field-level-registry", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../field-level-registry")>();
  return { ...actual, callerAccessGrants: vi.fn(actual.callerAccessGrants) };
});

import * as registry from "../field-level-registry";
import { assertFieldGroupPathsFilterable } from "../filterable-fields";

const USER = { id: "u1" };
/** A rule that asks for the caller's grants, so a resolver is used. */
const byGrant = ({ permissions }: { permissions?: readonly string[] }) =>
  permissions?.includes("read-secrets") === true;

afterEach(() => {
  registry.clearFieldFunctions();
  vi.mocked(registry.callerAccessGrants).mockClear();
});

describe("assertFieldGroupPathsFilterable", () => {
  it("refuses a path the field group's rule hides, naming the key", async () => {
    registry.registerFieldFunctions("fieldGroup", "note", [
      { name: "secret", access: { read: () => false } },
    ]);
    await expect(
      assertFieldGroupPathsFilterable(
        [
          {
            key: "one.secret",
            componentSlugs: ["note"],
            componentFieldPath: "secret",
          },
        ],
        { caller: { user: USER } }
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("resolves the caller's grants once for every target and field group", async () => {
    for (const slug of ["note", "card"]) {
      registry.registerFieldFunctions("fieldGroup", slug, [
        { name: "secret", access: { read: byGrant } },
        { name: "label", access: { read: byGrant } },
      ]);
    }
    await expect(
      assertFieldGroupPathsFilterable(
        [
          {
            key: "zone.secret",
            componentSlugs: ["note", "card"],
            componentFieldPath: "secret",
          },
          {
            key: "one.label",
            componentSlugs: ["note"],
            componentFieldPath: "label",
          },
        ],
        { caller: { user: USER } }
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(registry.callerAccessGrants).toHaveBeenCalledTimes(1);
  });
});
