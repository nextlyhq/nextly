/**
 * The check of what a save's translations-table step would take of another owner's, and that step,
 * run under one hold of the schema lock: between them no other holder of the lock, `nextly migrate`
 * or a plugin's install or uninstall among them, changes the tables the check read.
 *
 * As it happens: a save of a collection, a Single or a field group, through the schema dialog and
 * through its own route, is stopped just after the check has answered, and a second connection asks
 * for the lock as `nextly plugins install` asks (`withMigrateLock`), from outside the save, whose own
 * work runs in its claim. The lock's row names the save as its holder; the ask is refused, naming
 * it, and runs nothing; the save then ends, and the same ask is let in. On SQLite, PostgreSQL
 * and MySQL, on per-language storage. What another program runs by hand takes no lock, and nothing
 * here speaks of it.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import { createAdapter } from "../../../../database/factory";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { NextlyError } from "../../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { withMigrateLock } from "../../pipeline/locks";
import { SCHEMA_LOCK_TABLE } from "../../pipeline/schema-lock";
import type * as RemovedElements from "../removed-elements";

perLanguageStorageSuite();

/** Run once a check has answered, before the save goes on; a case sets it for the save it stops. */
const pause = vi.hoisted(() => ({
  afterCheck: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("../removed-elements", async importOriginal => {
  const actual = await importOriginal<typeof RemovedElements>();
  return {
    ...actual,
    refuseCompanionPlanTakingOthersElements: async (
      ...args: Parameters<typeof actual.refuseCompanionPlanTakingOthersElements>
    ) => {
      await actual.refuseCompanionPlanTakingOthersElements(...args);
      await pause.afterCheck?.();
    },
  };
});

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const SLUG = "csl_entity";
const FIELDS = [
  { name: "code", type: "text" },
  { name: "note", type: "text" },
];
const WITHOUT_CODE = FIELDS.filter(field => field.name !== "code");
const DIALOG = {
  fields: WITHOUT_CODE,
  confirmed: true,
  resolutions: { code: { action: "confirm_drop" } },
};

/** Each road a person's save of an entity takes, and how its entity is made first. */
const ROADS = [
  {
    road: "a collection's dialog save",
    registry: "dynamic_collections",
    create: () =>
      dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: SLUG,
          label: SLUG,
          fields: FIELDS,
        }
      ),
    save: (schemaVersion: number) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        { ...DIALOG, schemaVersion }
      ),
  },
  {
    road: "a Single's dialog save",
    registry: "dynamic_singles",
    create: () =>
      dispatchSingles(
        "createSingle",
        {},
        {
          slug: SLUG,
          label: SLUG,
          fields: FIELDS,
        }
      ),
    save: (schemaVersion: number) =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: SLUG },
        { ...DIALOG, schemaVersion }
      ),
  },
  {
    road: "a Single's own route",
    registry: "dynamic_singles",
    create: () =>
      dispatchSingles(
        "createSingle",
        {},
        {
          slug: SLUG,
          label: SLUG,
          fields: FIELDS,
        }
      ),
    save: () =>
      dispatchSingles(
        "updateSingleSchema",
        { slug: SLUG },
        { fields: WITHOUT_CODE }
      ),
  },
  {
    road: "a field group's dialog save",
    registry: "dynamic_components",
    create: () =>
      dispatchComponents(
        "createComponent",
        {},
        {
          slug: SLUG,
          label: SLUG,
          fields: FIELDS,
        }
      ),
    save: (schemaVersion: number) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: SLUG },
        { ...DIALOG, schemaVersion }
      ),
  },
  {
    road: "a field group's own route",
    registry: "dynamic_components",
    create: () =>
      dispatchComponents(
        "createComponent",
        {},
        {
          slug: SLUG,
          label: SLUG,
          // This route changes the translations table only, so it takes a change of a translated
          // field's column and refuses one of the group's own table.
          localized: true,
          fields: FIELDS,
        }
      ),
    save: () =>
      dispatchComponents(
        "updateComponent",
        { slug: SLUG },
        { fields: WITHOUT_CODE }
      ),
  },
];

