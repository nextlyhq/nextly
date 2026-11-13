// `nextly users:create-admin` writes the install's own accounts and claim
// rows, which on PostgreSQL live in the schema the config names. The config
// publishes that schema when it loads, so it must load before the connection
// opens: otherwise the command works in `public`, on another install.

import { describe, expect, it, vi } from "vitest";

const order: string[] = [];
/** What the install's config says, as the loader hands it back. */
let loadedConfig: Record<string, unknown> = {};

/** What the connection fails with: `createCliAdapter` gives a failure its code itself. */
const connectionFailed = new Error("connected");

vi.mock("../../utils/config-loader", () => ({
  loadConfig: vi.fn(async (options: unknown) => {
    order.push(`config ${JSON.stringify(options)}`);
    return { config: loadedConfig };
  }),
}));

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: "sqlite",
    databaseUrl: "file::memory:",
    errors: [],
  }),
  createCliAdapter: vi.fn(async () => {
    order.push("connect");
    // Stop here: what is under test is what happened before connecting.
    throw connectionFailed;
  }),
}));

const { connectToInstall } = await import("../create-admin");
const { appPasswordDigester, appPasswordRule, useLoadedPasswordHasher } =
  await import("../../../di/password-digester");
const { validatePasswordStrength } = await import("../../../auth/password");

describe("nextly users:create-admin and the config", () => {
  it("loads the install's config, from its path, before it connects", async () => {
    order.length = 0;
    const context = {
      logger: { info: vi.fn(), error: vi.fn() },
      options: { config: "apps/site/nextly.config.ts", cwd: "/srv/site" },
    } as unknown as Parameters<typeof connectToInstall>[0];
    // The stop is the connection failing, passed on as it came: its code is the adapter's.
    await expect(connectToInstall(context)).rejects.toBe(connectionFailed);
    expect(order).toEqual([
      `config ${JSON.stringify({
        configPath: "apps/site/nextly.config.ts",
        cwd: "/srv/site",
      })}`,
      "connect",
    ]);
  });

  it("hashes and judges the administrator's password with the configured hasher", async () => {
    // A hasher of the app's own that reads a password whole, set in the config.
    const hasher = {
      name: "unbounded",
      reach: "unbounded" as const,
      hash: (password: string) => Promise.resolve(`own$${password}`),
      verify: (password: string, stored: string) =>
        Promise.resolve(stored === `own$${password}`),
    };
    loadedConfig = { auth: { passwordHasher: hasher } };
    const context = {
      logger: { info: vi.fn(), error: vi.fn() },
      options: {},
    } as unknown as Parameters<typeof connectToInstall>[0];
    try {
      await expect(connectToInstall(context)).rejects.toBe(connectionFailed);
      // The account services hash with the app's digester: the configured
      // hasher, not core's bcrypt, which the app's sign-in would not take.
      expect(appPasswordDigester().hasher).toBe(hasher);
      expect(await appPasswordDigester().hash("Str0ng-P@ssw0rd!")).toBe(
        "own$Str0ng-P@ssw0rd!"
      );
      // And the password is judged by its reach: 80 bytes, past bcrypt's 72.
      const long = `Str0ng-P@ss-${"x".repeat(68)}`;
      expect(validatePasswordStrength(long, appPasswordRule()).ok).toBe(true);
    } finally {
      loadedConfig = {};
      useLoadedPasswordHasher(undefined);
    }
  });
});
