/**
 * `getNextly()` does not resolve until permissions and roles are seeded.
 *
 * Left to run in the background, the seeding could still be writing a role's
 * permissions when a serverless instance answered its first request and was
 * frozen, and the role stayed half-written until another instance started.
 * The request-path boot already waited for it; this pins the instrumentation
 * boot to the same, including when the request-path boot registered the
 * services and has yet to seed them. And while this boot is between
 * registering the services and seeding, a boot that finds them registered
 * waits for it. The seeding gate here is the real one; only the seeding itself
 * and the drift check are stood in for.
 */
import { afterEach, expect, it, vi } from "vitest";

let finishSeeding: () => void = () => {};
const seeding = new Promise<void>(resolve => {
  finishSeeding = resolve;
});
const seedPermissionsAndRolePresets = vi.fn(() => seeding);
let driftCheck: Promise<void> = Promise.resolve();

vi.mock("../init/seed-permissions", async importOriginal => ({
  ...(await importOriginal<typeof import("../init/seed-permissions")>()),
  seedPermissionsAndRolePresets,
}));
vi.mock("../init/post-init-tasks", () => ({
  runPostInitTasks: vi.fn(async () => undefined),
}));
vi.mock("../init/drift-check", async importOriginal => ({
  ...(await importOriginal<typeof import("../init/drift-check")>()),
  runDriftCheck: vi.fn(() => driftCheck),
}));

const { defineConfig } = await import("../collections/config/define-config");
const { getNextly, shutdownNextly } = await import("../init");
const { awaitBootSeeding, holdBootSeeding } = await import(
  "../init/seed-permissions"
);
const { isServicesRegistered } = await import("../di");

afterEach(async () => {
  driftCheck = Promise.resolve();
  await shutdownNextly();
});

/** Whether the promise is still pending once a boot that did not wait would be done. */
async function stillPending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  // Long enough for a boot that did not wait to have finished already.
  await new Promise(resolve => setTimeout(resolve, 100));
  return !settled;
}

it("does not resolve while permissions and roles are still seeding", async () => {
  const booting = getNextly({ config: defineConfig({}) });

  await vi.waitFor(
    () => expect(seedPermissionsAndRolePresets).toHaveBeenCalled(),
    { timeout: 30_000 }
  );
  expect(await stillPending(booting)).toBe(true);

  finishSeeding();
  await booting;
});

it("waits for the boot that registered the services to seed them", async () => {
  finishSeeding();
  await getNextly({ config: defineConfig({}) });
  // What the request-path boot leaves behind while it is still between
  // registering and seeding: services registered, the public instance never
  // built, and its hold on the gate.
  delete (globalThis as { __nextly_cachedInstance?: unknown })
    .__nextly_cachedInstance;
  const release = holdBootSeeding();
  seedPermissionsAndRolePresets.mockClear();

  const booting = getNextly({ config: defineConfig({}) });
  expect(await stillPending(booting)).toBe(true);
  expect(seedPermissionsAndRolePresets).not.toHaveBeenCalled();

  release();
  await booting;
});

it("holds the gate from before it registers the services until it has seeded", async () => {
  finishSeeding();
  let finishDriftCheck: () => void = () => {};
  driftCheck = new Promise<void>(resolve => {
    finishDriftCheck = resolve;
  });

  // Registered, then held up in the drift check, before it seeds.
  const booting = getNextly({ config: defineConfig({}) });
  await vi.waitFor(() => expect(isServicesRegistered()).toBe(true), {
    timeout: 30_000,
  });

  // What the request-path boot does on finding the services registered.
  const otherBoot = awaitBootSeeding();
  expect(await stillPending(otherBoot)).toBe(true);

  finishDriftCheck();
  await booting;
  await otherBoot;
});
