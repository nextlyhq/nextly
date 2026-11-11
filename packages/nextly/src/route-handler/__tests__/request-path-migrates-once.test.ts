/**
 * The request-path boot applies production migrations exactly once, inside
 * `registerServices`.
 *
 * `registerServices` runs them before any plugin initialises, from the `db`
 * block and the schema the boot actually runs. The request path used to run
 * them a second time afterwards from the handler store, which carries no field
 * groups and no deferred Builder extends — a narrower schema than the one just
 * applied, judged by a second call the instrumentation boot never makes.
 *
 * Observed through the calls the request path makes, with registration
 * replaced by a recorder: what is under test is whether THIS path calls the
 * migration runner itself, and whether it hands registration what the runner
 * inside it needs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";

const registerServices = vi.fn();
const runProdMigrationsIfEnabled = vi.fn();
let registered = false;

/**
 * A service that answers every property and call with itself, so each step of
 * the start after registration runs through without what it reads mattering.
 * Not thenable, so awaiting it does not hang, and printable, for the start's
 * log lines.
 */
const anything: unknown = new Proxy(function anyService() {}, {
  get: (_target, key) =>
    key === "then"
      ? undefined
      : key === Symbol.toPrimitive
        ? () => "stand-in"
        : anything,
  apply: () => anything,
});

vi.mock("../../di/register", () => ({
  registerServices: (config: unknown) => {
    registerServices(config);
    registered = true;
  },
  shutdownServices: vi.fn(),
}));
// The lookup the start reads, as well as the route handler: a cold request
// with a config runs `getNextly`'s start.
vi.mock("../../di/service-access", () => ({
  isServicesRegistered: () => registered,
  // Permissive: the post-registration steps are not what is under test, and a
  // stub that throws would stop the walk before the point being observed.
  getService: () => anything,
}));
vi.mock("../../init/prod-migrations", () => ({
  runProdMigrationsIfEnabled: (args: unknown) =>
    runProdMigrationsIfEnabled(args),
}));
vi.mock("../../init/boot-apply", () => ({
  runBootTimeApplyIfDev: vi.fn(),
}));
vi.mock("../../runtime/hmr-listener", () => ({ ensureHmrListener: vi.fn() }));
vi.mock("../../storage/image-processor", () => ({
  getImageProcessor: () => undefined,
}));

const { ensureServicesInitialized, setHandlerConfig } = await import(
  "../auth-handler"
);

const db = {
  runMigrationsOnBoot: true,
  migrationsDir: "./migrations",
  uiSchemaFile: "./ui-schema.json",
};

beforeEach(() => {
  vi.clearAllMocks();
  registered = false;
});

describe("the request-path boot and production migrations", () => {
  it("leaves them to registerServices, handing it the db block they read", async () => {
    setHandlerConfig({ db, plugins: [] } as unknown as SanitizedNextlyConfig);

    await ensureServicesInitialized();

    // Registration received the whole block its migration phase reads...
    expect(registerServices).toHaveBeenCalledTimes(1);
    expect((registerServices.mock.calls[0][0] as { db?: unknown }).db).toEqual(
      db
    );
    // ...and this path did not run them a second time on its own.
    expect(runProdMigrationsIfEnabled).not.toHaveBeenCalled();
  });
});
