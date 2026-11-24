/**
 * A Builder save that drops a translatable field, killed on MySQL after its own migration file ran and
 * before its translations table is brought in step (`helpers/left-save-fixture.ts`). The registry row
 * no longer names the field, the file is recorded applied, and the column and its values are still
 * there. Nothing a save settles may say it applied whole: the save stays left part-way and named, the
 * migration commands and the next save of the entity refuse, saying so, and the values a person
 * confirmed the loss of are never read back.
 */
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { defineConfig } from "../../../../config";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { runBootTimeApplyIfDev } from "../../../../init/boot-apply";
import type { TestNextly } from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { createLogger } from "../../../../cli/utils/logger";
import {
  basePath,
  killedAt,
  leftSaveHooks,
  leftSaveSuite,
  LEFT_SAVE_SUITES,
  MIGRATIONS,
  text,
  type Field,
} from "./helpers/left-save-fixture";
import { loadedConfig } from "./helpers/loaded-config";
import { migrationCommands } from "./helpers/project-commands";
import { unwatchStart, watched } from "./helpers/watched-start";

vi.mock("../../busy-table/run-unit", async original =>
  (await import("./helpers/stop-at-kill")).stoppingUnits(
    await original<typeof import("../../busy-table/run-unit")>()
  )
);
vi.mock("../../../i18n/migration/held-leaving-drops", async original =>
  (await import("./helpers/stop-at-kill")).stoppingCompanion(
    await original<
      typeof import("../../../i18n/migration/held-leaving-drops")
    >()
  )
);
vi.mock("../../services/drizzle-statement-executor", async original =>
  (await import("./helpers/stop-at-kill")).stoppingStatements(
    await original<typeof import("../../services/drizzle-statement-executor")>()
  )
);
vi.mock("../../pipeline/locks", async original =>
  (await import("./helpers/watched-start")).passingLocks(
    await original<typeof import("../../pipeline/locks")>()
  )
);
vi.mock("../../../../cli/utils/adapter", async original =>
  (await import("./helpers/watched-start")).validEnvironment(
    await original<typeof import("../../../../cli/utils/adapter")>()
  )
);
vi.mock("../../../../cli/commands/migrate", async original =>
  (await import("./helpers/watched-start")).countingMigrate(
    await original<typeof import("../../../../cli/commands/migrate")>()
  )
);
vi.mock("../../../../cli/program", () => ({
  createContext: () => ({ logger: createLogger({ quiet: true }) }),
}));
vi.mock("../../../../cli/utils/config-loader", async original => {
  const { loadedConfig: toLoad } = await import("./helpers/loaded-config");
  const reading = (await import("./helpers/watched-start")).readingFolder(
    await original<typeof import("../../../../cli/utils/config-loader")>()
  );
  return {
    ...reading,
    loadConfig: (async (...args: Parameters<typeof reading.loadConfig>) =>
      toLoad.value === undefined
        ? reading.loadConfig(...args)
        : { config: toLoad.value, dependencies: [] }) as never,
  };
});

leftSaveHooks();

