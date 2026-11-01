/**
 * The upgrade from a database with image sizes, end to end, on every dialect
 * with a database in this run: the command removes the size files while the
 * column still says where they are, and then, asked with --drop, drops the
 * column and the table, only once no item names a size file and only where
 * each is shown to be what image sizes left. `nextly migrate`, from the
 * command or at startup, never drops either.
 *
 * The database is built as a fresh install builds it, then given what one
 * from before the removal still holds: the media table's `sizes` column and
 * the `image_sizes` table. The files are real ones on local disk, beside files
 * no media item names. Each step is asserted together with the state before
 * and after it, because each of these outcomes is also what a step that never
 * ran would leave: a column still present, a file still stored.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { sql, type SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  availableDialects,
  buildCurrentCoreSchema,
  type FreshDatabase,
  withFreshDatabase,
} from "../../../__tests__/helpers/fresh-database";
import {
  addRetiredImageSizes,
  retiredImageSizesTableDdl,
  retiredSizesColumnDdl,
  retiredSizesOn,
  runOn,
  setRetiredSizes,
} from "../../../__tests__/helpers/retired-image-sizes";
import { runRemoveSizes } from "../../../cli/commands/media";
import { previewRetiredImageSizes } from "../../../cli/commands/migrate";
import { ensureFirstRunSetup } from "../../../init/first-run";
import type { OwnerRecord } from "../../schema/ownership/owner-registry";
import { SchemaOwnersRepository } from "../../schema/ownership/schema-owners-repository";
import { reconcileCore } from "../../schema/migrate/core-reconcile";
import { LocalStorageAdapter } from "../../../storage/adapters/local-adapter";
import type { ReferencedNow } from "../orphan-thumbnails";
import {
  dropRetiredImageSizes,
  readRetiredObjects,
  storedSizesOf,
} from "../retired-image-sizes-store";

/** Every file under a folder, by its stored path. */
async function filesIn(folder: string): Promise<string[]> {
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter(entry => entry.isFile())
    .map(entry =>
      path
        .relative(folder, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    )
    .sort();
}

/** The media drizzle surface the inserts below need. */
interface Inserter {
  insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
}

/** A media item as the table holds it, through the dialect's own table. */
async function insertItem(
  fresh: FreshDatabase,
  id: string,
  original: { path: string; url: string },
  thumbnailUrl: string | null
): Promise<void> {
  await (fresh.db as Inserter).insert(fresh.tables.media).values({
    id,
    filename: original.path,
    originalFilename: path.basename(original.path),
    mimeType: "image/png",
    size: 1,
    url: original.url,
    thumbnailUrl,
    uploadedAt: new Date(),
    updatedAt: new Date(),
  });
}

/** Startup on an initialized database, with what it warned. */
async function bootWarnings(fresh: FreshDatabase): Promise<string[]> {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  await ensureFirstRunSetup({
    adapter: {
      dialect: fresh.dialect,
      getDrizzle: () => fresh.db,
      tableExists: async () => true,
      executeQuery: async () => undefined,
    },
    logger,
  });
  return logger.warn.mock.calls.map(([message]) => String(message));
}

/**
 * `nextly migrate`'s core reconcile, as a startup runs it, or, with `asked`,
 * with every drop and destructive flag the command can set, and the flag that
 * once dropped the retired column and table, which nothing reads now.
 */
async function migrate(fresh: FreshDatabase, asked = false): Promise<void> {
  const flags = asked
    ? {
        allowDestructive: true,
        dropRetiredAuthTables: true,
        allowDropNonEmptyRetired: true,
        dropRetiredImageSizes: true,
      }
    : {};
  await reconcileCore({
    db: fresh.db,
    dialect: fresh.dialect,
    logger: { info: () => {}, warn: () => {} },
    executeSql: statement => fresh.exec(statement),
    ...flags,
  });
}

/**
 * What items use now, as the command asks it just before each removal.
 * Answered as "none" here: this suite's subject is the dialects' reads,
 * writes and drops, and the check itself, over a real media table through
 * the adapter, is covered beside the command (media-remove-sizes.test.ts).
 */
const nothingUsedNow: ReferencedNow = async () => new Set();

/** `nextly media remove-sizes` with the given flags, and what it said. */
async function removeSizes(
  fresh: FreshDatabase,
  storage: LocalStorageAdapter,
  flags: { apply?: boolean; drop?: boolean }
): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await runRemoveSizes({
    db: fresh.db,
    dialect: fresh.dialect,
    storage,
    apply: flags.apply === true,
    drop: flags.drop === true,
    referencedNow: nothingUsedNow,
    executeSql: statement => fresh.exec(statement),
    say: line => lines.push(line),
  });
  return { code, lines };
}

