/**
 * Whether a production boot runs its migrations itself: only in production,
 * and only when the `db` block opts in.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { bootMigratesCore } from "../boot-migrates-core";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("bootMigratesCore", () => {
  it("is true in production when the boot is opted in", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(bootMigratesCore({ runMigrationsOnBoot: true })).toBe(true);
  });

  it("is false in production without the opt-in", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(bootMigratesCore({ runMigrationsOnBoot: false })).toBe(false);
    expect(bootMigratesCore({})).toBe(false);
    expect(bootMigratesCore(undefined)).toBe(false);
  });

  it("is false outside production, opted in or not", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(bootMigratesCore({ runMigrationsOnBoot: true })).toBe(false);
  });
});
