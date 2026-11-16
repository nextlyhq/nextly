/**
 * The build's schema version reaches a production start's comparison from
 * the app's `instrumentation.ts`: `createRegister` records the value Next.js
 * inlined there for `process.env.NEXTLY_BUILD_SCHEMA_VERSION`, which Nextly,
 * a server-external package, cannot read for itself on Vercel or under
 * `output: "standalone"`. An app whose hook passes none still compares under
 * `next start`, where `withNextly` set the variable in the server's own
 * environment.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import { loadDialectTables } from "../../database/dialect-tables";
import {
  buildSchemaVersion,
  recordBuildSchemaVersion,
} from "../../domains/schema/build-schema-version";
import { reportSchemaVersionAtStart } from "../../domains/schema/schema-version";
import { createRegister, shutdownNextly } from "../../init";
import { consoleLogger } from "../../shared/types";

const STORED = "20260101_000000_000_create_posts";
const BUILT = "20260301_120000_000_add_summary";
const ELSEWHERE = "20251201_000000_000_from_the_environment";

/** A Drizzle handle whose one read answers the stored version. */
const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => [
          { value: JSON.stringify({ migration: STORED, seq: 3 }) },
        ],
      }),
    }),
  }),
};

/** What the production start says, given the build version it reads now. */
async function compared(): Promise<string[]> {
  const logger = { warn: vi.fn(), info: vi.fn() };
  await reportSchemaVersionAtStart({
    db,
    dialect: "sqlite",
    build: buildSchemaVersion(),
    logger,
  });
  return logger.warn.mock.calls.map(call => String(call[0]));
}

describe("createRegister's build schema version", () => {
  const config = {} as SanitizedNextlyConfig;

  beforeAll(async () => {
    await loadDialectTables("sqlite");
    // The start these registers begin has no database here; its failure is
    // logged, and nothing under test waits for it.
    vi.spyOn(consoleLogger, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    recordBuildSchemaVersion(undefined);
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await shutdownNextly();
  });

  it("is the value the app's instrumentation passed, which the start compares, over the environment's", async () => {
    vi.stubEnv("NEXTLY_BUILD_SCHEMA_VERSION", ELSEWHERE);
    await createRegister(config, {
      cacheComponents: "true",
      buildSchemaVersion: BUILT,
    })();

    expect(buildSchemaVersion()).toBe(BUILT);
    const warnings = await compared();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(BUILT);
    expect(warnings[0]).not.toContain(ELSEWHERE);
  });

  it("is the server's own environment where the instrumentation passed none", async () => {
    vi.stubEnv("NEXTLY_BUILD_SCHEMA_VERSION", BUILT);
    await createRegister(config, { cacheComponents: "true" })();

    expect(buildSchemaVersion()).toBe(BUILT);
    expect((await compared())[0]).toContain(BUILT);
  });

  it("is none where neither gives one, and the start compares nothing", async () => {
    vi.stubEnv("NEXTLY_BUILD_SCHEMA_VERSION", "");
    await createRegister(config, {
      cacheComponents: "true",
      buildSchemaVersion: "",
    })();

    expect(buildSchemaVersion()).toBeUndefined();
    expect(await compared()).toEqual([]);
  });
});
