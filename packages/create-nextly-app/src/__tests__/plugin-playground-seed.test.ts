/**
 * The plugin playground's dev-user seed, run rather than read.
 *
 * `admin.devAutoLogin` signs in a user that already exists and never creates
 * one, so the playground creates it at start-up through
 * `templates/plugin/dev/src/seed-dev-user.ts`. This runs that function with a
 * recording seeder and asserts what it asked for: a scan of the source would
 * stay green with the call removed, unreachable, or failing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import config from "../../../../templates/plugin/dev/nextly.config";
import { register } from "../../../../templates/plugin/dev/src/instrumentation";
import {
  type SeedSuperAdmin,
  seedDevUser,
} from "../../../../templates/plugin/dev/src/seed-dev-user";

import { recorded, resetRecord, seedOptions } from "./stubs/nextly";

// The playground config imports the plugin by name, which its tsconfig maps to
// the template's own src/; that needs the plugin SDK, so the plugin is a stub.
vi.mock("../../../../templates/plugin/src/index", () => ({
  myPlugin: () => ({ name: "my-plugin" }),
}));

const LOGIN = { email: "dev@nextly.local", password: "DevPassword123!" };

describe("plugin playground seedDevUser()", () => {
  let seed: ReturnType<typeof vi.fn<SeedSuperAdmin>>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    seed = vi.fn<SeedSuperAdmin>(async () => ({ success: true }));
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "development");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("creates the account devAutoLogin names, under next dev", async () => {
    await seedDevUser(LOGIN, seed);

    expect(seed).toHaveBeenCalledTimes(1);
    expect(seed).toHaveBeenCalledWith(
      expect.objectContaining({
        email: LOGIN.email,
        password: LOGIN.password,
      })
    );
    expect(warn).not.toHaveBeenCalled();
  });

  // Credentials are never seeded into a production build, and test runners
  // bring their own fixtures.
  it.each(["production", "test"])(
    "creates nothing when NODE_ENV is %s",
    async env => {
      vi.stubEnv("NODE_ENV", env);
      await seedDevUser(LOGIN, seed);

      expect(seed).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["auto-login is off", false as const],
    ["auto-login is not configured", undefined],
  ])("creates nothing, and says nothing, when %s", async (_label, login) => {
    await seedDevUser(login, seed);

    expect(seed).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  // Auto-login needs no password, but the seeder cannot create an account
  // without one; saying so beats a silent setup wizard.
  it("explains a devAutoLogin without a password instead of seeding", async () => {
    await seedDevUser({ email: LOGIN.email }, seed);

    expect(seed).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).toContain(LOGIN.email);
  });

  it("reports a seed that failed", async () => {
    seed.mockResolvedValue({
      success: false,
      errorMessages: ["database is locked"],
    });

    await seedDevUser(LOGIN, seed);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).toContain("database is locked");
  });
});

/*
 * The start-up hook itself, with Nextly replaced by the recording stub
 * (vitest.config.ts). The cases above cover what seedDevUser decides; these
 * cover that register() actually reaches it, after boot, with the account the
 * playground config names.
 */
describe("plugin playground register()", () => {
  const autoLogin = (
    config as { admin: { devAutoLogin: { email: string; password: string } } }
  ).admin.devAutoLogin;

  beforeEach(() => {
    resetRecord();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "development");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("boots, then creates the devAutoLogin account through the adapter", async () => {
    await register();

    expect(recorded).toEqual(["boot", "seed"]);
    expect(seedOptions).toEqual([
      { email: autoLogin.email, password: autoLogin.password },
    ]);
  });

  it("boots without seeding outside next dev", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await register();

    expect(recorded).toEqual(["boot"]);
  });

  it("does nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();

    expect(recorded).toEqual([]);
  });
});
