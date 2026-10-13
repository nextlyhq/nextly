/**
 * The request-path boot does not serve until permissions and roles are seeded.
 *
 * An app that boots through `createDynamicHandlers` rather than
 * `instrumentation.ts` registers services on its first request. That boot has
 * to finish seeding before the request goes on, as the instrumentation boot
 * does, or the first requests on a fresh instance are judged against roles
 * that are still being written. The same holds when the instrumentation boot
 * registered the services and is still seeding: this boot then seeds nothing
 * itself, and waits for that run.
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
let otherBootSeeding: Promise<void> = Promise.resolve();
let registered = false;
const seedPermissionsAndRolePresets = vi.fn(() => seeding.promise);
const awaitBootSeeding = vi.fn(() => otherBootSeeding);

vi.mock("../../init/seed-permissions", () => ({
  seedPermissionsAndRolePresets,
  awaitBootSeeding,
  seedAllPermissions: vi.fn(async () => undefined),
}));
vi.mock("../../di", () => ({
  registerServices: vi.fn(async () => {
    registered = true;
  }),
  isServicesRegistered: () => registered,
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

afterEach(() => {
  registered = false;
  seeding = pending();
  otherBootSeeding = Promise.resolve();
  vi.clearAllMocks();
});

/** Whether the boot is still pending once a boot that did not wait would be done. */
async function stillBooting(booting: { done: boolean }): Promise<boolean> {
  // Long enough for a boot that did not wait to have finished already.
  await new Promise(resolve => setTimeout(resolve, 100));
  return !booting.done;
}

function boot(): { done: boolean; finished: Promise<void> } {
  const state = { done: false, finished: Promise.resolve() };
  state.finished = ensureServicesInitialized().then(() => {
    state.done = true;
  });
  return state;
}

it("does not finish booting while permissions and roles are still seeding", async () => {
  setHandlerConfig({} as SanitizedNextlyConfig);

  const booting = boot();
  await vi.waitFor(() =>
    expect(seedPermissionsAndRolePresets).toHaveBeenCalled()
  );
  expect(await stillBooting(booting)).toBe(true);

  seeding.finish();
  await booting.finished;
  expect(booting.done).toBe(true);
});

it("waits for the seeding of the boot that registered the services", async () => {
  setHandlerConfig({} as SanitizedNextlyConfig);
  // The instrumentation boot registered the services and is still seeding.
  registered = true;
  const other = pending();
  otherBootSeeding = other.promise;

  const booting = boot();
  expect(await stillBooting(booting)).toBe(true);
  expect(seedPermissionsAndRolePresets).not.toHaveBeenCalled();

  other.finish();
  await booting.finished;
  expect(booting.done).toBe(true);
});
