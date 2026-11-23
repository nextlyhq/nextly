/**
 * A field inside a named group or a repeater changing type, judged value by value as a field on
 * the row is, on every dialect, by both roads a collection's save takes in development (its own
 * migration file through the writer, and the push) and from both its callers (the schema dialog
 * and the collection update).
 *
 * A group's and a repeater's fields are kept inside the container's own JSON column, so a change
 * of their type changes no column: a judgement that compares containers by their own type alone
 * sees nothing and lets the save through, leaving each stored value under a type that cannot read
 * it. What separates the correct judgement from that: the save is refused as losing values, naming
 * the field by its path and only the row holding a value the new type cannot read, and every value
 * is kept as it was.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetSessionStandingForTests } from "../../../../../auth/session/session-standing";
import { dispatchCollections } from "../../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../../dispatcher/handlers/component-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../../services";

const SLUG = "ntc_posts";
const TABLE = `dc_${SLUG}`;

/** The collection's fields, with `price` inside the group and the repeater of type `price`. */
const fieldsWith = (price: string) => [
  { name: "heading", type: "text" },
  {
    name: "details",
    type: "group",
    fields: [{ name: "price", type: price }],
  },
  {
    name: "items",
    type: "repeater",
    fields: [{ name: "price", type: price }],
  },
];

let instance: TestNextly | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSessionStandingForTests();
  await instance?.destroy();
  instance = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a field inside a group or a repeater changing type (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function boot(road: "writer" | "push"): Promise<TestNextly> {
      const t = await createTestNextly({
        dialect,
        ...(road === "writer"
          ? {
              db: {
                migrationsDir: "./database/history",
                uiSchemaFile: "./schema/builder.json",
              },
            }
          : {}),
      });
      instance = t;
      // As the Builder runs: each save is applied here.
      vi.stubEnv("NODE_ENV", "development");
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: SLUG, label: SLUG, fields: fieldsWith("text") }
      );
      return t;
    }

    /** An entry holding `details` and `items` as given; its id. */
    async function entry(
      t: TestNextly,
      details: Record<string, unknown>,
      items: Record<string, unknown>[]
    ): Promise<string> {
      const created = (await t.nextly.create({
        collection: SLUG,
        data: { heading: "h", details, items },
      } as never)) as unknown as { item: { id: unknown } };
      return String(created.item.id);
    }

    /** What the table holds for the containers, as text, row by row. */
    async function stored(t: TestNextly): Promise<string[]> {
      const rows = (await t.adapter.executeQuery(
        `SELECT ${q("id")} AS id, ${q("details")} AS details, ${q("items")} AS items FROM ${q(TABLE)} ORDER BY ${q("id")}`
      )) as Array<{ id: unknown; details: unknown; items: unknown }>;
      return rows.map(row => JSON.stringify(row));
    }

    async function schemaVersion(t: TestNextly): Promise<number> {
      const [row] = (await t.adapter.executeQuery(
        `SELECT schema_version AS v FROM dynamic_collections WHERE slug = '${SLUG}'`
      )) as Array<{ v: unknown }>;
      return Number(row?.v ?? 1);
    }

    /** The save of the fields with `price` a number, through the dialog or the update. */
    async function save(
      t: TestNextly,
      caller: "dialog" | "update"
    ): Promise<unknown> {
      const attempt =
        caller === "dialog"
          ? dispatchCollections(
              {} as ServiceContainer,
              "applySchemaChanges",
              { collectionName: SLUG },
              {
                fields: fieldsWith("number"),
                confirmed: true,
                schemaVersion: await schemaVersion(t),
              }
            )
          : dispatchCollections(
              {} as ServiceContainer,
              "updateCollection",
              { collectionName: SLUG },
              { fields: fieldsWith("number") }
            );
      // A refusal is thrown, or answered as an error response whose body names it.
      return attempt.then(
        async answer =>
          answer instanceof Response
            ? ((await answer.json()) as unknown)
            : answer,
        (error: unknown) => error
      );
    }

    /** The refusal's text, whichever shape the caller answers it in. */
    const told = (answer: unknown): string =>
      `${answer instanceof Error ? answer.message : ""} ${JSON.stringify(answer)}`;

    for (const road of ["writer", "push"] as const) {
      for (const caller of ["dialog", "update"] as const) {
        it(`refuses a group's field whose values the new type can't read, by the ${road} from the ${caller}`, async () => {
          const t = await boot(road);
          const readable = await entry(t, { price: "1" }, []);
          const unreadable = await entry(t, { price: "abc" }, []);
          const before = await stored(t);

          const answer = await save(t, caller);

          expect(told(answer)).toContain("TYPE_CHANGE_LOSES_VALUES");
          expect(told(answer)).toContain("field 'details.price'");
          // Only the row holding a value no number reads is named as cleared.
          expect(told(answer)).toContain(
            `values that are not a number would be cleared (1 row: id ${unreadable})`
          );
          expect(told(answer)).not.toContain(`cleared (1 row: id ${readable})`);
          expect(await stored(t)).toEqual(before);
        }, 120_000);

        it(`refuses a repeater's field whose values the new type can't read, by the ${road} from the ${caller}`, async () => {
          const t = await boot(road);
          // One item of this entry's list can't be read as a number; the other entry's all can.
          const unreadable = await entry(t, {}, [
            { price: "2" },
            { price: "x" },
          ]);
          const readable = await entry(t, {}, [{ price: "3" }]);
          const before = await stored(t);

          const answer = await save(t, caller);

          expect(told(answer)).toContain("TYPE_CHANGE_LOSES_VALUES");
          expect(told(answer)).toContain("field 'items.price'");
          // Only the row holding a value no number reads is named as cleared.
          expect(told(answer)).toContain(
            `values that are not a number would be cleared (1 row: id ${unreadable})`
          );
          expect(told(answer)).not.toContain(`cleared (1 row: id ${readable})`);
          expect(await stored(t)).toEqual(before);
        }, 120_000);
      }
    }

    it("lets a group's field change type where the new type reads every value", async () => {
      const t = await boot("writer");
      await entry(t, { price: "1" }, [{ price: "2" }]);

      const answer = await save(t, "dialog");

      expect(told(answer)).not.toContain("TYPE_CHANGE");
    }, 120_000);
  }
);

