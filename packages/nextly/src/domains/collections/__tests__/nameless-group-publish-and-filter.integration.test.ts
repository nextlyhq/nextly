/**
 * A group with no name in a collection's fields only lays fields out: the fields it holds are
 * stored where it sits, as columns of the entry's row, and a field group placed inside it keeps
 * its instances in its own table, as one beside it does. The collection API refuses a field with
 * no name, so such a group reaches a collection only through its definition.
 *
 * The entry reads and writes already address those fields at the row's level. These cases hold
 * the paths that judged or matched them from the declared top level, where the group hides them:
 * publishing a draft (which decodes its stored JSON and reads its stored field groups), the
 * filter (which matches a reference list by membership, and a field group's fields through its
 * table), the guards a filter on a field group's field passes, and the search.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { _resetEnvCache } from "../../../shared/lib/env";
import { writeCollectionSave } from "../../schema/builder-save/collection-save";
import { generateRuntimeSchema } from "../../schema/services/runtime-schema-generator";

type Doc = Record<string, unknown>;
type Result = { success: boolean; statusCode?: number; data?: unknown };

interface Entries {
  createEntry(
    params: { collectionName: string; overrideAccess?: boolean },
    data: Doc
  ): Promise<Result>;
  updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      overrideAccess?: boolean;
    },
    data: Doc
  ): Promise<Result>;
  listEntries(params: Record<string, unknown>): Promise<{
    success: boolean;
    data?: { docs: Doc[] } | null;
  }>;
}

/** Whether the field group's `code` rule refuses: off while entries are saved, on to publish. */
let ruleOn = false;

/** The caller who may read the collection, whose field rules decide the rest. */
const READER = { id: "ng-reader", email: "ng-reader@example.com" };

/**
 * The collection as the Builder's definition file records it: its fields beside a group with no
 * name, which holds a text, a JSON field, a repeater, a field group and a has-many reference.
 */
const posts = {
  slug: "ngposts",
  labels: { singular: "Post", plural: "Posts" },
  status: true,
  fields: [
    { name: "title", type: "text" },
    {
      type: "group",
      label: "Details",
      fields: [
        { name: "byline", type: "text" },
        { name: "meta", type: "json" },
        {
          name: "links",
          type: "repeater",
          fields: [{ name: "label", type: "text" }],
        },
        { name: "promo", type: "component", component: "ngpromo" },
        {
          name: "tags",
          type: "relationship",
          relationTo: "ngpeople",
          hasMany: true,
        },
      ],
    },
  ],
} as unknown as UiSchemaEntity;

/**
 * An app over a fresh database of `dialect` (SQLite in a file of `dir`), run as the Builder runs
 * it, with the field group and the referenced collection defined in code and the collection
 * holding the group saved through the Builder's save writer: the road such a collection takes,
 * since the collection API refuses a field with no name.
 */
