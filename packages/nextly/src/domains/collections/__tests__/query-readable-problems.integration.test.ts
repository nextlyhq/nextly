/**
 * The question a list read asks before it reads, answered without reading:
 * every reason the read would refuse this caller's query, or none. It is the
 * read's own chain, run and read for its refusal, so it says no exactly where
 * the read refuses, on every configured dialect, and a failure that is not a
 * refusal is never an answer.
 */
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, password, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type Envelope = { success: boolean; statusCode?: number; data: unknown };
type Problem = { path: string; code: string; message: string };
interface Handler {
  listEntries: (p: Record<string, unknown>) => Promise<Envelope>;
  queryReadableProblems: (p: Record<string, unknown>) => Promise<Problem[]>;
}

const VAULTS = "qrp_vaults";
const BOSS = { id: "boss", email: "boss@example.com" };
const AGENT = { id: "agent", email: "agent@example.com" };

async function boot(dialect: TestDialect): Promise<Handler> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: VAULTS,
        access: { read: () => true, create: () => true },
        fields: [
          text({ name: "title" }),
          text({
            name: "codename",
            access: {
              read: ({ req }: { req: { user?: { id?: unknown } } }) =>
                req.user?.id === BOSS.id,
            },
          } as never),
          password({ name: "vaultKey" }),
        ],
      } as never),
    ],
  });
  for (const caller of [BOSS, AGENT]) {
    await userWhoMay(current, caller.id, "read", [VAULTS]);
  }
  return current.getService("collectionsHandler") as unknown as Handler;
}

const asked = (user: typeof BOSS, extra: Record<string, unknown>) => ({
  collectionName: VAULTS,
  overrideAccess: false,
  user,
  ...extra,
});

describe.each(getConfiguredTestDialects())(
  "what a list read would refuse, asked without reading (%s)",
  dialect => {
    it("answers none for a query the read allows, and a problem where it refuses", async () => {
      const h = await boot(dialect);
      const where = { codename: { equals: "alpha" } };
      // The control: the caller the rule lets read it.
      expect(await h.queryReadableProblems(asked(BOSS, { where }))).toEqual([]);
      const refused = await h.queryReadableProblems(asked(AGENT, { where }));
      expect(refused).toEqual([
        expect.objectContaining({
          path: "where.codename",
          code: "FIELD_NOT_FILTERABLE",
        }),
      ]);
      // And the read itself refuses the same query, unchanged.
      const read = await h.listEntries(asked(AGENT, { where }));
      expect(read.success).toBe(false);
    });

    it.each<[string, Record<string, unknown>, string]>([
      [
        "a sort on a field the caller may not read",
        { sort: "codename" },
        "FIELD_NOT_SORTABLE",
      ],
      [
        "a group key on a field the caller may not read",
        { groupBy: "codename" },
        "FIELD_NOT_GROUPABLE",
      ],
      [
        "a filter on a password field",
        { where: { vaultKey: { equals: "x" } } },
        "vaultKey",
      ],
      [
        "a filter on a field the read leaves out",
        {
          where: { title: { equals: "x" } },
          hiddenFields: async () => new Set(["title"]),
        },
        "title",
      ],
      [
        "a filter on what a release holds, by a caller who may not read releases",
        { where: { _inRelease: { equals: "r1" } } },
        "_inRelease",
      ],
    ])("reads %s as a problem", async (_case, extra, named) => {
      const h = await boot(dialect);
      const problems = await h.queryReadableProblems(asked(AGENT, extra));
      expect(problems.length).toBeGreaterThan(0);
      expect(JSON.stringify(problems)).toContain(named);
    });

    it("rethrows a failure that is not a refusal, never answering none", async () => {
      const h = await boot(dialect);
      await expect(
        h.queryReadableProblems(
          asked(BOSS, {
            collectionName: "no-such-collection",
            where: { codename: { equals: "alpha" } },
          })
        )
      ).rejects.toBeDefined();
    });
  }
);
