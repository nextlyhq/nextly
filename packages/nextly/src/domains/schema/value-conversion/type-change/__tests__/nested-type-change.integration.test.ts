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
 *
 * Nothing converts a value held inside JSON either, so a value is kept only where the new field
 * reads it as it is stored: a text the number reads stays a text, refused as needing a rewrite.
 * Each item of a repeater is asked of the new field's own validation, an object's inherited
 * members are no field's value, and a virtual field, storing nothing, changes type freely.
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

/** A field held inside the containers: its name, its type and any settings. */
const leaf = (name: string, type: string, extra: object = {}) => ({
  name,
  type,
  ...extra,
});

/** The field most cases change: a text whose values may or may not be emails. */
const contact = (type: string, extra: object = {}) =>
  leaf("contact", type, extra);

/** The collection's fields, with `inner` inside the group `details` and the repeater `items`. */
const fieldsWith = (inner: ReturnType<typeof leaf>) => [
  { name: "heading", type: "text" },
  { name: "details", type: "group", fields: [inner] },
  { name: "items", type: "repeater", fields: [inner] },
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

    async function boot(
      road: "writer" | "push",
      inner = contact("text")
    ): Promise<TestNextly> {
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
        { name: SLUG, label: SLUG, fields: fieldsWith(inner) }
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

    /** The save of the fields with `inner` as given, through the dialog or the update. */
    async function save(
      t: TestNextly,
      caller: "dialog" | "update",
      inner = contact("email")
    ): Promise<unknown> {
      const attempt =
        caller === "dialog"
          ? dispatchCollections(
              {} as ServiceContainer,
              "applySchemaChanges",
              { collectionName: SLUG },
              {
                fields: fieldsWith(inner),
                confirmed: true,
                schemaVersion: await schemaVersion(t),
              }
            )
          : dispatchCollections(
              {} as ServiceContainer,
              "updateCollection",
              { collectionName: SLUG },
              { fields: fieldsWith(inner) }
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

    /** The collection's fields as the registry keeps them, once a save has applied. */
    async function registered(t: TestNextly): Promise<string> {
      const [row] = (await t.adapter.executeQuery(
        `SELECT fields FROM dynamic_collections WHERE slug = '${SLUG}'`
      )) as Array<{ fields: unknown }>;
      return typeof row?.fields === "string"
        ? row.fields
        : JSON.stringify(row?.fields);
    }

    for (const road of ["writer", "push"] as const) {
      for (const caller of ["dialog", "update"] as const) {
        it(`refuses a group's field whose values the new type can't read, by the ${road} from the ${caller}`, async () => {
          const t = await boot(road);
          const readable = await entry(t, { contact: "a@b.co" }, []);
          const unreadable = await entry(t, { contact: "abc" }, []);
          const before = await stored(t);

          const answer = await save(t, caller);

          expect(told(answer)).toContain("TYPE_CHANGE_LOSES_VALUES");
          expect(told(answer)).toContain("field 'details.contact'");
          // Only the row holding a value no email reads is named.
          expect(told(answer)).toContain(
            `values the email field's rule refuses would be cleared (1 row: id ${unreadable})`
          );
          expect(told(answer)).not.toContain(readable);
          expect(await stored(t)).toEqual(before);
        }, 120_000);

        it(`refuses a repeater's field whose values the new type can't read, by the ${road} from the ${caller}`, async () => {
          const t = await boot(road);
          // One item of this entry's list can't be read as an email; the other entry's all can.
          const unreadable = await entry(t, {}, [
            { contact: "a@b.co" },
            { contact: "x" },
          ]);
          const readable = await entry(t, {}, [{ contact: "c@d.co" }]);
          const before = await stored(t);

          const answer = await save(t, caller);

          expect(told(answer)).toContain("TYPE_CHANGE_LOSES_VALUES");
          expect(told(answer)).toContain("field 'items.contact'");
          expect(told(answer)).toContain(
            `values the email field's rule refuses would be cleared (1 row: id ${unreadable})`
          );
          expect(told(answer)).not.toContain(readable);
          expect(await stored(t)).toEqual(before);
        }, 120_000);
      }

      // A type change converts nothing held inside JSON: a text the number reads stays a text,
      // which the number field reads only once it is rewritten as a number.
      it(`refuses a field whose values the new type reads only once rewritten, by the ${road}`, async () => {
        const t = await boot(road, leaf("amount", "text"));
        const id = await entry(t, { amount: "1" }, [{ amount: "2" }]);
        const before = await stored(t);

        const answer = await save(t, "dialog", leaf("amount", "number"));

        expect(told(answer)).toContain("TYPE_CHANGE_BLOCKED");
        for (const path of ["details.amount", "items.amount"]) {
          expect(told(answer)).toContain(`field '${path}'`);
        }
        expect(told(answer)).toContain(
          `values the new type reads only once they are rewritten into its form, which a save does not do yet (1 row: id ${id})`
        );
        expect(await stored(t)).toEqual(before);
      }, 120_000);
    }

    it("asks the new field's own validation of every item of a repeater", async () => {
      const t = await boot("writer");
      // Both of this entry's emails are emails; only the second is longer than the new field allows.
      const tooLong = await entry(t, {}, [
        { contact: "a@b.co" },
        { contact: "long.name@example.com" },
      ]);
      const fits = await entry(t, {}, [{ contact: "c@d.co" }]);
      const before = await stored(t);

      const answer = await save(
        t,
        "dialog",
        contact("email", { validation: { maxLength: 10 } })
      );

      expect(told(answer)).toContain("TYPE_CHANGE_LOSES_VALUES");
      expect(told(answer)).toContain("field 'items.contact'");
      expect(told(answer)).toContain(
        `values the new field's own validation refuses would be cleared (1 row: id ${tooLong})`
      );
      expect(told(answer)).not.toContain(fits);
      expect(await stored(t)).toEqual(before);
    }, 120_000);

    // Every object inherits a member named `constructor`, a name the Builder allows a field.
    it("reads a group's object without the field as holding no value, whatever the field's name", async () => {
      const t = await boot("writer", leaf("constructor", "text"));
      // Written with no group at all, then left holding objects without the field, as rows saved
      // before the field was added hold them.
      const created = (await t.nextly.create({
        collection: SLUG,
        data: { heading: "h" },
      } as never)) as unknown as { item: { id: unknown } };
      const id = String(created.item.id);
      await t.adapter.executeQuery(
        `UPDATE ${q(TABLE)} SET ${q("details")} = '{}', ${q("items")} = '[{}]' WHERE ${q("id")} = '${id}'`
      );

      const answer = await save(t, "dialog", leaf("constructor", "email"));

      expect(told(answer)).not.toContain("TYPE_CHANGE");
      expect(await registered(t)).toContain('"email"');
    }, 120_000);

    it("lets a virtual field inside a group change type, which stores nothing", async () => {
      const virtual = { virtual: true };
      const t = await boot("writer", leaf("when", "date", virtual));
      await entry(t, {}, []);

      const answer = await save(t, "dialog", leaf("when", "email", virtual));

      expect(told(answer)).not.toContain("TYPE_CHANGE");
      expect(await registered(t)).toContain('"email"');
    }, 120_000);

    it("lets a group's and a repeater's field change type where the new type reads every value as it is stored", async () => {
      const t = await boot("writer");
      await entry(t, { contact: "a@b.co" }, [{ contact: "c@d.co" }]);

      const answer = await save(t, "dialog");

      expect(told(answer)).not.toContain("TYPE_CHANGE");
      expect(await registered(t)).toContain('"email"');
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
      const group = (contactType: string) => ({
        name: "details",
        type: "group",
        localized: true,
        fields: [{ name: "contact", type: contactType }],
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
      // English reads as an email; Spanish does not.
      const created = (await t.nextly.create({
        collection: SLUG,
        locale: "en",
        data: { heading: "h", details: { contact: "a@b.co" } },
      } as never)) as unknown as { item: { id: unknown } };
      const id = String(created.item.id);
      await t.nextly.update({
        collection: SLUG,
        id,
        locale: "es",
        data: { details: { contact: "abc" }, _overwrite: true },
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
            fields: [{ name: "heading", type: "text" }, group("email")],
          }
        )
      );

      expect(told(answer)).toContain("TYPE_CHANGE_LOSES_VALUES");
      expect(told(answer)).toContain("field 'details.contact'");
      // Only the Spanish row is cleared: English reads as an email.
      expect(told(answer)).toContain(
        `values the email field's rule refuses would be cleared (1 row: parent ${id} locale es)`
      );
      expect(await readBack()).toEqual(before);
    }, 120_000);

    it("refuses a field group's group field over the row whose value the new type can't read", async () => {
      const GROUP = "ntc_meta";
      const COMP = `comp_${GROUP}`;
      const t = await createTestNextly({ dialect });
      instance = t;
      vi.stubEnv("NODE_ENV", "development");
      const fields = (contactType: string) => [
        {
          name: "details",
          type: "group",
          fields: [{ name: "contact", type: contactType }],
        },
      ];
      await dispatchComponents(
        "createComponent",
        {},
        { slug: GROUP, label: "Meta", fields: fields("text") }
      );
      // Two instances as their rows keep them: the group as JSON in its own column.
      for (const [id, value] of [
        ["nest-row-readable", "a@b.co"],
        ["nest-row-unreadable", "abc"],
      ] as const) {
        await t.adapter.executeQuery(
          `INSERT INTO ${q(COMP)} (${q("id")}, ${q("_parent_id")}, ${q("_parent_table")}, ${q("_parent_field")}, ${q("details")}) VALUES ('${id}', 'p1', 'dc_posts', 'meta', '{"contact":"${value}"}')`
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
          { fields: fields("email"), confirmed: true, schemaVersion }
        )
      );

      expect(told(answer)).toContain("TYPE_CHANGE_LOSES_VALUES");
      expect(told(answer)).toContain("field 'details.contact'");
      expect(told(answer)).toContain(
        "values the email field's rule refuses would be cleared (1 row: id nest-row-unreadable)"
      );
      expect(told(answer)).not.toContain("nest-row-readable");
      expect(await readBack()).toEqual(before);
    }, 120_000);
  }
);
