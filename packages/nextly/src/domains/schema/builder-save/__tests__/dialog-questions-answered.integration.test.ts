/**
 * A Schema Builder dialog's save that runs its own migration file asks what the push asks before
 * anything changes. A rename pair the request does not answer, or a column holding values that it
 * drops without confirming, refuses the save as the push refuses it: nothing is written, and every
 * value stays where it was. The admin's dialog answers each pair it shows and confirms each drop,
 * so only a request that leaves one out meets the refusal; answered, the same save goes through.
 *
 * Held for an untranslated collection, a Single and a field group, each saved through its own
 * dialog, on every dialect. Run as a development server runs it, where a Builder save applies its
 * file at once.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { readTableDefinition } from "../../__tests__/helpers/table-definition";
import { junctionTableNameFor } from "../../services/field-column-descriptor";

type Field = { name: string; type: string; component?: string };
const text = (name: string): Field => ({ name, type: "text" });
const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };

/** What a dialog's request carries beside its fields. */
interface Answers {
  renameResolutions?: {
    tableName: string;
    fromColumn: string;
    toColumn: string;
    choice: "rename" | "drop_and_add";
  }[];
  eventResolutions?: { kind: "confirm_drop"; eventId: string }[];
  /** The per-field confirmation the admin's dialog sends, by field name. */
  resolutions?: Record<string, { action: "confirm_drop" }>;
}

/** One kind of entity the Builder saves through its schema dialog. */
interface Kind {
  name: string;
  table: string;
  create(t: TestNextly, fields: Field[]): Promise<unknown>;
  /** One entry holding `views`, as the entity's own writes store it. */
  seed(t: TestNextly, views: string): Promise<void>;
  save(t: TestNextly, fields: Field[], answers: Answers): Promise<unknown>;
}

const exec = <R>(t: TestNextly, statement: string) =>
  (
    t.adapter as unknown as {
      executeQuery<T>(sql: string): Promise<T[]>;
    }
  ).executeQuery<R>(statement);

const versionOf = async (t: TestNextly, registry: string, slug: string) => {
  const [row] = await exec<{ version: number | string | null }>(
    t,
    `SELECT schema_version AS version FROM ${registry} WHERE slug = '${slug}'`
  );
  return Number(row?.version ?? 1);
};

const KINDS: Kind[] = [
  {
    name: "an untranslated collection",
    table: "dc_posts",
    create: (_t, fields) =>
      dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "posts", label: "posts", fields }
      ),
    seed: async (t, views) => {
      await t.nextly.create({
        collection: "posts",
        data: { title: "One", heading: "Hello", views },
      } as never);
    },
    save: async (t, fields, answers) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_collections", "posts"),
          ...answers,
        }
      ),
  },
  {
    name: "a Single",
    table: "single_notice",
    create: (_t, fields) =>
      dispatchSingles(
        "createSingle",
        {},
        { slug: "notice", label: "Notice", fields }
      ),
    seed: async (t, views) => {
      await t.nextly.updateSingle({
        slug: "notice",
        data: { heading: "Hello", views, _overwrite: true },
      } as never);
    },
    save: async (t, fields, answers) =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "notice" },
        {
          fields,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_singles", "notice"),
          ...answers,
        }
      ),
  },
  {
    name: "a field group",
    table: "comp_meta",
    create: (_t, fields) =>
      dispatchComponents(
        "createComponent",
        {},
        { slug: "meta", label: "Meta", fields }
      ),
    // One instance of the group, placed in an entry of some parent, as a parent's save stores it.
    seed: async (t, views) => {
      await exec(
        t,
        `INSERT INTO comp_meta (id, _parent_id, _parent_table, _parent_field, _order, heading, views) VALUES ('kept-1', 'parent-1', 'dc_parent', 'meta', 0, 'Hello', '${views}')`
      );
    },
    save: async (t, fields, answers) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "meta" },
        {
          fields,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_components", "meta"),
          ...answers,
        }
      ),
  },
];

