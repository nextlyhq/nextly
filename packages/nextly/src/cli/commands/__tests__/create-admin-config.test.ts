// `nextly users:create-admin` writes the install's own accounts and claim
// rows, which on PostgreSQL live in the schema the config names. The config
// publishes that schema when it loads, so it must load before the connection
// opens: otherwise the command works in `public`, on another install.

import { describe, expect, it, vi } from "vitest";

const order: string[] = [];

vi.mock("../../utils/config-loader", () => ({
  loadConfig: vi.fn(async (options: unknown) => {
    order.push(`config ${JSON.stringify(options)}`);
    return { config: {} };
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
    throw new Error("connected");
  }),
}));

const { connectToInstall } = await import("../create-admin");

describe("nextly users:create-admin and the config", () => {
  it("loads the install's config, from its path, before it connects", async () => {
    order.length = 0;
    const context = {
      logger: { info: vi.fn(), error: vi.fn() },
      options: { config: "apps/site/nextly.config.ts", cwd: "/srv/site" },
    } as unknown as Parameters<typeof connectToInstall>[0];
    // The stop is the connection failing, read as the command's error for it.
    await expect(connectToInstall(context)).rejects.toMatchObject({
      code: "DATABASE_UNREACHABLE",
      why: "connected",
    });
    expect(order).toEqual([
      `config ${JSON.stringify({
        configPath: "apps/site/nextly.config.ts",
        cwd: "/srv/site",
      })}`,
      "connect",
    ]);
  });
});
