/**
 * After `getNextly` registers the services, the request path can tell what
 * `localization` they hold.
 *
 * An app's server code, an `instrumentation.ts` and the admin's component
 * check all boot through `getNextly`, before the route handler has seen a
 * request. In development the route handler registers the services again
 * when their `localization` block differs from its config's, and it shuts
 * them down to do it, disconnecting the adapter under any other request still
 * using it. So the block `getNextly` registered from has to be known: an
 * unchanged one must not cost that rebuild, and an edited one must still be
 * noticed. The boot is the real one; only seeding and the drift check are
 * stood in for.
 */
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../init/seed-permissions", async importOriginal => ({
  ...(await importOriginal<typeof import("../../init/seed-permissions")>()),
  seedPermissionsAndRolePresets: vi.fn(async () => undefined),
}));
vi.mock("../../init/post-init-tasks", () => ({
  runPostInitTasks: vi.fn(async () => undefined),
}));
vi.mock("../../init/drift-check", async importOriginal => ({
  ...(await importOriginal<typeof import("../../init/drift-check")>()),
  runDriftCheck: vi.fn(async () => undefined),
}));

const { defineConfig } = await import("../../collections/config/define-config");
const { getNextly, shutdownNextly } = await import("../../init");
const { _localizationBlockChangedForTest } = await import("../auth-handler");
const { registeredLocalization } = await import(
  "../../di/registered-localization"
);

const config = defineConfig({
  localization: { locales: ["en", "de"], defaultLocale: "en" },
});

afterEach(async () => {
  await shutdownNextly();
});

it("knows the block getNextly registered from, and still notices an edit", async () => {
  await getNextly({ config });

  // The route handler holds the same config: nothing to register again.
  expect(_localizationBlockChangedForTest(config)).toBe(false);

  // The control: an edited block is still a change, so the guard against a
  // stale `localization` keeps working.
  const edited = defineConfig({
    localization: { locales: ["en", "de", "fr"], defaultLocale: "en" },
  });
  expect(_localizationBlockChangedForTest(edited)).toBe(true);
});

it("forgets the block when the services are released", async () => {
  await getNextly({ config });
  expect(registeredLocalization()).toBeDefined();

  await shutdownNextly();

  // Nothing is registered, so nothing may claim to describe it.
  expect(registeredLocalization()).toBeUndefined();
});
