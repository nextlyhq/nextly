/**
 * `nextly migrate` refuses, before any file applies, a pending file that turns translation on
 * where the main column whose values it moves has a definition of its own (a comment, or on SQLite
 * a collation named in the table's statement), which the companion column created for them would
 * not have. The file's header says what it moves; the database says what the column has.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { migrateCore } from "../../../cli/commands/migrate";
import { createLogger } from "../../../cli/utils/logger";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  NO_CONSENT,
  resolveDataLossConsent,
} from "../../schema/migrate/data-loss-consent";
import {
  generateMigration,
  type MinimalConfigEntity,
} from "../../schema/migrate-create/generate";
import { ensureCompanionTable } from "../runtime/companion-io";

let current: TestNextly | undefined;
let dir: string | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

/** `mkd_docs` with a text `heading`, translated or not. */
const docs = (localized: boolean): MinimalConfigEntity => ({
  slug: "mkd_docs",
  tableName: "dc_mkd_docs",
  localized,
  fields: [
    { name: "heading", type: "text", localized },
    { name: "views", type: "number" },
  ],
});

describe.each(getConfiguredTestDialects())(
  "nextly migrate over a column with a definition of its own (%s)",
  dialect => {
    const q = (id: string) => (dialect === "mysql" ? `\`${id}\`` : `"${id}"`);

    it("refuses the file turning translation on before any file applies", async () => {
      current = await createTestNextly({ dialect });
      const adapter = current.adapter as unknown as DrizzleAdapter;
      const query = (statement: string) => adapter.executeQuery(statement);
      dir = await mkdtemp(join(tmpdir(), "nextly-definition-loss-"));
      const migrationsDir = dir;
      const generate = (
        entity: MinimalConfigEntity,
        name: string,
        at: string
      ) =>
        generateMigration({
          name,
          dialect,
          migrationsDir,
          defaultLocale: "en",
          collections: [entity],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date(at),
        });
      const sqlFiles = async () =>
        (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"));
      const migrate = (step?: number) =>
        migrateCore({
          ...(step === undefined ? {} : { step }),
          extensionSchema: undefined,
          dialect,
          db: adapter.getDrizzle(),
          adapter: adapter as never,
          migrationsDir,
          logger: createLogger({ quiet: true }),
          lockMode: "fail-fast",
          consent: NO_CONSENT,
          interactive: false,
        } as never);

      await generate(docs(false), "one", "2026-11-13T10:00:00.000Z");
      const first = (await sqlFiles()).length;
      await generate(docs(true), "two", "2026-11-13T11:00:00.000Z");
      expect(
        (await sqlFiles()).some(f => /enable_localization_mkd_docs/.test(f))
      ).toBe(true);

      await migrate(first);
      // The main column as a database may have it, with a definition of its own.
      if (dialect === "sqlite") {
        await query(
          `ALTER TABLE ${q("dc_mkd_docs")} ADD COLUMN ${q("note")} TEXT COLLATE NOCASE`
        );
      } else if (dialect === "mysql") {
        await query(
          `ALTER TABLE ${q("dc_mkd_docs")} MODIFY COLUMN ${q("heading")} VARCHAR(255) NULL COMMENT 'kept'`
        );
      } else {
        await query(
          `COMMENT ON COLUMN ${q("dc_mkd_docs")}.${q("heading")} IS 'kept'`
        );
      }

      const refused = await migrate().then(
        () => undefined,
        (error: unknown) => error
      );

      expect(refused).toBeInstanceOf(Error);
      expect(
        JSON.stringify(
          (refused as { publicData?: unknown }).publicData ?? refused
        )
      ).toMatch(
        dialect === "sqlite"
          ? /TRANSLATION_MOVE_LOSES_COLUMN_DEFINITION.*own collation/
          : /TRANSLATION_MOVE_LOSES_COLUMN_DEFINITION.*own comment/
      );
      // No file of the run applied: the column and its values are where they were.
      const [row] = (await query(
        `SELECT COUNT(*) AS n FROM ${q("dc_mkd_docs")} WHERE ${q("heading")} IS NULL OR ${q("heading")} IS NOT NULL`
      )) as unknown as { n: unknown }[];
      expect(row).toBeDefined();
    });

    // SQLite cannot give an existing column a default without rebuilding its table.
    it.skipIf(dialect === "sqlite")(
      "refuses the file turning translation off where the companion column has a default the file does not restore",
      async () => {
        current = await createTestNextly({ dialect });
        const adapter = current.adapter as unknown as DrizzleAdapter;
        const query = (statement: string) => adapter.executeQuery(statement);
        dir = await mkdtemp(join(tmpdir(), "nextly-definition-loss-"));
        const migrationsDir = dir;
        const generate = (
          entity: MinimalConfigEntity,
          name: string,
          at: string
        ) =>
          generateMigration({
            name,
            dialect,
            migrationsDir,
            defaultLocale: "en",
            collections: [entity],
            singles: [],
            components: [],
            nonInteractive: true,
            now: new Date(at),
          });
        const sqlFiles = async () =>
          (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"));
        // Turning translation off drops the translations table, a deletion the deploy names, so
        // the only refusal left is the one judged here.
        const migrate = (step?: number) =>
          migrateCore({
            ...(step === undefined ? {} : { step }),
            extensionSchema: undefined,
            dialect,
            db: adapter.getDrizzle(),
            adapter: adapter as never,
            migrationsDir,
            logger: createLogger({ quiet: true }),
            lockMode: "fail-fast",
            consent: resolveDataLossConsent({
              flag: "dc_mkd_docs_locales",
              env: {},
            }),
            interactive: false,
          } as never);

        await generate(docs(true), "one", "2026-11-13T10:00:00.000Z");
        const first = (await sqlFiles()).length;
        await generate(docs(false), "two", "2026-11-13T11:00:00.000Z");
        expect(
          (await sqlFiles()).some(f => /disable_localization_mkd_docs/.test(f))
        ).toBe(true);

        await migrate(first);
        // The companion column as a database may have it, with a default the file's restored main
        // column would not take.
        await query(
          dialect === "mysql"
            ? `ALTER TABLE ${q("dc_mkd_docs_locales")} MODIFY COLUMN ${q("heading")} VARCHAR(255) NULL DEFAULT 'none'`
            : `ALTER TABLE ${q("dc_mkd_docs_locales")} ALTER COLUMN ${q("heading")} SET DEFAULT 'none'`
        );

        const refused = await migrate().then(
          () => undefined,
          (error: unknown) => error
        );

        expect(refused).toBeInstanceOf(Error);
        expect(
          JSON.stringify(
            (refused as { publicData?: unknown }).publicData ?? refused
          )
        ).toMatch(/TRANSLATION_MOVE_LOSES_COLUMN_DEFINITION.*own default/);
        // No file of the run applied: the translations table is still there.
        await expect(
          query(`SELECT 1 FROM ${q("dc_mkd_docs_locales")}`)
        ).resolves.toBeDefined();
      }
    );

    // SQLite cannot give an existing column a default without rebuilding its table.
    it.skipIf(dialect === "sqlite")(
      "judges a file turning translation off after one in the same run turning it on, by the column that one moves",
      async () => {
        current = await createTestNextly({ dialect });
        const adapter = current.adapter as unknown as DrizzleAdapter;
        const query = (statement: string) => adapter.executeQuery(statement);
        dir = await mkdtemp(join(tmpdir(), "nextly-definition-loss-"));
        const migrationsDir = dir;
        const generate = (
          entity: MinimalConfigEntity,
          name: string,
          at: string
        ) =>
          generateMigration({
            name,
            dialect,
            migrationsDir,
            defaultLocale: "en",
            collections: [entity],
            singles: [],
            components: [],
            nonInteractive: true,
            now: new Date(at),
          });
        const sqlFiles = async () =>
          (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"));
        const migrate = (step?: number) =>
          migrateCore({
            ...(step === undefined ? {} : { step }),
            extensionSchema: undefined,
            dialect,
            db: adapter.getDrizzle(),
            adapter: adapter as never,
            migrationsDir,
            logger: createLogger({ quiet: true }),
            lockMode: "fail-fast",
            consent: resolveDataLossConsent({
              flag: "dc_mkd_docs_locales",
              env: {},
            }),
            interactive: false,
          } as never);

        await generate(docs(false), "one", "2026-11-13T10:00:00.000Z");
        const first = (await sqlFiles()).length;
        await generate(docs(true), "two", "2026-11-13T11:00:00.000Z");
        await generate(docs(false), "three", "2026-11-13T12:00:00.000Z");
        expect(
          (await sqlFiles()).filter(f =>
            /(enable|disable)_localization_mkd_docs/.test(f)
          )
        ).toHaveLength(2);

        await migrate(first);
        // The main column, with a default its snapshot does not know: the file turning
        // translation on carries it into the companion, and the one turning it off would not
        // restore it.
        await query(
          dialect === "mysql"
            ? `ALTER TABLE ${q("dc_mkd_docs")} MODIFY COLUMN ${q("heading")} VARCHAR(255) NULL DEFAULT 'none'`
            : `ALTER TABLE ${q("dc_mkd_docs")} ALTER COLUMN ${q("heading")} SET DEFAULT 'none'`
        );

        const refused = await migrate().then(
          () => undefined,
          (error: unknown) => error
        );

        expect(refused).toBeInstanceOf(Error);
        expect(
          JSON.stringify(
            (refused as { publicData?: unknown }).publicData ?? refused
          )
        ).toMatch(/TRANSLATION_MOVE_LOSES_COLUMN_DEFINITION.*own default/);
      }
    );

    /**
     * A folder holding `entity` shared, then translated, with the first run's files applied; the
     * companion made as a development start or `db:sync` makes it, before the file turning
     * translation on runs.
     */
    async function enableOverRuntimeCompanion(
      entity: (localized: boolean) => MinimalConfigEntity
    ) {
      current = await createTestNextly({ dialect });
      const adapter = current.adapter as unknown as DrizzleAdapter;
      dir = await mkdtemp(join(tmpdir(), "nextly-definition-loss-"));
      const migrationsDir = dir;
      const generate = (localized: boolean, name: string, at: string) =>
        generateMigration({
          name,
          dialect,
          migrationsDir,
          defaultLocale: "en",
          collections: [entity(localized)],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date(at),
        });
      const sqlFiles = async () =>
        (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"));
      const migrate = (step?: number, consent = NO_CONSENT) =>
        migrateCore({
          ...(step === undefined ? {} : { step }),
          extensionSchema: undefined,
          dialect,
          db: adapter.getDrizzle(),
          adapter: adapter as never,
          migrationsDir,
          logger: createLogger({ quiet: true }),
          lockMode: "fail-fast",
          consent,
          interactive: false,
        } as never);
      await generate(false, "one", "2026-11-13T10:00:00.000Z");
      const first = (await sqlFiles()).length;
      await generate(true, "two", "2026-11-13T11:00:00.000Z");
      await migrate(first);
      const translated = entity(true);
      expect(
        await ensureCompanionTable(
          adapter as unknown as Parameters<typeof ensureCompanionTable>[0],
          {
            builtBy: "codeFirst",
            slug: translated.slug,
            tableName: translated.tableName,
            fields: translated.fields as never,
            dialect,
            sourceLocale: "en",
          }
        )
      ).toBe(true);
      return {
        query: (statement: string) => adapter.executeQuery(statement),
        migrate,
      };
    }

    // SQLite cannot give an existing column a default without rebuilding its table.
    it.skipIf(dialect === "sqlite")(
      "refuses a file turning translation on over a companion already there without the main column's default",
      async () => {
        const { query, migrate } = await enableOverRuntimeCompanion(docs);
        // The main column given a default after its companion column was made.
        await query(
          dialect === "mysql"
            ? `ALTER TABLE ${q("dc_mkd_docs")} MODIFY COLUMN ${q("heading")} VARCHAR(255) NULL DEFAULT 'none'`
            : `ALTER TABLE ${q("dc_mkd_docs")} ALTER COLUMN ${q("heading")} SET DEFAULT 'none'`
        );

        const refused = await migrate().then(
          () => undefined,
          (error: unknown) => error
        );

        expect(
          JSON.stringify(
            (refused as { publicData?: unknown } | undefined)?.publicData ??
              refused
          )
        ).toMatch(/TRANSLATION_MOVE_LOSES_COLUMN_DEFINITION.*own default/);
      }
    );

    // The companion a development start makes spells some types otherwise than the main table
    // (PostgreSQL's TIMESTAMPTZ beside timestamp, BOOLEAN beside bool), which hold each other's
    // values: an ordinary file turning translation on over it is not refused for them.
    it.runIf(dialect === "postgresql")(
      "does not refuse an ordinary file turning translation on over a companion a development start made",
      async () => {
        const typed = (localized: boolean): MinimalConfigEntity => ({
          slug: "mkd_typed",
          tableName: "dc_mkd_typed",
          localized,
          fields: [
            { name: "published", type: "date", localized },
            { name: "featured", type: "checkbox", localized },
            {
              name: "score",
              type: "number",
              options: { format: "float" },
              localized,
            },
          ],
        });
        const { migrate } = await enableOverRuntimeCompanion(typed);

        // The data-loss judgement reads the main columns' drop as a loss, since the companion is
        // already there; consenting to it leaves the definition check alone to decide.
        const outcome = await migrate(
          undefined,
          resolveDataLossConsent({ flag: "dc_mkd_typed", env: {} })
        ).then(
          () => "applied",
          (error: unknown) => error
        );

        expect(outcome).toBe("applied");
      }
    );

    // An existing receiving column is judged as it is, not by its table's defaults.
    it.runIf(dialect === "postgresql")(
      "refuses a file turning translation on over a companion column whose collation was changed by hand",
      async () => {
        const { query, migrate } = await enableOverRuntimeCompanion(docs);
        await query(
          `ALTER TABLE ${q("dc_mkd_docs_locales")} ALTER COLUMN ${q("heading")} TYPE text COLLATE "C"`
        );

        const refused = await migrate().then(
          () => undefined,
          (error: unknown) => error
        );

        expect(
          JSON.stringify(
            (refused as { publicData?: unknown } | undefined)?.publicData ??
              refused
          )
        ).toMatch(/TRANSLATION_MOVE_LOSES_COLUMN_DEFINITION.*own collation/);
      }
    );

    it.runIf(dialect === "postgresql")(
      "does not refuse a file turning translation on over a companion column that already has the main column's collation",
      async () => {
        const { query, migrate } = await enableOverRuntimeCompanion(docs);
        for (const table of ["dc_mkd_docs", "dc_mkd_docs_locales"]) {
          await query(
            `ALTER TABLE ${q(table)} ALTER COLUMN ${q("heading")} TYPE text COLLATE "C"`
          );
        }

        // Consent to the drop the data-loss judgement reads, as above.
        const outcome = await migrate(
          undefined,
          resolveDataLossConsent({ flag: "dc_mkd_docs", env: {} })
        ).then(
          () => "applied",
          (error: unknown) => error
        );

        expect(outcome).toBe("applied");
      }
    );
  }
);
