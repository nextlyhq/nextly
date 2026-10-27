/**
 * The request-path boot does not serve until permissions and roles are seeded.
 *
 * An app that boots through `createDynamicHandlers` rather than
 * `instrumentation.ts` registers services on its first request. That boot has
 * to finish seeding before the request goes on, as the instrumentation boot
 * does, or the first requests on a fresh instance are judged against roles
 * that are still being written. The same holds when the instrumentation boot
 * registered the services and has yet to seed: this boot then seeds nothing
 * itself, and waits for it. And while this boot is between registering the
 * services and seeding, a boot that finds them registered waits for it,
 * whether it registers them cold or again after a development config change. The
 * seeding gate here is the real one; only the seeding itself and the boot's
 * other steps are stood in for.
 */
import { afterEach, expect, it, vi } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";

/** A promise that stays pending until its `finish` is called. */
function pending(): { promise: Promise<void>; finish: () => void } {
  let finish: () => void = () => {};
  const promise = new Promise<void>(resolve => {
    finish = resolve;
  });
  return { promise, finish };
}

let seeding = pending();
let templates: Promise<void> = Promise.resolve();
let registered = false;
const seedPermissionsAndRolePresets = vi.fn(() => seeding.promise);
const registerServices = vi.fn(async () => {
  registered = true;
});

vi.mock("../../init/seed-permissions", async importOriginal => ({
  ...(await importOriginal<typeof import("../../init/seed-permissions")>()),
  seedPermissionsAndRolePresets,
}));
vi.mock("../../di/register", () => ({
  registerServices,
  shutdownServices: vi.fn(async () => {
    registered = false;
  }),
}));
vi.mock("../../di", () => ({
  isServicesRegistered: () => registered,
  // The template step is the one between registering and seeding that a test
  // can hold up; every other step resolves to nothing, since this is about the
  // order of the seeding and the boot's own return, not what they produce.
  getService: (name: string) =>
    name === "emailTemplateService"
      ? { ensureBuiltInTemplates: () => templates }
      : new Proxy({}, { get: () => () => undefined }),
}));
vi.mock("../../runtime/hmr-listener", () => ({ ensureHmrListener: vi.fn() }));
vi.mock("../../storage/image-processor", () => ({
  getImageProcessor: () => undefined,
}));

const { ensureServicesInitialized, setHandlerConfig } = await import(
  "../auth-handler"
);
const { awaitBootSeeding, holdBootSeeding } = await import(
  "../../init/seed-permissions"
);

afterEach(() => {
  vi.unstubAllEnvs();
  registered = false;
  seeding = pending();
  templates = Promise.resolve();
  vi.clearAllMocks();
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

it("does not finish booting while permissions and roles are still seeding", async () => {
  setHandlerConfig({} as SanitizedNextlyConfig);

  const booting = ensureServicesInitialized();
  await vi.waitFor(() =>
    expect(seedPermissionsAndRolePresets).toHaveBeenCalled()
  );
  expect(await stillPending(booting)).toBe(true);

  seeding.finish();
  await booting;
});

it("waits for the boot that registered the services to seed them", async () => {
  setHandlerConfig({} as SanitizedNextlyConfig);
  // The instrumentation boot registered the services and holds the gate until
  // it has seeded.
  registered = true;
  const release = holdBootSeeding();

  const booting = ensureServicesInitialized();
  expect(await stillPending(booting)).toBe(true);
  expect(seedPermissionsAndRolePresets).not.toHaveBeenCalled();

  release();
  await booting;
});

it("holds the gate from before it registers the services until it has seeded", async () => {
  setHandlerConfig({} as SanitizedNextlyConfig);
  seeding.finish();
  const slowTemplates = pending();
  templates = slowTemplates.promise;

  // Registered, then held up in the template step, before it seeds.
  const booting = ensureServicesInitialized();
  await vi.waitFor(() => expect(registerServices).toHaveBeenCalled());

  // What the instrumentation boot does on finding the services registered.
  const otherBoot = awaitBootSeeding();
  expect(await stillPending(otherBoot)).toBe(true);

  slowTemplates.finish();
  await booting;
  await otherBoot;
});

it("holds the gate while it registers the services again after a config change", async () => {
  // Development re-registers the services when the route config's
  // `localization` block has moved since they were registered from it.
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXTLY_DISABLE_INSTRUMENTATION_WARNING", "1");
  seeding.finish();
  setHandlerConfig({} as SanitizedNextlyConfig);
  await ensureServicesInitialized();
  setHandlerConfig({
    localization: { defaultLocale: "en", locales: ["en", "fr"] },
  } as unknown as SanitizedNextlyConfig);
  registerServices.mockClear();
  const slowTemplates = pending();
  templates = slowTemplates.promise;

  // Torn down, registered again, then held up in the template step.
  const booting = ensureServicesInitialized();
  await vi.waitFor(() => expect(registerServices).toHaveBeenCalled());

  const otherBoot = awaitBootSeeding();
  expect(await stillPending(otherBoot)).toBe(true);

  slowTemplates.finish();
  await booting;
  await otherBoot;
});
