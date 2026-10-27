/**
 * A plugin-defined signed-in person under collection access rules, on every
 * configured dialect.
 *
 * The person reaches a collection only through a code rule that names them
 * (or one set to `true`): no rule refuses them where an anonymous caller would
 * fall through to the public default, and a rule written for any signed-in
 * staff user refuses them too. Field rules and hooks see the person, and a
 * write made as one never stores their id where a staff user's goes.
 *
 * @module domains/collections/__tests__/principal-access.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAsPrincipal } from "../../../auth/principal-scope";
import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import type { Principal } from "../../../plugins/principals/types";
import { runPluginRoute } from "../../../plugins/routes/dispatch";
import { getPluginRouteRegistry } from "../../../plugins/routes/route-registry";
import type { PluginRouteContext } from "../../../plugins/routes/route-types";
import { defineSingle } from "../../../singles/config/define-single";
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

const KIND = "accounts:account";
const isMember = ({ principal }: { principal: Principal | null }) =>
  principal?.kind === KIND;

/** Who the resolver and the lookup know: an id, and whether they verified. */
const PEOPLE: Record<string, { verified: boolean }> = {
  m1: { verified: true },
  m2: { verified: false },
};

const resolve = vi.fn(async (request: Request) => {
  const id = request.headers.get("x-member");
  return id && PEOPLE[id] ? { id, attributes: PEOPLE[id] } : null;
});

/** The plugin that defines the kind, and a route that serves it. */
const accounts = {
  name: "accounts",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    principals: [
      {
        name: "account",
        attributes: { verified: "boolean" },
        resolve,
        lookup: async (id: string) =>
          PEOPLE[id] ? { id, attributes: PEOPLE[id] } : null,
      },
    ],
    routes: [
      {
        method: "GET",
        path: "/orders",
        principal: { kind: KIND },
        handler: async (_req: Request, ctx: PluginRouteContext) => {
          const principal = ctx.principal as Principal;
          // Several calls made as the person: none of them asks the resolver.
          const first = await current!.nextly.find({
            collection: "members_only",
            principal,
          });
          const again = await current!.nextly.count({
            collection: "members_only",
            principal,
          });
          await ctx.services.collections.listEntries(
            "members_only",
            {},
            { principal }
          );
          return Response.json({
            found: first.items.length,
            counted: again.total,
          });
        },
      },
    ],
  },
} as unknown as PluginDefinition;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    plugins: [accounts],
    collections: [
      defineCollection({
        slug: "members_only",
        access: {
          read: isMember,
          create: isMember,
          update: isMember,
          delete: isMember,
        },
        fields: [
          text({ name: "title" }),
          // Refused to the kind: a person reads the row without it.
          text({
            name: "staff_note",
            access: {
              read: ({ principal }: { principal: Principal | null }) =>
                principal === null,
            },
          } as never),
          // No rule: follows the collection's decision.
          text({ name: "open_note" }),
        ],
      }),
      defineCollection({
        slug: "verified_only",
        access: {
          read: ({ principal }) => principal?.attributes.verified === true,
        },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "no_rule",
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "staff_rule",
        access: { read: ({ user }) => !!user },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "member_banner",
        access: { read: isMember },
        fields: [text({ name: "headline" })],
      }),
      defineSingle({
        slug: "staff_banner",
        access: { read: ({ user }) => !!user },
        fields: [text({ name: "headline" })],
      }),
    ],
  });
  return current;
}

/** A person core made, found through the kind's lookup. */
async function person(t: TestNextly, id: string): Promise<Principal> {
  const found = await t.nextly.principals.byId(KIND, id);
  if (!found) throw new Error(`no person ${id}`);
  return found;
}

async function seed(t: TestNextly, collection: string): Promise<string> {
  const created = await t.nextly.create({
    collection,
    // The two notes exist only on `members_only`.
    data:
      collection === "members_only"
        ? { title: "seeded", staff_note: "internal", open_note: "public" }
        : { title: "seeded" },
    user: { id: "staff-1" },
  });
  return String((created.item as { id: string }).id);
}

