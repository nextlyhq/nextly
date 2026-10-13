/**
 * `migrate:create` writes a collection's declared compound indexes, and
 * `migrate:check` compares them.
 *
 * Both commands reduce the config's collections with `toMinimalEntities` and
 * build the desired side with `buildDesiredSnapshotFromConfig`, the calls each
 * command makes. A reduction that dropped `indexes` would write a migration
 * without the index and a check that agrees with it, so the first case asserts
 * the index is in the SQL, and the last that a declared index the migrations
 * lack is reported rather than passed over.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { runChecks } from "../../../../cli/commands/migrate-check";
import { defineCollection } from "../../../../collections/config/define-collection";
import type { IndexConfig } from "../../../../collections/config/define-collection";
import { text } from "../../../../collections/fields/helpers";
import { indexNameForColumns } from "../../services/index-name";
import { resolveCollectionTableName } from "../../utils/resolve-table-name";
import { toMinimalEntities } from "../config-entities";
import { buildDesiredSnapshotFromConfig, generateMigration } from "../generate";

function places(indexes: IndexConfig[]) {
  return defineCollection({
    slug: "places",
    fields: [text({ name: "country" }), text({ name: "city" })],
    indexes,
  });
}

const UNIQUE_PLACE: IndexConfig = { fields: ["country", "city"], unique: true };
const BY_CITY: IndexConfig = { fields: ["city", "country"] };

/** Config collections as both commands reduce them. */
function entities(collection: ReturnType<typeof places>) {
  return toMinimalEntities([collection], e =>
    resolveCollectionTableName(e.slug, e.dbName)
  );
}

let migrationsDir: string;

beforeEach(async () => {
  migrationsDir = await mkdtemp(join(tmpdir(), "nextly-collection-indexes-"));
});

async function create(collection: ReturnType<typeof places>) {
  return generateMigration({
    name: "places",
    dialect: "postgresql",
    migrationsDir,
    collections: entities(collection),
    singles: [],
    components: [],
    nonInteractive: true,
    now: new Date("2026-10-13T10:00:00.000Z"),
  });
}

/** What `migrate:check` logs as errors against the migrations written so far. */
async function check(collection: ReturnType<typeof places>) {
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation((() => undefined) as never);
  const errors: string[] = [];
  try {
    await runChecks({
      migrationsDir,
      desiredSnapshot: buildDesiredSnapshotFromConfig(
        entities(collection),
        [],
        [],
        "postgresql"
      ),
      logger: {
        error: (m: string) => errors.push(m),
        success: () => {},
        info: () => {},
        warn: () => {},
        debug: () => {},
      } as never,
    });
  } finally {
    exit.mockRestore();
  }
  return errors;
}

describe("a collection's declared compound indexes", () => {
  it("are written by migrate:create", async () => {
    const result = await create(places([UNIQUE_PLACE]));

    const up = (await readFile(result!.sqlPath, "utf-8")).split("-- DOWN")[0];
    const name = indexNameForColumns("dc_places", ["country", "city"], true);
    expect(up).toMatch(
      new RegExp(`CREATE UNIQUE INDEX[^;]*"${name}"[^;]*"country", "city"`)
    );
  });

  it("are not reported as drift by migrate:check once written", async () => {
    await create(places([UNIQUE_PLACE]));
    expect(await check(places([UNIQUE_PLACE]))).toEqual([]);
  });

  it("are reported as drift by migrate:check when the migrations lack one", async () => {
    await create(places([UNIQUE_PLACE]));
    const errors = await check(places([UNIQUE_PLACE, BY_CITY]));
    expect(errors.some(m => m.startsWith("SCHEMA_DRIFT"))).toBe(true);
  });
});
