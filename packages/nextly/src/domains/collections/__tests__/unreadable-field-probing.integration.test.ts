/**
 * Whether a caller may filter, sort, group or search on a field follows
 * whether the field's read rule lets THAT caller read it, judged without an
 * entry — on every configured dialect.
 *
 * Two rules, one each side of the line:
 *
 * - `codename` lets one caller ("boss") read it and nobody else. Boss may use
 *   it in a query; anyone else is refused, naming the field as they wrote it.
 *   The refusal used to be for EVERY caller, the one the rule allows
 *   included, so the allowed caller's cases are the ones this change moves.
 * - `ownerNote` is readable only on the caller's own entries. With no entry to
 *   judge, nobody may use it in a query — its owner included — since an
 *   ordering, a predicate or a search would reveal it on entries where it is
 *   hidden. A configured search covering it leaves it out.
 */
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
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

type Envelope = {
  success: boolean;
  statusCode?: number;
  data: unknown;
};
type Handler = {
  listEntries: (p: Record<string, unknown>) => Promise<Envelope>;
  countEntries: (p: Record<string, unknown>) => Promise<Envelope>;
  groupEntries: (p: Record<string, unknown>) => Promise<Envelope>;
  createEntry: (
    p: Record<string, unknown>,
    data: Record<string, unknown>
  ) => Promise<Envelope>;
};

const VAULTS = "vaults";
const BOSS = { id: "boss", email: "boss@example.com" };
const AGENT = { id: "agent", email: "agent@example.com" };

async function boot(dialect: TestDialect): Promise<Handler> {
  current = await createTestNextly({
    dialect,
    // The anonymous caller is a visitor, judged by the Public role a real
    // boot makes, which reads `vaults` by its `true` read rule.
    seedPublic: true,
    collections: [
      defineCollection({
        slug: VAULTS,
        access: { read: () => true, create: () => true },
        search: { searchableFields: ["title", "codename", "ownerNote"] },
        fields: [
          text({ name: "title" }),
          text({ name: "owner" }),
          text({
            name: "codename",
            access: {
              read: ({ req }: { req: { user?: { id?: unknown } } }) =>
                req.user?.id === BOSS.id,
            },
          } as never),
          text({
            name: "ownerNote",
            access: {
              read: ({
                req,
                data,
              }: {
                req: { user?: { id?: unknown } };
                data?: Record<string, unknown>;
              }) =>
                // The documented ownership pattern. With no entry and no
                // caller it reads `undefined === undefined`, which is true.
                data?.owner === req.user?.id,
            },
          } as never),
        ],
      } as never),
    ],
  });
  // A code rule only narrows the permission, so both callers hold read on
  // vaults; the field rules are what tell them apart.
  for (const caller of [BOSS, AGENT]) {
    await userWhoMay(current, caller.id, "read", [VAULTS]);
  }
  const h = current.getService("collectionsHandler") as unknown as Handler;
  for (const [title, codename, owner, ownerNote] of [
    ["north", "alpha", "agent", "zebra"],
    ["south", "beta", "boss", "yak"],
  ]) {
    await h.createEntry(
      { collectionName: VAULTS, overrideAccess: true },
      { title, codename, owner, ownerNote }
    );
  }
  return h;
}

const read = (user: typeof BOSS, extra: Record<string, unknown>) => ({
  collectionName: VAULTS,
  overrideAccess: false,
  user,
  ...extra,
});

const titles = (e: Envelope): string[] =>
  ((e.data as { docs: { title: string }[] }).docs ?? []).map(d => d.title);

/** The refusal's codes and paths, failing when the read answered. */
function refusal(e: Envelope): string[] {
  expect(e.success, JSON.stringify(e)).toBe(false);
  expect(e.statusCode).toBe(400);
  return [JSON.stringify(e)];
}

