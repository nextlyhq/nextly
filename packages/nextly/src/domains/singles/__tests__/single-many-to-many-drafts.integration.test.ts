/**
 * A Draft/Published Builder Single's many-to-many keeps its links through a held edit, its
 * publish and a version restore, on every dialect.
 *
 * A save that names no status on a published Single is held as its working draft: the live row and
 * its junction stay as published, and the draft holds the document the edit makes, links included.
 * A publish then writes the draft's links into the junction, and a version restored is held and
 * published the same way. The links are read from the junction by the name its create made, spelled
 * out as the first many-to-many test spells it.
 *
 * The same for a translated Single whose many-to-many is translated: its junction keeps no language.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { registerFieldFunctions } from "../../../shared/lib/field-level-registry";
import { restoreVersion } from "../../versions/restore-version";

// Slugs prefixed for this file (`smd_`), so the tables it owns are its own.
const HERO = "smd_hero";
const TAGS = "smd_tags";
const TABLE = `single_${HERO}`;
const JUNCTION = `dc_${TAGS}_${TABLE}_tags`;
const SOURCE_COLUMN = `${TABLE}_id`;
const TARGET_COLUMN = `${TAGS}_id`;

/** An untranslated Single, and a translated one whose many-to-many is translated. */
const SHAPES = [
  {
    name: "a Draft/Published Builder Single's many-to-many links",
    translated: false,
  },
  {
    name: "a translated Draft/Published Builder Single's translated many-to-many links",
    translated: true,
  },
] as const;

interface VersionRow {
  scopeSlug: string;
  entryId: string;
  versionNo: number | null;
  isAutosave: boolean | number;
  snapshot: unknown;
}

for (const shape of SHAPES)
  describeEachDialect(shape.name, dialect => {
    let t: TestNextly;
    let tagIds: string[];

    beforeEach(async () => {
      // The Builder's create runs its migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: TAGS, fields: [text({ name: "name" })] }),
        ],
        ...(shape.translated
          ? { localization: { locales: ["en", "es"], defaultLocale: "en" } }
          : {}),
      });
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: HERO,
          label: "Hero",
          // Draft/Published, with every save kept as a version.
          status: true,
          versions: true,
          ...(shape.translated ? { localized: true } : {}),
          fields: [
            { name: "title", type: "text" },
            {
              name: "tags",
              type: "relationship",
              ...(shape.translated ? { localized: true } : {}),
              options: { relationType: "manyToMany", target: TAGS },
            },
          ],
        }
      );
      tagIds = [];
      for (const name of ["a", "b", "c"]) {
        const created = await t.nextly.create({
          collection: TAGS,
          data: { name },
        });
        tagIds.push(String(created.item.id));
      }
    });

    afterEach(async () => {
      // The field functions are kept per Single across instances: none are left for the next.
      registerFieldFunctions("single", HERO, []);
      await t.destroy();
      vi.unstubAllEnvs();
    });

    const quote = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const query = <T>(statement: string): Promise<T[]> =>
      (
        t.adapter as unknown as {
          executeQuery<R>(sql: string): Promise<R[]>;
        }
      ).executeQuery<T>(statement);

    /** The tags the junction links to the Single's row, sorted. */
    async function linked(): Promise<string[]> {
      const [row] = await query<{ id: string }>(
        `SELECT ${quote("id")} AS ${quote("id")} FROM ${quote(TABLE)}`
      );
      expect(row, "the Single's row").toBeDefined();
      const links = await query<{ source: string; target: string }>(
        `SELECT ${quote(SOURCE_COLUMN)} AS ${quote("source")}, ${quote(TARGET_COLUMN)} AS ${quote("target")} FROM ${quote(JUNCTION)}`
      );
      for (const link of links)
        expect(String(link.source)).toBe(String(row!.id));
      return links.map(link => String(link.target)).sort();
    }

    /** A save of `data`: published when `publish`, else held as the working draft. */
    const save = (data: Record<string, unknown>, publish: boolean) =>
      t.nextly.updateSingle({
        slug: HERO,
        data: {
          ...data,
          ...(publish ? { status: "published" } : {}),
          _overwrite: true,
        },
      });

    /** The versions rows kept for the Single, autosaves left out. */
    async function versionRows(): Promise<VersionRow[]> {
      return (await t.adapter.select<VersionRow>("nextly_versions")).filter(
        row => row.scopeSlug === HERO && !row.isAutosave
      );
    }
    const parsed = (snapshot: unknown) =>
      (typeof snapshot === "string"
        ? JSON.parse(snapshot)
        : snapshot) as Record<string, unknown>;

    /** The working draft's document: the one row with no version number. */
    async function workingDraft(): Promise<Record<string, unknown>> {
      const rows = (await versionRows()).filter(row => row.versionNo === null);
      expect(rows, "one working draft").toHaveLength(1);
      return parsed(rows[0]!.snapshot);
    }

    // A value that is not a list reads as one entry naming it, so a missing one fails as itself.
    const idsOf = (tags: unknown): string[] =>
      !Array.isArray(tags)
        ? [`not a list: ${JSON.stringify(tags)}`]
        : tags
            .map(tag =>
              typeof tag === "object" && tag !== null
                ? String((tag as { id: unknown }).id)
                : String(tag)
            )
            .sort();

    it("holds a held edit's links in its draft, and leaves the live links alone", async () => {
      const [a, b, c] = tagIds;
      await save({ title: "Live", tags: [a!] }, true);
      expect(await linked()).toEqual([a]);

      await save({ tags: [b!, c!] }, false);

      expect(await linked()).toEqual([a]);
      expect(idsOf((await workingDraft()).tags)).toEqual([b, c].sort());
    });

    it("keeps the live links in the draft of a held edit that leaves them out", async () => {
      const [a, b] = tagIds;
      await save({ title: "Live", tags: [a!, b!] }, true);

      await save({ title: "Held" }, false);

      const draft = await workingDraft();
      expect(draft.title).toBe("Held");
      expect(idsOf(draft.tags)).toEqual([a, b].sort());
    });

    it("writes a held edit's links into the junction when it is published", async () => {
      const [a, b, c] = tagIds;
      await save({ title: "Live", tags: [a!] }, true);
      await save({ tags: [b!, c!] }, false);

      await save({}, true);

      expect(await linked()).toEqual([b, c].sort());
    });

    it("keeps the published links when a held edit that left them out is published", async () => {
      const [a, b] = tagIds;
      await save({ title: "Live", tags: [a!, b!] }, true);
      await save({ title: "Held" }, false);

      await save({}, true);

      expect(await linked()).toEqual([a, b].sort());
    });

    it("restores a version's links through the held edit the restore makes and its publish", async () => {
      const [a, b] = tagIds;
      await save({ title: "First", tags: [a!] }, true);
      const first = (await versionRows())
        .filter(row => typeof row.versionNo === "number")
        .sort((x, y) => (y.versionNo ?? 0) - (x.versionNo ?? 0))[0]!;
      expect(idsOf(parsed(first.snapshot).tags)).toEqual([a]);
      await save({ title: "Second", tags: [b!] }, true);
      expect(await linked()).toEqual([b]);

      await restoreVersion({
        scopeKind: "single",
        slug: HERO,
        entryId: first.entryId,
        versionNo: first.versionNo!,
        // Stored, so the update gate the restore asks finds its role.
        user: {
          id: await superAdminUser(t, "tester"),
          roles: ["super-admin"],
        },
        version: { _overwrite: true },
      });
      await save({}, true);

      expect(await linked()).toEqual([a]);
    });
  });
