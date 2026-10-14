/**
 * The plugin playground's dev-user seed, run rather than read.
 *
 * `admin.devAutoLogin` signs in a user that already exists and never creates
 * one, so the playground creates it at start-up through
 * `templates/plugin/dev/seed-dev-user.ts`. This runs that function with a
 * recording seeder and asserts what it asked for: a scan of the source would
 * stay green with the call removed, unreachable, or failing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type SeedSuperAdmin,
  seedDevUser,
} from "../../../../templates/plugin/dev/seed-dev-user";

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
