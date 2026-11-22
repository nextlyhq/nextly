/**
 * The browser suite's server runs with higher REST limits, and only it.
 *
 * Loaded against the real `nextly.config.ts`: a plain run keeps the product's
 * defaults (100 reads and 30 writes a minute per address), and the switch the
 * suite's own server sets (`NEXTLY_E2E_RATE_LIMIT=1`) raises both tenfold.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { E2E_RATE_LIMIT, e2eRateLimit } from "./e2e-rate-limit";

/** Loading the config loads every plugin it names, which takes a while cold. */
const LOAD_TIMEOUT = 60_000;

/** The REST limits the config holds with the switch set to `value`. */
async function limitsWith(value: string) {
  vi.resetModules();
  vi.stubEnv("NEXTLY_E2E_RATE_LIMIT", value);
  const config = (await import("../nextly.config")).default;
  return {
    readLimit: config.rateLimit?.readLimit,
    writeLimit: config.rateLimit?.writeLimit,
    enabled: config.rateLimit?.enabled,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the e2e suite's REST limits", () => {
  it("are ten times the product's per-address defaults", () => {
    expect(E2E_RATE_LIMIT).toEqual({ readLimit: 1_000, writeLimit: 300 });
  });

  it("apply only when the switch reads 1", () => {
    expect(e2eRateLimit("1")).toEqual({ rateLimit: E2E_RATE_LIMIT });
    for (const off of [undefined, "", "0", "true"]) {
      expect(e2eRateLimit(off)).toEqual({});
    }
  });

  it(
    "leave a plain run on the product's defaults",
    async () => {
      expect(await limitsWith("")).toEqual({
        readLimit: 100,
        writeLimit: 30,
        enabled: true,
      });
    },
    LOAD_TIMEOUT
  );

  it(
    "raise the suite's server, which still limits",
    async () => {
      expect(await limitsWith("1")).toEqual({
        readLimit: 1_000,
        writeLimit: 300,
        enabled: true,
      });
    },
    LOAD_TIMEOUT
  );
});
