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
 * What separates a counted save from plausible wrong ones: a save that reads no count deletes a
 * value written after the review uncounted; a count taken from the main table alone reads a
 * translatable field's values as none; a road that compares nothing (a push, or an app with no
 * migration writer) deletes them all the same.
 *
 * While the save holds the entity, a write of its values (the Single's document, or an entry
 * placing the field group) waits, through the save's registry row too, then is refused naming a
 * field the save removed. A write that takes no share of the entity lands between the count and
 * the delete; a hold let go before the registry row lets it through on the old definition. The
 * share is taken once for the write's transaction: a share taken per row or per call sends a
 * statement for each.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordStatements } from "../../../__tests__/helpers/record-statements";
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

// A gate just after the save's count of the removed field's values, while armed: the save waits
// there once, holding its entity, until the case lets it go.
const afterCount = vi.hoisted(() => ({
  armed: false,
  paused: undefined as undefined | (() => void),
  release: undefined as undefined | Promise<void>,
  /** Lets a paused save go: called after each case too, so a case that failed first ends. */
  letGo: undefined as undefined | (() => void),
}));
vi.mock("../builder-save/deletion-counts", async importOriginal => {
  const real =
    await importOriginal<typeof import("../builder-save/deletion-counts")>();
  return {
    ...real,
    deletionHoldOf: (...args: Parameters<typeof real.deletionHoldOf>) => {
      const hold = real.deletionHoldOf(...args);
      if (hold === undefined) return hold;
      const gatedAfter =
        (check: (db: unknown) => Promise<void>) => async (db: unknown) => {
          await check(db);
          if (!afterCount.armed) return;
          afterCount.armed = false;
          afterCount.paused?.();
          await afterCount.release;
        };
      return {
        ...hold,
        // The push roads compare just before the push, the file road inside the file's
        // transaction: the gate follows either count.
        compare: gatedAfter(hold.compare),
        check: gatedAfter(hold.check),
        checkIn(changed: readonly string[]) {
          const check = hold.checkIn(changed);
          return check === undefined ? undefined : gatedAfter(check);
        },
      };
    },
  };
});

// A pause before the registry row a Single's or a field group's save writes once its change has
// applied, while `ms` is set: the span a hold let go before that row would leave a write to land in.
const slowRow = vi.hoisted(() => ({ ms: 0 }));
vi.mock(
  "../../../dispatcher/helpers/applied-fields-row",
  async importOriginal => {
    const real =
      await importOriginal<
        typeof import("../../../dispatcher/helpers/applied-fields-row")
      >();
    return {
      ...real,
      writeAppliedFieldsRow: async (
        ...args: Parameters<typeof real.writeAppliedFieldsRow>
      ) => {
        if (slowRow.ms > 0) {
          await new Promise(resolve => setTimeout(resolve, slowRow.ms));
        }
        return real.writeAppliedFieldsRow(...args);
      },
    };
  }
);

/** Arms the gate after the save's count: `paused` settles once the save waits there. */
function gateAfterCount(): { paused: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  afterCount.release = new Promise<void>(resolve => {
    release = resolve;
  });
  const paused = new Promise<void>(resolve => {
    afterCount.paused = resolve;
  });
  afterCount.letGo = release;
  afterCount.armed = true;
  return { paused, release };
}

let instance: TestNextly | undefined;
afterEach(async () => {
  afterCount.armed = false;
  // A case that failed before letting its save go leaves it paused at the gate, holding what the
  // app's teardown waits for.
  afterCount.letGo?.();
  afterCount.letGo = undefined;
  slowRow.ms = 0;
  pushRoad.forced = false;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await instance?.destroy();
  instance = undefined;
});

const SINGLE = "dhs_notice";
const GROUP = "dhs_meta";
const PARENT = "dhs_posts";
/** A collection placing the field group twice, so one entry writes two of its rows. */
const TWICE = "dhs_twice";
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

const KINDS = ["Single", "field group"] as const;
type Kind = (typeof KINDS)[number];

/**
 * The roads a save takes: its own migration file, the push (a change whose values only the push
 * carries), and the push alone in an app with no migration writer.
 */
const ROADS = ["file", "push", "no writer"] as const;

