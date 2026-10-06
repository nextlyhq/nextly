/**
 * A boot that refuses after its migrations releases what it acquired, and a
 * later boot attempt in the same process refuses before acquiring anything.
 *
 * Migrations run inside `registerServices`, before the container is marked
 * registered, and `shutdownServices` acts only on a registered container. So
 * a refusal there left the adapter connected and the container populated,
 * and every later request connected a fresh adapter only to refuse again at
 * the same point — one leaked pool per request.
 *
 * The adapter is the real in-memory SQLite one, created where registration
 * creates it (`createAdapterFromEnv`) and wrapped only to count creations and
 * observe `disconnect`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetBootMigrationsGateForTest } from "../../init/boot-migrations-gate";

const created = vi.hoisted(() => ({
  adapters: [] as Array<{ disconnect: () => Promise<void> }>,
  disconnects: 0,
}));

vi.mock("../../database/factory", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../database/factory")>();
  return {
    ...original,
    createAdapterFromEnv: async () => {
      const adapter = await original.createAdapter({
        type: "sqlite",
        memory: true,
      } as Parameters<typeof original.createAdapter>[0]);
      const disconnect = adapter.disconnect.bind(adapter);
      adapter.disconnect = async () => {
        created.disconnects += 1;
        await disconnect();
      };
      created.adapters.push(adapter);
      return adapter;
    },
  };
});
vi.mock("../../cli/commands/migrate", () => ({
  // The lock stayed held past the wait: the boot cannot know the schema it
  // would serve, so it refuses.
  migrateCore: async () => ({ applied: 0, coreChanged: false, ran: false }),
}));
vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices, isServicesRegistered } = await import("../register");

const config = {
  db: {
    runMigrationsOnBoot: true,
    migrationsDir: "./migrations",
    uiSchemaFile: "./ui-schema.json",
  },
} as unknown as Parameters<typeof registerServices>[0];

beforeEach(() => {
  _resetBootMigrationsGateForTest();
  created.adapters.length = 0;
  created.disconnects = 0;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
  vi.stubEnv("DB_DIALECT", "sqlite");
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetBootMigrationsGateForTest();
});

describe("a boot that refuses at its migrations", () => {
  it("disconnects the adapter it connected, and a retry connects none", async () => {
    await expect(registerServices(config)).rejects.toMatchObject({
      code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    });
    expect(created.adapters).toHaveLength(1);
    expect(created.disconnects).toBe(1);
    expect(isServicesRegistered()).toBe(false);

    // The next request's boot attempt refuses before it connects anything.
    await expect(registerServices(config)).rejects.toMatchObject({
      code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    });
    expect(created.adapters).toHaveLength(1);
  });
});
