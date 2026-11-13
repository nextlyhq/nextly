/**
 * Two server copies of one site on one database, on every dialect: a field
 * added in the Schema Builder on one copy is served by the other's Direct API
 * within five seconds, with no restart, as by its REST API
 * (`schema-change-reaches-other-copy.integration.test.ts`).
 *
 * This process is the copy that keeps serving, through `nextly.create` and
 * `nextly.findByID` alone: no request reaches it, so only the Direct API's own
 * check of the stored schema version can bring its definitions up to date. A
 * copy still holding the old entry table drops the new field on the write, so
 * its read comes back without it.
 *
 * The other copy is a process of its own (`helpers/schema-builder-copy.ts`):
 * two copies in one process would share their definitions.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import { createAdapter } from "../../database/factory";
import { dispatchCollections } from "../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import type { ServiceContainer } from "../../services";
import { _resetEnvCache } from "../../shared/lib/env";

const run = promisify(execFile);
const OTHER_COPY = join(__dirname, "helpers", "schema-builder-copy.ts");
/** How soon another copy's change must be served here. */
const WITHIN_MS = 5000;

const FIELDS = [{ name: "title", type: "text" }];
const WITH_SUMMARY = [...FIELDS, { name: "summary", type: "text" }];

describe.each(getConfiguredTestDialects())(
  "a schema change made on another server copy, read through the Direct API (%s)",
  (dialect: TestDialect) => {
    const slug = `direct_copy_notes_${dialect.slice(0, 2)}`;
    let url: string;
    let drop: () => Promise<void>;
    let here: TestNextly;

    beforeAll(async () => {
      vi.stubEnv("NODE_ENV", "development");
      if (dialect === "sqlite") {
        // A file, not memory: the other copy is another process.
        const dir = mkdtempSync(join(tmpdir(), "nextly-other-copy-"));
        url = `file:${join(dir, "site.db")}`;
        drop = async () => rmSync(dir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_copies");
        url = scratch.url;
        drop = scratch.drop;
      }
      // The database the environment names, as each copy of an app has it.
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      here = await createTestNextly({
        adapter: (await createAdapter({ type: dialect, url } as Parameters<
          typeof createAdapter
        >[0])) as never,
      });
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: slug, label: slug, fields: FIELDS }
      );
    }, 180_000);

    afterAll(async () => {
      await here?.destroy();
      await drop?.();
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    /** Write an entry through this copy's Direct API and read it back. */
    async function roundTrip(
      values: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
      const created = await here.nextly.create({
        collection: slug,
        data: values,
      });
      const id = created.item.id;
      expect(typeof id).toBe("string");
      const read = await here.nextly.findByID({
        collection: slug,
        id: String(id),
      });
      return (read ?? {}) as Record<string, unknown>;
    }

    it("is served here within five seconds, with no restart", async () => {
      // This copy serves the collection as it stands, so its entry table is
      // loaded without the field the other copy is about to add.
      expect(await roundTrip({ title: "before" })).toMatchObject({
        title: "before",
      });

      const row = await here.adapter.selectOne<{ schema_version?: unknown }>(
        "dynamic_collections",
        { where: { and: [{ column: "slug", op: "=", value: slug }] } }
      );
      const saved = await run(
        process.execPath,
        [
          "--import",
          "tsx",
          OTHER_COPY,
          dialect,
          url,
          here.basePath,
          slug,
          String(row?.schema_version ?? 1),
          JSON.stringify(WITH_SUMMARY),
        ],
        {
          cwd: join(__dirname, "..", "..", ".."),
          env: {
            ...process.env,
            NODE_ENV: "development",
            DB_DIALECT: dialect,
            DATABASE_URL: url,
          },
          timeout: 150_000,
          maxBuffer: 64 * 1024 * 1024,
        }
      );
      // Committed before the other copy exited: the clock starts no later
      // than the change.
      const changedBy = Date.now();
      expect(saved.stdout.trim().split("\n").at(-1)).toBe("saved");

      let served: Record<string, unknown> | undefined;
      while (Date.now() - changedBy <= WITHIN_MS) {
        const entry = await roundTrip({ title: "after", summary: "kept" });
        if (entry.summary === "kept") {
          served = entry;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      expect(served).toMatchObject({ title: "after", summary: "kept" });
      expect(Date.now() - changedBy).toBeLessThanOrEqual(WITHIN_MS + 1000);
    }, 300_000);
  }
);
