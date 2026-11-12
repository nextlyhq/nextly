/**
 * `withNextly()` names the build's schema version: the newest migration in the
 * app's migrations folder, handed to the server as
 * `NEXTLY_BUILD_SCHEMA_VERSION` through Next.js's `env` (for the app's bundled
 * code) and on `process.env` (which Next.js keeps for the server it starts
 * after loading the config), so a production start can compare it with the
 * database's. No folder, no migration: no version, and nothing is set.
 */
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withNextly } from "../next";

const OLDER = "20260101_000000_000_create_posts";
const NEWER = "20260301_120000_000_add_summary";

let dir: string;
let saved: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-with-nextly-version-"));
  saved = process.env.NEXTLY_BUILD_SCHEMA_VERSION;
  delete process.env.NEXTLY_BUILD_SCHEMA_VERSION;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (saved === undefined) delete process.env.NEXTLY_BUILD_SCHEMA_VERSION;
  else process.env.NEXTLY_BUILD_SCHEMA_VERSION = saved;
  // `withNextly()` warns about the Cache Components options these configs
  // leave off; the queued line is cleared unsent, as the other files do.
  const holder = globalThis as Record<symbol, { timer?: unknown } | undefined>;
  for (const key of [
    Symbol.for("nextly/cache-components-queued-warnings"),
    Symbol.for("nextly/cache-components-off-warned"),
  ]) {
    const held = holder[key];
    if (held && typeof held === "object" && "timer" in held) {
      clearTimeout(held.timer as ReturnType<typeof setTimeout>);
    }
    delete holder[key];
  }
});

describe("withNextly's build schema version", () => {
  it("is the newest migration in the folder, in `env` and on `process.env`, beside the app's own `env`", () => {
    writeFileSync(join(dir, `${NEWER}.sql`), "-- UP\n");
    writeFileSync(join(dir, `${OLDER}.sql`), "-- UP\n");
    const config = withNextly(
      { env: { APP_FLAG: "on" } } as Record<string, unknown>,
      { migrationsDir: dir }
    );
    expect(config.env).toEqual({
      APP_FLAG: "on",
      NEXTLY_BUILD_SCHEMA_VERSION: NEWER,
    });
    expect(process.env.NEXTLY_BUILD_SCHEMA_VERSION).toBe(NEWER);
  });

  it("is nothing where the folder holds no migration, and the config's `env` is left alone", () => {
    const config = withNextly({} as Record<string, unknown>, {
      migrationsDir: join(dir, "missing"),
    });
    expect(config).not.toHaveProperty("env");
    expect(process.env.NEXTLY_BUILD_SCHEMA_VERSION).toBeUndefined();
  });

  it("passes the installed Next.js config schema", () => {
    writeFileSync(join(dir, `${NEWER}.sql`), "-- UP\n");
    const require = createRequire(import.meta.url);
    const { configSchema } = require("next/dist/server/config-schema.js") as {
      configSchema: {
        safeParse(value: unknown): {
          success: boolean;
          error?: { issues: unknown[] };
        };
      };
    };
    const result = configSchema.safeParse(
      withNextly({} as Record<string, unknown>, { migrationsDir: dir })
    );
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });
});
