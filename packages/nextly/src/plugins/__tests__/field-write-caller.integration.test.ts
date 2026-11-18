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
/** The field type whose validator records what it is told. */
const GUARDED = "guarded";
/** The permission the validator asks about. */
const ACTION = "manage";
const RESOURCE = "fwcaller-site";

/** What the validator was told, per write. */
interface Told {
  kind: PluginFieldWriteCaller["kind"] | "none";
  may: boolean;
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
                });
                return true as const;
              },
            },
          ],
        },
      }),
    ],
    // Raw configs: the type is registered by the plugin at boot.
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
        ],
      } as unknown as CollectionConfig,
    ],
    singles: [
      {
        slug: HOME,
        access: { read: () => true, update: () => true },
        fields: [{ name: "body", type: GUARDED }],
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
    expect(await write({ userId: "permitted" })).toEqual({
      kind: "user",
      may: true,
    });
    expect(await write({ userId: "plain" })).toEqual({
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
    ).toEqual({ kind: "apiKey", may: false });
    // A key whose scope holds it.
    expect(
      await write({
        userId: "permitted",
        authenticatedScope: {
          actorType: "apiKey",
          permissions: [`create-${PAGES}`, `${ACTION}-${RESOURCE}`],
        },
      })
    ).toEqual({ kind: "apiKey", may: true });
    // Trusted code.
    expect(await write({ overrideAccess: true })).toEqual({
      kind: "system",
      may: true,
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
    expect(told.at(-1)).toEqual({ kind: "user", may: false });

    told = [];
    await direct.updateSingle({
      slug: HOME,
      data: { body: { v: 2 }, _overwrite: true },
      overrideAccess: true,
    });
    expect(told.at(-1)).toEqual({ kind: "system", may: true });

    // A super-admin holds every permission, as the route gate answers.
    told = [];
    await direct.updateSingle({
      slug: HOME,
      data: { body: { v: 3 }, _overwrite: true },
      overrideAccess: false,
      user: { id: "admin" },
    });
    expect(told.at(-1)).toEqual({ kind: "user", may: true });
  });
});