describe.each(LEFT_SAVE_SUITES)(
  "a Builder save that drops a translatable field, killed before its translations table is in step ($dialect, $layout)",
  ({ dialect, perLanguage }) => {
    const {
      slug,
      table,
      hero,
      field,
      boot,
      versionOf,
      killSave,
      settle,
      fromAnotherProcess,
    } = leftSaveSuite({ dialect, perLanguage });

    /** What the drop of `heading` sends to be confirmed, with the one value it takes. */
    const confirmed = {
      resolutions: { heading: { action: "confirm_drop" } },
      confirmedDeletions: [{ field: "heading", count: 1 }],
    };

    /** The entity the drop is made on, and how it is made. */
    interface Dropped {
      kind: "collection" | "single";
      table: string;
      registry: string;
      slug: string;
      save: (
        t: TestNextly,
        fields: Field[],
        answers?: Record<string, unknown>
      ) => Promise<unknown>;
    }
    const translated = perLanguage ? {} : { localized: true };
    const entities: Dropped[] = [
      {
        kind: "collection",
        table,
        registry: "dynamic_collections",
        slug,
        save: async (t, fields, answers = {}) =>
          dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: slug },
            {
              fields,
              confirmed: true,
              schemaVersion: await versionOf(t),
              ...answers,
              ...translated,
            }
          ),
      },
      {
        kind: "single",
        table: `single_${hero}`,
        registry: "dynamic_singles",
        slug: hero,
        save: async (t, fields, answers = {}) =>
          dispatchSingles(
            "applySingleSchemaChanges",
            { slug: hero },
            {
              fields,
              confirmed: true,
              schemaVersion: await versionOf(t, "dynamic_singles", hero),
              ...answers,
              ...translated,
            }
          ),
      },
    ];

    /** The site, the entity with `heading` translatable and its one value written. */
    async function setUp(entity: Dropped): Promise<TestNextly> {
      const t = await boot(
        perLanguage ? { translatable: true } : { languages: true }
      );
      if (entity.kind === "single") {
        await dispatchSingles(
          "createSingle",
          {},
          {
            slug: hero,
            label: hero,
            ...translated,
            fields: [text("heading"), field("note")],
          }
        );
        await t.nextly.updateSingle({
          slug: hero,
          data: { heading: "OLD VALUE", note: "n", _overwrite: true },
        } as never);
        return t;
      }
      const [first] = (await t.adapter.executeQuery(
        `SELECT id FROM ${table} WHERE slug = 'first'`
      )) as unknown as Array<{ id: unknown }>;
      await t.nextly.update({
        collection: slug,
        id: String(first?.id),
        data: { heading: "OLD VALUE", _overwrite: true },
      } as never);
      return t;
    }

    /** The drop of `heading`, killed once its file ran and before its translations column is dropped. */
    async function killDrop(t: TestNextly, entity: Dropped): Promise<void> {
      await killSave(
        t,
        point => point === "companion: before",
        () => entity.save(t, [field("note")], confirmed)
      );
      // The column, and the value in it, are still there; the row no longer names the field.
      expect(await storedHeading(t, entity), `killed at ${killedAt}`).toContain(
        "OLD VALUE"
      );
      expect(await namesHeading(t, entity)).toBe(false);
    }

    /** What the entity's translations table holds under `heading`. */
    async function storedHeading(
      t: TestNextly,
      entity: Dropped
    ): Promise<string> {
      const rows = await t.adapter
        .executeQuery(`SELECT heading FROM ${entity.table}_locales`)
        .catch(() => []);
      return JSON.stringify(rows);
    }

    /** Whether the entity's registry row names `heading`. */
    async function namesHeading(
      t: TestNextly,
      entity: Dropped
    ): Promise<boolean> {
      const [row] = (await t.adapter.executeQuery(
        `SELECT fields FROM ${entity.registry} WHERE slug = '${entity.slug}'`
      )) as unknown as Array<{ fields: unknown }>;
      return JSON.stringify(row?.fields).includes("heading");
    }

    /** Whether the save's record still stands. */
    async function recordStands(t: TestNextly): Promise<boolean> {
      const rows = (await t.adapter.executeQuery(
        "SELECT `key` FROM nextly_meta WHERE `key` LIKE 'builder-save-in-progress:%'"
      )) as unknown as unknown[];
      return rows.length > 0;
    }

    /** A development start over the project, its migrate step running the folder's files. */
    async function start(): Promise<void> {
      watched.on = true;
      watched.folder = join(basePath, MIGRATIONS);
      try {
        await runBootTimeApplyIfDev({ caller: "companion drop" });
      } finally {
        unwatchStart();
      }
    }

    /** What a save says where it is refused, or that it went through. */
    async function saidBy(save: Promise<unknown>): Promise<string> {
      try {
        const answer = await save;
        return answer instanceof Response
          ? `${answer.status} ${await answer.clone().text()}`
          : JSON.stringify(answer);
      } catch (error) {
        return String(
          (error as { publicMessage?: string }).publicMessage ??
            (error as Error).message
        );
      }
    }

    it.runIf(dialect === "mysql").each(entities.map(e => [e.kind, e] as const))(
      "a %s's stays left part-way, named by the settle, a start, the commands and the next save",
      async (_kind, entity) => {
        const t = await setUp(entity);
        await killDrop(t, entity);

        const settled = await settle(t);
        expect.soft(settled.map(one => one.outcome)).toEqual(["left"]);
        expect.soft(await recordStands(t), "after the settle").toBe(true);
        await start();
        expect.soft(await recordStands(t), "after a start").toBe(true);

        loadedConfig.value = defineConfig({
          collections: [],
          db: {
            migrationsDir: MIGRATIONS,
            uiSchemaFile: "./schema/builder.json",
          },
        });
        try {
          const commands = await migrationCommands(basePath);
          for (const [name, ended] of Object.entries(commands)) {
            expect.soft(ended.ok, `${name}: ${ended.said}`).toBe(false);
            expect.soft(ended.said, name).toContain("left part-way");
          }
        } finally {
          loadedConfig.value = undefined;
        }

        // The next save of the entity is refused saying the save was left, never as drift.
        const refused = await saidBy(
          entity.save(t, [field("note"), field("extra")])
        );
        expect.soft(refused).toContain("left part-way");
        expect.soft(refused).not.toContain("schema drift");
      },
      300_000
    );

    // The field added again takes the column that was never dropped, with the values in it.
    it.runIf(dialect === "mysql").each(entities.map(e => [e.kind, e] as const))(
      "a %s's never reads back the values confirmed as deleted, once the field is added again",
      async (kind, entity) => {
        const t = await setUp(entity);
        await killDrop(t, entity);
        await settle(t);
        await start();

        await saidBy(entity.save(t, [field("note"), field("extra")]));
        await saidBy(
          entity.save(t, [text("heading"), field("note"), field("extra")])
        );

        const reads =
          kind === "single"
            ? await fromAnotherProcess([
                { kind: "single-read", via: "rest", slug: entity.slug },
                { kind: "single-read", via: "api", slug: entity.slug },
              ])
            : await fromAnotherProcess([
                { kind: "read", via: "rest" },
                { kind: "read", via: "api" },
              ]);
        for (const read of reads) {
          expect
            .soft(JSON.stringify(read.items ?? read.item), JSON.stringify(read))
            .not.toContain("OLD VALUE");
        }
      },
      300_000
    );

    // Where the field leaves translation, its column in the translations table is the one left. On
    // per-language storage the Builder refuses that save before its file.
    it.runIf(dialect === "mysql" && !perLanguage)(
      "a field that leaves translation stays left part-way, named by the settle",
      async () => {
        const entity = entities[0]!;
        const t = await setUp(entity);
        await killSave(
          t,
          point => point === "companion: before",
          () =>
            entity.save(t, [
              { ...text("heading"), localized: false },
              text("note"),
            ])
        );

        const settled = await settle(t);
        expect.soft(settled.map(one => one.outcome)).toEqual(["left"]);
        expect.soft(await recordStands(t)).toBe(true);
      },
      300_000
    );
  }
);
