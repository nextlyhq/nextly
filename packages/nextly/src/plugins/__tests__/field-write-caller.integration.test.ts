/**
 * A plugin field type's validator is told who the write is made as
 * (`PluginFieldWrite.caller`), on every dialect, from the reader the write's
 * own access is judged by: a signed-in user, by their own permissions; an
 * API key, by the key's scope, never its maker's; and trusted code
 * (`overrideAccess`), which every check lets through. A Single's write is
 * told it the same way.
 *
 * The separating property is the answer to `can`: a user who holds the
 * permission and one who does not get different answers, and a key made by
 * the one who holds it does not inherit it.
 */
import { afterEach, expect, it } from "vitest";

import {
  grantTo,
  superAdminUser,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import type { CollectionConfig } from "../../collections/config/define-collection";
import type { PluginFieldWriteCaller } from "../contributions";
import { definePlugin } from "../plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

import { describeEachDialect } from "./helpers/dialect-matrix";

// Suite-local slugs: integration files share fixed system-table names.
const PAGES = "fwcaller_pages";
const HOME = "fwcaller_home";
/** A field group holding the guarded type, placed in both. */
const HERO = "fwcaller_hero";
/** The field type whose validator records what it is told. */
const GUARDED = "guarded";
/** The permission the validator asks about. */
const ACTION = "manage";
const RESOURCE = "fwcaller-site";

/** What the validator was told, per write. */
interface Told {
  kind: PluginFieldWriteCaller["kind"] | "none";
  may: boolean;
  /** Whether the value sat in a field-group instance. */
  inFieldGroup: boolean;
}
let told: Told[] = [];
let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  told = [];
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "@test/field-write-caller",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          fieldTypes: [
            {
              type: GUARDED,
              storage: "json",
              component: "@test/field-write-caller/admin#Guarded",
              validate: async (_value, args) => {
                const caller = args.write?.caller;
                told.push({
                  kind: caller?.kind ?? "none",
                  may: (await caller?.can(ACTION, RESOURCE)) ?? false,
                  inFieldGroup: args.write?.inFieldGroup === true,
                });
                return true as const;
              },
            },
          ],
        },
      }),
    ],
    // Raw configs: the type is registered by the plugin at boot.
    fieldGroups: [
      { slug: HERO, fields: [{ name: "body", type: GUARDED }] } as never,
    ],
    collections: [
      {
        slug: PAGES,
        // Anyone may write, so every caller reaches the validator.
        access: {
          read: () => true,
          create: () => true,
          update: () => true,
        },
        fields: [
          { name: "title", type: "text" },
          { name: "body", type: GUARDED },
          { name: "hero", type: "component", component: HERO },
        ],
      } as unknown as CollectionConfig,
    ],
    singles: [
      {
        slug: HOME,
        access: { read: () => true, update: () => true },
        fields: [
          { name: "body", type: GUARDED },
          { name: "hero", type: "component", component: HERO },
        ],
      } as never,
    ],
  });
  return current;
}