/** Records a table, or one of its columns, as the app's in the owner registry. */
async function claimForApp(
  fresh: FreshDatabase,
  tableName: string,
  column?: string
): Promise<void> {
  const record: OwnerRecord = {
    tableName,
    ...(column === undefined
      ? {}
      : { elementKind: "column" as const, elementName: column }),
    ownerKind: "app",
    ownerId: "app",
    migratedBy: "app",
    ownerVersion: null,
    schemaVersion: null,
    state: "active",
  };
  await new SchemaOwnersRepository(fresh.db, fresh.dialect).upsert([record]);
}

/** A local-disk storage in a folder of the test's own. */
function localStorageIn(folder: string): LocalStorageAdapter {
  return new LocalStorageAdapter({ basePath: folder, baseUrl: "/uploads" });
}

/** What `nextly migrate --dry-run` says of the retired column and table. */
async function migrateDryRun(fresh: FreshDatabase): Promise<string[]> {
  const lines: string[] = [];
  await previewRetiredImageSizes(fresh.db, fresh.dialect, {
    info: line => lines.push(line),
  });
  return lines;
}

/**
 * The tables with a foreign key to `image_sizes`, read from each dialect's
 * own catalogue, by a query of the test's own rather than the product's.
 */
async function foreignKeysTo(fresh: FreshDatabase): Promise<string[]> {
  const statement =
    fresh.dialect === "postgresql"
      ? sql`SELECT conrelid::regclass::text AS name FROM pg_constraint WHERE contype = ${"f"} AND confrelid = ${"image_sizes"}::regclass`
      : fresh.dialect === "mysql"
        ? sql`SELECT DISTINCT TABLE_NAME AS name FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ${"image_sizes"}`
        : sql`SELECT ${"app_card_styles"} AS name FROM pragma_foreign_key_list(${"app_card_styles"}) WHERE "table" = ${"image_sizes"}`;
  let rows: Array<{ name: string }>;
  if (fresh.dialect === "sqlite") {
    rows = (fresh.db as { all(q: SQL): Array<{ name: string }> }).all(
      statement
    );
  } else {
    const raw = await (
      fresh.db as { execute(q: SQL): Promise<unknown> }
    ).execute(statement);
    rows = (
      Array.isArray(raw)
        ? Array.isArray(raw[0])
          ? raw[0]
          : raw
        : (raw as { rows: unknown[] }).rows
    ) as Array<{ name: string }>;
  }
  return rows.map(row => row.name).sort();
}

/** Whether the retired column and table are there. */
async function retired(fresh: FreshDatabase) {
  return {
    column: (await fresh.columnsOf("media")).includes("sizes"),
    table: (await fresh.columnsOf("image_sizes")).length > 0,
  };
}

