/**
 * The production start's warning about limits counted in memory, logged by
 * the boot itself: the function deciding it is tested on its own beside it
 * (`limits-in-memory-warning.test.ts`); this shows the boot asks it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices } = await import("../register");

const thinAdapter = {
  connect: () => undefined,
  getDrizzle: () => ({}),
};

/** The warnings a boot with `config` logs before the thin adapter stops it. */
async function bootWarnings(
  config: Record<string, unknown>
): Promise<string[]> {
  const warnings: string[] = [];
  const logger = {
    info: () => undefined,
    debug: () => undefined,
    error: () => undefined,
    warn: (message: unknown) => {
      warnings.push(String(message));
    },
  };
  await registerServices({
    adapter: thinAdapter,
    logger,
    collections: [],
    ...config,
  } as unknown as Parameters<typeof registerServices>[0]).catch(
    () => undefined
  );
  return warnings;
}

const inMemory = (warnings: string[]) =>
  warnings.filter(w => w.includes("count in this process's memory"));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the limits-in-memory warning at boot", () => {
  it("is logged on a production start with the default store", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(inMemory(await bootWarnings({}))).toHaveLength(1);
  });

  it("is not logged on a production start that says it runs one instance", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      inMemory(await bootWarnings({ rateLimit: { singleInstance: true } }))
    ).toHaveLength(0);
  });

  it("is not logged outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(inMemory(await bootWarnings({}))).toHaveLength(0);
  });
});
