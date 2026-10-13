/**
 * Boot seeding keeps quiet only about a table that does not exist yet.
 *
 * A boot has to start before migrations have created the permission and role
 * tables, so that one failure is expected and silent. Swallowing every failure
 * left a site without its preset roles and said nothing about why, so any
 * other failure is logged as an error naming the step. The presets still run
 * after a failed permission step; plugin roles wait for a boot whose
 * permissions all seeded. One seeding runs at a time, and a boot can wait for
 * the one in flight.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const error = vi.fn();
const seedSystemPermissions = vi.fn();
const seedRolePresets = vi.fn();
const seedPluginRoles = vi.fn();

vi.mock("../../di/register", () => ({
  getService: (name: string) => {
    switch (name) {
      case "adapter":
        return { getCapabilities: () => ({ dialect: "postgresql" }) };
      case "logger":
        return { debug() {}, info() {}, warn() {}, error };
      case "config":
        return { plugins: [] };
      case "permissionSeedService":
        return {
          seedSystemPermissions,
          seedAllCollectionPermissions: async () => ({ newPermissionIds: [] }),
          seedAllSinglePermissions: async () => ({ newPermissionIds: [] }),
          seedCustomPermissions: async () => ({ newPermissionIds: [] }),
          markOrphanedPermissions: async () => undefined,
          assignNewPermissionsToSuperAdmin: async () => undefined,
        };
      default:
        throw new Error(`no service ${name}`);
    }
  },
}));
vi.mock("../../database/seeders/role-presets", () => ({ seedRolePresets }));
vi.mock("../../plugins/roles/seed-roles", () => ({ seedPluginRoles }));

const { awaitBootSeeding, seedPermissionsAndRolePresets } = await import(
  "../seed-permissions"
);

/** What PostgreSQL reports for a table that does not exist. */
function missingTable(): Error {
  return Object.assign(new Error('relation "permissions" does not exist'), {
    code: "42P01",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  seedSystemPermissions.mockResolvedValue({ newPermissionIds: [] });
  seedRolePresets.mockResolvedValue(undefined);
  seedPluginRoles.mockResolvedValue(undefined);
});

describe("seedPermissionsAndRolePresets", () => {
  it("keeps quiet about a table that does not exist yet, in every step", async () => {
    seedSystemPermissions.mockRejectedValue(missingTable());
    seedRolePresets.mockRejectedValue(missingTable());
    seedPluginRoles.mockRejectedValue(missingTable());

    await expect(seedPermissionsAndRolePresets()).resolves.toBeUndefined();

    expect(error).not.toHaveBeenCalled();
  });

  it("logs any other failure as an error naming the step, and still seeds the presets", async () => {
    seedSystemPermissions.mockRejectedValue(new Error("connection reset"));

    await seedPermissionsAndRolePresets();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toContain("Seeding permissions failed");
    expect(error.mock.calls[0]?.[0]).toContain("connection reset");
    expect(seedRolePresets).toHaveBeenCalled();
  });

  it("creates no plugin role until a boot has seeded every permission", async () => {
    // A plugin role is created once and never revisited, so one created now
    // would keep, for good, only the grants this failed step managed to write.
    seedSystemPermissions.mockRejectedValue(new Error("connection reset"));
    await seedPermissionsAndRolePresets();
    expect(seedPluginRoles).not.toHaveBeenCalled();

    seedSystemPermissions.mockResolvedValue({ newPermissionIds: [] });
    await seedPermissionsAndRolePresets();
    expect(seedPluginRoles).toHaveBeenCalledTimes(1);
  });

  it("runs once at a time: a boot arriving mid-seeding joins the run, and waits for it", async () => {
    let finish: (value: { newPermissionIds: never[] }) => void = () => {};
    seedSystemPermissions.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );

    const first = seedPermissionsAndRolePresets();
    const second = seedPermissionsAndRolePresets();
    let waited = false;
    const waiting = awaitBootSeeding().then(() => {
      waited = true;
    });

    // Long enough for a wait that did not follow the run to have finished.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(waited).toBe(false);

    finish({ newPermissionIds: [] });
    await Promise.all([first, second, waiting]);
    expect(waited).toBe(true);
    expect(seedSystemPermissions).toHaveBeenCalledTimes(1);
    expect(seedRolePresets).toHaveBeenCalledTimes(1);
  });

  it("does not hold a boot up when nothing is seeding", async () => {
    await expect(awaitBootSeeding()).resolves.toBeUndefined();
  });

  it("logs a failure of the role presets or the plugin roles the same way", async () => {
    seedRolePresets.mockRejectedValue(new Error("deadlock detected"));
    seedPluginRoles.mockRejectedValue(new Error("lock wait timeout"));

    await seedPermissionsAndRolePresets();

    const messages = error.mock.calls.map(call => String(call[0]));
    expect(messages).toEqual([
      expect.stringContaining("Seeding role presets failed"),
      expect.stringContaining("Seeding plugin roles failed"),
    ]);
  });

  it("writes nothing during a production build", async () => {
    // What `next build` sets while it prerenders, which is when a build boots
    // Nextly: the first runtime boot seeds before it serves.
    vi.stubEnv("NEXT_PHASE", "phase-production-build");

    await seedPermissionsAndRolePresets();

    expect(seedSystemPermissions).not.toHaveBeenCalled();
    expect(seedRolePresets).not.toHaveBeenCalled();
    expect(seedPluginRoles).not.toHaveBeenCalled();
  });

  it("seeds at runtime, whatever other phase is set", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-server");

    await seedPermissionsAndRolePresets();

    expect(seedSystemPermissions).toHaveBeenCalled();
    expect(seedRolePresets).toHaveBeenCalled();
  });
});