for (const dialect of getConfiguredTestDialects()) {
  describe.each(KINDS)(
    `a dialog save that leaves a question unanswered, $name (${dialect})`,
    kind => {
      let t: TestNextly;
      let basePath: string;

      beforeEach(async () => {
        basePath = await mkdtemp(join(tmpdir(), "nextly-dialog-questions-"));
        vi.stubEnv("NODE_ENV", "development");
        t = await createTestNextly({
          dialect: dialect as TestDialect,
          basePath,
          db: DB,
        });
        await kind.create(t, [text("heading"), text("views")]);
        await kind.seed(t, "7");
      });

      afterEach(async () => {
        await t?.destroy();
        vi.unstubAllEnvs();
        await rm(basePath, { recursive: true, force: true });
      });

      const migrationFiles = () => {
        const dir = join(basePath, "migrations");
        return existsSync(dir)
          ? readdirSync(dir)
              .filter(name => name.endsWith(".sql"))
              .sort()
          : [];
      };
      const columns = async () =>
        (
          await readTableDefinition(
            statement => exec(t, statement),
            (t.adapter as unknown as DrizzleAdapter).getCapabilities().dialect,
            kind.table
          )
        ).columns
          .map(column => column.name)
          .sort();
      const viewsHeld = async () =>
        (await exec<{ views: unknown }>(t, `SELECT views FROM ${kind.table}`))
          .map(row => String(row.views))
          .sort();
      const refusalOf = (fields: Field[], answers: Answers) =>
        kind.save(t, fields, answers).then(
          () => undefined,
          (error: unknown) => error
        );

      it("refuses a rename pair it does not answer, and changes nothing", async () => {
        const files = migrationFiles();
        const before = await columns();

        const refused = await refusalOf([text("heading"), text("visits")], {});

        // Told as the push tells a refused question: an apply failure with its message.
        expect(refused).toMatchObject({
          code: "NEXTLY_MIGRATION_APPLY_FAILED",
        });
        expect(String(refused)).toMatch(/cancelled/);
        expect(migrationFiles()).toEqual(files);
        expect(await columns()).toEqual(before);
        expect(await viewsHeld()).toEqual(["7"]);
      }, 60_000);

      it("refuses dropping a column that holds values without confirming it, and changes nothing", async () => {
        const files = migrationFiles();
        const before = await columns();

        const refused = await refusalOf([text("heading")], {});

        expect(String(refused)).toMatch(/cancelled/);
        expect(migrationFiles()).toEqual(files);
        expect(await columns()).toEqual(before);
        expect(await viewsHeld()).toEqual(["7"]);
      }, 60_000);

      // Answered, the same saves go through: the check refuses what is unanswered, not the change.
      it("renames the column when the pair is answered, keeping its values", async () => {
        await kind.save(t, [text("heading"), text("visits")], {
          renameResolutions: [
            {
              tableName: kind.table,
              fromColumn: "views",
              toColumn: "visits",
              choice: "rename",
            },
          ],
        });

        expect(await columns()).toContain("visits");
        expect(await columns()).not.toContain("views");
        const held = await exec<{ visits: unknown }>(
          t,
          `SELECT visits FROM ${kind.table}`
        );
        expect(held.map(row => String(row.visits))).toEqual(["7"]);
      }, 60_000);

      it("drops the column when the drop is confirmed", async () => {
        await kind.save(t, [text("heading")], {
          eventResolutions: [
            {
              kind: "confirm_drop",
              eventId: `destructive_drop:${kind.table}.views`,
            },
          ],
        });

        expect(await columns()).not.toContain("views");
      }, 60_000);

      // A field the change keeps by name but turns into a field group stores nothing on the row any
      // more, its values kept in the group's own table: its column goes with what it holds, so its
      // drop is asked as a removed field's is.
      const intoGroup = async () => {
        await dispatchComponents(
          "createComponent",
          {},
          { slug: "card", label: "Card", fields: [text("line")] }
        );
        return [
          text("heading"),
          { name: "views", type: "component", component: "card" },
        ];
      };

      it("refuses turning a field that holds values into a field group without confirming the drop, and changes nothing", async () => {
        const fields = await intoGroup();
        const files = migrationFiles();
        const before = await columns();

        const refused = await refusalOf(fields, {});

        expect(String(refused)).toMatch(/cancelled/);
        expect(migrationFiles()).toEqual(files);
        expect(await columns()).toEqual(before);
        expect(await viewsHeld()).toEqual(["7"]);
      }, 60_000);

      it("turns the field into a field group, dropping its column, when the drop is confirmed", async () => {
        await kind.save(t, await intoGroup(), {
          eventResolutions: [
            {
              kind: "confirm_drop",
              eventId: `destructive_drop:${kind.table}.views`,
            },
          ],
        });

        expect(await columns()).not.toContain("views");
      }, 60_000);

      it("turns the field into a field group when its drop is confirmed by name, as the admin confirms a removed field", async () => {
        await kind.save(t, await intoGroup(), {
          resolutions: { views: { action: "confirm_drop" } },
        });

        expect(await columns()).not.toContain("views");
      }, 60_000);
    }
  );
}