describe.each(getConfiguredTestDialects())(
  "querying on a field the caller may not read (%s)",
  dialect => {
    it("lets the caller the rule allows filter, sort, count and group on it", async () => {
      const h = await boot(dialect);

      const filtered = await h.listEntries(
        read(BOSS, { where: { codename: { equals: "alpha" } } })
      );
      expect(filtered.success, JSON.stringify(filtered)).toBe(true);
      expect(titles(filtered)).toEqual(["north"]);

      const sorted = await h.listEntries(read(BOSS, { sort: "-codename" }));
      expect(sorted.success, JSON.stringify(sorted)).toBe(true);
      expect(titles(sorted)).toEqual(["south", "north"]);

      const counted = await h.countEntries(
        read(BOSS, { where: { codename: { equals: "beta" } } })
      );
      expect(counted.success, JSON.stringify(counted)).toBe(true);
      expect((counted.data as { totalDocs: number }).totalDocs).toBe(1);

      const grouped = await h.groupEntries(read(BOSS, { groupBy: "codename" }));
      expect(grouped.success, JSON.stringify(grouped)).toBe(true);
    });

    it("searches the field for the caller the rule allows", async () => {
      // A configured search covers only the fields the caller may read, and
      // boss may read `codename`, so a term only it holds finds its entry.
      const h = await boot(dialect);
      const found = await h.listEntries(read(BOSS, { search: "alpha" }));
      expect(found.success, JSON.stringify(found)).toBe(true);
      expect(titles(found)).toEqual(["north"]);
    });

    it("refuses anyone else, naming the field as they wrote it", async () => {
      const h = await boot(dialect);
      const cases: Array<[string, Envelope, string]> = [
        [
          "where",
          await h.listEntries(
            read(AGENT, { where: { codename: { equals: "alpha" } } })
          ),
          '"path":"where.codename"',
        ],
        [
          "where, snake_case spelling",
          await h.listEntries(
            read(AGENT, { where: { owner_note: { equals: "zebra" } } })
          ),
          '"path":"where.owner_note"',
        ],
        [
          "sort",
          await h.listEntries(read(AGENT, { sort: "codename" })),
          '"path":"sort.codename"',
        ],
        [
          "count",
          await h.countEntries(
            read(AGENT, { where: { codename: { equals: "beta" } } })
          ),
          '"path":"where.codename"',
        ],
        [
          "group",
          await h.groupEntries(read(AGENT, { groupBy: "codename" })),
          '"path":"groupBy.codename"',
        ],
      ];
      for (const [name, envelope, path] of cases) {
        expect(refusal(envelope)[0], name).toContain(path);
      }
    });

    it("searches only what the caller may read", async () => {
      // `alpha` is held only by `codename`, which this caller may not read,
      // so the configured search must not match on it.
      const h = await boot(dialect);
      const none = await h.listEntries(read(AGENT, { search: "alpha" }));
      expect(none.success, JSON.stringify(none)).toBe(true);
      expect(titles(none)).toEqual([]);
      // The control: a term in a readable field still finds its entry.
      const some = await h.listEntries(read(AGENT, { search: "north" }));
      expect(titles(some)).toEqual(["north"]);
    });

    it("refuses an anonymous caller a field whose rule reads the entry", async () => {
      // With no entry and no user, the rule above answers true by accident.
      // A rule that reads the entry at all is judged entry-dependent, so the
      // accidental answer does not open the field to a query.
      const h = await boot(dialect);
      const anonymous = (extra: Record<string, unknown>) => ({
        collectionName: VAULTS,
        overrideAccess: false,
        ...extra,
      });
      const cases: Array<[string, Envelope, string]> = [
        [
          "where",
          await h.listEntries(
            anonymous({ where: { ownerNote: { equals: "zebra" } } })
          ),
          '"path":"where.ownerNote"',
        ],
        [
          "sort",
          await h.listEntries(anonymous({ sort: "ownerNote" })),
          '"path":"sort.ownerNote"',
        ],
      ];
      for (const [name, envelope, path] of cases) {
        expect(refusal(envelope)[0], name).toContain(path);
      }
      const none = await h.listEntries(anonymous({ search: "zebra" }));
      expect(none.success, JSON.stringify(none)).toBe(true);
      expect(titles(none)).toEqual([]);
    });

    it("treats a field readable only on some entries as unreadable to query", async () => {
      // Even the owner is refused: with no entry to judge, the rule does not
      // allow, and an ordering or predicate would reveal the value on entries
      // where it is hidden.
      const h = await boot(dialect);
      const cases: Array<[string, Envelope, string]> = [
        [
          "where",
          await h.listEntries(
            read(AGENT, { where: { ownerNote: { equals: "zebra" } } })
          ),
          '"path":"where.ownerNote"',
        ],
        [
          "sort",
          await h.listEntries(read(BOSS, { sort: "ownerNote" })),
          '"path":"sort.ownerNote"',
        ],
        [
          "group",
          await h.groupEntries(read(BOSS, { groupBy: "ownerNote" })),
          '"path":"groupBy.ownerNote"',
        ],
      ];
      for (const [name, envelope, path] of cases) {
        expect(refusal(envelope)[0], name).toContain(path);
      }
      // And a search whose term only that field holds finds nothing, even
      // for the entry's owner.
      const none = await h.listEntries(read(AGENT, { search: "zebra" }));
      expect(none.success, JSON.stringify(none)).toBe(true);
      expect(titles(none)).toEqual([]);
    });
  }
);
