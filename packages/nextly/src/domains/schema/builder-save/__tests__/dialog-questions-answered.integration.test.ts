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

type Field = { name: string; type: string };
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
    }
  );
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