// A field group's row keeps a many-to-many in a column of its own, as a list, where a collection
// keeps it in a link table: turned into a field group, the relationship loses that column and the
// links it holds, so its drop is asked as on any other row.
for (const dialect of getConfiguredTestDialects()) {
  describe(`a field group's many-to-many turned into a field group (${dialect})`, () => {
    let t: TestNextly;
    let basePath: string;
    const related = {
      name: "related",
      type: "relationship",
      options: { relationType: "manyToMany", target: "tags" },
    };
    const intoGroup = [
      text("heading"),
      { name: "related", type: "component", component: "card" },
    ];

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-dialog-questions-"));
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
      });
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "tags", label: "tags", fields: [text("name")] }
      );
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "card", label: "Card", fields: [text("line")] }
      );
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "meta", label: "Meta", fields: [text("heading"), related] }
      );
      await exec(
        t,
        `INSERT INTO comp_meta (id, _parent_id, _parent_table, _parent_field, _order, heading, related) VALUES ('kept-1', 'parent-1', 'dc_parent', 'meta', 0, 'Hello', '["tag-1"]')`
      );
    });

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    const columns = async () =>
      (
        await readTableDefinition(
          statement => exec(t, statement),
          (t.adapter as unknown as DrizzleAdapter).getCapabilities().dialect,
          "comp_meta"
        )
      ).columns.map(column => column.name);
    const save = async (answers: Answers) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "meta" },
        {
          fields: intoGroup,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_components", "meta"),
          ...answers,
        }
      );

    it("refuses it without confirming the drop, keeping the links, and drops the column once confirmed", async () => {
      const refused = await save({}).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(String(refused)).toMatch(/cancelled/);
      expect(await columns()).toContain("related");
      const held = await exec<{ related: unknown }>(
        t,
        "SELECT related FROM comp_meta"
      );
      // PostgreSQL hands the list back parsed; SQLite and MySQL as its text.
      expect(
        held.map(row =>
          typeof row.related === "string"
            ? (JSON.parse(row.related) as unknown)
            : row.related
        )
      ).toEqual([["tag-1"]]);

      await save({
        eventResolutions: [
          {
            kind: "confirm_drop",
            eventId: "destructive_drop:comp_meta.related",
          },
        ],
      });

      expect(await columns()).not.toContain("related");
    }, 60_000);

    it("drops the column once its drop is confirmed by name", async () => {
      await save({ resolutions: { related: { action: "confirm_drop" } } });

      expect(await columns()).not.toContain("related");
    }, 60_000);
  });
}

