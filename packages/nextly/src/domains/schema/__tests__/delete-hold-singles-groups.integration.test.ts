/**
 * A Builder save that removes a Single's or a field group's field deletes only the count of values
 * the person confirmed in the review, as a collection's save does: the review counts the removed
 * field's values, the dialog sends that count back with the save, and the save counts again just
 * before it deletes them, refusing with every value kept where the count moved since.
 *
 * A Single holds its values on its one row; a field group on its instance table, whose rows every
 * entry and Single placing it writes. On per-language storage a translatable field's values are in
 * the entity's translations table, where they are counted.
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
const NOTED = [...KEPT, { name: "note", type: "text" }];

const KINDS = ["Single", "field group"] as const;
type Kind = (typeof KINDS)[number];

/**
 * The roads a save takes: its own migration file, the push (a change whose values only the push
 * carries), and the push alone in an app with no migration writer.
 */
const ROADS = ["file", "push", "no writer"] as const;

/** The table that holds the entity's values: its own, or its translations table. */
function valuesTable(kind: Kind, perLanguage: boolean): string {
  const table = kind === "Single" ? `single_${SINGLE}` : `comp_${GROUP}`;
  return perLanguage ? `${table}${STORAGE_FORMAT.companionSuffix}` : table;
}

/** The refusal of a save whose removed field's count moved since the review: `count` now. */
const refusedWith = (count: number) => ({
  code: "VALIDATION_ERROR",
  publicData: {
    errors: [
      expect.objectContaining({
        path: "fields.note",
        code: "DELETION_COUNT_CHANGED",
        message: expect.stringContaining(`now holds ${String(count)} value`),
      }),
    ],
  },
});

for (const perLanguage of [false, true]) {
  describe.each(getConfiguredTestDialects())(
    `a save that removes a Single's or a field group's field deletes the count confirmed${perLanguage ? ", on per-language storage" : ""} (%s)`,
    dialect => {
      const q = (n: string) => (dialect === "mysql" ? `\`${n}\`` : `"${n}"`);

      /** The app in development, with the Single, or the field group placed in a collection. */
      async function boot(kind: Kind): Promise<TestNextly> {
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
        if (kind === "Single") {
          await dispatchSingles(
            "createSingle",
            {},
            { slug: SINGLE, label: "Notice", fields: NOTED }
          );
        } else {
          await dispatchComponents(
            "createComponent",
            {},
            { slug: GROUP, label: "Meta", fields: NOTED }
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

      /** The `note` values the entity's values table holds, or `"gone"` once its column is. */
      async function notes(t: TestNextly, kind: Kind): Promise<number | "gone"> {
        try {
          const [row] = await (
            t.adapter as unknown as {
              executeQuery<R>(statement: string): Promise<R[]>;
            }
          ).executeQuery<{ n: number | string }>(
            `SELECT COUNT(*) AS n FROM ${q(valuesTable(kind, perLanguage))} WHERE ${q("note")} IS NOT NULL`
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
        return Number(
          (row as { schemaVersion?: unknown }).schemaVersion ?? 1
        );
      }

      /** What the review shows for `note` when the entity keeps only `heading`. */
      async function reviewed(
        kind: Kind
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
        return changes?.removed?.find(field => field.name === "note");
      }

      /** The save removing `note`, confirming `confirmed` values deleted, as the dialog sends it. */
      async function save(
        t: TestNextly,
        kind: Kind,
        confirmed: number
      ): Promise<unknown> {
        const body = {
          fields: KEPT,
          confirmed: true,
          schemaVersion: await schemaVersion(t, kind),
          resolutions: { note: { action: "confirm_drop" } },
          confirmedDeletions: [{ field: "note", count: confirmed }],
        };
        return (
          kind === "Single"
            ? dispatchSingles("applySingleSchemaChanges", { slug: SINGLE }, body)
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
        });
      });
    }
  );
}
