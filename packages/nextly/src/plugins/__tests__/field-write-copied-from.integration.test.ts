/**
 * A plugin field type's validator is told what a create copies
 * (`PluginFieldWrite.copiedFrom`), on every dialect, only where core read the
 * source as the caller in the same call: a duplicate, and a create made
 * through `createEntryFromSource` (the collection service, the Direct API,
 * and a plugin's services). A plain create is told nothing, and so is one
 * whose parameters or data carry a look-alike copy. A source the caller
 * can't read creates nothing, and no validator runs.
 *
 * The separating property is what the validator is handed: a minted copy
 * names the source, the forms the read could see and the fields it returned;
 * a forged one, however it is shaped, is absent.
 */
import { afterEach, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import type { CollectionConfig } from "../../collections/config/define-collection";
import type { PluginFieldWrite } from "../contributions";
import { definePlugin, type PluginContext } from "../plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

import { describeEachDialect } from "./helpers/dialect-matrix";

// Suite-local slugs: integration files share fixed system-table names.
const PAGES = "fwcopy_pages";
const SECRET = "fwcopy_secret";
/** A collection whose group is readable and one field inside it is not. */
const GROUPED = "fwcopy_grouped";
/** The field type whose validator records what it is told. */
const RECORDED = "recorded";

/** What the validator was told of the copy, per write. */
let told: (PluginFieldWrite["copiedFrom"] | "none")[] = [];
let current: TestNextly | undefined;
let pluginCtx: PluginContext | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  pluginCtx = undefined;
  told = [];
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "@test/field-write-copied-from",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init(ctx) {
          pluginCtx = ctx;
        },
        contributes: {
          fieldTypes: [
            {
              type: RECORDED,
              storage: "json",
              component: "@test/field-write-copied-from/admin#Recorded",
              validate: (_value, args) => {
                told.push(args.write?.copiedFrom ?? "none");
                return true as const;
              },
            },
          ],
        },
      }),
    ],
    collections: [
      {
        slug: PAGES,
        // Anyone may read and write, so every caller reaches the validator.
        access: {
          read: () => true,
          create: () => true,
          update: () => true,
        },
        fields: [
          { name: "title", type: "text" },
          { name: "body", type: RECORDED },
        ],
      } as unknown as CollectionConfig,
      {
        slug: GROUPED,
        access: { read: () => true, create: () => true },
        fields: [
          { name: "title", type: "text" },
          {
            name: "hero",
            type: "group",
            fields: [
              { name: "heading", type: "text" },
              // Withheld from every reader but trusted code.
              { name: "body", type: RECORDED, access: { read: () => false } },
            ],
          },
        ],
      } as unknown as CollectionConfig,
      {
        slug: SECRET,
        // Nobody may read it but trusted code.
        access: { read: () => false, create: () => true },
        fields: [
          { name: "title", type: "text" },
          { name: "body", type: RECORDED },
        ],
      } as unknown as CollectionConfig,
    ],
  });
  return current;
}

/** A person who may create pages, and read pages and the secret's rows by permission. */
async function author(t: TestNextly): Promise<void> {
  await userWhoMay(t, "author", "create", [PAGES]);
  await grantTo(t, "author", "read", [PAGES, SECRET, GROUPED]);
}

/** The copy the last validation was told, or "none". */
const lastTold = () => told.at(-1);