// A collection keeps a many-to-many in a link table, which the push's preview does not read: it
// asks about the entity's own columns. Removed, or kept by name but turned into a field group, the
// relationship's link table goes with every link, so its drop is confirmed by the field's name, as
// the admin's dialog confirms a removed field.
for (const dialect of getConfiguredTestDialects()) {
  describe(`a collection's many-to-many leaving its link table (${dialect})`, () => {
    let t: TestNextly;
    let basePath: string;
    const related = {
      name: "related",
      type: "relationship",
      options: { relationType: "manyToMany", target: "tags" },
    };
    const link = junctionTableNameFor("dc_posts", related as never);

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-dialog-questions-"));
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
      });
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "tags", label: "tags", fields: [text("name")] }
      );
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "card", label: "Card", fields: [text("line")] }
      );
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "posts", label: "posts", fields: [text("heading"), related] }
      );
      const tag = (await t.nextly.create({
        collection: "tags",
        data: { name: "first" },
      } as never)) as unknown as { item: { id: unknown } };
      await t.nextly.create({
        collection: "posts",
        data: { heading: "Hello", related: [String(tag.item.id)] },
      } as never);
    });

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    // The links the link table holds, or none where the table is gone.
    const links = async () =>
      exec<{ n: number | string }>(t, `SELECT COUNT(*) AS n FROM ${link}`).then(
        rows => Number(rows[0]?.n ?? 0),
        () => 0
      );
    const save = async (fields: Field[], answers: Answers) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_collections", "posts"),
          ...answers,
        }
      );

    it.each([
      {
        change: "turned into a field group",
        fields: [
          text("heading"),
          { name: "related", type: "component", component: "card" },
        ],
      },
      { change: "removed", fields: [text("heading")] },
    ])(
      "refuses the relationship $change unconfirmed, keeping its links, and goes through once confirmed by name",
      async ({ fields }) => {
        expect(await links()).toBe(1);

        const refused = await save(fields, {}).then(
          () => undefined,
          (error: unknown) => error
        );

        expect(refused).toMatchObject({
          code: "NEXTLY_MIGRATION_APPLY_FAILED",
        });
        expect(String(refused)).toMatch(/cancelled/);
        expect(await links()).toBe(1);

        await save(fields, {
          resolutions: { related: { action: "confirm_drop" } },
        });
      },
      60_000
    );
  });
}

// A field inside a group with no name is a column of the row too: removed, it is asked about as
// any removed field is, the dialog's preview lists it for the person to confirm, and their
// confirmation, sent by the field's name as the admin sends it, lets the drop through.
for (const dialect of getConfiguredTestDialects()) {
  describe(`a dialog save that removes a field inside a group with no name (${dialect})`, () => {
    let t: TestNextly;
    let basePath: string;
    const laidOut = (fields: Field[]) => ({
      type: "group",
      label: "Details",
      fields,
    });
    const before = [text("heading"), laidOut([text("views"), text("note")])];
    const after = [text("heading"), laidOut([text("note")])];

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-dialog-questions-"));
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
      });
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "meta", label: "Meta", fields: before }
      );
      await exec(
        t,
        `INSERT INTO comp_meta (id, _parent_id, _parent_table, _parent_field, _order, heading, views, note) VALUES ('kept-1', 'parent-1', 'dc_parent', 'meta', 0, 'Hello', '7', 'n')`
      );
    });

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    const save = async (extra: Record<string, unknown>) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "meta" },
        {
          fields: after,
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_components", "meta"),
          ...extra,
        }
      );
    const columns = async () =>
      (
        await readTableDefinition(
          statement => exec(t, statement),
          (t.adapter as unknown as DrizzleAdapter).getCapabilities().dialect,
          "comp_meta"
        )
      ).columns.map(column => column.name);

    it("refuses removing it unconfirmed, lists it as removed, and drops it once confirmed by name", async () => {
      const refused = await save({}).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(String(refused)).toMatch(/cancelled/);
      expect(await columns()).toContain("views");

      // The dialog's preview, as the Builder reads it from the response.
      const response = await dispatchComponents(
        "previewComponentSchemaChanges",
        { slug: "meta" },
        { fields: after }
      );
      const body = (await (response as Response).json()) as {
        data?: { changes?: { removed?: { name: string }[] } };
        changes?: { removed?: { name: string }[] };
      };
      const shown = body.data ?? body;
      expect((shown.changes?.removed ?? []).map(field => field.name)).toContain(
        "views"
      );

      await save({ resolutions: { views: { action: "confirm_drop" } } });
      expect(await columns()).not.toContain("views");
    }, 60_000);
  });
}