describe.each(getConfiguredTestDialects())(
  "a plugin-defined person under access rules (%s)",
  dialect => {
    it("is admitted by a rule that names the kind, and staff is not", async () => {
      const t = await boot(dialect);
      await seed(t, "members_only");
      const found = await t.nextly.find({
        collection: "members_only",
        principal: await person(t, "m1"),
      });
      expect(found.items).toHaveLength(1);
      // Staff is refused by the same rule: it names a person, not a user.
      await expect(
        t.nextly.find({
          collection: "members_only",
          user: { id: "staff-1" },
          overrideAccess: false,
        })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("is judged on declared attributes", async () => {
      const t = await boot(dialect);
      await seed(t, "verified_only");
      const verified = await t.nextly.find({
        collection: "verified_only",
        principal: await person(t, "m1"),
      });
      expect(verified.items).toHaveLength(1);
      await expect(
        t.nextly.find({
          collection: "verified_only",
          principal: await person(t, "m2"),
        })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("is refused by a collection with no rule, where a visitor is not", async () => {
      const t = await boot(dialect);
      await seed(t, "no_rule");
      // The control: an anonymous read falls through to the public default.
      const anonymous = await t.nextly.find({
        collection: "no_rule",
        overrideAccess: false,
      });
      expect(anonymous.items).toHaveLength(1);
      await expect(
        t.nextly.find({
          collection: "no_rule",
          principal: await person(t, "m1"),
        })
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        t.nextly.create({
          collection: "no_rule",
          data: { title: "by a person" },
          principal: await person(t, "m1"),
        })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("is answered as missing about one entry it may not read, existing or not", async () => {
      // A person is an identity of its own: refused one entry, it is told the
      // entry is missing, exactly as it is told about an id that matches
      // nothing, so the refusal confirms nothing.
      const t = await boot(dialect);
      const id = await seed(t, "verified_only");
      const unverified = await person(t, "m2");
      for (const entryId of [id, "00000000-0000-0000-0000-000000000000"]) {
        await expect(
          t.nextly.update({
            collection: "verified_only",
            id: entryId,
            data: { title: "changed" },
            principal: unverified,
          })
        ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
      }
    });

    it("is refused by a rule written for any signed-in staff user", async () => {
      const t = await boot(dialect);
      await seed(t, "staff_rule");
      await expect(
        t.nextly.find({
          collection: "staff_rule",
          principal: await person(t, "m1"),
        })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("reads without a field whose rule refuses the kind, and with one that has none", async () => {
      const t = await boot(dialect);
      await seed(t, "members_only");
      const found = await t.nextly.find({
        collection: "members_only",
        principal: await person(t, "m1"),
      });
      const row = found.items[0] as Record<string, unknown>;
      expect(row).not.toHaveProperty("staff_note");
      expect(row.open_note).toBe("public");
    });

    it("lists and counts only the Singles the person may read", async () => {
      const t = await boot(dialect);
      const member = await person(t, "m1");

      const all = await t.nextly.findSingles({ principal: member });
      expect(all.docs.map(single => single.slug)).toEqual(["member_banner"]);
      expect(all.totalDocs).toBe(1);

      // A page past the end, where no Single is read: its total must not
      // count the protected Single. (No `search` here: the registry's search
      // is ILIKE, which SQLite and MySQL do not have; and a limit beside the
      // offset, which SQLite requires.)
      const probe = await t.nextly.findSingles({
        principal: member,
        limit: 10,
        offset: 10,
      });
      expect(probe.docs).toEqual([]);
      expect(probe.totalDocs).toBe(1);
      // The control: without a person, both Singles count.
      const unrestricted = await t.nextly.findSingles({
        limit: 10,
        offset: 10,
      });
      expect(unrestricted.totalDocs).toBe(2);
    });

    it("refuses a where on a field the person may not read before an update writes", async () => {
      const t = await boot(dialect);
      const id = await seed(t, "members_only");
      const member = await person(t, "m1");

      // A guessed value on the withheld field: refused, and nothing written,
      // so whether it matched cannot be read off the write.
      await expect(
        t.nextly.update({
          collection: "members_only",
          where: { staff_note: { equals: "internal" } },
          data: { title: "probed" },
          principal: member,
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      const row = (await t.nextly.findByID({
        collection: "members_only",
        id,
      })) as Record<string, unknown>;
      expect(row.title).toBe("seeded");

      // The control: a where on a field the person may read updates.
      await t.nextly.update({
        collection: "members_only",
        where: { title: { equals: "seeded" } },
        data: { title: "renamed" },
        principal: member,
      });
      const renamed = (await t.nextly.findByID({
        collection: "members_only",
        id,
      })) as Record<string, unknown>;
      expect(renamed.title).toBe("renamed");
    });

    it("refuses a where on a field the person may not read before a delete removes anything", async () => {
      const t = await boot(dialect);
      const id = await seed(t, "members_only");
      const member = await person(t, "m1");

      await expect(
        t.nextly.delete({
          collection: "members_only",
          where: { staff_note: { equals: "internal" } },
          principal: member,
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(
        await t.nextly.findByID({ collection: "members_only", id })
      ).not.toBeNull();

      // The control: a where on a field the person may read deletes.
      await t.nextly.delete({
        collection: "members_only",
        where: { title: { equals: "seeded" } },
        principal: member,
      });
      expect(
        await t.nextly.findByID({
          collection: "members_only",
          id,
          disableErrors: true,
        })
      ).toBeNull();
    });

    it("refuses a withheld where at the bulk service, which every way in reaches", async () => {
      // The REST bulk routes call the collections handler directly, with no
      // Direct API namespace in front, so the check has to live where the
      // rows are found.
      const t = await boot(dialect);
      const id = await seed(t, "members_only");
      const member = await person(t, "m1");

      await expect(
        runAsPrincipal(member, () =>
          t.nextly.collectionsHandler.bulkUpdateByQuery({
            collectionName: "members_only",
            where: { staff_note: { equals: "internal" } },
            data: { title: "probed" },
            overrideAccess: false,
          })
        )
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(
        runAsPrincipal(member, () =>
          t.nextly.collectionsHandler.bulkDeleteByQuery({
            collectionName: "members_only",
            where: { staff_note: { equals: "internal" } },
            overrideAccess: false,
          })
        )
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      const row = (await t.nextly.findByID({
        collection: "members_only",
        id,
      })) as Record<string, unknown>;
      expect(row.title).toBe("seeded");
    });

    it("hands collection hooks the person, and no staff user", async () => {
      const t = await boot(dialect);
      await seed(t, "members_only");
      const seen: { user: unknown; principal: unknown }[] = [];
      t.hooks.register("afterRead", "members_only", ctx => {
        seen.push({ user: ctx.user, principal: ctx.principal });
      });
      const member = await person(t, "m1");
      await t.nextly.find({ collection: "members_only", principal: member });
      expect(seen.length).toBeGreaterThan(0);
      expect(seen[0]).toEqual({ user: undefined, principal: member });
    });

    it("never stores the person's id in the owner column", async () => {
      const t = await boot(dialect);
      const member = await person(t, "m1");
      const created = await t.nextly.create({
        collection: "members_only",
        data: { title: "by a person" },
        principal: member,
      });
      const id = String((created.item as { id: string }).id);
      const staffRow = await seed(t, "members_only");
      await t.nextly.update({
        collection: "members_only",
        id: staffRow,
        data: { title: "edited by a person" },
        principal: member,
      });

      const rows = await t.adapter.select<{
        id: string;
        created_by: string | null;
      }>("dc_members_only", {});
      const byId = new Map(rows.map(row => [String(row.id), row.created_by]));
      // A create made as a person leaves the owner empty; an update made as
      // one leaves the staff owner as it was.
      expect(byId.get(id)).toBeNull();
      expect(byId.get(staffRow)).toBe("staff-1");
    });

    it("calls the resolver once for a request, however many calls run as the person", async () => {
      const t = await boot(dialect);
      await seed(t, "members_only");
      resolve.mockClear();
      const match = getPluginRouteRegistry().match(
        "GET",
        "/plugins/accounts/orders",
        "plugin"
      );
      if (match === null) throw new Error("the route was not registered");
      const res = await runPluginRoute(
        new Request("http://localhost:3000/admin/api/plugins/accounts/orders", {
          headers: { "x-member": "m1" },
        }),
        match
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ found: 1, counted: 1 });
      expect(resolve).toHaveBeenCalledTimes(1);
    });
  }
);