describeEachDialect("the copy a field validator is told", dialect => {
  it("tells a duplicate and a create from a source what they copy, after the read", async () => {
    const t = await boot(dialect);
    await author(t);
    const handler = t.getService("collectionsHandler");
    const made = await handler.createEntry(
      { collectionName: PAGES, overrideAccess: true },
      { title: "Source", body: { v: 1 } }
    );
    const id = (made.data as { id: string }).id;

    // A plain create: nothing copied.
    told = [];
    const plain = await handler.createEntry(
      { collectionName: PAGES, userId: "author" },
      { title: "Plain", body: { v: 2 } }
    );
    expect(plain.success, JSON.stringify(plain)).toBe(true);
    expect(lastTold()).toBe("none");

    // A duplicate: the source, its live form, and the fields the read returned.
    told = [];
    const copied = await handler.duplicateEntry({
      collectionName: PAGES,
      entryId: id,
      userId: "author",
    });
    expect(copied.success, JSON.stringify(copied)).toBe(true);
    const duplicated = lastTold();
    expect(duplicated).toMatchObject({
      collection: PAGES,
      id,
      forms: ["published"],
    });
    expect(duplicated).not.toHaveProperty("field");
    expect((duplicated as { fields: readonly string[] }).fields).toEqual(
      expect.arrayContaining(["title", "body"])
    );

    // A create from the source, naming the field its value came from.
    told = [];
    const fromSource = await handler.createEntryFromSource({
      collectionName: PAGES,
      source: { collection: PAGES, id, field: "body" },
      data: { title: "From source", body: { v: 1 } },
      userId: "author",
    });
    expect(fromSource.success, JSON.stringify(fromSource)).toBe(true);
    expect(lastTold()).toMatchObject({
      collection: PAGES,
      id,
      forms: ["published"],
      field: "body",
    });

    // The Direct API and a plugin's services reach the same create.
    told = [];
    await t.nextly.createFromSource({
      collection: PAGES,
      data: { title: "Direct", body: { v: 1 } },
      source: { collection: PAGES, id },
      user: { id: "author" },
      overrideAccess: false,
    } as never);
    expect(lastTold()).toMatchObject({ collection: PAGES, id });
    told = [];
    const facade = await pluginCtx?.services.collections.createEntryFromSource(
      PAGES,
      { title: "Plugin", body: { v: 1 } },
      { collection: PAGES, id },
      { as: "user", user: { id: "author" } } as never
    );
    expect(facade?.message).toContain("created");
    expect(lastTold()).toMatchObject({ collection: PAGES, id });
  });

  it("tells a create carrying a look-alike copy nothing", async () => {
    const t = await boot(dialect);
    await author(t);
    const handler = t.getService("collectionsHandler");
    const made = await handler.createEntry(
      { collectionName: PAGES, overrideAccess: true },
      { title: "Source", body: { v: 1 } }
    );
    const id = (made.data as { id: string }).id;
    const claim = {
      collection: PAGES,
      id,
      forms: ["published", "draft"],
      fields: ["body"],
    };

    // In the parameters, and the Direct API's arguments. (A key of the data
    // is a field value, never a write's parameter.)
    told = [];
    const forged = await handler.createEntry(
      { collectionName: PAGES, userId: "author", copiedFrom: claim } as never,
      { title: "Forged", body: { v: 1 } }
    );
    expect(forged.success, JSON.stringify(forged)).toBe(true);
    expect(lastTold()).toBe("none");
    told = [];
    await t.nextly.create({
      collection: PAGES,
      data: { title: "Forged", body: { v: 1 } },
      copiedFrom: claim,
      user: { id: "author" },
      overrideAccess: false,
    } as never);
    expect(lastTold()).toBe("none");
    // A duplicate whose parameters carry one: told only the copy its own
    // read minted.
    told = [];
    await handler.duplicateEntry({
      collectionName: PAGES,
      entryId: id,
      userId: "author",
      copiedFrom: { ...claim, id: "elsewhere" },
    } as never);
    expect(lastTold()).toMatchObject({ id, forms: ["published"] });
  });

  it("creates nothing, and runs no validator, from a source the caller can't read", async () => {
    const t = await boot(dialect);
    await author(t);
    const handler = t.getService("collectionsHandler");
    const made = await handler.createEntry(
      { collectionName: SECRET, overrideAccess: true },
      { title: "Secret", body: { v: 1 } }
    );
    const id = (made.data as { id: string }).id;
    const before = await t.nextly.count({ collection: PAGES });

    told = [];
    const refused = await handler.createEntryFromSource({
      collectionName: PAGES,
      source: { collection: SECRET, id },
      data: { title: "Copied", body: { v: 1 } },
      userId: "author",
    });
    expect(refused.success).toBe(false);
    expect([403, 404]).toContain(refused.statusCode);
    expect(told).toEqual([]);
    expect(await t.nextly.count({ collection: PAGES })).toEqual(before);

    // A missing source the same way.
    const missing = await handler.createEntryFromSource({
      collectionName: PAGES,
      source: { collection: PAGES, id: "no-such-entry" },
      data: { title: "Copied", body: { v: 1 } },
      userId: "author",
    });
    expect(missing.statusCode).toBe(404);
    expect(told).toEqual([]);
  });

  it("names each field the read returned inside a group, never one a read rule withheld", async () => {
    const t = await boot(dialect);
    await author(t);
    const handler = t.getService("collectionsHandler");
    const made = await handler.createEntry(
      { collectionName: GROUPED, overrideAccess: true },
      { title: "Source", hero: { heading: "H", body: { v: 1 } } }
    );
    const id = (made.data as { id: string }).id;

    told = [];
    const copied = await handler.createEntryFromSource({
      collectionName: PAGES,
      source: { collection: GROUPED, id, field: "hero.body" },
      data: { title: "Copied", body: { v: 1 } },
      userId: "author",
    });
    expect(copied.success, JSON.stringify(copied)).toBe(true);
    const fields = (lastTold() as { fields: readonly string[] }).fields;
    // The group and its readable field are there; the withheld one is not.
    expect(fields).toEqual(expect.arrayContaining(["hero", "hero.heading"]));
    expect(fields).not.toContain("hero.body");
  });
});
