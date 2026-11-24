/**
 * The translations-table file a Builder save writes for an answer on a field kept per language
 * carries the fill's `UPDATE` and `INSERT`, or the delete's statements, after the statements that
 * change the table itself. `nextly migrate` applies such a file to a database that holds entries of
 * its own:
 *
 * - `migrate:check` passes it, and the check of the translations table before a later file's apply
 *   does not read it as drift;
 * - a database of its own, which holds the collection and entries, ends with every entry filled or
 *   the entries without the value gone, and a second run does nothing;
 * - the delete needs the data-loss consent on that database: refused without it, by the file and the
 *   tables it takes rows from and nothing else of the file, with nothing of it changed, and applied
 *   with it;
 * - on MySQL, where the file's statements commit one at a time, a run stopped between its ALTER and
 *   its fill goes on where it stopped.
 *
 * The project is built as a person builds it: a site in development, whose Builder saves write the
 * definition and migrations into one folder. Two copies of that folder, as it stood before the
 * answered save and after it, are then deployed onto a second database with entries of its own,
 * written by a site that runs on it. The cases for a layout run in a suite of that layout: the
 * commands' configuration, mocked there, is the caller's to hold (`loaded`).
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineConfig } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { clearServices, shutdownServices } from "../../../../di/register";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { setNonInteractive } from "../../../../domains/schema/migrate/can-prompt";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { _resetEnvCache } from "../../../../shared/lib/env";
import type { CommandContext } from "../../../program";
import type { CLIDatabaseAdapter } from "../../../utils/adapter";
import { createLogger } from "../../../utils/logger";
import { findPendingFiles, runMigrate } from "../../migrate";
import { runMigrateCheck } from "../../migrate-check";
import { runMigrateResolve } from "../../migrate-resolve";

import { throwawayDatabase } from "./sync-target";

const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const DB = {
  migrationsDir: "./database/history",
  uiSchemaFile: "./schema/builder.json",
};

/** The companion table, and so the names the delete answers: `dc_posts_locales`. */
const MAIN = "dc_posts";
const COMPANION = "dc_posts_locales";

/** A save's change and answer, its values told apart by case: the answer the dialog sends. */
type AnsweredSave =
  | {
      name: "added";
      fields: Record<string, unknown>[];
      answers: Record<string, unknown>;
      settled: "summary";
    }
  | {
      name: "renamed";
      fields: Record<string, unknown>[];
      answers: Record<string, unknown>;
      settled: "remark";
    };

