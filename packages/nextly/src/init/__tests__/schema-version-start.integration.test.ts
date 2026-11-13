/**
 * A production start compares the database's schema version with the
 * build's, on every dialect: one read, one line, nothing written, and the app
 * serves.
 *
 * The database is migrated for a one-collection configuration, and its stored
 * version is set to one migration; the build's version
 * (`NEXTLY_BUILD_SCHEMA_VERSION`, which `withNextly` sets) names another.
 * Every statement the start sends is recorded at the driver
 * (`record-statements`), the work it leaves running after it resolves
 * included (`startSettled`).
 *
 * - The build one migration AHEAD of the database (the database is behind):
 *   one warning naming both versions and `nextly migrate`.
 * - The build one migration BEHIND the database (an older build serving): one
 *   line at info.
 * - Either way: exactly ONE statement reads the version, none writes it, the
 *   stored version is as it was, and the Direct API answers.
 *
 * The control: a development start, recorded the same way, reads no version.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import {
  recordStatements,
  type RecordedStatement,
} from "../../__tests__/helpers/record-statements";
import { defineCollection, defineConfig, text } from "../../config";
import { createAdapter } from "../../database/factory";
import { shutdownServices } from "../../di/register";
import {
  readSchemaVersion,
  storeSchemaVersion,
  type StoredSchemaVersion,
} from "../../domains/schema/schema-version";
import { getNextly, startSettled } from "../../init";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { resetDispatcherForTests } from "../../route-handler/auth-handler";
import { _resetEnvCache } from "../../shared/lib/env";
import { consoleLogger } from "../../shared/types";
import { sanitizeConfig } from "../../shared/types/config";

const OLDER = "20260101_000000_000_create_svstart";
const NEWER = "20260201_000000_000_change_svstart";

const COLLECTIONS = [
  defineCollection({ slug: "svstart", fields: [text({ name: "title" })] }),
];
const CONFIG = defineConfig({ collections: COLLECTIONS });

/** A statement that reads or writes the schema version's row. */
function touchesVersion(call: RecordedStatement): boolean {
  return (
    /nextly_meta/i.test(call.text) &&
    (call.text.includes("schema_version") ||
      call.values.some(value => value === "schema_version"))
  );
}

/** The log lines about the schema version, by level. */
function versionLines(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((line: string) => line.includes("schema version"));
}

describe.each(getConfiguredTestDialects())(
  "a production start's schema version (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;

    const adapterFor = (): Promise<DrizzleAdapter> =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;

    beforeEach(async () => {
      if (dialect === "sqlite") {
        const dir = mkdtempSync(join(tmpdir(), "nextly-svstart-"));
        url = `file:${join(dir, "start.db")}`;
        drop = async () => rmSync(dir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_svstart");
        url = scratch.url;
        drop = scratch.drop;
      }
      // The request path opens the database the environment names.
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      // Migrated for the configuration, as a deployment that ran
      // `nextly migrate`.
      await createTestNextly({
        adapter: (await adapterFor()) as never,
        collections: COLLECTIONS,
      });
      await shutdownServices();
    }, 180_000);

    afterEach(async () => {
      await shutdownServices();
      resetDispatcherForTests();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
    });

    /** Store `migration` as the database's version, on a connection of its own. */
    async function storeVersion(
      migration: string
    ): Promise<StoredSchemaVersion> {
      const adapter = await adapterFor();
      try {
        await storeSchemaVersion(adapter.getDrizzle(), dialect, {
          wrote: true,
          migration,
        });
        return await readSchemaVersion(adapter.getDrizzle(), dialect);
      } finally {
        await adapter.disconnect();
      }
    }

    /**
     * One start in `mode` with the build's version `build`: every statement
     * it sent, the warnings and infos it logged, the stored version after it,
     * and what the Direct API answered.
     */
    async function start(mode: "production" | "development", build: string) {
      vi.stubEnv("NODE_ENV", mode);
      vi.stubEnv("NEXTLY_BUILD_SCHEMA_VERSION", build);
      const warn = vi.spyOn(consoleLogger, "warn");
      const info = vi.spyOn(consoleLogger, "info");
      const adapter = await adapterFor();
      const recorder = await recordStatements(adapter, dialect);
      let answered: { items: unknown[] };
      try {
        const nextly = await getNextly({
          config: sanitizeConfig(CONFIG) as never,
          adapter,
        });
        await startSettled();
        recorder.uninstall();
        answered = await nextly.find({ collection: "svstart" });
        const stored = await readSchemaVersion(adapter.getDrizzle(), dialect);
        await nextly.shutdown();
        return {
          calls: recorder.calls,
          warnings: versionLines(warn),
          infos: versionLines(info),
          stored,
          answered,
        };
      } finally {
        recorder.uninstall();
      }
    }

    it("warns once where the build is one migration ahead of the database, reads the version once, writes nothing, and serves", async () => {
      const before = await storeVersion(OLDER);
      const run = await start("production", NEWER);

      expect(run.warnings).toHaveLength(1);
      expect(run.warnings[0]).toContain(OLDER);
      expect(run.warnings[0]).toContain(NEWER);
      expect(run.warnings[0]).toContain("nextly migrate");
      expect(run.infos).toEqual([]);
      const version = run.calls.filter(touchesVersion);
      expect(
        version.map(call => call.text.trim().slice(0, 6).toUpperCase())
      ).toEqual(["SELECT"]);
      expect(run.stored).toEqual(before);
      expect(run.answered.items).toEqual([]);
    }, 180_000);

    it("notes once, at info, where the build is one migration behind the database, reads the version once, writes nothing, and serves", async () => {
      const before = await storeVersion(NEWER);
      const run = await start("production", OLDER);

      expect(run.infos).toHaveLength(1);
      expect(run.infos[0]).toContain(NEWER);
      expect(run.infos[0]).toContain(OLDER);
      expect(run.warnings).toEqual([]);
      expect(run.calls.filter(touchesVersion)).toHaveLength(1);
      expect(run.stored).toEqual(before);
      expect(run.answered.items).toEqual([]);
    }, 180_000);

    it("a development start, recorded the same way, reads no version and says nothing of it", async () => {
      await storeVersion(OLDER);
      const run = await start("development", NEWER);

      expect(run.calls.filter(touchesVersion)).toEqual([]);
      expect(run.warnings).toEqual([]);
      expect(run.infos).toEqual([]);
    }, 180_000);
  }
);
