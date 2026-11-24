/**
 * `nextly migrate:create` and a field renamed in code, on either storage layout.
 *
 * A text field's values are kept in its entity's translations table for each language wherever
 * the entity stores them per language: under per-language storage, as every installation now
 * runs, whether or not the collection is translated, and for a translated collection on the
 * earlier layout. Its rename is that table's own there, offered and written as a rename, so every
 * language's value is kept. Planned as an added column instead, the field read empty after it: its
 * values stayed in the column under the old name, which nothing reads.
 *
 * The rename planner's question of where the values are kept changes nothing for an entity that
 * keeps them on its main table: the files a run writes for one are byte for byte the files dev's
 * generator wrote (`__fixtures__/dev-generator-captures`, captured from it): a text field renamed on the earlier
 * layout, and a number field (kept once for every language) renamed under per-language storage.
 *
 * And a project whose newest snapshot dev's generator wrote, for a collection that is not
 * translated under per-language storage, takes the first run after the change as it took runs
 * before it: with nothing changed, no file; with an unrelated field added, that field's column
 * alone, no rename and no drop.
 *
 * Shared by the suite on the earlier layout and the one on per-language storage. Each run owns its
 * database, reached by the commands through `DATABASE_URL` as an app's would.
 */
import {
  cpSync,
  existsSync,
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

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import {
  defineCollection,
  defineConfig,
  number,
  text,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { clearServices, shutdownServices } from "../../../../di/register";
import { setNonInteractive } from "../../../../domains/schema/migrate/can-prompt";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../../shared/lib/env";
import type { CommandContext } from "../../../program";
import { createLogger } from "../../../utils/logger";
import { runMigrate } from "../../migrate";
import { runMigrateCreate } from "../../migrate-create";

/** The files dev's generator wrote, by case and dialect. */
const FIXTURES = join(
  __dirname,
  "..",
  "__fixtures__",
  "dev-generator-captures"
);

/** The slug every case declares, so a file captured from dev's generator names the same tables. */
const SLUG = "rtl_notes";

type Collections = ReturnType<typeof defineCollection>[];

/**
 * The notes collection: `title`, the text field `name`, `note`, and the fields `extra` adds, the
 * collection translated where `translated` says so.
 */
function notes(
  name: string,
  options: { translated?: boolean; extra?: ReturnType<typeof number>[] } = {}
): Collections {
  return [
    defineCollection({
      slug: SLUG,
      ...(options.translated === true ? { localized: true } : {}),
      fields: [
        text({ name: "title" }),
        text({ name }),
        text({ name: "note" }),
        ...(options.extra ?? []),
      ],
    }),
  ];
}

/** The notes with the number field `name` beside their text fields. */
const counted = (name: string) =>
  notes("heading", { extra: [number({ name })] });

/** Every SQL file of `dir`, by name, in the order `nextly migrate` runs them. */
const sqlFilesIn = (dir: string) =>
  readdirSync(dir)
    .filter(f => f.endsWith(".sql"))
    .sort();

/**
 * Files as the comparison with dev's reads them: each by name and text, in order, the moment a
 * run wrote it at left out, which is the only part two runs of one generator differ in.
 */
function comparable(dir: string, names: readonly string[]): string {
  const moment = /\d{8}_\d{6}_\d{3}/g;
  return names
    .map(
      name =>
        `== ${name.replace(moment, "<at>")}\n${readFileSync(
          join(dir, name),
          "utf-8"
        )
          .replace(moment, "<at>")
          .replace(/^-- Generated at: .*$/gm, "-- Generated at: <now>")}`
    )
    .join("\n");
}

/**
 * The cases for `layout`. `loaded` is the configuration the commands load: the suite file mocks
 * the config loader to return it, since a mock is registered by the file that declares it.
 */
export function codeRenameCases(args: {
  layout: "earlier" | "per-language";
  loaded: { config: unknown };
}): void {
  const { layout, loaded } = args;
  const configOf = (collections: Collections) =>
    defineConfig({
      collections,
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      db: { migrationsDir: "./migrations" },
    });

  let dir: string;
  let closers: Array<() => Promise<void>> = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nextly-code-renames-"));
    mkdirSync(join(dir, "migrations"));
  });

  afterEach(async () => {
    await shutdownServices().catch(() => {});
    for (const close of closers.splice(0)) await close();
    vi.unstubAllEnvs();
    _resetEnvCache();
    setNonInteractive(false);
    rmSync(dir, { recursive: true, force: true });
  });

  /** A database of this test's own, which the commands reach through `DATABASE_URL`. */
  async function openDatabase(dialect: TestDialect): Promise<string> {
    let url: string;
    if (dialect === "sqlite") {
      url = `file:${join(dir, "app.db")}`;
    } else {
      const scratch = await createScratchDatabase(
        dialect,
        "nextly_rtl_renames"
      );
      url = scratch.url;
      closers.push(() => scratch.drop());
    }
    vi.stubEnv("DB_DIALECT", dialect);
    vi.stubEnv("DATABASE_URL", url);
    _resetEnvCache();
    return url;
  }

  /** Start the app over the database at `url`, declaring `collections`. */
  async function start(
    dialect: TestDialect,
    url: string,
    collections?: Collections
  ): Promise<TestNextly> {
    await shutdownServices().catch(() => {});
    clearServices();
    const adapter = (await createAdapter({
      type: dialect,
      url,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    closers.unshift(() => adapter.disconnect().catch(() => {}));
    return createTestNextly({
      adapter: adapter as never,
      ...(collections === undefined
        ? {}
        : {
            collections,
            localization: { locales: ["en", "es"], defaultLocale: "en" },
          }),
    } as Parameters<typeof createTestNextly>[0]);
  }

  /** A command's context, and everything it said, its error shape on standard error included. */
  function command(): { context: CommandContext; said: string[] } {
    const said: string[] = [];
    const base = createLogger({ quiet: true });
    const capture = (message: string) => {
      said.push(message);
    };
    return {
      context: {
        logger: {
          ...base,
          info: capture,
          warn: capture,
          success: capture,
          error: capture,
        },
        options: {},
        cwd: dir,
      } as CommandContext,
      said,
    };
  }

  /**
   * Run `fn` as a command: `process.exit` becomes its code, and what it prints to standard error is
   * kept with what it said.
   */
  async function ran(
    said: string[],
    fn: () => Promise<void>
  ): Promise<number | undefined> {
    const exit = vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Error(`exit ${String(code)}`);
    });
    const printed = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(chunk => {
        said.push(String(chunk));
        return true;
      });
    const logged = vi.spyOn(console, "error").mockImplementation(message => {
      said.push(String(message));
    });
    try {
      await fn();
      return undefined;
    } catch (error) {
      const match = /^exit (\d+)$/.exec((error as Error).message);
      if (match) return Number(match[1]);
      said.push(String(error));
      return -1;
    } finally {
      exit.mockRestore();
      printed.mockRestore();
      logged.mockRestore();
    }
  }

  /**
   * `migrate:create` with `name` over `collections`, accepting each rename it offers and consenting
   * to no loss of data; how it ended, and the files it wrote, by name.
   */
  async function create(
    name: string,
    collections: Collections
  ): Promise<{ code: number | undefined; said: string; files: string[] }> {
    const migrations = join(dir, "migrations");
    const before = new Set(sqlFilesIn(migrations));
    loaded.config = configOf(collections);
    setNonInteractive(true);
    const run = command();
    const code = await ran(run.said, () =>
      runMigrateCreate(name, { cwd: dir, acceptRenames: true }, run.context)
    );
    return {
      code,
      said: run.said.join("\n"),
      files: sqlFilesIn(migrations).filter(f => !before.has(f)),
    };
  }

  /** `migrate`, consenting to the drops it makes; it must apply every file. */
  async function applied(): Promise<void> {
    setNonInteractive(true);
    const run = command();
    expect(
      await ran(run.said, () =>
        runMigrate({ cwd: dir, acceptDataLoss: true }, run.context)
      ),
      run.said.join("\n")
    ).toBeUndefined();
  }

  /** What the files a run wrote do when applied, together: each one's UP, without its DOWN. */
  const textOf = (files: readonly string[]) =>
    files
      .map(
        f =>
          readFileSync(join(dir, "migrations", f), "utf-8").split(
            /^-- DOWN$/m
          )[0]
      )
      .join("\n");

  /** A rename of `from` to `to` in any file, quoted as each dialect quotes. */
  const renames = (from: string, to: string) =>
    new RegExp(`RENAME COLUMN [\`"]${from}[\`"] TO [\`"]${to}[\`"]`);

  describe.each(getConfiguredTestDialects())(
    `a field renamed in code (${layout} layout, %s)`,
    dialect => {
      for (const translated of [false, true]) {
        it(`renames ${translated ? "a translated" : "an untranslated"} collection's text field where its values are kept, every value kept`, async () => {
          const url = await openDatabase(dialect);
          await start(dialect, url);
          const first = await create(
            "create_notes",
            notes("heading", { translated })
          );
          expect(first.code, first.said).toBeUndefined();
          await applied();
          const app = await start(
            dialect,
            url,
            notes("heading", { translated })
          );
          const note = await app.nextly.create({
            collection: SLUG as never,
            data: { title: "N", heading: "Hello", note: "kept" } as never,
          });
          const id = String((note.item as { id: unknown }).id);
          if (translated) {
            await app.nextly.update({
              collection: SLUG,
              id,
              locale: "es",
              data: { heading: "Hola", _overwrite: true },
            } as never);
          }

          const renamed = await create(
            "rename_heading",
            notes("headline", { translated })
          );
          expect(renamed.code, renamed.said).toBeUndefined();
          // Wherever the values are kept, the main table or the translations table (in the file
          // the run writes beside the main one for it), the column is renamed, never dropped.
          const sql = textOf(renamed.files);
          expect(sql).toMatch(renames("heading", "headline"));
          expect(sql).not.toMatch(/DROP COLUMN [`"]heading[`"]/);
          await applied();

          const reread = await start(
            dialect,
            url,
            notes("headline", { translated })
          );
          const read = (await reread.nextly.findByID({
            collection: SLUG as never,
            id: id as never,
          })) as Record<string, unknown>;
          expect(read.headline).toBe("Hello");
          expect(read.note).toBe("kept");
          expect(read.heading).toBeUndefined();
          if (translated) {
            const spanish = (await reread.nextly.findByID({
              collection: SLUG,
              id,
              locale: "es",
            } as never)) as Record<string, unknown>;
            expect(spanish.headline).toBe("Hola");
          }
        });
      }

      // The case of this layout whose values are on the main table: a text field of an
      // untranslated collection on the earlier layout, a number field under per-language storage.
      const mainTableCase =
        layout === "earlier"
          ? {
              name: "earlier-text",
              before: notes("heading"),
              after: notes("headline"),
            }
          : {
              name: "per-language-number",
              before: counted("views"),
              after: counted("visits"),
            };
      it(`writes the files dev wrote for a rename kept on the main table (${mainTableCase.name})`, async () => {
        const url = await openDatabase(dialect);
        await start(dialect, url);
        const first = await create("create_notes", mainTableCase.before);
        expect(first.code, first.said).toBeUndefined();
        await applied();

        const renamed = await create("rename_field", mainTableCase.after);
        expect(renamed.code, renamed.said).toBeUndefined();

        const fixture = join(FIXTURES, mainTableCase.name, dialect);
        expect(comparable(join(dir, "migrations"), renamed.files)).toBe(
          comparable(fixture, sqlFilesIn(fixture))
        );
      });

      if (layout === "per-language") {
        /** The project dev's generator wrote: its files and its snapshot, applied. */
        const fromDev = async (): Promise<string> => {
          const source = join(FIXTURES, "snapshot-from-dev", dialect);
          expect(existsSync(source)).toBe(true);
          cpSync(source, join(dir, "migrations"), { recursive: true });
          const url = await openDatabase(dialect);
          await start(dialect, url);
          // The configuration the project was recorded with, which `nextly migrate` compares too.
          loaded.config = configOf(notes("heading"));
          await applied();
          return url;
        };

        it("writes nothing for a project dev's generator recorded, with nothing changed", async () => {
          await fromDev();
          const run = await create("nothing", notes("heading"));
          // "No changes": the command ends with success, having written nothing.
          expect(run.code ?? 0, run.said).toBe(0);
          expect(run.said).toMatch(/No changes detected/);
          expect(run.files).toEqual([]);
        });

        it("writes only an unrelated change for a project dev's generator recorded", async () => {
          const url = await fromDev();
          const app = await start(dialect, url, notes("heading"));
          const note = await app.nextly.create({
            collection: SLUG as never,
            data: { title: "N", heading: "Hello", note: "kept" } as never,
          });
          const id = String((note.item as { id: unknown }).id);

          const run = await create("add_views", counted("views"));
          expect(run.code, run.said).toBeUndefined();
          const sql = textOf(run.files);
          expect(sql).toMatch(/ADD (COLUMN )?[`"]views[`"]/);
          expect(sql).not.toMatch(/RENAME COLUMN/);
          expect(sql).not.toMatch(/DROP COLUMN/);
          await applied();

          const read = (await (
            await start(dialect, url, counted("views"))
          ).nextly.findByID({
            collection: SLUG as never,
            id: id as never,
          })) as Record<string, unknown>;
          expect(read.heading).toBe("Hello");
          expect(read.note).toBe("kept");
        });
      }
    }
  );
}
