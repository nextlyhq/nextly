/**
 * A text field renamed in an entity that is not translated, on per-language storage as every
 * installation runs it: the rename is offered on its translations table, and a container's column
 * there is no candidate for it.
 *
 * An earlier release let a repeater or group be marked `localized: true` and kept it whole on the
 * translations table, so its snapshot lists that column among the translated ones. The first run
 * here writes such a snapshot, from the definition that release took; the second has the mark
 * taken off, as configuration validation asks now.
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

/** A collection that is not marked translatable. */
const posts = (fields: MinimalConfigEntity["fields"]): MinimalConfigEntity => ({
  slug: "posts",
  tableName: "dc_posts",
  fields,
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

    /** The text between a pair of the dialect's identifier quotes. */
    const named = (name: string) => `[\`"]${name}[\`"]`;

    /** One run, which accepts every rename it is asked about. */
    async function run(
      step: number,
      fields: MinimalConfigEntity["fields"]
    ): Promise<{ asked: string[]; up: string }> {
      const asked: string[] = [];
      const before = new Set(await readdir(dir));
      await generateMigration({
        name: `step_${step}`,
        dialect,
        migrationsDir: dir,
        defaultLocale: "en",
        collections: [posts(fields)],
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
    async function earlierRelease(): Promise<void> {
      await run(1, [HEADING, VIEWS, { ...SLIDES, localized: true }]);
      const meta = resolve(dir, "meta");
      const [file] = await readdir(meta);
      const { snapshot } = JSON.parse(
        await readFile(resolve(meta, file!), "utf-8")
      ) as {
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
