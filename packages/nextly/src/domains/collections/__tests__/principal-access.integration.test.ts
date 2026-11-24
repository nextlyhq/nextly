/**
 * A plugin-defined signed-in person under collection access rules, on every
 * configured dialect.
 *
 * The person reaches a collection only through a code rule that names them
 * (or one set to `true`): no rule refuses them where a visitor reads by what
 * the Public role grants, which a person never holds, and a rule written for
 * any signed-in staff user refuses them too. Field rules and hooks see the
 * person, and a write made as one never stores their id where a staff user's
 * goes. A rule may also answer the person a filter, and then every read and
 * write made as them reaches only the rows it matches.
 *
 * @module domains/collections/__tests__/principal-access.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { grantPublic } from "../../../__tests__/helpers/public-role";
import { runAsPrincipal } from "../../../auth/principal-scope";
import { defineCollection } from "../../../collections/config/define-collection";
import { relationship, text } from "../../../collections/fields";
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

/**
 * A rule that answers a person of the kind a filter, the rows they own, and
 * everyone else `false`. Read, update and delete share it.
 */
const ownRows = ({ principal }: { principal: Principal | null }) =>
  principal?.kind === KIND
    ? { owner: { equals: principal.id } }
    : (false as const);

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

/**
 * `seedPublic` runs the boot's seeding, for a test whose visitor needs the
 * Public role a real boot makes.
 */