describe.each(availableDialects())(
  "removing stored image sizes on upgrade (%s)",
  dialect => {
    it("a new install has neither the sizes column nor the image_sizes table", async () => {
      await withFreshDatabase(dialect, "nextly_sizes_fresh", async fresh => {
        await buildCurrentCoreSchema(fresh);

        expect(await fresh.columnsOf("media")).toContain("thumbnail_url");
        expect(await retired(fresh)).toEqual({ column: false, table: false });
        expect(await bootWarnings(fresh)).not.toEqual(
          expect.arrayContaining([expect.stringContaining("image sizes")])
        );
      });
    });

    it("removes the size files, then drops the column and table only when asked and nothing would be lost", async () => {
      const folder = await mkdtemp(path.join(tmpdir(), "nextly-sizes-up-"));
      try {
        await withFreshDatabase(dialect, "nextly_sizes_up", async fresh => {
          await buildCurrentCoreSchema(fresh);
          await addRetiredImageSizes(dialect, statement =>
            fresh.exec(statement)
          );
          const storage = localStorageIn(folder);
          const put = (name: string) =>
            storage.upload(Buffer.from(name), {
              filename: name,
              mimeType: "image/png",
              collection: "media",
            });

          // An item with its upload thumbnail and two sizes; an item whose
          // thumbnail is its `thumbnail` size; files no item names.
          const photo = await put("photo.png");
          const photoThumb = await put("photo-thumb.webp");
          const small = await put("photo-small.webp");
          const medium = await put("photo-medium.webp");
          const wide = await put("wide.png");
          const wideThumb = await put("wide-thumbnail.webp");
          const wideLarge = await put("wide-large.webp");
          await put("site-logo.png");
          await insertItem(fresh, "item-photo", photo, photoThumb.url);
          await insertItem(fresh, "item-wide", wide, wideThumb.url);
          await runOn(
            fresh.db,
            dialect,
            setRetiredSizes("item-photo", JSON.stringify({ small, medium }))
          );
          await runOn(
            fresh.db,
            dialect,
            setRetiredSizes(
              "item-wide",
              JSON.stringify({ thumbnail: wideThumb, large: wideLarge })
            )
          );
          const sizeFiles = [small.path, medium.path, wideLarge.path];
          const before = await filesIn(folder);

          // Startup names both and the steps, and changes nothing.
          const notice = (await bootWarnings(fresh)).find(message =>
            message.includes("image sizes")
          );
          expect(notice).toContain("media.sizes");
          expect(notice).toContain("image_sizes: 1 row");
          expect(notice).toContain("nextly media remove-sizes --apply --drop");
          expect(notice).toContain("`nextly migrate` never drops them");

          // `nextly migrate`, as a startup runs it and with every flag the
          // command sets, keeps both, and its dry run says so.
          const kept = [
            "  • would keep the retired column media.sizes and table image_sizes: `nextly migrate` never drops them. Once this release is serving, run `nextly media remove-sizes`, then `nextly media remove-sizes --apply --drop`.",
          ];
          expect(await migrateDryRun(fresh)).toEqual(kept);
          await migrate(fresh);
          await migrate(fresh, true);
          expect(await retired(fresh)).toEqual({ column: true, table: true });

          // The dry run lists and changes nothing, --drop included.
          const listed = await removeSizes(fresh, storage, { drop: true });
          expect(listed.code).toBe(0);
          for (const [file, name] of [
            [small.path, "small"],
            [medium.path, "medium"],
            [wideLarge.path, "large"],
          ]) {
            expect(listed.lines).toContain(`  remove ${file} (size "${name}")`);
          }
          expect(listed.lines.join("\n")).toContain(`keep   ${wideThumb.path}`);
          expect(listed.lines.join("\n")).toContain(
            "--drop drops nothing without --apply"
          );
          expect(await filesIn(folder)).toEqual(before);
          expect(await retired(fresh)).toEqual({ column: true, table: true });
          expect(
            await retiredSizesOn(fresh.db, dialect, "item-photo")
          ).not.toBeNull();

          // With --apply: exactly the size files go, every other file stays,
          // each item's sizes are cleared, and both are still there.
          expect(
            (await removeSizes(fresh, storage, { apply: true })).code
          ).toBe(0);
          expect(await filesIn(folder)).toEqual(
            before.filter(file => !sizeFiles.includes(file))
          );
          expect(await retiredSizesOn(fresh.db, dialect, "item-photo")).toBe(
            null
          );
          expect(await retiredSizesOn(fresh.db, dialect, "item-wide")).toBe(
            null
          );
          expect(await retired(fresh)).toEqual({ column: true, table: true });

          // With nothing left to lose, `nextly migrate` still drops neither.
          await migrate(fresh);
          await migrate(fresh, true);
          expect(await retired(fresh)).toEqual({ column: true, table: true });

          // --apply --drop drops both, keeping every media row and file.
          const dropped = await removeSizes(fresh, storage, {
            apply: true,
            drop: true,
          });
          expect(dropped.code).toBe(0);
          expect(dropped.lines).toEqual(
            expect.arrayContaining([
              "Dropped the `image_sizes` table (1 size definition nothing reads).",
              "Dropped the `media.sizes` column: no media item named a size file in it.",
            ])
          );
          expect(await retired(fresh)).toEqual({ column: false, table: false });
          const rows = (await (
            fresh.db as {
              select: () => { from: (t: unknown) => Promise<unknown[]> };
            }
          )
            .select()
            .from(fresh.tables.media)) as unknown[];
          expect(rows).toHaveLength(2);
          expect(await filesIn(folder)).toEqual(
            before.filter(file => !sizeFiles.includes(file))
          );

          // Startup is quiet, and every step is safe to run again.
          expect(
            (await bootWarnings(fresh)).filter(message =>
              message.includes("image sizes")
            )
          ).toEqual([]);
          const again = await removeSizes(fresh, storage, {
            apply: true,
            drop: true,
          });
          expect(again.code).toBe(0);
          expect(again.lines[0]).toContain("no sizes column");
          expect(again.lines).toContain(
            "Nothing to drop: neither the `sizes` column nor the `image_sizes` table is left."
          );
          expect(await migrateDryRun(fresh)).toEqual([]);
        });
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });

    it("drops nothing while an item still names a size file", async () => {
      await withFreshDatabase(dialect, "nextly_sizes_held", async fresh => {
        await buildCurrentCoreSchema(fresh);
        await addRetiredImageSizes(dialect, statement => fresh.exec(statement));
        await insertItem(
          fresh,
          "item-held",
          { path: "2026/10/a.png", url: "/uploads/2026/10/a.png" },
          null
        );
        await runOn(
          fresh.db,
          dialect,
          setRetiredSizes(
            "item-held",
            JSON.stringify({ small: { path: "2026/10/a-small.webp" } })
          )
        );
        const lines: string[] = [];

        const code = await dropRetiredImageSizes({
          db: fresh.db,
          dialect,
          executeSql: statement => fresh.exec(statement),
          say: line => lines.push(line),
        });

        expect(code).toBe(1);
        expect(lines.join("\n")).toContain(
          "Dropped nothing: 1 item still names its image size files"
        );
        expect(await retired(fresh)).toEqual({ column: true, table: true });
        expect(await retiredSizesOn(fresh.db, dialect, "item-held")).toEqual({
          small: { path: "2026/10/a-small.webp" },
        });
      });
    });

    it("never reads or drops a sizes column or an image_sizes table an app owns", async () => {
      const folder = await mkdtemp(path.join(tmpdir(), "nextly-sizes-app-"));
      try {
        await withFreshDatabase(dialect, "nextly_sizes_app", async fresh => {
          await buildCurrentCoreSchema(fresh);
          // The very shape image sizes left, recorded as the app's own.
          await addRetiredImageSizes(dialect, statement =>
            fresh.exec(statement)
          );
          await claimForApp(fresh, "media", "sizes");
          await claimForApp(fresh, "image_sizes");
          const storage = localStorageIn(folder);
          const report = await storage.upload(Buffer.from("r"), {
            filename: "report.pdf",
            mimeType: "application/pdf",
            collection: "media",
          });
          await insertItem(fresh, "item-app", report, null);
          // The app's own value, whose `path` names a stored file.
          const value = { invoice: { path: report.path, url: report.url } };
          await runOn(
            fresh.db,
            dialect,
            setRetiredSizes("item-app", JSON.stringify(value))
          );
          const before = await filesIn(folder);

          expect(await readRetiredObjects(fresh.db, dialect)).toEqual({
            column: false,
            tableRows: null,
            keptTable: 'nextly_schema_owners records it as app "app"\'s',
          });
          expect(await storedSizesOf(fresh.db, dialect, ["item-app"])).toEqual(
            new Map()
          );

          const run = await removeSizes(fresh, storage, {
            apply: true,
            drop: true,
          });

          expect(run.code).toBe(1);
          expect(run.lines[0]).toContain("no sizes column");
          expect(run.lines.join("\n")).toContain(
            "Kept the `image_sizes` table: nextly_schema_owners records it as app"
          );
          expect(await retired(fresh)).toEqual({ column: true, table: true });
          expect(await retiredSizesOn(fresh.db, dialect, "item-app")).toEqual(
            value
          );
          expect(await filesIn(folder)).toEqual(before);
          expect(
            (await bootWarnings(fresh)).filter(message =>
              message.includes("image sizes")
            )
          ).toEqual([]);
        });
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });

    it("keeps an image_sizes table that is not exactly the one Nextly created, and names it", async () => {
      await withFreshDatabase(dialect, "nextly_sizes_shape", async fresh => {
        await buildCurrentCoreSchema(fresh);
        await addRetiredImageSizes(dialect, statement => fresh.exec(statement));
        const q = dialect === "mysql" ? "`" : '"';
        await fresh.exec(
          `ALTER TABLE ${q}image_sizes${q} ADD COLUMN ${q}tenant${q} ${dialect === "mysql" ? "varchar(50)" : "text"}`
        );
        const lines: string[] = [];

        const code = await dropRetiredImageSizes({
          db: fresh.db,
          dialect,
          executeSql: statement => fresh.exec(statement),
          say: line => lines.push(line),
        });

        expect(code).toBe(1);
        expect(lines).toContain(
          "Kept the `image_sizes` table: its columns are not exactly the ones Nextly created it with. Check it, and drop it yourself if it is the one image sizes left."
        );
        expect(await retired(fresh)).toEqual({ column: false, table: true });
      });
    });

    it("never reads or drops a sizes column of another type than Nextly gave it", async () => {
      const folder = await mkdtemp(path.join(tmpdir(), "nextly-sizes-type-"));
      try {
        await withFreshDatabase(dialect, "nextly_sizes_type", async fresh => {
          await buildCurrentCoreSchema(fresh);
          // No owner record: only the type tells it from the retired column.
          const q = dialect === "mysql" ? "`" : '"';
          await fresh.exec(
            `ALTER TABLE ${q}media${q} ADD COLUMN ${q}sizes${q} varchar(255)`
          );
          const storage = localStorageIn(folder);
          const report = await storage.upload(Buffer.from("r"), {
            filename: "report.pdf",
            mimeType: "application/pdf",
            collection: "media",
          });
          await insertItem(fresh, "item-typed", report, null);
          const value = { invoice: { path: report.path, url: report.url } };
          await runOn(
            fresh.db,
            dialect,
            setRetiredSizes("item-typed", JSON.stringify(value))
          );
          const before = await filesIn(folder);

          const run = await removeSizes(fresh, storage, {
            apply: true,
            drop: true,
          });

          expect(run.code).toBe(0);
          expect(run.lines[0]).toContain("no sizes column");
          expect(await retired(fresh)).toEqual({ column: true, table: false });
          expect(await retiredSizesOn(fresh.db, dialect, "item-typed")).toEqual(
            value
          );
          expect(await filesIn(folder)).toEqual(before);
        });
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });

    it("keeps an image_sizes table of exactly that shape where the media table has no sizes column beside it", async () => {
      await withFreshDatabase(dialect, "nextly_sizes_lone", async fresh => {
        await buildCurrentCoreSchema(fresh);
        // A table an app created under that name and shape, on a database
        // image sizes never reached: nothing of Nextly's is beside it.
        for (const statement of await retiredImageSizesTableDdl(dialect)) {
          await fresh.exec(statement);
        }
        const lines: string[] = [];

        const code = await dropRetiredImageSizes({
          db: fresh.db,
          dialect,
          executeSql: statement => fresh.exec(statement),
          say: line => lines.push(line),
        });

        expect(code).toBe(1);
        expect(lines.join("\n")).toContain(
          "Kept the `image_sizes` table: the media table no longer has the `sizes` column Nextly created beside it"
        );
        expect(await retired(fresh)).toEqual({ column: false, table: true });
      });
    });

    it("drops nothing while another table has a foreign key to image_sizes, and names it", async () => {
      await withFreshDatabase(dialect, "nextly_sizes_fk", async fresh => {
        await buildCurrentCoreSchema(fresh);
        await addRetiredImageSizes(dialect, statement => fresh.exec(statement));
        // An app table that points at a size definition, as one could while
        // the table was published.
        const q = dialect === "mysql" ? "`" : '"';
        const key = dialect === "mysql" ? "varchar(36)" : "text";
        await fresh.exec(
          `CREATE TABLE ${q}app_card_styles${q} (${q}id${q} ${key} PRIMARY KEY, ${q}size_id${q} ${key}, CONSTRAINT ${q}app_card_styles_size_fk${q} FOREIGN KEY (${q}size_id${q}) REFERENCES ${q}image_sizes${q} (${q}id${q}))`
        );
        await fresh.exec(
          `INSERT INTO ${q}app_card_styles${q} (${q}id${q}, ${q}size_id${q}) VALUES ('style-1', 'size-card')`
        );
        const lines: string[] = [];

        const code = await dropRetiredImageSizes({
          db: fresh.db,
          dialect,
          executeSql: statement => fresh.exec(statement),
          say: line => lines.push(line),
        });

        expect(code).toBe(1);
        expect(lines.join("\n")).toContain(
          "Dropped nothing: the `image_sizes` table has foreign keys from other tables"
        );
        expect(lines.join("\n")).toContain("app_card_styles");
        // Both kept: the column is what shows the table is Nextly's on the
        // next run, once the foreign key is gone.
        expect(await retired(fresh)).toEqual({ column: true, table: true });
        expect(await foreignKeysTo(fresh)).toEqual(["app_card_styles"]);
      });
    });

    it("has `nextly migrate --dry-run` name exactly what is there", async () => {
      await withFreshDatabase(dialect, "nextly_sizes_preview", async fresh => {
        await buildCurrentCoreSchema(fresh);
        const next =
          "Once this release is serving, run `nextly media remove-sizes`, then `nextly media remove-sizes --apply --drop`.";

        // A table of that name and shape with nothing of Nextly's beside it:
        // not the retired one, and never called so.
        for (const statement of await retiredImageSizesTableDdl(dialect)) {
          await fresh.exec(statement);
        }
        expect(await migrateDryRun(fresh)).toEqual([
          "  • would keep the table image_sizes, which is not shown to be the one image sizes left (the media table no longer has the `sizes` column Nextly created beside it, so nothing shows Nextly made this table): nothing drops it.",
        ]);

        // With the column beside it, both are the retired ones.
        await fresh.exec(retiredSizesColumnDdl(dialect));
        expect(await migrateDryRun(fresh)).toEqual([
          `  • would keep the retired column media.sizes and table image_sizes: \`nextly migrate\` never drops them. ${next}`,
        ]);

        // The column alone, as a drop that stopped after the table leaves it.
        const q = dialect === "mysql" ? "`" : '"';
        await fresh.exec(`DROP TABLE ${q}image_sizes${q}`);
        expect(await migrateDryRun(fresh)).toEqual([
          `  • would keep the retired column media.sizes: \`nextly migrate\` never drops it. ${next}`,
        ]);
      });
    });

    it("keeps the sizes column through a core change, with every item's sizes intact", async () => {
      await withFreshDatabase(dialect, "nextly_sizes_keep", async fresh => {
        await buildCurrentCoreSchema(fresh);
        await addRetiredImageSizes(dialect, statement => fresh.exec(statement));
        await insertItem(
          fresh,
          "item-kept",
          { path: "2026/10/a.png", url: "/uploads/2026/10/a.png" },
          null
        );
        const sizes = { small: { path: "2026/10/a-small.webp" } };
        await runOn(
          fresh.db,
          dialect,
          setRetiredSizes("item-kept", JSON.stringify(sizes))
        );
        // An index of the media table missing, so the reconcile has a change
        // to apply to that very table and runs the push, which must plan
        // nothing against the kept column.
        // One no foreign key needs, which MySQL refuses to drop.
        const index = "media_mime_type_idx";
        expect(await fresh.indexesOf("media")).toContain(index);
        await fresh.exec(
          dialect === "mysql"
            ? `DROP INDEX \`${index}\` ON \`media\``
            : `DROP INDEX "${index}"`
        );

        await migrate(fresh);

        expect(await fresh.indexesOf("media")).toContain(index);
        expect(await retiredSizesOn(fresh.db, dialect, "item-kept")).toEqual(
          sizes
        );
      });
    });
  }
);
