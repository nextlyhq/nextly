/**
 * Both boot paths seed through one function, so what it seeds is what every
 * boot leaves behind. The request-path boot used to carry its own shorter copy
 * that never reached the custom permissions, which is the case these assertions
 * are here to hold.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const seedSystemPermissions = vi.fn();
const seedAllEntityPermissions = vi.fn();
const seedCustomPermissions = vi.fn();
const markOrphanedPermissions = vi.fn();
const assignNewPermissionsToSuperAdmin = vi.fn();

const config: Record<string, unknown> = {};

vi.mock("../../di/service-access", () => ({
  getService: (name: string) =>
    name === "config"
      ? config
      : {
          seedSystemPermissions,
          seedAllEntityPermissions,
          seedCustomPermissions,
          markOrphanedPermissions,
          assignNewPermissionsToSuperAdmin,
        },
}));

const { seedAllPermissions } = await import("../seed-permissions");

const exportSubmissions = {
  action: "export",
  resource: "submissions",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  seedSystemPermissions.mockResolvedValue({ newPermissionIds: ["sys-1"] });
  seedAllEntityPermissions.mockResolvedValue({
    collections: { newPermissionIds: [] },
    singles: { newPermissionIds: [] },
  });
  seedCustomPermissions.mockResolvedValue({ newPermissionIds: [] });
  config.collections = undefined;
  config.plugins = undefined;
});

describe("seedAllPermissions", () => {
  it("seeds the permissions a plugin declares", async () => {
    config.plugins = [
      {
        name: "@acme/p",
        version: "1.0.0",
        contributes: { permissions: [exportSubmissions] },
      },
    ];

    await seedAllPermissions();

    expect(seedCustomPermissions).toHaveBeenCalledTimes(1);
    expect(seedCustomPermissions.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        action: "export",
        resource: "submissions",
        owner: "@acme/p",
      }),
    ]);
  });

  /**
   * A start marks nothing orphaned, whatever its build stopped declaring: a
   * permission leaves only when `nextly migrate` applies the recorded
   * migration that drops it. The control is the seeding itself, which this
   * start does reach.
   */
  it("marks nothing orphaned", async () => {
    config.plugins = [
      {
        name: "@acme/p",
        version: "1.0.0",
        contributes: { permissions: [exportSubmissions] },
      },
    ];

    await seedAllPermissions();

    expect(seedCustomPermissions).toHaveBeenCalledTimes(1);
    expect(markOrphanedPermissions).not.toHaveBeenCalled();
  });

  /**
   * A new custom permission is worthless without the grant: super_admin is the
   * only role seeding assigns to, so a row created without this is one nobody
   * holds. The positive control is `sys-1`, which the system seeder reported —
   * its presence shows the grant call is reached at all, so the assertion is
   * about the custom id specifically rather than about the call happening.
   */
  it("grants a newly seeded custom permission to super_admin", async () => {
    seedCustomPermissions.mockResolvedValue({ newPermissionIds: ["custom-1"] });

    await seedAllPermissions();

    expect(assignNewPermissionsToSuperAdmin).toHaveBeenCalledWith([
      "sys-1",
      "custom-1",
    ]);
  });

  /** Nothing new means nothing to grant, rather than an empty grant call. */
  it("does not grant when no permission was created", async () => {
    seedSystemPermissions.mockResolvedValue({ newPermissionIds: [] });

    await seedAllPermissions();

    expect(assignNewPermissionsToSuperAdmin).not.toHaveBeenCalled();
  });
});
