/**
 * A Builder save that removes a Single's or a field group's field deletes only the count of values
 * the person confirmed in the review, as a collection's save does: the review counts the removed
 * field's values, the dialog sends that count back with the save, and the save counts again just
 * before it deletes them, refusing with every value kept where the count moved since.
 *
 * A Single holds its values on its one row; a field group on its instance table, whose rows every
 * entry and Single placing it writes. On per-language storage a translatable field's values are in
 * the entity's translations table, where they are counted, and a field kept out of translation's on
 * the entity's own row.
 *
 * A removed many-to-many is counted where its links are: a Single's link table, a field group's own
 * row, which has no link table.
 *
 * What separates a counted save from plausible wrong ones: a save that reads no count deletes a
 * value written after the review uncounted; a count taken from the main table alone reads a
 * translatable field's values as none; a road that compares nothing (a push, or an app with no
 * migration writer) deletes them all the same.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { ServiceContainer } from "../../../services";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

// A switch that sends a save down the push road (`pushCarriesValues`), which the push applies
// rather than the save's own file, whatever the change.
const pushRoad = vi.hoisted(() => ({ forced: false }));
vi.mock("../builder-save/push-carries-values", async importOriginal => {
  const real =
    await importOriginal<
      typeof import("../builder-save/push-carries-values")
    >();
  return {
    ...real,
    pushCarriesValues: async (
      ...args: Parameters<typeof real.pushCarriesValues>
    ) => pushRoad.forced || real.pushCarriesValues(...args),
  };
});

let instance: TestNextly | undefined;
afterEach(async () => {
  pushRoad.forced = false;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await instance?.destroy();
  instance = undefined;
});

const SINGLE = "dhs_notice";
const GROUP = "dhs_meta";
const PARENT = "dhs_posts";
const KEPT = [{ name: "heading", type: "text" }];
/** The fields before the save: `note` translatable, or kept out of translation (`translated` false). */
const notedFields = (translated: boolean) => [
  ...KEPT,
  { name: "note", type: "text", ...(translated ? {} : { localized: false }) },
];

/**
 * Where `note`'s values are: on the entity's own row in the earlier layout; in its translations
 * table on per-language storage; and on its own row again on per-language storage where the field
 * is kept out of translation. A count that reads the translations table for every field of a
 * per-language entity reads that last one as none.
 */
const LAYOUTS = [
  { label: "", perLanguage: false, translated: true },
  { label: ", on per-language storage", perLanguage: true, translated: true },
  {
    label: ", on per-language storage, the field kept out of translation",
    perLanguage: true,
    translated: false,
  },
] as const;

/** The collection a removed many-to-many links to. */
const TAGS = "dhs_tags";
/**
 * The fields before a save removing a many-to-many, `links`: a Single keeps its links in a link
 * table, a field group in a column of its own row, where its review and its save count them.
 */
const LINKED = [
  ...KEPT,
  {
    name: "links",
    type: "relationship",
    relationTo: TAGS,
    hasMany: true,
    options: { target: TAGS, relationType: "manyToMany" },
  },
];

const KINDS = ["Single", "field group"] as const;
type Kind = (typeof KINDS)[number];

/**
 * The roads a save takes: its own migration file, the push (a change whose values only the push
 * carries), and the push alone in an app with no migration writer.
 */
const ROADS = ["file", "push", "no writer"] as const;

/**
 * The table that holds `note`'s values: the entity's own, as its registry row names it (a field
 * group's is `fg_<slug>` on the current field-group names), or its translations table.
 */
async function valuesTable(
  t: TestNextly,
  kind: Kind,
  inTranslations: boolean
): Promise<string> {
  const row =
    kind === "Single"
      ? await t.getService("singleRegistryService").getSingle(SINGLE)
      : await t.getService("fieldGroupRegistryService").getComponent(GROUP);
  const table = (row as { tableName: string }).tableName;
  return inTranslations ? `${table}${STORAGE_FORMAT.companionSuffix}` : table;
}

/** The refusal of a save whose removed field's count moved since the review: `count` now. */
const refusedWith = (count: number, field = "note") => ({
  code: "VALIDATION_ERROR",
  publicData: {
    errors: [
      expect.objectContaining({
        path: `fields.${field}`,
        code: "DELETION_COUNT_CHANGED",
        message: expect.stringContaining(`now holds ${String(count)} value`),
      }),
    ],
  },
});

