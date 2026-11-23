/**
 * A field the Builder moves into or out of a group has its values copied, and its old place
 * cleared or dropped, by statements of the save's migration file. A write setting the field while
 * those statements run would land in the old place after the copy and be lost with it, so writes to
 * the collection wait from before the move's first statement until its file has committed: then the
 * write lands in the field's new place, or is refused with nothing of it written, never lost.
 *
 * On PostgreSQL the move's transaction locks the table against writes; on MySQL the save holds the
 * collection, as a save deleting values does, and an entry write takes the shared side. SQLite has
 * one writer at a time already.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import type { CollectionService } from "../../../collections/services/collection-service";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { withStopPoints } from "../../migrate/stop-points";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const SLUG = "mhw_posts";

type Field = Record<string, unknown>;

const NOTE: Field = { name: "note", type: "text" };
const SUMMARY: Field = { name: "summary", type: "text" };
const group = (fields: Field[]): Field => ({
  name: "meta",
  type: "group",
  fields,
});

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-move-holds-"));
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    vi.unstubAllEnvs();
    await rm(basePath, { recursive: true, force: true });
  }
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function versionOf(t: TestNextly): Promise<number> {
  const [row] = (await (t.adapter as unknown as DrizzleAdapter).executeQuery(
    `SELECT schema_version AS version FROM dynamic_collections WHERE slug = '${SLUG}'`
  )) as { version: number | string | null }[];
  return Number(row?.version ?? 1);
}

describe.each(
  getConfiguredTestDialects().filter(
    (dialect): dialect is TestDialect => dialect !== "sqlite"
  )
)("a write racing a field move (%s)", dialect => {
  it("into a group: a write setting the field waits for the move, then lands in the group or is told", async () => {
    const t = await createTestNextly({ dialect, basePath, db: DB });
    instance = t;
    await t.getService("collectionService").createCollection(
      {
        name: SLUG,
        label: "Post",
        localized: false,
        fields: [SUMMARY, group([NOTE])],
      } as Parameters<CollectionService["createCollection"]>[0],
      {}
    );
    await t.nextly.create({
      collection: SLUG,
      data: {
        title: "One",
        slug: "one",
        summary: "First",
        meta: { note: "n" },
      },
    });

    // The racing write is set up here, in the case's own context, so it is another request's: one
    // started from inside the move's file would join the file's transaction instead of waiting.
    let reach: () => void = () => undefined;
    const reached = new Promise<void>(resolve => {
      reach = resolve;
    });
    let started = false;
    const racing = reached
      .then(() =>
        t.nextly.create({
          collection: SLUG,
          data: { title: "Race", slug: "race", summary: "raced" },
        })
      )
      .then(
        () => ({ ok: true }) as const,
        (error: unknown) => ({ ok: false, error }) as const
      );
    let wentThroughMeanwhile: boolean | undefined;
    await withStopPoints(
      async point => {
        if (started || !/: after statement 1$/.test(point)) return;
        // Another request sets the field once the move's first statement has run.
        started = true;
        reach();
        wentThroughMeanwhile = await Promise.race([
          racing.then(() => true),
          sleep(400).then(() => false),
        ]);
      },
      async () => {
        await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: SLUG },
          {
            fields: [group([NOTE, SUMMARY])],
            confirmed: true,
            schemaVersion: await versionOf(t),
            hints: { moves: [{ from: ["summary"], to: ["meta", "summary"] }] },
          }
        );
        clearRegistryRowCache();
      }
    );

    expect(started, "the move's file never ran a statement").toBe(true);
    expect(
      wentThroughMeanwhile,
      "the write went through while the move ran"
    ).toBe(false);
    const outcome = await racing;
    clearRegistryRowCache();
    const { items } = await t.nextly.find({ collection: SLUG, limit: 10 });
    const race = (items as Record<string, unknown>[]).find(
      item => item.slug === "race"
    );
    if (outcome.ok) {
      // Written once the move's file committed: in the field's new place.
      expect((race?.meta as Record<string, unknown> | undefined)?.summary).toBe(
        "raced"
      );
    } else {
      // Refused once it no longer fits the field's place: told, and nothing of it written.
      expect(race, "a refused write left an entry").toBeUndefined();
    }
  }, 120_000);
});
