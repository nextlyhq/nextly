/**
 * A Builder save that drops what a translations table holds, killed after its own migration file ran
 * and before that table is brought in step (`helpers/left-save-fixture.ts`). The registry row no longer
 * names the field, the file is recorded applied, and the column and its values are still there. Nothing
 * that settles such a save may say it applied whole: it stays left part-way and named, the migration
 * commands and the next save of the entity refuse, saying so, and the values a person confirmed the
 * loss of are never read back. A save that had nothing of that table left to drop applied whole, and is
 * settled so: one that finished, one that only adds, one whose own file moved a field out of
 * translation, one a later migration of the entity moved past.
 *
 * The column is a translatable field's, or the one a repeater or group keeps its text per language in,
 * which the snapshots record apart from the fields'.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { defineConfig } from "../../../../config";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { runBootTimeApplyIfDev } from "../../../../init/boot-apply";
import type { TestNextly } from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { createLogger } from "../../../../cli/utils/logger";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { recordAlreadyApplied } from "../../migrate/drift-reconcile";
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
  "a Builder save that drops what a translations table holds, killed before that table is in step ($dialect, $layout)",
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
      rows,
      fromAnotherProcess,
    } = leftSaveSuite({ dialect, perLanguage });

    /** What a save drops: its field, the value written to it, and the column it is kept in. */
    interface Taken {
      name: string;
      column: string;
      field: Field;
      data: Record<string, unknown>;
    }
    const HEADING: Taken = {
      name: "a translatable field",
      column: "heading",
      field: text("heading"),
      data: { heading: "OLD VALUE" },
    };
    const BOX: Taken = {
      name: "a group holding text",
      column: "box",
      field: { name: "box", type: "group", fields: [text("label")] },
      data: { box: { label: "OLD VALUE" } },
    };
    // A container's column is reached on the entities not marked translated, which the save's
    // own comparison of the translations table asks nothing of.
    const TAKEN = perLanguage ? [HEADING, BOX] : [HEADING];

    /** What the drop of `taken` sends to be confirmed, with the one value it takes. */
    const confirmed = (taken: Taken) => ({
      resolutions: { [taken.column]: { action: "confirm_drop" } },
      confirmedDeletions: [{ field: taken.column, count: 1 }],
    });

    /** The fields each entity keeps beside the one dropped. */
    const kept = (taken: Taken): Field[] =>
      taken === BOX ? [text("heading"), field("note")] : [field("note")];

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

    /** The site, and the entity with `taken`'s field and its one value written. */
    async function setUp(entity: Dropped, taken: Taken): Promise<TestNextly> {
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
            fields: [...kept(taken), taken.field],
          }
        );
        await t.nextly.updateSingle({
          slug: hero,
          data: { ...taken.data, note: "n", _overwrite: true },
        } as never);
        return t;
      }
      if (taken === BOX) await entity.save(t, [...kept(taken), taken.field]);
      const [first] = (await t.adapter.executeQuery(
        `SELECT id FROM ${table} WHERE slug = 'first'`
      )) as unknown as Array<{ id: unknown }>;
      await t.nextly.update({
        collection: slug,
        id: String(first?.id),
        data: { ...taken.data, _overwrite: true },
      } as never);
      return t;
    }

    /** The drop of `taken`, killed once its file ran: before its translations column is dropped, or after. */
    async function killDrop(
      t: TestNextly,
      entity: Dropped,
      taken: Taken,
      at: "companion: before" | "companion: after" = "companion: before"
    ): Promise<void> {
      await killSave(
        t,
        point => point === at,
        () => entity.save(t, kept(taken), confirmed(taken))
      );
      // Before: the column, and the value in it, are still there. The row names the field no more.
      const stored = await storedIn(t, entity, taken.column);
      if (at === "companion: before") {
        expect(stored, `killed at ${killedAt}`).toContain("OLD VALUE");
      } else {
        expect(stored, `killed at ${killedAt}`).toBe("no such column");
      }
      expect(await namesField(t, entity, taken.column)).toBe(false);
    }

    /** What the entity's translations table holds under `column`. */
    async function storedIn(
      t: TestNextly,
      entity: Dropped,
      column: string
    ): Promise<string> {
      const held = (await t.adapter.executeQuery(
        `SELECT * FROM ${entity.table}_locales`
      )) as unknown as Array<Record<string, unknown>>;
      expect(held.length, "rows per language").toBeGreaterThan(0);
      return held.some(row => column in row)
        ? JSON.stringify(held.map(row => row[column]))
        : "no such column";
    }

    /** Whether the entity's registry row names `name`. */
    async function namesField(
      t: TestNextly,
      entity: Dropped,
      name: string
    ): Promise<boolean> {
      const [row] = (await t.adapter.executeQuery(
        `SELECT fields FROM ${entity.registry} WHERE slug = '${entity.slug}'`
      )) as unknown as Array<{ fields: unknown }>;
      const fields =
        typeof row?.fields === "string"
          ? (JSON.parse(row.fields) as Field[])
          : (row?.fields as Field[]);
      return fields.some(each => each.name === name);
    }

    /** Each entity with each thing a save drops of it, by name. */
    const drops = entities.flatMap(entity =>
      TAKEN.map(taken => [entity.kind, taken.name, entity, taken] as const)
    );

    /** Whether the save's record still stands. */
    async function recordStands(t: TestNextly): Promise<boolean> {
      const key = dialect === "mysql" ? "`key`" : '"key"';
      const records = (await t.adapter.executeQuery(
        `SELECT ${key} FROM nextly_meta WHERE ${key} LIKE 'builder-save-in-progress:%'`
      )) as unknown as unknown[];
      return records.length > 0;
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

    it.each(drops)(
      "a %s that drops %s stays left part-way, named by the settle, a start, the commands and the next save",
      async (_kind, _name, entity, taken) => {
        const t = await setUp(entity, taken);
        await killDrop(t, entity, taken);

        const settled = await settle(t);
        expect.soft(settled.map(one => one.outcome)).toEqual(["left"]);
        expect
          .soft(settled.flatMap(one => one.notes ?? []).join("; "))
          .toContain(`${entity.table}_locales.${taken.column}`);
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
          entity.save(t, [...kept(taken), field("extra")])
        );
        expect.soft(refused).toContain("left part-way");
        expect.soft(refused).not.toContain("schema drift");
      },
      300_000
    );

    // The field added again takes the column that was never dropped, with the values in it.
    it.each(drops)(
      "a %s that drops %s never reads back the values confirmed as deleted, once it is added again",
      async (kind, _name, entity, taken) => {
        const t = await setUp(entity, taken);
        await killDrop(t, entity, taken);
        await settle(t);
        await start();

        await saidBy(entity.save(t, [...kept(taken), field("extra")]));
        await saidBy(
          entity.save(t, [...kept(taken), taken.field, field("extra")])
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

    // The column dropped by hand, as the note says to, the save applied whole.
    it.each(drops)(
      "a %s that drops %s is settled whole once the column it left is dropped by hand",
      async (_kind, _name, entity, taken) => {
        const t = await setUp(entity, taken);
        await killDrop(t, entity, taken);
        expect((await settle(t)).map(one => one.outcome)).toEqual(["left"]);

        await t.adapter.executeQuery(
          `ALTER TABLE ${entity.table}_locales DROP COLUMN ${taken.column}`
        );

        expect((await settle(t)).map(one => one.outcome)).toEqual(["all"]);
        expect(await recordStands(t)).toBe(false);
      },
      300_000
    );

    // A field that leaves translation is moved by a file of the save's own, its column dropped there:
    // nothing of the translations table is left for the step. On per-language storage the Builder
    // refuses that save before its file.
    it.runIf(!perLanguage)(
      "a field that leaves translation is settled whole, its own file having moved its values",
      async () => {
        const entity = entities[0]!;
        const t = await setUp(entity, HEADING);
        await killSave(
          t,
          point => point === "companion: before",
          () =>
            entity.save(t, [
              { ...text("heading"), localized: false },
              text("note"),
            ])
        );
        expect(await storedIn(t, entity, "heading")).toBe("no such column");
        expect(await rows(t)).toEqual([
          expect.stringContaining('"heading":"OLD VALUE"'),
        ]);

        expect((await settle(t)).map(one => one.outcome)).toEqual(["all"]);
        expect(await recordStands(t)).toBe(false);
      },
      300_000
    );

    it.each(drops)(
      "a %s that drops %s is settled whole where the save had brought the translations table in step",
      async (_kind, _name, entity, taken) => {
        const t = await setUp(entity, taken);
        await killDrop(t, entity, taken, "companion: after");

        expect((await settle(t)).map(one => one.outcome)).toEqual(["all"]);
        expect(await recordStands(t)).toBe(false);
      },
      300_000
    );

    // A save that only adds has nothing of the translations table to drop: its own files made the
    // columns, so it applied whole whether or not it was killed before that table's step.
    it.each(
      entities.flatMap(entity =>
        (["companion: before", "companion: after"] as const).flatMap(at =>
          (perLanguage
            ? [text("added"), { ...BOX.field, name: "crate" }]
            : [text("added")]
          ).map(
            added =>
              [entity.kind, String(added.name), at, entity, added] as const
          )
        )
      )
    )(
      "a %s that adds %s is settled whole, killed at %s",
      async (_kind, _name, at, entity, added) => {
        const t = await setUp(entity, HEADING);
        await killSave(
          t,
          point => point === at,
          () => entity.save(t, [text("heading"), field("note"), added])
        );

        expect((await settle(t)).map(one => one.outcome)).toEqual(["all"]);
        expect(await recordStands(t)).toBe(false);
      },
      300_000
    );

    // A later migration of the entity applied since: the column is that migration's to speak of.
    it.each(drops)(
      "a %s that drops %s is settled whole where a later migration of it applied since",
      async (kind, _name, entity, taken) => {
        const t = await setUp(entity, taken);
        await killDrop(t, entity, taken);
        const later = "29991231_000000_000_later.sql";
        writeFileSync(
          join(basePath, MIGRATIONS, later),
          [
            `-- Migration: ${entity.slug}_later`,
            `-- ${kind === "single" ? "Singles" : "Collections"}: ${entity.slug}`,
            "-- Entity scope: touched",
            "",
            "-- UP",
            "",
            "-- DOWN",
            "",
          ].join("\n")
        );
        await recordAlreadyApplied(
          { filename: later },
          new SchemaEventsRepository(t.adapter.getDrizzle(), t.adapter.dialect)
        );

        expect((await settle(t)).map(one => one.outcome)).toEqual(["all"]);
        expect(await recordStands(t)).toBe(false);
      },
      300_000
    );
  }
);