async function boot(dialect: TestDialect, dir: string): Promise<TestNextly> {
  mkdirSync(join(dir, "migrations"));
  const options = {
    db: { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" },
    basePath: dir,
    fieldGroups: [
      defineFieldGroup({
        slug: "ngpromo",
        fields: [
          text({ name: "note" }),
          // A rule tightened after its value was saved, which the value breaks only once it is on.
          text({
            name: "code",
            validate: (value: unknown) =>
              !ruleOn || value !== "retired" || "code is retired",
          }),
          // Readable by no caller: a filter on it would tell its value by which rows match.
          text({ name: "secret", access: { read: () => false } }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: "ngpeople",
        fields: [text({ name: "name" })],
      }),
    ],
  } satisfies Partial<Parameters<typeof createTestNextly>[0]>;
  let t: TestNextly;
  if (dialect === "sqlite") {
    const url = `file:${join(dir, "test.db")}`;
    process.env.DB_DIALECT = "sqlite";
    process.env.DATABASE_URL = url;
    _resetEnvCache();
    const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
      typeof createAdapter
    >[0]);
    t = await createTestNextly({ adapter, ...options });
  } else {
    t = await createTestNextly({ dialect, ...options });
  }
  vi.stubEnv("NODE_ENV", "development");
  const adapter = t.adapter as unknown as DrizzleAdapter;
  await writeCollectionSave(
    {
      adapter,
      config: defineConfig({
        collections: [],
        db: { migrationsDir: "./migrations" },
      }),
      projectRoot: dir,
      migrationsDir: join(dir, "migrations"),
      applies: true,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    },
    { slug: posts.slug, previous: null, entity: posts, change: "create" }
  );
  // The save writer makes the table; the Builder's create then puts it in the running
  // instance's table resolver and the entry reads' schema cache, as every create path does
  // (`registerRuntimeSchema`), so it is registered here the same way.
  const tableName = `dc_${posts.slug}`;
  const { table } = generateRuntimeSchema(
    tableName,
    posts.fields as unknown as FieldDefinition[],
    adapter.getCapabilities().dialect,
    { status: true }
  );
  (
    adapter as unknown as {
      tableResolver: {
        registerDynamicSchema(name: string, t: unknown): void;
      };
    }
  ).tableResolver.registerDynamicSchema(tableName, table);
  (
    t.getService("collectionsHandler") as CollectionsHandler
  ).refreshCollectionSchema(tableName, table);
  await userWhoMay(t, READER.id, "read", ["ngposts"]);
  return t;
}

function entriesOf(t: TestNextly): Entries {
  return (
    t.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as unknown as Entries;
}

async function created(
  t: TestNextly,
  collection: string,
  data: Doc
): Promise<string> {
  const result = await entriesOf(t).createEntry(
    { collectionName: collection, overrideAccess: true },
    data
  );
  expect(result.success, JSON.stringify(result)).toBe(true);
  return String((result.data as { id: unknown }).id);
}

/** A status-only publish: the stored document is what goes live. */
function publish(t: TestNextly, id: string): Promise<Result> {
  return entriesOf(t).updateEntry(
    { collectionName: "ngposts", entryId: id, overrideAccess: true },
    { status: "published", _overwrite: true }
  );
}

/** The titles of the entries `params` lists, sorted. */
async function titlesListed(
  t: TestNextly,
  params: Record<string, unknown>
): Promise<string[]> {
  const listed = await entriesOf(t).listEntries({
    collectionName: "ngposts",
    overrideAccess: true,
    ...params,
  });
  expect(listed.success, JSON.stringify(listed)).toBe(true);
  return listed.data!.docs.map(doc => String(doc.title)).sort();
}

describe.each(getConfiguredTestDialects())(
  "a collection holding a group with no name: publish, filter and search (%s)",
  dialect => {
    let t: TestNextly;
    let dir: string;
    let ana: string;
    let ben: string;
    const previousDialect = process.env.DB_DIALECT;
    const previousUrl = process.env.DATABASE_URL;

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-nameless-publish-"));
      t = await boot(dialect, dir);
      ana = await created(t, "ngpeople", { name: "Ana" });
      ben = await created(t, "ngpeople", { name: "Ben" });
      await created(t, "ngposts", {
        title: "both",
        byline: "written by a pair",
        tags: [ana, ben],
        promo: { note: "pair", secret: "s1" },
      });
      await created(t, "ngposts", {
        title: "ben only",
        byline: "solo work",
        tags: [ben],
        promo: { note: "solo", secret: "s2" },
      });
    }, 120_000);

    afterAll(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      if (previousDialect === undefined) delete process.env.DB_DIALECT;
      else process.env.DB_DIALECT = previousDialect;
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      _resetEnvCache();
      rmSync(dir, { recursive: true, force: true });
    });

    it("publishes a draft holding a JSON and a repeater field inside the group, and answers with their values", async () => {
      const draft = await entriesOf(t).createEntry(
        { collectionName: "ngposts", overrideAccess: true },
        {
          title: "lists",
          status: "draft",
          meta: { tone: "warm" },
          links: [{ label: "Home" }],
        }
      );
      // The create answers with the values too, not the text a dialect stores JSON in.
      expect(draft.data).toMatchObject({
        meta: { tone: "warm" },
        links: [expect.objectContaining({ label: "Home" })],
      });
      const id = String((draft.data as { id: unknown }).id);

      // Judged as the values the reads return, not as the text a dialect stores JSON in.
      const published = await publish(t, id);
      expect(published.success, JSON.stringify(published)).toBe(true);
      expect(published.data).toMatchObject({
        status: "published",
        meta: { tone: "warm" },
        links: [expect.objectContaining({ label: "Home" })],
      });
    });

    it("refuses to publish a draft whose field group inside the group breaks a rule tightened since it was saved", async () => {
      const id = await created(t, "ngposts", {
        title: "held back",
        status: "draft",
        promo: { note: "kept", code: "retired" },
      });
      const fine = await created(t, "ngposts", {
        title: "let through",
        status: "draft",
        promo: { note: "kept", code: "current" },
      });

      ruleOn = true;
      try {
        // The stored field group is read and judged as it goes live, as one beside the group is,
        // and the refusal names the field inside it.
        const refused = await publish(t, id);
        expect(refused.success).toBe(false);
        expect(JSON.stringify(refused)).toContain('"path":"promo.code"');

        // The control: a draft the rule lets through goes live, so the refusal is the rule's.
        const published = await publish(t, fine);
        expect(published.success, JSON.stringify(published)).toBe(true);
      } finally {
        ruleOn = false;
      }
    });

    it("matches a has-many reference inside the group by membership", async () => {
      expect(await titlesListed(t, { where: { tags: { in: [ana] } } })).toEqual(
        ["both"]
      );
      expect(await titlesListed(t, { where: { tags: { in: [ben] } } })).toEqual(
        ["ben only", "both"]
      );
      // `not_in` keeps only the entries listing none of the ids; one without the field holds none.
      const without = await titlesListed(t, {
        where: { tags: { not_in: [ana] } },
      });
      expect(without).toContain("ben only");
      expect(without).not.toContain("both");
    });

    it("filters by a field of a field group inside the group, through its table", async () => {
      expect(
        await titlesListed(t, { where: { "promo.note": { equals: "solo" } } })
      ).toEqual(["ben only"]);
    });

    it("refuses a caller's filter on an unreadable field of a field group inside the group", async () => {
      // The control: the field is filterable where access is not judged, so the refusal below is
      // the guard's and not a filter that cannot be built.
      expect(
        await titlesListed(t, { where: { "promo.secret": { equals: "s1" } } })
      ).toEqual(["both"]);

      const refused = await entriesOf(t).listEntries({
        collectionName: "ngposts",
        overrideAccess: false,
        user: READER,
        where: { "promo.secret": { equals: "s1" } },
      });
      expect(refused.success).toBe(false);
      expect(JSON.stringify(refused)).toContain("FIELD_NOT_FILTERABLE");
    });

    it("searches a text field inside the group, as one beside it", async () => {
      expect(await titlesListed(t, { search: "solo" })).toEqual(["ben only"]);
    });
  }
);
