/**
 * The request-path boot does not serve until permissions and roles are seeded.
 *
 * An app that boots through `createDynamicHandlers` rather than
 * `instrumentation.ts` registers services on its first request. That boot has
 * to finish seeding before the request goes on, as the instrumentation boot
 * does, or the first requests on a fresh instance are judged against roles
 * that are still being written.
 */
import { expect, it, vi } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";

let finishSeeding: () => void = () => {};
const seeding = new Promise<void>(resolve => {
  finishSeeding = resolve;
});
const seedPermissionsAndRolePresets = vi.fn(() => seeding);

vi.mock("../../init/seed-permissions", () => ({
  seedPermissionsAndRolePresets,
  seedAllPermissions: vi.fn(async () => undefined),
}));
vi.mock("../../di", () => ({
  registerServices: vi.fn(async () => undefined),
  isServicesRegistered: () => false,
  shutdownServices: vi.fn(),
  // Every other post-registration step resolves to nothing: this test is about
  // the order of the seeding and the boot's own return, not what they produce.
  getService: () => new Proxy({}, { get: () => () => undefined }),
}));
vi.mock("../../runtime/hmr-listener", () => ({ ensureHmrListener: vi.fn() }));
vi.mock("../../storage/image-processor", () => ({
  getImageProcessor: () => undefined,
}));

const { ensureServicesInitialized, setHandlerConfig } = await import(
  "../auth-handler"
);

it("does not finish booting while permissions and roles are still seeding", async () => {
  setHandlerConfig({} as SanitizedNextlyConfig);

  let booted = false;
  const booting = ensureServicesInitialized().then(() => {
    booted = true;
  });

  await vi.waitFor(() =>
    expect(seedPermissionsAndRolePresets).toHaveBeenCalled()
  );
  // Long enough for a boot that did not wait to have finished already.
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(booted).toBe(false);

  finishSeeding();
  await booting;
  expect(booted).toBe(true);
});