export function settleAnswerCases(args: {
  layout: "earlier" | "per-language";
  /** The configuration the commands load, held by the suite file that mocks the loader. */
  loaded: { config: unknown };
}): void {
  const { layout, loaded } = args;
  // Kept per language on the earlier layout only for a translated collection; on per-language
  // storage for either.
  const translations = layout === "earlier" ? [true] : [false, true];

  describe.each(getConfiguredTestDialects())(
    `an answer carried in a translations-table file (${layout} layout, %s)`,
    dialect => {
      let project: string;
      let closers: Array<() => Promise<void>> = [];

      beforeEach(() => {
        project = mkdtempSync(join(tmpdir(), "nextly-settle-answers-"));
        mkdirSync(join(project, "database"), { recursive: true });
      });

      afterEach(async () => {
        await shutdownServices().catch(() => {});
        clearServices();
        for (const close of closers.splice(0)) await close();
        vi.unstubAllEnvs();
        _resetEnvCache();
        setNonInteractive(false);
        rmSync(project, { recursive: true, force: true });
      });

      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

      /** A database of this case's own, and the address the commands reach it by. */
      async function database(): Promise<{
        url: string;
        adapter: DrizzleAdapter;
      }> {
        let url: string;
        if (dialect === "sqlite") {
          url = `file:${join(project, `db-${Math.random().toString(36).slice(2)}.db`)}`;
        } else {
          const own = await throwawayDatabase(dialect);
          url = own.url;
          closers.push(own.drop);
        }
        const adapter = (await createAdapter({
          type: dialect,
          url,
        } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
        closers.unshift(() => adapter.disconnect().catch(() => {}));
        return { url, adapter };
      }

      /** The commands and a site reach `url`'s database from here on. */
      function reach(url: string): void {
        vi.stubEnv("DB_DIALECT", dialect);
        vi.stubEnv("DATABASE_URL", url);
        _resetEnvCache();
      }

      /** A site over `adapter`'s database, its files under `folder`. */
      async function site(
        adapter: DrizzleAdapter,
        folder: string,
        environment: "development" | "production" = "development"
      ): Promise<TestNextly> {
        await shutdownServices().catch(() => {});
        clearServices();
        vi.stubEnv("NODE_ENV", environment);
        return createTestNextly({
          adapter: adapter as never,
          basePath: folder,
          collections: [],
          localization: LOCALIZATION,
          db: DB,
        } as Parameters<typeof createTestNextly>[0]);
      }

      /** A command's output, its error shape on standard error included, and its exit code. */
      async function ran(
        fn: () => Promise<void>
      ): Promise<{ code: number | undefined; said: string }> {
        const said: string[] = [];
        const base = createLogger({ quiet: true });
        const capture = (message: string) => {
          said.push(message);
        };
        Object.assign(base, {
          info: capture,
          warn: capture,
          success: capture,
          error: capture,
        });
        const exit = vi.spyOn(process, "exit").mockImplementation(code => {
          throw new Error(`exit ${String(code)}`);
        });
        const errors = vi
          .spyOn(console, "error")
          .mockImplementation((...parts: unknown[]) => {
            said.push(parts.map(String).join(" "));
          });
        const stderr = vi
          .spyOn(process.stderr, "write")
          .mockImplementation(chunk => {
            said.push(String(chunk));
            return true;
          });
        context = {
          logger: base,
          options: {},
          cwd: "",
        } as unknown as CommandContext;
        try {
          await fn();
          return { code: undefined, said: said.join("\n") };
        } catch (error) {
          const match = /^exit (\d+)$/.exec((error as Error).message);
          if (match) return { code: Number(match[1]), said: said.join("\n") };
          said.push(String(error));
          return { code: -1, said: said.join("\n") };
        } finally {
          exit.mockRestore();
          errors.mockRestore();
          stderr.mockRestore();
        }
      }
      let context: CommandContext;

      /** `nextly migrate` in `folder` on the reached database, with nobody to ask. */
      const migrate = (
        folder: string,
        options: { acceptDataLoss?: true } = {}
      ) =>
        ran(() => {
          setNonInteractive(true);
          vi.stubEnv("NODE_ENV", "development");
          vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", undefined);
          loaded.config = defineConfig({
            collections: [],
            localization: LOCALIZATION,
            db: {
              migrationsDir: join(folder, "database", "history"),
              uiSchemaFile: join(folder, "schema", "builder.json"),
            },
          } as never);
          context.cwd = folder;
          return runMigrate({ cwd: folder, ...options } as never, context);
        });

      /** `nextly migrate:check` in `folder`. */
      const check = (folder: string) =>
        ran(() => {
          context.cwd = folder;
          loaded.config = defineConfig({
            collections: [],
            localization: LOCALIZATION,
            db: {
              migrationsDir: join(folder, "database", "history"),
              uiSchemaFile: join(folder, "schema", "builder.json"),
            },
          } as never);
          return runMigrateCheck({ cwd: folder } as never, context);
        });

      /** The project's folder as it stands, copied: the state a deploy takes. */
      function copied(name: string): string {
        const folder = mkdtempSync(join(tmpdir(), `nextly-settle-${name}-`));
        cpSync(project, folder, { recursive: true });
        closers.push(async () => {
          rmSync(folder, { recursive: true, force: true });
        });
        return folder;
      }

      /** The project's SQL files so far, by name. */
      const files = (folder: string) =>
        readdirSync(join(folder, "database", "history"))
          .filter(file => file.endsWith(".sql"))
          .sort();

      /** What file `name` of `folder` runs: its statements, without the ones that undo them. */
      const runs = (folder: string, name: string) =>
        readFileSync(join(folder, "database", "history", name), "utf8").split(
          "-- DOWN"
        )[0]!;

      /** The deletions a refusal lists, each under the file it is listed for. */
      function listedDeletions(said: string): Record<string, string[]> {
        const listed: Record<string, string[]> = {};
        let file = "";
        for (const line of said.split("\n")) {
          const heading = /^\s+(\S+\.sql):$/.exec(line);
          if (heading) file = heading[1]!;
          const item = /^\s+- (.+)$/.exec(line);
          if (item) (listed[file] ??= []).push(item[1]!);
        }
        return listed;
      }

      /** A dialog's apply in development on the running site: it must go through. */
      async function save(
        name: string,
        fields: Record<string, unknown>[],
        answers: Record<string, unknown>,
        version: number
      ): Promise<void> {
        const applied = (await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: name },
          { fields, confirmed: true, schemaVersion: version, ...answers }
        )) as unknown as Response;
        expect(applied.ok, await applied.clone().text()).toBe(true);
      }

      /** The registry's version of `posts`, which a save names. */
      async function versionOf(adapter: DrizzleAdapter): Promise<number> {
        const rows = await adapter.executeQuery<{ version: unknown }>(
          `SELECT ${q("schema_version")} AS version FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'posts'`
        );
        return Number(rows[0]?.version ?? 1);
      }

      /** The translated table a rename reads and writes in: its values are kept per language. */
      const renameTable = COMPANION;

      const savesFor = (translated: boolean): AnsweredSave[] => [
        {
          name: "added",
          settled: "summary",
          fields: [
            { name: "heading", type: "text" },
            { name: "note", type: "text" },
            { name: "summary", type: "text", required: true },
          ],
          answers: {
            ...(translated ? { localized: true } : {}),
            eventResolutions: [
              {
                kind: "provide_default",
                eventId: `add_required_field_no_default:${MAIN}.summary`,
                value: "summed",
              },
            ],
          },
        },
        {
          name: "renamed",
          settled: "remark",
          fields: [
            { name: "heading", type: "text" },
            { name: "remark", type: "text", required: true },
          ],
          answers: {
            ...(translated ? { localized: true } : {}),
            renameResolutions: [
              {
                tableName: renameTable,
                fromColumn: "note",
                toColumn: "remark",
                choice: "rename",
              },
            ],
            eventResolutions: [
              {
                kind: "delete_nonconforming",
                eventId: `add_not_null_with_nulls:${MAIN}.remark`,
              },
            ],
          },
        },
      ];

      /**
       * The project built to an answered save, and its folder as it stood before that save
       * (`before`) and after it (`after`).
       */
      async function built(
        translated: boolean,
        answered: AnsweredSave
      ): Promise<{ before: string; after: string; later: string }> {
        const dev = await database();
        reach(dev.url);
        await site(dev.adapter, project);
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          {
            name: "posts",
            label: "Posts",
            localized: translated,
            fields: [
              { name: "heading", type: "text" },
              { name: "note", type: "text" },
            ],
          }
        );
        const before = copied("before");
        await save(
          "posts",
          answered.fields,
          answered.answers,
          await versionOf(dev.adapter)
        );
        const after = copied("after");
        expect(files(after).length).toBeGreaterThan(files(before).length);
        // A later save on the same table, which the drift check compares against what the
        // answered save's file left.
        await save(
          "posts",
          [...answered.fields, { name: "extra", type: "text" }],
          translated ? { localized: true } : {},
          await versionOf(dev.adapter)
        );
        const later = copied("later");
        expect(files(later).length).toBeGreaterThan(files(after).length);
        return { before, after, later };
      }

      /**
       * A second database deployed to the state before the answered save, with three entries of
       * its own: one that has a note in English, one that has none (and, in a translated
       * collection, a Spanish one), and one with none at all in English.
       */
      async function seeded(
        before: string,
        translated: boolean
      ): Promise<{
        url: string;
        adapter: DrizzleAdapter;
        kept: string;
        empty: string;
        bare: string;
      }> {
        const target = await database();
        reach(target.url);
        const first = await migrate(before);
        expect(first.code, first.said).toBeUndefined();
        const app = await site(target.adapter, before, "production");
        const write = async (locale: string, data: Record<string, unknown>) =>
          String(
            (
              await app.nextly.create({
                collection: "posts" as never,
                data: data as never,
                locale,
              } as never)
            ).item.id
          );
        const kept = await write("en", { heading: "Kept", note: "kept" });
        const empty = await write("en", { heading: "Empty" });
        const bare = await write("en", { heading: "Bare" });
        if (translated) {
          await app.nextly.update({
            collection: "posts",
            id: bare,
            locale: "es",
            data: { heading: "Desnuda", note: "nota", _overwrite: true },
          } as never);
        }
        // An entry with no row in English at all, as one written in another language first has.
        await target.adapter.executeQuery(
          `DELETE FROM ${q(COMPANION)} WHERE ${q("_parent")} = '${bare}' AND ${q("_locale")} = 'en'`
        );
        return { ...target, kept, empty, bare };
      }

      /** Each entry's English value of `column`, by entry, and which entries there are. */
      async function englishOf(
        adapter: DrizzleAdapter,
        column: string
      ): Promise<Record<string, unknown>> {
        const rows = await adapter.executeQuery<{
          id: unknown;
          value: unknown;
        }>(
          `SELECT ${q("_parent")} AS id, ${q(column)} AS value FROM ${q(COMPANION)} WHERE ${q("_locale")} = 'en'`
        );
        return Object.fromEntries(rows.map(row => [String(row.id), row.value]));
      }

      /** The entries the collection holds. */
      async function entriesOf(adapter: DrizzleAdapter): Promise<string[]> {
        const rows = await adapter.executeQuery<{ id: unknown }>(
          `SELECT ${q("id")} AS id FROM ${q(MAIN)}`
        );
        return rows.map(row => String(row.id)).sort();
      }

      /** The files the reached database's ledger does not hold yet. */
      const pendingIn = (adapter: DrizzleAdapter, folder: string) =>
        findPendingFiles(
          adapter as unknown as CLIDatabaseAdapter,
          adapter.getDrizzle(),
          dialect,
          join(folder, "database", "history"),
          createLogger({ quiet: true })
        );

      for (const translated of translations) {
        for (const answered of savesFor(translated)) {
          const kind = translated ? "a translated" : "an untranslated";
          const filling = answered.name === "added";

          it(`passes ${kind} collection's file that ${filling ? "fills" : "deletes"} through migrate:check, a second database and a second run (${answered.name})`, async () => {
            const { before, after, later } = await built(translated, answered);
            // The check reads the project as a whole: files, snapshots and what they say.
            const checked = await check(after);
            expect(checked.code, checked.said).toBeUndefined();

            const target = await seeded(before, translated);
            const ids = [target.kept, target.empty, target.bare].sort();
            expect(await entriesOf(target.adapter)).toEqual(ids);
            reach(target.url);
            const applied = await migrate(
              after,
              filling ? {} : { acceptDataLoss: true }
            );
            expect(applied.code, applied.said).toBeUndefined();
            // A file that fills is compared with the table before it applies; a pending rename
            // leaves its table unjudged, as any pending rename does. Neither is drift.
            expect(applied.said).not.toMatch(/SCHEMA_DRIFT|drifted/);
            if (filling) {
              expect(applied.said).not.toMatch(/without a drift check/);
            }

            const expected = filling
              ? {
                  [target.kept]: "summed",
                  [target.empty]: "summed",
                  [target.bare]: "summed",
                }
              : { [target.kept]: "kept" };
            expect(await englishOf(target.adapter, answered.settled)).toEqual(
              expected
            );
            if (!filling) {
              // The entries without a value are gone, with every language's row of them.
              expect(await entriesOf(target.adapter)).toEqual([target.kept]);
              const rows = await target.adapter.executeQuery<{ id: unknown }>(
                `SELECT ${q("_parent")} AS id FROM ${q(COMPANION)}`
              );
              expect(new Set(rows.map(row => String(row.id)))).toEqual(
                new Set([target.kept])
              );
            } else {
              expect(await entriesOf(target.adapter)).toEqual(ids);
            }

            // A second run finds nothing to do, and says so; nothing is pending or run again.
            expect((await pendingIn(target.adapter, after)).length).toBe(0);
            const again = await migrate(after);
            expect(again.code, again.said).toBeUndefined();
            expect(await englishOf(target.adapter, answered.settled)).toEqual(
              expected
            );

            // The next save's file applies over the table the settled file left, with no drift.
            const next = await migrate(later);
            expect(next.code, next.said).toBeUndefined();
            expect(next.said).not.toMatch(/SCHEMA_DRIFT|drifted/);
            expect((await pendingIn(target.adapter, later)).length).toBe(0);
            expect(await englishOf(target.adapter, answered.settled)).toEqual(
              expected
            );
          }, 240_000);

          if (filling) continue;

          it(`refuses ${kind} collection's file that deletes without the data-loss consent, changing nothing (${answered.name})`, async () => {
            const { before, after } = await built(translated, answered);
            // The one file of the save that deletes is the translations table's: it renames the
            // column there, and then deletes from both tables.
            const deleting = files(after).filter(
              name =>
                !files(before).includes(name) &&
                runs(after, name).includes("DELETE FROM")
            );
            expect(deleting).toHaveLength(1);
            const file = deleting[0]!;
            const up = runs(after, file);
            expect(up).toMatch(
              /dc_posts_locales[^;]*RENAME COLUMN .note. TO .remark./
            );
            expect(up.indexOf("DELETE FROM")).toBeGreaterThan(
              up.indexOf("RENAME COLUMN")
            );
            expect(up).toContain(`DELETE FROM ${q(MAIN)} `);
            expect(up).toContain(`DELETE FROM ${q(COMPANION)} `);

            const target = await seeded(before, translated);
            const ids = [target.kept, target.empty, target.bare].sort();

            reach(target.url);
            const rowsBefore = await languageRowsOf(target.adapter, "note");
            const pending = await pendingIn(target.adapter, after);
            const refused = await migrate(after);

            // Refused for want of the consent, and for the rows alone: the file's rename is not
            // among what needs it.
            expect(refused.code, refused.said).not.toBeUndefined();
            expect(refused.said).toMatch(/DATA_LOSS_CONSENT_REQUIRED/);
            expect(refused.said).toMatch(/Nothing was changed/);
            expect(listedDeletions(refused.said)).toEqual({
              [file]: [
                `rows of ${MAIN}`,
                `rows of ${COMPANION}, belonging to ${MAIN}`,
              ],
            });
            // Nothing changed: the entries, every language's row under the column's old name, and
            // the files still to run.
            expect(await entriesOf(target.adapter)).toEqual(ids);
            expect(await languageRowsOf(target.adapter, "note")).toEqual(
              rowsBefore
            );
            expect(await pendingIn(target.adapter, after)).toEqual(pending);

            // With it, the same file applies.
            const applied = await migrate(after, { acceptDataLoss: true });
            expect(applied.code, applied.said).toBeUndefined();
            expect(await entriesOf(target.adapter)).toEqual([target.kept]);
          }, 240_000);
        }

        it.runIf(dialect === "mysql")(
          `leaves ${translated ? "a translated" : "an untranslated"} collection's file whole where a run stopped between its ALTER and its fill, and finishes once that is undone`,
          async () => {
            const [answered] = savesFor(translated);
            const { before, after } = await built(translated, answered!);
            const target = await seeded(before, translated);
            reach(target.url);
            const ids = [target.kept, target.empty, target.bare].sort();
            const notes = await languageRowsOf(target.adapter, "note");

            // The file's ALTER has committed, and its fill is refused: a run stopped between
            // them. A table with a trigger asks for the data-loss consent before anything runs.
            await target.adapter.executeQuery(
              `CREATE TRIGGER ${q("stop_fill")} BEFORE UPDATE ON ${q(COMPANION)} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stopped'`
            );
            const stopped = await migrate(after, { acceptDataLoss: true });
            expect(stopped.code, stopped.said).not.toBeUndefined();
            expect(stopped.said).toMatch(/stopped/);
            await target.adapter.executeQuery(`DROP TRIGGER ${q("stop_fill")}`);

            // Nothing is filled and nothing is lost: every entry is there with its notes, and the
            // new column, which the ALTER left, holds no value.
            expect(await entriesOf(target.adapter)).toEqual(ids);
            expect(await languageRowsOf(target.adapter, "note")).toEqual(notes);
            expect(await languageRowsOf(target.adapter, "summary")).toEqual(
              notes.map(row => [row[0], row[1], null])
            );

            // A rerun refuses: it says which statement has run and which it cannot judge, and
            // what to do about each, and changes nothing.
            const refused = await migrate(after, { acceptDataLoss: true });
            expect(refused.code, refused.said).not.toBeUndefined();
            expect(refused.said).toMatch(/NEXTLY_MIGRATION_PARTIALLY_APPLIED/);
            expect(refused.said).toMatch(
              /ALTER TABLE [^)]*ADD COLUMN `summary`[^)]*\) is done/
            );
            expect(refused.said).toMatch(/UPDATE [^)]*\) is unknown/);
            expect(await languageRowsOf(target.adapter, "note")).toEqual(notes);

            // Undone as the message says, the file runs whole.
            const file = files(after).find(name =>
              name.includes("adds_localization")
            )!;
            await target.adapter.executeQuery(
              `ALTER TABLE ${q(COMPANION)} DROP COLUMN ${q("summary")}`
            );
            const resolved = await ran(() =>
              runMigrateResolve(
                { cwd: after, failedCleanup: file } as never,
                context
              )
            );
            expect(resolved.code, resolved.said).toBeUndefined();
            const finished = await migrate(after);
            expect(finished.code, finished.said).toBeUndefined();
            expect(await englishOf(target.adapter, "summary")).toEqual({
              [target.kept]: "summed",
              [target.empty]: "summed",
              [target.bare]: "summed",
            });
          },
          240_000
        );
      }

      /** Every language's row of the collection, by entry, language and value of `column`. */
      async function languageRowsOf(
        adapter: DrizzleAdapter,
        column: string
      ): Promise<[string, string, unknown][]> {
        const rows = await adapter.executeQuery<Record<string, unknown>>(
          `SELECT ${q("_parent")} AS parent, ${q("_locale")} AS locale, ${q(column)} AS value FROM ${q(COMPANION)}`
        );
        return rows
          .map((row): [string, string, unknown] => [
            String(row.parent),
            String(row.locale),
            row.value ?? null,
          ])
          .sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
      }
    }
  );
}