let instance: TestNextly | undefined;
let other: DrizzleAdapter | undefined;
let basePath: string;
let dropDatabase: (() => Promise<void>) | undefined;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-csl-"));
  // A person's save applies its change, and writes its migration, in development only.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  pause.afterCheck = undefined;
  try {
    await other?.disconnect();
    await instance?.destroy();
    await dropDatabase?.();
  } finally {
    other = undefined;
    instance = undefined;
    dropDatabase = undefined;
    vi.unstubAllEnvs();
    _resetEnvCache();
    await rm(basePath, { recursive: true, force: true });
  }
});

describe.each(getConfiguredTestDialects())(
  "the check and the step it guards hold one schema lock (%s)",
  (dialect: TestDialect) => {
    async function start(): Promise<TestNextly> {
      let url = `file:${join(basePath, "app.db")}`;
      if (dialect !== "sqlite") {
        const scratch = await createScratchDatabase(dialect, "csl");
        dropDatabase = scratch.drop;
        url = scratch.url;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      const connect = () =>
        createAdapter({ type: dialect, url } as Parameters<
          typeof createAdapter
        >[0]);
      instance = await createTestNextly({
        adapter: (await connect()) as never,
        basePath,
        db: DB,
        localization: LOCALIZATION,
      });
      other = (await connect()) as DrizzleAdapter;
      return instance;
    }

    /** The lock asked for on the second connection, as `nextly plugins install` asks. */
    async function ask(): Promise<{ ran: boolean; refused: unknown }> {
      let ran = false;
      const refused = await withMigrateLock(
        other!,
        dialect,
        () => {
          ran = true;
          return Promise.resolve();
        },
        { command: "nextly plugins install/uninstall", mode: "fail-fast" }
      ).then(
        () => undefined,
        (error: unknown) => error
      );
      return { ran, refused };
    }

    it.each(ROADS)(
      "refuses another holder between the check and the step of $road",
      async ({ registry, create, save }) => {
        const t = await start();
        await create();
        clearRegistryRowCache();
        const [row] = await t.adapter.executeQuery<{
          v: number | string | null;
        }>(
          `SELECT schema_version AS v FROM ${registry} WHERE slug = '${SLUG}'`
        );
        let stopped = (): void => undefined;
        let goOn = (): void => undefined;
        const atCheck = new Promise<void>(resolve => (stopped = resolve));
        const released = new Promise<void>(resolve => (goOn = resolve));
        pause.afterCheck = async () => {
          stopped();
          await released;
        };

        const saving = save(Number(row?.v ?? 1));
        // A save that ends without reaching the check is told as that, not waited for.
        const reached = await Promise.race([
          atCheck.then(() => "the check"),
          saving.then(
            () => "its end",
            (error: unknown) => `its refusal: ${String(error)}`
          ),
        ]);
        expect(reached).toBe("the check");
        // No row, or no such table, is nobody holding it: the case goes on, and is told so below.
        const held = await other!
          .executeQuery<{
            command: unknown;
          }>(`SELECT command FROM ${SCHEMA_LOCK_TABLE}`)
          .then(
            rows => rows[0]?.command,
            () => undefined
          );
        const { ran, refused } = await ask();
        goOn();
        await saving;

        expect(String(held)).toContain(SLUG);
        expect(ran).toBe(false);
        expect(
          NextlyError.isCode(refused, "NEXTLY_MIGRATE_LOCK_BUSY"),
          String(refused)
        ).toBe(true);
        expect((refused as NextlyError).publicMessage).toContain(SLUG);
        // The same ask, once the save has ended: what refused it was the save's hold.
        expect(await ask()).toEqual({ ran: true, refused: undefined });
      }
    );
  }
);
