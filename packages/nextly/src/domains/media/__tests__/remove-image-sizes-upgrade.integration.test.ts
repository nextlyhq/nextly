/**
 * The upgrade from a database with image sizes, end to end, on every dialect
 * with a database in this run: the command removes the size files while the
 * column still says where they are, and `nextly migrate` drops the column and
 * the table only once no item names a size file.
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

import { describe, expect, it, vi } from "vitest";

import {
  availableDialects,
  buildCurrentCoreSchema,
  type FreshDatabase,
  withFreshDatabase,
} from "../../../__tests__/helpers/fresh-database";
import {
  addRetiredImageSizes,
  retiredSizesOn,
  runOn,
  setRetiredSizes,
} from "../../../__tests__/helpers/retired-image-sizes";
import { runRemoveSizes } from "../../../cli/commands/media";
import { ensureFirstRunSetup } from "../../../init/first-run";
import { reconcileCore } from "../../schema/migrate/core-reconcile";
import { LocalStorageAdapter } from "../../../storage/adapters/local-adapter";

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

/** `nextly migrate`'s core reconcile, as the command or a startup runs it. */
async function migrate(
  fresh: FreshDatabase,
  asked: boolean
): Promise<string[]> {
  const warn = vi.fn();
  await reconcileCore({
    db: fresh.db,
    dialect: fresh.dialect,
    logger: { info: () => {}, warn },
    executeSql: statement => fresh.exec(statement),
    ...(asked ? { dropRetiredImageSizes: true } : {}),
  });
  return warn.mock.calls.map(([message]) => String(message));
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

    it("removes the size files, then drops the column and table only once nothing would be lost", async () => {
      const folder = await mkdtemp(path.join(tmpdir(), "nextly-sizes-up-"));
      try {
        await withFreshDatabase(dialect, "nextly_sizes_up", async fresh => {
          await buildCurrentCoreSchema(fresh);
          await addRetiredImageSizes(dialect, statement =>
            fresh.exec(statement)
          );
          const storage = new LocalStorageAdapter({
            basePath: folder,
            baseUrl: "/uploads",
          });
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

          // Startup names both and the two steps, and changes nothing.
          const notice = (await bootWarnings(fresh)).find(message =>
            message.includes("image sizes")
          );
          expect(notice).toContain("media.sizes");
          expect(notice).toContain("image_sizes: 1 row");
          expect(notice).toContain("nextly media remove-sizes");
          expect(notice).toContain("`nextly migrate`");

          // `nextly migrate` keeps both while items name size files.
          const refused = await migrate(fresh, true);
          expect(refused.join("\n")).toContain(
            "2 items still name their image size files"
          );
          expect(refused.join("\n")).toContain("nextly media remove-sizes");
          expect(await retired(fresh)).toEqual({ column: true, table: true });

          // The dry run lists and changes nothing.
          const listed: string[] = [];
          expect(
            await runRemoveSizes({
              db: fresh.db,
              dialect,
              storage,
              apply: false,
              say: line => listed.push(line),
            })
          ).toBe(0);
          for (const file of sizeFiles) {
            expect(listed).toContain(
              `  remove ${file} (size "${
                file === small.path
                  ? "small"
                  : file === medium.path
                    ? "medium"
                    : "large"
              }")`
            );
          }
          expect(listed.join("\n")).toContain(`keep   ${wideThumb.path}`);
          expect(await filesIn(folder)).toEqual(before);
          expect(
            await retiredSizesOn(fresh.db, dialect, "item-photo")
          ).not.toBeNull();

          // With --apply: exactly the size files go, every other file stays,
          // and each item's sizes are cleared.
          expect(
            await runRemoveSizes({
              db: fresh.db,
              dialect,
              storage,
              apply: true,
              say: () => {},
            })
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

          // A startup's migration never drops them, even with nothing left.
          await migrate(fresh, false);
          expect(await retired(fresh)).toEqual({ column: true, table: true });

          // `nextly migrate` now drops both, keeping every media row.
          await migrate(fresh, true);
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
          const again: string[] = [];
          expect(
            await runRemoveSizes({
              db: fresh.db,
              dialect,
              storage,
              apply: true,
              say: line => again.push(line),
            })
          ).toBe(0);
          expect(again[0]).toContain("no sizes column");
          await migrate(fresh, true);
          expect(await retired(fresh)).toEqual({ column: false, table: false });
        });
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
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
        // A core table missing, so the reconcile has a change to apply and
        // runs the push, which must plan nothing against the kept column.
        await fresh.exec(
          dialect === "mysql"
            ? "DROP TABLE `nextly_meta`"
            : 'DROP TABLE "nextly_meta"'
        );

        await migrate(fresh, false);

        expect(await fresh.columnsOf("nextly_meta")).not.toEqual([]);
        expect(await retiredSizesOn(fresh.db, dialect, "item-kept")).toEqual(
          sizes
        );
      });
    });
  }
);
