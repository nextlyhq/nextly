/**
 * A text field renamed in an entity that is not translated, on per-language storage as every
 * installation runs it: the rename is offered on its translations table, and a container's column
 * there is no candidate for it.
 *
 * An earlier release let a repeater or group be marked `localized: true` and kept it whole on the
 * translations table, so its snapshot lists that column among the translated ones. The first run
 * here writes such a snapshot, from the definition that release took; the second has the mark
 * taken off, as configuration validation asks now, or the container removed.
 *
 * What tells a removed container's column from a text field's is the declaration the previous
 * snapshot holds of the entity. A snapshot may hold none (one taken by `migrate:baseline`, or
 * written before declarations were recorded): the rename is offered there.
 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import type { RenameCandidate } from "../../pipeline/pushschema-pipeline-interfaces";
import { generateMigration, type MinimalConfigEntity } from "../generate";

perLanguageStorageSuite();

const DIALECTS: SupportedDialect[] = ["sqlite", "postgresql", "mysql"];
const VIEWS = { name: "views", type: "number" };
const HEADING = { name: "heading", type: "text" };
const SLIDES = {
  name: "slides",
  type: "repeater",
  fields: [{ name: "caption", type: "text" }],
};

/** A collection that is not marked translatable, its declaration given where `declared`. */
const posts = (
  fields: MinimalConfigEntity["fields"],
  declared: boolean
): MinimalConfigEntity => ({
  slug: "posts",
  tableName: "dc_posts",
  fields,
  ...(declared
    ? {
        settings: {
          source: "code",
          settings: JSON.parse(
            JSON.stringify({ slug: "posts", fields })
          ) as NonNullable<MinimalConfigEntity["settings"]>["settings"],
        },
      }
    : {}),
});

describe.each(DIALECTS)(
  "a text field renamed in an untranslated entity with a container (%s)",
  dialect => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "nextly-untranslated-rename-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    /** What the last run was asked about, kept where the run was refused. */
    let lastAsked: string[] = [];

    /** The text between a pair of the dialect's identifier quotes. */
    const named = (name: string) => `[\`"]${name}[\`"]`;

    /** One run, which accepts every rename it is asked about. */
    async function run(
      step: number,
      fields: MinimalConfigEntity["fields"],
      declared = false
    ): Promise<{ asked: string[]; up: string }> {
      const asked: string[] = [];
      lastAsked = asked;
      const before = new Set(await readdir(dir));
      await generateMigration({
        name: `step_${step}`,
        dialect,
        migrationsDir: dir,
        defaultLocale: "en",
        collections: [posts(fields, declared)],
        singles: [],
        components: [],
        decideRenames: async (candidates: readonly RenameCandidate[]) => {
          asked.push(
            ...candidates.map(
              c => `${c.tableName}.${c.fromColumn}>${c.toColumn}`
            )
          );
          return candidates.map(candidate => ({ candidate, accepted: true }));
        },
        now: new Date(Date.UTC(2026, 10, 25, 12, step)),
      });
      const written = (await readdir(dir))
        .filter(name => name.endsWith(".sql") && !before.has(name))
        .sort();
      const texts = await Promise.all(
        written.map(name => readFile(resolve(dir, name), "utf-8"))
      );
      return {
        asked,
        up: texts.map(text => text.split("-- DOWN")[0]).join("\n"),
      };
    }

    /** The first run: a container kept whole per language, as an earlier release allowed. */
    async function earlierRelease(declared = false): Promise<void> {
      await run(1, [HEADING, VIEWS, { ...SLIDES, localized: true }], declared);
      const meta = resolve(dir, "meta");
      const [file] = await readdir(meta);
      const { snapshot, entities } = JSON.parse(
        await readFile(resolve(meta, file!), "utf-8")
      ) as {
        entities?: { collections: Record<string, unknown> };
        snapshot: {
          tables: {
            name: string;
            localizedColumns?: string[];
            overlayColumns?: string[];
          }[];
        };
      };
      const main = snapshot.tables.find(table => table.name === "dc_posts");
      // What these cases stand on: the container's column listed as a translated one.
      expect(main?.localizedColumns).toEqual(["heading", "slides"]);
      expect(main?.overlayColumns).toBeUndefined();
      expect(entities?.collections.posts !== undefined).toBe(declared);
    }

    it("offers no rename of the container's column to a text field added, and leaves it in place", async () => {
      await earlierRelease();

      const { asked, up } = await run(2, [
        HEADING,
        VIEWS,
        SLIDES,
        { name: "summary", type: "text" },
      ]);

      expect(asked).toEqual([]);
      expect(up).toMatch(
        new RegExp(
          `${named("dc_posts_locales")}[^;]*ADD (COLUMN )?${named("summary")}`
        )
      );
      expect(up).not.toMatch(/RENAME COLUMN/);
      expect(up).not.toMatch(
        new RegExp(
          `${named("dc_posts_locales")}[^;]*DROP (COLUMN )?${named("slides")}`
        )
      );
    });

    it("offers no rename of a removed container's column to a text field added, where the previous snapshot declares the container", async () => {
      await earlierRelease(true);

      const { asked, up } = await run(
        2,
        [HEADING, VIEWS, { name: "summary", type: "text" }],
        true
      );

      expect(asked).toEqual([]);
      expect(up).toMatch(
        new RegExp(
          `${named("dc_posts_locales")}[^;]*ADD (COLUMN )?${named("summary")}`
        )
      );
      expect(up).not.toMatch(/RENAME COLUMN/);
      expect(up).not.toMatch(
        new RegExp(
          `${named("dc_posts_locales")}[^;]*DROP (COLUMN )?${named("slides")}`
        )
      );
    });

    it("offers a text field's rename beside a removed container the previous snapshot declares", async () => {
      await earlierRelease(true);

      const { asked, up } = await run(
        2,
        [{ name: "headline", type: "text" }, VIEWS],
        true
      );

      expect(asked).toEqual(["dc_posts_locales.heading>headline"]);
      expect(up).toMatch(
        new RegExp(
          `${named("dc_posts_locales")}[^;]*RENAME COLUMN ${named("heading")} TO ${named("headline")}`
        )
      );
    });

    it("offers a removed container's column as a rename where the previous snapshot declares nothing, and refuses it where a file records the column", async () => {
      await earlierRelease();

      await expect(
        run(2, [HEADING, VIEWS, { name: "summary", type: "text" }])
      ).rejects.toThrow(/in the same change that renames it/);
      expect(lastAsked).toEqual(["dc_posts_locales.slides>summary"]);
    });

    it("offers and writes a text field's rename beside the container", async () => {
      await earlierRelease();

      const { asked, up } = await run(2, [
        { name: "headline", type: "text" },
        VIEWS,
        SLIDES,
      ]);

      expect(asked).toEqual(["dc_posts_locales.heading>headline"]);
      expect(up).toMatch(
        new RegExp(
          `${named("dc_posts_locales")}[^;]*RENAME COLUMN ${named("heading")} TO ${named("headline")}`
        )
      );
    });
  }
);
