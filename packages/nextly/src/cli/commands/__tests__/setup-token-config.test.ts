// `nextly setup-token` reads and writes the install's own `nextly_meta`, which
// on PostgreSQL lives in the schema the config names. The config publishes
// that schema when it loads, so it must load before the connection opens:
// otherwise the command works in `public`, on another install's token.

import { describe, expect, it, vi } from "vitest";

import { runtimeImportsOf } from "../../__tests__/helpers/runtime-imports";

const order: string[] = [];

vi.mock("../../utils/config-loader", () => ({
  loadConfig: vi.fn(async (options: unknown) => {
    order.push(`config ${JSON.stringify(options)}`);
    return { config: {} };
  }),
}));

vi.mock("../../utils/adapter", () => ({
  withAdapter: vi.fn(async () => {
    order.push("connect");
    return { ok: true, lines: [] };
  }),
}));

const { runSetupTokenCommand } = await import("../setup-token");

function context() {
  const logger = { info: vi.fn(), error: vi.fn() };
  return {
    logger,
    options: { config: "apps/site/nextly.config.ts", cwd: "/srv/site" },
  } as unknown as Parameters<typeof runSetupTokenCommand>[1];
}

describe("nextly setup-token and the config", () => {
  it("loads the install's config, from its path, before it connects", async () => {
    order.length = 0;
    await runSetupTokenCommand({}, context());
    expect(order).toEqual([
      `config ${JSON.stringify({
        configPath: "apps/site/nextly.config.ts",
        cwd: "/srv/site",
      })}`,
      "connect",
    ]);
  });

  it("needs neither with --generate", async () => {
    order.length = 0;
    await runSetupTokenCommand({ generate: true }, context());
    expect(order).toEqual([]);
  });

  it("loads no database code until a run needs the store", async () => {
    const { packages } = await runtimeImportsOf("cli/commands/setup-token.ts");
    // Every package it loads: the colours its errors print in, and the light
    // entry of the adapter's that says whether a build is running.
    expect([...packages.keys()].sort()).toEqual([
      "@nextlyhq/adapter-drizzle/build-phase",
      "commander",
      "picocolors",
    ]);
    // The store's module loads drizzle, so its absence above is the command's
    // own. (A dialect's core it loads only with that dialect's tables.)
    const store = await runtimeImportsOf("cli/commands/setup-token-store.ts");
    expect([...store.packages.keys()]).toContain("drizzle-orm");
  });
});
