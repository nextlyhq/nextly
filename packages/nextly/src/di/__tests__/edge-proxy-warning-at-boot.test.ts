/**
 * The edge proxy warning is said by boot itself, not only by the function a
 * unit test can call.
 *
 * Drives the real boot entry point with an adapter too thin to finish (it
 * fails a few steps after the warning, as `register-widgets-boot-wiring`
 * explains), so a warning seen after the rejection can only have come from
 * boot reaching it. The platform condition is Vercel's own environment
 * variable, and an app with no plugins at all is used on purpose: the warning
 * must not depend on any plugin being present.
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
  await expect(
    registerServices({
      adapter: thinAdapter,
      logger,
      collections: [],
      ...config,
    } as unknown as Parameters<typeof registerServices>[0])
  ).rejects.toThrow();
  return warnings;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the edge proxy warning at boot", () => {
  it("names security.trustProxy when the app starts on Vercel with it unset", async () => {
    vi.stubEnv("VERCEL", "1");
    const said = (await bootWarnings({})).filter(w => w.includes("Vercel"));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("security.trustProxy: true");
  });

  it("says nothing when the auth limiter is off", async () => {
    vi.stubEnv("VERCEL", "1");
    const said = await bootWarnings({
      security: { authRateLimit: { requestsPerHour: 0 } },
    });
    expect(said.filter(w => w.includes("security.trustProxy"))).toEqual([]);
  });

  it("says nothing when security.trustProxy is set", async () => {
    vi.stubEnv("VERCEL", "1");
    const said = await bootWarnings({ security: { trustProxy: true } });
    expect(said.filter(w => w.includes("security.trustProxy"))).toEqual([]);
  });
});