async function boot(
  dialect: TestDialect,
  options: { seedPublic?: boolean } = {}
): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    seedPublic: options.seedPublic === true,
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
      // Rows a person owns, by the `owner` each row names.
      defineCollection({
        slug: "owned_items",
        access: {
          read: ownRows,
          create: isMember,
          update: ownRows,
          delete: ownRows,
        },
        fields: [text({ name: "title" }), text({ name: "owner" })],
      }),
      // Readable by every person of the kind, writable only by its owner.
      defineCollection({
        slug: "shared_items",
        access: {
          read: isMember,
          update: ownRows,
          delete: ownRows,
        },
        fields: [text({ name: "title" }), text({ name: "owner" })],
      }),
      // Owned the same way, each linking to an item that may be someone else's.
      defineCollection({
        slug: "owned_orders",
        access: { read: ownRows },
        fields: [
          text({ name: "title" }),
          text({ name: "owner" }),
          relationship({ name: "item", relationTo: "owned_items" }),
        ],
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
      const t = await boot(dialect, { seedPublic: true });
      await seed(t, "no_rule");
      // A visitor holds what the Public role grants, and boot grants no read
      // where no rule says anyone may read, so an owner grants it here: the
      // person must still be refused, holding no grant of Public's.
      await grantPublic(t, ["read-no_rule"]);
      // The control: the visitor reads by Public's grant.
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
            data: { title: "changed", _overwrite: true },
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
      // count the protected Single. (No `search` here: this probe pins the
      // page-past-the-end total alone; the registry's search has its own
      // suite.)
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
          // Refused for the withheld field, not for want of a version.
          data: { title: "probed", _overwrite: true },
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
        data: { title: "renamed", _overwrite: true },
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
            // Refused for the withheld field, not for want of a version.
            data: { title: "probed", _overwrite: true },
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
        data: { title: "edited by a person", _overwrite: true },
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

/** A row in a filtered collection, owned by `owner`, written as the server. */
async function own(
  t: TestNextly,
  collection: "owned_items" | "owned_orders" | "shared_items",
  owner: string,
  title: string,
  item?: string
): Promise<string> {
  const created = await t.nextly.create({
    collection,
    data: { title, owner, ...(item === undefined ? {} : { item }) },
  });
  return String((created.item as { id: string }).id);
}

/** Every title in `collection`, read as the server, sorted. */
async function titlesOf(t: TestNextly, collection: string): Promise<string[]> {
  const all = await t.nextly.find({ collection, limit: 100 });
  return all.items.map(row => String((row as { title: unknown }).title)).sort();
}

/**
 * What a refusal tells the caller: the error's kind, status and both
 * messages. Two refusals that agree on all of it cannot be told apart.
 */
async function refusalOf(attempt: Promise<unknown>): Promise<unknown> {
  const error: unknown = await attempt.then(
    () => {
      throw new Error("expected a refusal");
    },
    (caught: unknown) => caught
  );
  const { name, code, statusCode, message, publicMessage } = error as Record<
    string,
    unknown
  >;
  return { name, code, statusCode, message, publicMessage };
}

describe.each(getConfiguredTestDialects())(
  "a rule that answers a person a filter (%s)",
  dialect => {
    /** m1 owns two items, m2 one. */
    async function bootOwned(): Promise<{
      t: TestNextly;
      member: Principal;
      mine: string;
      theirs: string;
    }> {
      const t = await boot(dialect);
      const mine = await own(t, "owned_items", "m1", "m1-first");
      await own(t, "owned_items", "m1", "m1-second");
      const theirs = await own(t, "owned_items", "m2", "m2-only");
      return { t, member: await person(t, "m1"), mine, theirs };
    }

    it("lists only the rows the filter matches, and counts the same rows", async () => {
      const { t, member } = await bootOwned();
      const found = await t.nextly.find({
        collection: "owned_items",
        principal: member,
      });
      expect(
        found.items.map(row => (row as { title: string }).title).sort()
      ).toEqual(["m1-first", "m1-second"]);
      expect(found.meta.total).toBe(2);
      const counted = await t.nextly.count({
        collection: "owned_items",
        principal: member,
      });
      expect(counted.total).toBe(2);

      // The caller's own where is added to the filter, never in place of it:
      // asking for another person's rows by name finds none of them.
      const asked = await t.nextly.find({
        collection: "owned_items",
        where: { owner: { equals: "m2" } },
        principal: member,
      });
      expect(asked.items).toEqual([]);
      const askedCount = await t.nextly.count({
        collection: "owned_items",
        where: { owner: { equals: "m2" } },
        principal: member,
      });
      expect(askedCount.total).toBe(0);

      // The control: the server sees every row.
      expect(await titlesOf(t, "owned_items")).toEqual([
        "m1-first",
        "m1-second",
        "m2-only",
      ]);
    });

    it("reads its own row by id, and is answered about another's exactly as about a missing one", async () => {
      const { t, member, mine, theirs } = await bootOwned();
      const row = (await t.nextly.findByID({
        collection: "owned_items",
        id: mine,
        principal: member,
      })) as Record<string, unknown>;
      expect(row.title).toBe("m1-first");

      const missing = "00000000-0000-0000-0000-000000000000";
      const refused = await refusalOf(
        t.nextly.findByID({
          collection: "owned_items",
          id: theirs,
          principal: member,
        })
      );
      expect(refused).toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
      expect(refused).toEqual(
        await refusalOf(
          t.nextly.findByID({
            collection: "owned_items",
            id: missing,
            principal: member,
          })
        )
      );
      // Asked not to throw, both answer nothing.
      for (const id of [theirs, missing]) {
        expect(
          await t.nextly.findByID({
            collection: "owned_items",
            id,
            principal: member,
            disableErrors: true,
          })
        ).toBeNull();
      }
    });

    it("populates a related row the filter matches, and never another's", async () => {
      const { t, member, mine, theirs } = await bootOwned();
      await own(t, "owned_orders", "m1", "order-of-mine", mine);
      await own(t, "owned_orders", "m1", "order-of-theirs", theirs);

      const found = await t.nextly.find({
        collection: "owned_orders",
        depth: 1,
        principal: member,
      });
      const byTitle = new Map(
        found.items.map(row => [
          (row as { title: string }).title,
          (row as { item: unknown }).item,
        ])
      );
      expect(byTitle.get("order-of-mine")).toMatchObject({
        id: mine,
        title: "m1-first",
      });
      // The other person's item stays the id the reader's own row holds,
      // as a related row any caller may not read does: none of its fields.
      expect(byTitle.get("order-of-theirs")).toBe(theirs);
      expect(JSON.stringify(found.items)).not.toContain("m2-only");
      expect(JSON.stringify(found.items)).not.toContain('"m2"');

      // The same by id, at a depth past the first.
      const order = (await t.nextly.findByID({
        collection: "owned_orders",
        id: String(
          (
            found.items.find(
              row => (row as { title: string }).title === "order-of-theirs"
            ) as { id: string }
          ).id
        ),
        depth: 2,
        principal: member,
      })) as Record<string, unknown>;
      expect(order.item).toBe(theirs);
    });

    it("updates only its own rows, by id and by where", async () => {
      const { t, member, mine, theirs } = await bootOwned();
      await t.nextly.update({
        collection: "owned_items",
        id: mine,
        data: { title: "m1-renamed", _overwrite: true },
        principal: member,
      });

      // Another's row by id: answered as missing, as a read of it is, and
      // left as it was.
      expect(
        await refusalOf(
          t.nextly.update({
            collection: "owned_items",
            id: theirs,
            data: { title: "taken", _overwrite: true },
            principal: member,
          })
        )
      ).toMatchObject({ statusCode: 404, code: "NOT_FOUND" });

      // An update by where writes the one row it matches. A where naming
      // another's row matches nothing under the filter: answered as missing,
      // and nothing written.
      await expect(
        t.nextly.update({
          collection: "owned_items",
          where: { title: { equals: "m2-only" } },
          data: { title: "taken", _overwrite: true },
          principal: member,
        })
      ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
      await t.nextly.update({
        collection: "owned_items",
        where: { title: { equals: "m1-second" } },
        data: { title: "m1-also-renamed", _overwrite: true },
        principal: member,
      });
      expect(await titlesOf(t, "owned_items")).toEqual([
        "m1-also-renamed",
        "m1-renamed",
        "m2-only",
      ]);

      // An update by where names one row: a where the filter leaves two rows
      // for is refused, and nothing written.
      await expect(
        t.nextly.update({
          collection: "owned_items",
          where: { title: { exists: true } },
          data: { title: "bulk", _overwrite: true },
          principal: member,
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await titlesOf(t, "owned_items")).toEqual([
        "m1-also-renamed",
        "m1-renamed",
        "m2-only",
      ]);

      // An update may not move a row out of the filter: refused, unchanged.
      await expect(
        t.nextly.update({
          collection: "owned_items",
          id: mine,
          data: { owner: "m2", _overwrite: true },
          principal: member,
        })
      ).rejects.toMatchObject({ statusCode: 403 });
      const kept = (await t.nextly.findByID({
        collection: "owned_items",
        id: mine,
      })) as Record<string, unknown>;
      expect(kept.owner).toBe("m1");
    });

    it("is refused a write to a row it may read but the filter does not match", async () => {
      // The read admits every person of the kind, so the row is not hidden:
      // the write is refused as forbidden, not answered as missing.
      const t = await boot(dialect);
      const theirs = await own(t, "shared_items", "m2", "m2-shared");
      const member = await person(t, "m1");
      expect(
        (
          (await t.nextly.findByID({
            collection: "shared_items",
            id: theirs,
            principal: member,
          })) as Record<string, unknown>
        ).title
      ).toBe("m2-shared");
      await expect(
        t.nextly.update({
          collection: "shared_items",
          id: theirs,
          data: { title: "taken", _overwrite: true },
          principal: member,
        })
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        t.nextly.delete({
          collection: "shared_items",
          id: theirs,
          principal: member,
        })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await titlesOf(t, "shared_items")).toEqual(["m2-shared"]);
    });

    it("deletes only its own rows, by id and by where", async () => {
      const { t, member, mine, theirs } = await bootOwned();
      expect(
        await refusalOf(
          t.nextly.delete({
            collection: "owned_items",
            id: theirs,
            principal: member,
          })
        )
      ).toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
      expect(await titlesOf(t, "owned_items")).toEqual([
        "m1-first",
        "m1-second",
        "m2-only",
      ]);

      await t.nextly.delete({
        collection: "owned_items",
        id: mine,
        principal: member,
      });
      expect(await titlesOf(t, "owned_items")).toEqual([
        "m1-second",
        "m2-only",
      ]);

      // A where that names every row removes only the rows the filter matches.
      await t.nextly.delete({
        collection: "owned_items",
        where: { title: { exists: true } },
        principal: member,
      });
      expect(await titlesOf(t, "owned_items")).toEqual(["m2-only"]);
    });
  }
);
