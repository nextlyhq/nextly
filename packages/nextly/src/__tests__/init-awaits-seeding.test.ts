/**
 * `getNextly()` does not resolve until permissions and roles are seeded.
 *
 * Left to run in the background, the seeding could still be writing a role's
 * permissions when a serverless instance answered its first request and was
 * frozen, and the role stayed half-written until another instance started.
 * The request-path boot already waited for it; this pins the instrumentation
 * boot to the same.
 */
import { afterEach, expect, it, vi } from "vitest";

let finishSeeding: () => void = () => {};
const seeding = new Promise<void>(resolve => {
  finishSeeding = resolve;
});
const seedPermissionsAndRolePresets = vi.fn(() => seeding);

vi.mock("../init/seed-permissions", () => ({
  seedPermissionsAndRolePresets,
  seedAllPermissions: vi.fn(async () => undefined),
}));
vi.mock("../init/post-init-tasks", () => ({
  runPostInitTasks: vi.fn(async () => undefined),
}));

const { defineConfig } = await import("../collections/config/define-config");
const { getNextly, shutdownNextly } = await import("../init");

afterEach(async () => {
  await shutdownNextly();
});

it("does not resolve while permissions and roles are still seeding", async () => {
  let resolved = false;
  const booting = getNextly({ config: defineConfig({}) }).then(instance => {
    resolved = true;
    return instance;
  });

  await vi.waitFor(
    () => expect(seedPermissionsAndRolePresets).toHaveBeenCalled(),
    { timeout: 30_000 }
  );
  // Long enough for a boot that did not wait to have resolved already.
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(resolved).toBe(false);

  finishSeeding();
  await booting;
  expect(resolved).toBe(true);
});