describe.each(getConfiguredTestDialects())(
  "a field inside a translated group, or a field group's group, changing type (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const told = (answer: unknown): string =>
      `${answer instanceof Error ? answer.message : ""} ${JSON.stringify(answer)}`;
    const failed = (attempt: Promise<unknown>) =>
      attempt.then(
        async a => (a instanceof Response ? ((await a.json()) as unknown) : a),
        (error: unknown) => error
      );

    it("refuses a translated group's field over the language whose value the new type can't read", async () => {
      const t = await createTestNextly({
        dialect,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      instance = t;
      vi.stubEnv("NODE_ENV", "development");
      const group = (price: string) => ({
        name: "details",
        type: "group",
        localized: true,
        fields: [{ name: "price", type: price }],
      });
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: SLUG,
          label: SLUG,
          localized: true,
          fields: [{ name: "heading", type: "text" }, group("text")],
        }
      );
      // English reads as a number; Spanish does not.
      const created = (await t.nextly.create({
        collection: SLUG,
        locale: "en",
        data: { heading: "h", details: { price: "1" } },
      } as never)) as unknown as { item: { id: unknown } };
      const id = String(created.item.id);
      await t.nextly.update({
        collection: SLUG,
        id,
        locale: "es",
        data: { details: { price: "abc" }, _overwrite: true },
      } as never);
      const readBack = async () =>
        JSON.stringify(
          await t.adapter.executeQuery(
            `SELECT ${q("details")} AS details FROM ${q(`${TABLE}_locales`)} ORDER BY ${q("_locale")}`
          )
        );
      const before = await readBack();

      const answer = await failed(
        dispatchCollections(
          {} as ServiceContainer,
          "updateCollection",
          { collectionName: SLUG },
          {
            localized: true,
            fields: [{ name: "heading", type: "text" }, group("number")],
          }
        )
      );

      expect(told(answer)).toContain("TYPE_CHANGE_LOSES_VALUES");
      expect(told(answer)).toContain("field 'details.price'");
      // Only the Spanish row is cleared: English reads as a number.
      expect(told(answer)).toContain(
        `values that are not a number would be cleared (1 row: parent ${id} locale es)`
      );
      expect(await readBack()).toEqual(before);
    }, 120_000);

    it("refuses a field group's group field over the row whose value the new type can't read", async () => {
      const GROUP = "ntc_meta";
      const COMP = `comp_${GROUP}`;
      const t = await createTestNextly({ dialect });
      instance = t;
      vi.stubEnv("NODE_ENV", "development");
      const fields = (price: string) => [
        {
          name: "details",
          type: "group",
          fields: [{ name: "price", type: price }],
        },
      ];
      await dispatchComponents(
        "createComponent",
        {},
        { slug: GROUP, label: "Meta", fields: fields("text") }
      );
      // Two instances as their rows keep them: the group as JSON in its own column.
      for (const [id, price] of [
        ["nest-row-readable", "1"],
        ["nest-row-unreadable", "abc"],
      ] as const) {
        await t.adapter.executeQuery(
          `INSERT INTO ${q(COMP)} (${q("id")}, ${q("_parent_id")}, ${q("_parent_table")}, ${q("_parent_field")}, ${q("details")}) VALUES ('${id}', 'p1', 'dc_posts', 'meta', '{"price":"${price}"}')`
        );
      }
      const readBack = async () =>
        JSON.stringify(
          await t.adapter.executeQuery(
            `SELECT ${q("details")} AS details FROM ${q(COMP)} ORDER BY ${q("id")}`
          )
        );
      const before = await readBack();
      const { schemaVersion } = await t
        .getService("fieldGroupRegistryService")
        .getComponent(GROUP);

      const answer = await failed(
        dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: GROUP },
          { fields: fields("number"), confirmed: true, schemaVersion }
        )
      );

      expect(told(answer)).toContain("TYPE_CHANGE_LOSES_VALUES");
      expect(told(answer)).toContain("field 'details.price'");
      expect(told(answer)).toContain(
        "values that are not a number would be cleared (1 row: id nest-row-unreadable)"
      );
      expect(told(answer)).not.toContain(
        "cleared (1 row: id nest-row-readable)"
      );
      expect(await readBack()).toEqual(before);
    }, 120_000);
  }
);