for (const { label, perLanguage, translated } of LAYOUTS) {
  const NOTED = notedFields(translated);
  describe.each(getConfiguredTestDialects())(
    `a save that removes a Single's or a field group's field deletes the count confirmed${label} (%s)`,
    dialect => {
      const q = (n: string) => (dialect === "mysql" ? `\`${n}\`` : `"${n}"`);

      /**
       * The app in development, with the Single, or the field group placed in a collection, holding
       * `fields`: with `links`, after the collection it links to.
       */
      async function boot(
        kind: Kind,
        fields: readonly unknown[] = NOTED
      ): Promise<TestNextly> {
        vi.stubEnv("NODE_ENV", "development");
        const t = await createTestNextly({
          dialect,
          ...(perLanguage ? { perLanguageStorage: true } : {}),
          db: {
            migrationsDir: "./database/history",
            uiSchemaFile: "./schema/builder.json",
          },
        });
        instance = t;
        if (fields === LINKED) {
          await dispatchCollections(
            {} as ServiceContainer,
            "createCollection",
            {},
            {
              name: TAGS,
              label: "Tags",
              fields: [{ name: "title", type: "text" }],
            }
          );
        }
        if (kind === "Single") {
          await dispatchSingles(
            "createSingle",
            {},
            { slug: SINGLE, label: "Notice", fields }
          );
        } else {
          await dispatchComponents(
            "createComponent",
            {},
            { slug: GROUP, label: "Meta", fields }
          );
          await dispatchCollections(
            {} as ServiceContainer,
            "createCollection",
            {},
            {
              name: PARENT,
              label: "Posts",
              fields: [
                { name: "title", type: "text" },
                { name: "meta", type: "component", component: GROUP },
              ],
            }
          );
        }
        return t;
      }

      /** A value of `note` written as a person writes it: the Single's, or a new entry's group. */
      async function write(t: TestNextly, kind: Kind, note: string) {
        if (kind === "Single") {
          const saved = await (
            t.getService("singleEntryService") as SingleEntryService
          ).update(
            SINGLE,
            { heading: "h", note, _overwrite: true },
            { overrideAccess: true }
          );
          if (!saved.success) throw new Error(String(saved.message));
          return;
        }
        await t.nextly.create({
          collection: PARENT,
          data: { title: "p", meta: { heading: "h", note } },
        } as never);
      }

      /**
       * One more link, to a new entry of TAGS, written as a person writes it: the Single's links are
       * set to every one so far (`linked`), and a field group's are a new entry's group's.
       */
      async function writeLink(
        t: TestNextly,
        kind: Kind,
        linked: string[]
      ): Promise<void> {
        const tag = await t.nextly.create({
          collection: TAGS,
          data: { title: "t" },
        } as never);
        linked.push(String(tag.item.id));
        if (kind === "Single") {
          const saved = await (
            t.getService("singleEntryService") as SingleEntryService
          ).update(
            SINGLE,
            { heading: "h", links: [...linked], _overwrite: true },
            { overrideAccess: true }
          );
          if (!saved.success) throw new Error(String(saved.message));
          return;
        }
        await t.nextly.create({
          collection: PARENT,
          data: { title: "p", meta: { heading: "h", links: linked.slice(-1) } },
        } as never);
      }

      /** The `note` values the entity's values table holds, or `"gone"` once its column is. */
      async function notes(
        t: TestNextly,
        kind: Kind
      ): Promise<number | "gone"> {
        const table = await valuesTable(t, kind, perLanguage && translated);
        try {
          const [row] = await (
            t.adapter as unknown as {
              executeQuery<R>(statement: string): Promise<R[]>;
            }
          ).executeQuery<{ n: number | string }>(
            `SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${q("note")} IS NOT NULL`
          );
          return Number(row?.n);
        } catch {
          return "gone";
        }
      }

      async function schemaVersion(t: TestNextly, kind: Kind): Promise<number> {
        const row =
          kind === "Single"
            ? await t.getService("singleRegistryService").getSingle(SINGLE)
            : await t
                .getService("fieldGroupRegistryService")
                .getComponent(GROUP);
        return Number((row as { schemaVersion?: unknown }).schemaVersion ?? 1);
      }

      /** What the review shows for `field` (`note` unless named) when the entity keeps only `heading`. */
      async function reviewed(
        kind: Kind,
        field = "note"
      ): Promise<{ rowCount?: number; rowCountUnknown?: boolean } | undefined> {
        const body = (await (kind === "Single"
          ? dispatchSingles(
              "previewSingleSchemaChanges",
              { slug: SINGLE },
              { fields: KEPT }
            )
          : dispatchComponents(
              "previewComponentSchemaChanges",
              { slug: GROUP },
              { fields: KEPT }
            ))) as Response | Record<string, unknown>;
        const json = (
          body instanceof Response ? await body.json() : body
        ) as Record<string, unknown>;
        const changes = ((json.data ?? json) as { changes?: unknown })
          .changes as
          | {
              removed?: Array<{
                name: string;
                rowCount?: number;
                rowCountUnknown?: boolean;
              }>;
            }
          | undefined;
        return changes?.removed?.find(removed => removed.name === field);
      }

      /** The save removing `field` (`note` unless named), confirming `confirmed` values deleted, as the dialog sends it. */
      async function save(
        t: TestNextly,
        kind: Kind,
        confirmed: number,
        field = "note"
      ): Promise<unknown> {
        const body = {
          fields: KEPT,
          confirmed: true,
          schemaVersion: await schemaVersion(t, kind),
          resolutions: { [field]: { action: "confirm_drop" } },
          confirmedDeletions: [{ field, count: confirmed }],
        };
        return (
          kind === "Single"
            ? dispatchSingles(
                "applySingleSchemaChanges",
                { slug: SINGLE },
                body
              )
            : dispatchComponents(
                "applyComponentSchemaChanges",
                { slug: GROUP },
                body
              )
        ).then(
          () => "applied",
          (error: unknown) => error
        );
      }

      describe.each(KINDS)("of a %s", kind => {
        describe.each(ROADS)("on the %s road", road => {
          beforeEach(() => {
            pushRoad.forced = road === "push";
            if (road !== "no writer") return;
            const has = container.has.bind(container);
            vi.spyOn(container, "has").mockImplementation(name =>
              name === "builderSaveSetup" ? false : has(name)
            );
          });

          it("deletes the removed field's values when their count is still the one the review showed", async () => {
            const t = await boot(kind);
            await write(t, kind, "a");
            // Where the values are counted: the table the save deletes them from.
            expect(await notes(t, kind)).toBe(1);
            expect(await reviewed(kind)).toMatchObject({ rowCount: 1 });

            expect(await save(t, kind, 1)).toBe("applied");
            expect(await notes(t, kind)).toBe("gone");
          }, 60_000);

          it("deletes nothing and names the new count when a value was written after the review", async () => {
            const t = await boot(kind);
            expect(await reviewed(kind)).toMatchObject({ rowCount: 0 });
            // A value written after the review counted none.
            await write(t, kind, "written after the review");

            expect(await save(t, kind, 0)).toMatchObject(refusedWith(1));
            expect(await notes(t, kind)).toBe(1);
          }, 60_000);

          // A removed many-to-many is counted where its links are, by the entity's own storage: a
          // Single's link table, a field group's own row, which has no link table. Counted as a link
          // table on a field group, it reads as unknown, and a save confirming any count is refused.
          it("counts a removed many-to-many where its links are, deletes the count confirmed and refuses a stale one", async () => {
            const t = await boot(kind, LINKED);
            const linked: string[] = [];
            await writeLink(t, kind, linked);
            const review = await reviewed(kind, "links");
            expect(review).toMatchObject({ rowCount: 1 });
            expect(review?.rowCountUnknown).toBeUndefined();
            // A link written after the review counted one.
            await writeLink(t, kind, linked);
            expect(await save(t, kind, 1, "links")).toMatchObject(
              refusedWith(2, "links")
            );

            expect(await save(t, kind, 2, "links")).toBe("applied");
          }, 60_000);
        });
      });
    }
  );
}
