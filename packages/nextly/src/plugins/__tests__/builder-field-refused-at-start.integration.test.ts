/**
 * A development start whose plugin field the database refuses on a Schema Builder type leaves the
 * type as it was, and the next start adds the field.
 *
 * The start adds the column before it records the field. A start that recorded a field whose column
 * was refused would leave a type no read or write of reaches, and one no later start asks about
 * again, since what it compares is the recorded fields.
 *
 * Each case owns its database: a throwaway database on PostgreSQL and MySQL, a temporary file on
 * SQLite.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import { number } from "../../config";
import { createAdapter } from "../../database/factory";
import { clearServices } from "../../di/register";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import { _resetEnvCache } from "../../shared/lib/env";
import type { Logger } from "../../shared/types/index";
import { createTestNextly, type TestNextly } from "../test-nextly";

import { describeEachDialect } from "./helpers/dialect-matrix";
import {
  seedBuilderCollection,
  seedBuilderComponent,
  seedBuilderSingle,
} from "./seed-builder-entity";

const KINDS = [
  {
    kind: "collection",
    slug: "bf_cases",
    table: "dc_bf_cases",
    registry: "dynamic_collections",
    seed: seedBuilderCollection,
  },
  {
    kind: "single",
    slug: "bf_home",
    table: "single_bf_home",
    registry: "dynamic_singles",
    seed: seedBuilderSingle,
  },
  {
    kind: "field group",
    slug: "bf_seo",
    table: "fg_bf_seo",
    registry: "dynamic_field_groups",
    seed: seedBuilderComponent,
  },
] as const;

describeEachDialect("a plugin's field a start could not add", dialect => {
  let dir: string;
  let drop: () => Promise<void>;
  let adapter: DrizzleAdapter;
  let refused: boolean;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-builder-field-refused-"));
    let url = `file:${join(dir, "test.db")}`;
    drop = async () => {};
    if (dialect !== "sqlite") {
      const scratch = await createScratchDatabase(
        dialect,
        "nextly_startrefused"
      );
      url = scratch.url;
      drop = scratch.drop;
    }
    vi.stubEnv("DB_DIALECT", dialect);
    vi.stubEnv("DATABASE_URL", url);
    _resetEnvCache();
    adapter = (await createAdapter({
      type: dialect,
      url,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    refused = false;
    const send = adapter.executeQuery.bind(adapter);
    vi.spyOn(adapter, "executeQuery").mockImplementation(
      async (sql, params) => {
        if (refused && /ADD COLUMN .rank_by/.test(sql)) {
          throw new Error("refused by the database");
        }
        return send(sql, params) as never;
      }
    );
  }, 60_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    clearServices();
    await adapter?.disconnect().catch(() => {});
    await drop();
    vi.unstubAllEnvs();
    _resetEnvCache();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it.each(KINDS)(
    "$kind: is served without the field, warns, and takes it at the next start",
    async ({ kind, slug, table, registry, seed }) => {
      await createTestNextly({ adapter: adapter as never });
      await seed(adapter, {
        slug,
        fields: [{ name: "weight", type: "number" }],
      });

      /** A development start with the plugin, and what it warned of. */
      const start = async (): Promise<{
        app: TestNextly;
        warned: string[];
      }> => {
        clearServices();
        vi.stubEnv("NODE_ENV", "development");
        const warned: string[] = [];
        const logger: Logger = {
          debug: () => {},
          info: () => {},
          error: () => {},
          warn: (message: string) => {
            warned.push(message);
          },
        };
        const app = await createTestNextly({
          adapter: adapter as never,
          logger,
          plugins: [
            {
              name: "@t/ranks",
              version: "1.0.0",
              nextly: ">=0.0.0",
              contributes: {
                extend: [
                  { target: slug, fields: [number({ name: "rank_by" })] },
                ],
              },
            },
          ] as never,
        });
        return { app, warned };
      };
      const hasColumn = async () =>
        (
          await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [table])
        ).tables
          .find(spec => spec.name === table)
          ?.columns.some(column => column.name === "rank_by") === true;
      const recordsField = async () => {
        const [row] = await adapter.executeQuery<{ fields: unknown }>(
          `SELECT fields FROM ${registry} WHERE slug = '${slug}'`
        );
        return JSON.stringify(row.fields).includes("rank_by");
      };
      /** A read of the type, and for a collection a write. */
      const reads = async (app: TestNextly): Promise<void> => {
        if (kind === "collection") {
          await app.nextly.create({
            collection: slug as never,
            data: { title: "Kept" } as never,
          });
          await app.nextly.find({ collection: slug as never });
        }
        if (kind === "single") {
          await app.nextly.findSingle({ slug } as never);
        }
      };

      refused = true;
      const first = await start();
      expect(await hasColumn()).toBe(false);
      expect(await recordsField()).toBe(false);
      expect(
        first.warned.filter(
          line =>
            line.includes(slug) &&
            line.includes("rank_by") &&
            line.includes("refused by the database") &&
            line.includes("next boot")
        )
      ).toHaveLength(1);
      await reads(first.app);

      refused = false;
      const second = await start();
      expect(await hasColumn()).toBe(true);
      expect(await recordsField()).toBe(true);
      await reads(second.app);
    },
    240_000
  );
});