/** The table that holds `note`'s values: the entity's own, or its translations table. */
function valuesTable(kind: Kind, inTranslations: boolean): string {
  const table = kind === "Single" ? `single_${SINGLE}` : `comp_${GROUP}`;
  return inTranslations ? `${table}${STORAGE_FORMAT.companionSuffix}` : table;
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

for (const { label, perLanguage, translated } of LAYOUTS) {
  const NOTED = notedFields(translated);
  describe.each(getConfiguredTestDialects())(
    `a save that removes a Single's or a field group's field deletes the count confirmed${label} (%s)`,
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

      /**
       * Another writer's write of `note`, made for the definition that still has it, as a person
       * makes it through the Direct API: the Single's document, or an entry placing the field
       * group. Answers `"written"` or what refused it.
       */
      function racedWrite(
        t: TestNextly,
        kind: Kind,
        note: string
      ): Promise<unknown> {
        const writing =
          kind === "Single"
            ? t.nextly.updateSingle({
                slug: SINGLE,
                data: { heading: "h", note, _overwrite: true },
              } as never)
            : t.nextly.create({
                collection: PARENT,
                data: { title: "p", meta: { heading: "h", note } },
              } as never);
        return writing.then(
          () => "written",
          (error: unknown) => error
        );
      }

      /** The `note` values the entity's values table holds, or `"gone"` once its column is. */
      async function notes(
        t: TestNextly,
        kind: Kind
      ): Promise<number | "gone"> {
        try {
          const [row] = await (
            t.adapter as unknown as {
              executeQuery<R>(statement: string): Promise<R[]>;
            }
          ).executeQuery<{ n: number | string }>(
            `SELECT COUNT(*) AS n FROM ${q(valuesTable(kind, perLanguage && translated))} WHERE ${q("note")} IS NOT NULL`
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

          // A write setting the removed field, sent while the save holds the entity between its
          // count and its delete. It waits, through the save's registry row too, then is refused
          // naming the field: never written into the field just before its values go uncounted,
          // nor sent to a column the field has left, nor let through between the change and the
          // row that records it.
          it("keeps a write of the removed field waiting until the save is recorded, then refuses it naming the field", async () => {
            const t = await boot(kind);
            await write(t, kind, "a");
            const { paused, release } = gateAfterCount();
            const saving = save(t, kind, 1);
            const reached = await Promise.race([
              paused.then(() => true),
              saving.then(() => false),
            ]);
            expect(reached || (await saving)).toBe(true);

            let settled = false;
            const writing = racedWrite(t, kind, "written while held").finally(
              () => {
                settled = true;
              }
            );
            await new Promise(resolve => setTimeout(resolve, 1_000));
            expect(settled, "the write waits while the save holds").toBe(false);

            // The save's registry row made slow: the write still waits through it.
            slowRow.ms = 1_500;
            release();
            expect(await saving).toBe("applied");
            expect(await writing).toMatchObject({
              code: "VALIDATION_ERROR",
              publicData: {
                errors: [
                  expect.objectContaining({
                    path: "fields.note",
                    code: "FIELD_REMOVED",
                  }),
                ],
              },
            });
            expect(await notes(t, kind)).toBe("gone");
          }, 60_000);
        });

        // The share a write takes of the entity is taken once for its transaction, never once per
        // row or per call: on PostgreSQL one advisory share statement (its registry row read rides
        // with it), on MySQL one locking read of the entity's registry row. A field group placed
        // twice in one entry writes two of its rows in one transaction. SQLite holds in this
        // process, with no statement to count.
        it.skipIf(dialect === "sqlite")(
          "takes the write's share of the entity once for its transaction, however many of its rows it writes",
          async () => {
            const t = await boot(kind);
            if (kind === "field group") {
              await dispatchCollections(
                {} as ServiceContainer,
                "createCollection",
                {},
                {
                  name: TWICE,
                  label: "Twice",
                  fields: [
                    { name: "title", type: "text" },
                    { name: "meta", type: "component", component: GROUP },
                    { name: "more", type: "component", component: GROUP },
                  ],
                }
              );
            }
            const recorder = await recordStatements(t.adapter, dialect);
            try {
              if (kind === "Single") {
                await t.nextly.updateSingle({
                  slug: SINGLE,
                  data: { heading: "h", note: "n", _overwrite: true },
                } as never);
              } else {
                await t.nextly.create({
                  collection: TWICE,
                  data: {
                    title: "t",
                    meta: { heading: "h", note: "n" },
                    more: { heading: "h2", note: "n2" },
                  },
                } as never);
              }
            } finally {
              recorder.uninstall();
            }
            const key =
              kind === "Single" ? `single:${SINGLE}` : `fieldGroup:${GROUP}`;
            const slug = kind === "Single" ? SINGLE : GROUP;
            const shares = recorder.calls.filter(call =>
              dialect === "postgresql"
                ? /advisory_xact_lock_shared/i.test(call.text) &&
                  call.values.includes(key)
                : /\bfor share\b/i.test(call.text) && call.values.includes(slug)
            );
            expect(shares).toHaveLength(1);
          },
          60_000
        );
      });
    }
  );
}
