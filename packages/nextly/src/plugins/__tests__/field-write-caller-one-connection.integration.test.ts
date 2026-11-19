/**
 * A field validator's `caller.can` is answered on the write's own
 * connection, on every dialect. A validator inside a field-group instance
 * runs while the write holds its transaction; asked on the pool, a
 * permitted user's permission waited for the connection the write held and,
 * the read failing, was answered no, so a permitted user's save was refused.
 * Here the pool has one connection, so any read on it inside the write would
 * wait for that connection; and the permission version this process keeps
 * for a second is let lapse just before the question, as a write longer than
 * a second finds it, so the answer is read rather than remembered.
 */
import { afterEach, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import type { CollectionConfig } from "../../collections/config/define-collection";
import { resetEpochForTests } from "../../services/lib/rbac-epoch";
import { definePlugin } from "../plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

import { describeEachDialect } from "./helpers/dialect-matrix";

// One connection, so a read on the pool inside the write has none to take.
// Set before any instance boots: the pool reads it then.
process.env.DB_POOL_MAX = "1";

// Suite-local slugs: integration files share fixed system-table names.
const PAGES = "fwc1_pages";
const HERO = "fwc1_hero";
const GUARDED = "guarded";
const ACTION = "manage";
const RESOURCE = "fwc1-site";

/** Each answer `can` gave, and whether it was asked inside an instance. */
let told: Array<{ may: boolean; inFieldGroup: boolean }> = [];
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
        name: "@test/field-write-caller-one-connection",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          fieldTypes: [
            {
              type: GUARDED,
              storage: "json",
              component: "@test/field-write-caller-one-connection/admin#G",
              validate: async (_value, args) => {
                if (args.write?.inFieldGroup === true) resetEpochForTests();
                const may =
                  (await args.write?.caller?.can(ACTION, RESOURCE)) ?? false;
                told.push({
                  may,
                  inFieldGroup: args.write?.inFieldGroup === true,
                });
                return may ? true : "Only someone who may manage the site";
              },
            },
          ],
        },
      }),
    ],
    fieldGroups: [
      { slug: HERO, fields: [{ name: "body", type: GUARDED }] } as never,
    ],
    collections: [
      {
        slug: PAGES,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [
          { name: "title", type: "text" },
          { name: "hero", type: "component", component: HERO },
        ],
      } as unknown as CollectionConfig,
    ],
  });
  return current;
}

describeEachDialect("a field validator's caller on one connection", dialect => {
  it("answers a permitted user's permission inside a field-group instance, and saves", async () => {
    const t = await boot(dialect);
    await userWhoMay(t, "permitted", ACTION, [RESOURCE]);
    await grantTo(t, "permitted", "create", [PAGES]);
    const made = await t
      .getService("collectionsHandler")
      .createEntry(
        { collectionName: PAGES, userId: "permitted" },
        { title: "t", hero: { body: { v: 1 } } }
      );
    expect(made.success, JSON.stringify(made)).toBe(true);
    // Asked inside the instance, and answered yes.
    expect(told.filter(entry => entry.inFieldGroup)).toEqual([
      { may: true, inFieldGroup: true },
    ]);
  }, 60_000);
});