// A translated field's values are kept in the translations table, which the preview of the main
// table does not read: removed, its drop is asked about all the same, and confirmed by its name as
// the admin sends it.
for (const dialect of getConfiguredTestDialects()) {
  describe(`a dialog save that removes a translated field (${dialect})`, () => {
    let t: TestNextly;
    let basePath: string;
    const translated = (name: string) => ({ ...text(name), localized: true });

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-dialog-questions-"));
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          localized: true,
          fields: [translated("heading"), translated("teaser")],
        }
      );
      await t.nextly.updateSingle({
        slug: "notice",
        locale: "en",
        data: { heading: "Hello", teaser: "Read on", _overwrite: true },
      } as never);
    });

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    const save = async (extra: Record<string, unknown>) =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "notice" },
        {
          fields: [translated("heading")],
          confirmed: true,
          localized: true,
          schemaVersion: await versionOf(t, "dynamic_singles", "notice"),
          ...extra,
        }
      );
    const companionColumns = async () =>
      (
        await readTableDefinition(
          statement => exec(t, statement),
          (t.adapter as unknown as DrizzleAdapter).getCapabilities().dialect,
          "single_notice_locales"
        )
      ).columns.map(column => column.name);

    it("refuses removing it unconfirmed, keeping every language, and drops it once confirmed by name", async () => {
      const refused = await save({}).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(refused).toMatchObject({ code: "NEXTLY_MIGRATION_APPLY_FAILED" });
      expect(String(refused)).toMatch(/cancelled/);
      expect(await companionColumns()).toContain("teaser");

      await save({ resolutions: { teaser: { action: "confirm_drop" } } });
      expect(await companionColumns()).not.toContain("teaser");
    }, 60_000);

    // A rename answer is consent only for the pair the dialog offered: one naming the removed field
    // beside a target it never offered answers nothing, and the save is refused, keeping the column.
    it("refuses a rename answer for a pair the dialog never offered, keeping every language", async () => {
      const refused = await save({
        renameResolutions: [
          {
            tableName: "single_notice_locales",
            fromColumn: "teaser",
            toColumn: "nowhere",
            choice: "drop_and_add",
          },
        ],
      }).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(refused).toMatchObject({ code: "NEXTLY_MIGRATION_APPLY_FAILED" });
      expect(await companionColumns()).toContain("teaser");
    }, 60_000);

    // Kept by name but turned into a field group, the field would leave translation with its storage
    // reshaped, which is refused before anything is written, confirmed or not: every language's
    // value stays.
    it("refuses turning it into a field group, confirmed or not, keeping every language", async () => {
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "card", label: "Card", fields: [text("line")] }
      );
      const intoGroup = {
        fields: [
          translated("heading"),
          { name: "teaser", type: "component", component: "card" },
        ],
      };

      for (const answers of [
        {},
        { resolutions: { teaser: { action: "confirm_drop" } } },
      ]) {
        const refused = await save({ ...intoGroup, ...answers }).then(
          () => undefined,
          (error: unknown) => error
        );
        expect(refused).toMatchObject({ code: "VALIDATION_ERROR" });
        expect(await companionColumns()).toContain("teaser");
      }
    }, 60_000);
  });
}

// Under per-language storage an untranslated entity keeps its translatable values in the
// translations table too, so the rename the dialog offers there is answered as it is for a
// translated one, and the save goes through.
for (const dialect of getConfiguredTestDialects()) {
  describe(`a dialog save under per-language storage (${dialect})`, () => {
    let t: TestNextly;
    let basePath: string;

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-dialog-questions-"));
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        perLanguageStorage: true,
      });
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "notice", label: "Notice", fields: [text("heading")] }
      );
      await t.nextly.updateSingle({
        slug: "notice",
        locale: "en",
        data: { heading: "Hello", _overwrite: true },
      } as never);
    });

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    // The answer to the offered rename answers the drop it covers, so the save is not refused as a
    // question left unanswered. What the save does after the questions is not this check's.
    it("does not refuse the answer to the rename the dialog offered on the translations table", async () => {
      const outcome = await dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "notice" },
        {
          fields: [text("title2")],
          confirmed: true,
          schemaVersion: await versionOf(t, "dynamic_singles", "notice"),
          renameResolutions: [
            {
              tableName: "single_notice_locales",
              fromColumn: "heading",
              toColumn: "title2",
              choice: "rename",
            },
          ],
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(String(outcome)).not.toMatch(/cancelled/);
    }, 60_000);
  });
}