describeEachDialect("the caller a field validator is told", dialect => {
  it("tells a user by their own permissions, a key by its own scope, and trusted code as the system", async () => {
    const t = await boot(dialect);
    // Both may create pages; only one may change what the validator guards.
    await userWhoMay(t, "permitted", ACTION, [RESOURCE]);
    await grantTo(t, "permitted", "create", [PAGES]);
    await userWhoMay(t, "plain", "create", [PAGES]);
    const handler = t.getService("collectionsHandler");

    const write = async (params: Record<string, unknown>): Promise<Told> => {
      told = [];
      const made = await handler.createEntry(
        { collectionName: PAGES, ...params },
        { title: "t", body: { v: 1 } }
      );
      expect(made.success, JSON.stringify(made)).toBe(true);
      expect(told.length).toBeGreaterThan(0);
      return told[told.length - 1];
    };

    // A signed-in user who holds the permission, and one who does not.
    expect(await write({ userId: "permitted" })).toMatchObject({
      kind: "user",
      may: true,
    });
    expect(await write({ userId: "plain" })).toMatchObject({
      kind: "user",
      may: false,
    });
    // A key made by the one who holds it, scoped without it: the key's
    // scope decides, not its maker's grants.
    expect(
      await write({
        userId: "permitted",
        authenticatedScope: {
          actorType: "apiKey",
          permissions: [`create-${PAGES}`],
        },
      })
    ).toMatchObject({ kind: "apiKey", may: false });
    // A key whose scope holds it.
    expect(
      await write({
        userId: "permitted",
        authenticatedScope: {
          actorType: "apiKey",
          permissions: [`create-${PAGES}`, `${ACTION}-${RESOURCE}`],
        },
      })
    ).toMatchObject({ kind: "apiKey", may: true });
    // Trusted code.
    expect(await write({ overrideAccess: true })).toMatchObject({
      kind: "system",
      may: true,
    });
  });

  it("tells a validator inside a field-group instance the same caller, and that it sits in one", async () => {
    const t = await boot(dialect);
    await userWhoMay(t, "permitted", ACTION, [RESOURCE]);
    await grantTo(t, "permitted", "create", [PAGES]);
    await grantTo(t, "permitted", "update", [PAGES]);
    await userWhoMay(t, "plain", "create", [PAGES]);
    await grantTo(t, "plain", "update", [PAGES, HOME]);
    const handler = t.getService("collectionsHandler");
    /** What the instance's own validator was told, on its last run. */
    const inInstance = () => told.filter(entry => entry.inFieldGroup).at(-1);

    // A create, as each kind of caller.
    const create = async (params: Record<string, unknown>) => {
      told = [];
      const made = await handler.createEntry(
        { collectionName: PAGES, ...params },
        { title: "t", body: { v: 0 }, hero: { body: { v: 1 } } }
      );
      expect(made.success, JSON.stringify(made)).toBe(true);
      return made;
    };
    const made = await create({ userId: "permitted" });
    expect(inInstance()).toEqual({
      kind: "user",
      may: true,
      inFieldGroup: true,
    });
    await create({ userId: "plain" });
    expect(inInstance()).toEqual({
      kind: "user",
      may: false,
      inFieldGroup: true,
    });
    await create({ overrideAccess: true });
    expect(inInstance()).toEqual({
      kind: "system",
      may: true,
      inFieldGroup: true,
    });
    await create({
      userId: "permitted",
      authenticatedScope: {
        actorType: "apiKey",
        permissions: [`create-${PAGES}`],
      },
    });
    expect(inInstance()).toEqual({
      kind: "apiKey",
      may: false,
      inFieldGroup: true,
    });
    // The entry's own top-level field is not in one.
    expect(told.find(entry => !entry.inFieldGroup)?.inFieldGroup).toBe(false);

    // An update of the same entry.
    const id = (made as { data?: { id?: string } }).data?.id;
    expect(typeof id).toBe("string");
    told = [];
    const updated = await handler.updateEntry(
      { collectionName: PAGES, entryId: id as string, userId: "permitted" },
      { hero: { body: { v: 2 } }, _overwrite: true }
    );
    expect(updated.success, JSON.stringify(updated)).toBe(true);
    expect(inInstance()).toEqual({
      kind: "user",
      may: true,
      inFieldGroup: true,
    });

    // A Single's field-group write.
    const direct = t.nextly as unknown as {
      updateSingle(args: Record<string, unknown>): Promise<unknown>;
    };
    told = [];
    await direct.updateSingle({
      slug: HOME,
      data: { hero: { body: { v: 3 } }, _overwrite: true },
      overrideAccess: false,
      user: { id: "plain" },
    });
    expect(inInstance()).toEqual({
      kind: "user",
      may: false,
      inFieldGroup: true,
    });
  });

  it("tells a Single's write the same way", async () => {
    const t = await boot(dialect);
    await superAdminUser(t, "admin");
    await userWhoMay(t, "plain", "update", [HOME]);
    const direct = t.nextly as unknown as {
      updateSingle(args: Record<string, unknown>): Promise<unknown>;
    };

    told = [];
    await direct.updateSingle({
      slug: HOME,
      data: { body: { v: 1 }, _overwrite: true },
      overrideAccess: false,
      user: { id: "plain" },
    });
    expect(told.at(-1)).toMatchObject({ kind: "user", may: false });

    told = [];
    await direct.updateSingle({
      slug: HOME,
      data: { body: { v: 2 }, _overwrite: true },
      overrideAccess: true,
    });
    expect(told.at(-1)).toMatchObject({ kind: "system", may: true });

    // A super-admin holds every permission, as the route gate answers.
    told = [];
    await direct.updateSingle({
      slug: HOME,
      data: { body: { v: 3 }, _overwrite: true },
      overrideAccess: false,
      user: { id: "admin" },
    });
    expect(told.at(-1)).toMatchObject({ kind: "user", may: true });
  });
});
