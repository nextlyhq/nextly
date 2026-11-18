/**
 * The New page dialog's create and read as an author reaches them: through
 * core's request handler, with a real API key per role, against a real
 * database.
 *
 * The unit suite (`new-page-route.test.ts`) pins what the route decides. This
 * pins what it MEANS: an address made from a taken title moves on to `-2`,
 * and the read says so first; a typed address another page holds is refused,
 * naming that page, or "another page" for an author who can't read it; a
 * collection with a required field the dialog doesn't ask for is refused
 * with that field's path, and made once it is given; the header & footer
 * choice is stored; and a role that may not create pages is refused.
 *
 * @module __tests__/new-page.integration.test
 */

// Read once, when the harness validates its environment; API keys are signed
// with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BLOCKS_TYPE } from "../fields/blocksField";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  newPagePath,
  PAGES_ROUTE_PATH,
  type CreatedPageItem,
  type NewPageFacts,
} from "../pages-write-contract";
import { pageBuilder } from "../plugin";

/** The plugin's own page collection: Draft/Published, a unique slug. */
const PAGES = "pages";
/** Pages of another kind, which need a category the dialog doesn't ask for. */
const ARTICLES = "articles";

const articles = defineCollection({
  slug: ARTICLES,
  fields: [
    text({ name: "title" }),
    text({ name: "slug", unique: true }),
    { name: "content", type: BLOCKS_TYPE } as never,
    text({ name: "category", required: true }),
  ],
});

/** Pages an author may change only where a row filter matches them. */
const NOTES = "notes";

const notes = defineCollection({
  slug: NOTES,
  fields: [
    text({ name: "title" }),
    text({ name: "slug", unique: true }),
    { name: "content", type: BLOCKS_TYPE } as never,
  ],
  // A filter: the author may update the entries it matches, which no
  // yes-or-no without an entry can say.
  access: { update: () => ({ id: { exists: true } }) as unknown as boolean },
});

/** The Direct API calls this suite makes staff and content with, trusted. */
interface Direct {
  users: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
  permissions: {
    find(args: {
      limit: number;
    }): Promise<{ items: { id: string; slug: string }[] }>;
  };
  roles: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
  find(args: {
    collection: string;
    where?: Record<string, unknown>;
    status?: string;
  }): Promise<{ items: Record<string, unknown>[] }>;
}

interface ApiKeys {
  createApiKey(
    userId: string,
    input: {
      name: string;
      tokenType: string;
      roleId?: string;
      expiresIn: string;
    }
  ): Promise<{ key: string }>;
}

/** One request to a plugin route through core's handler, as `key`. */
async function ask(
  method: "GET" | "POST",
  path: string,
  key: string,
  body?: unknown
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const [pathname = "", search = ""] = path.split("?");
  const segments = [
    "plugins",
    ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
    ...pathname.slice(1).split("/").map(decodeURIComponent),
  ];
  const request = new Request(
    `http://localhost/api/${segments.map(encodeURIComponent).join("/")}${search === "" ? "" : `?${search}`}`,
    {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  );
  return handlers[method](request, {
    params: Promise.resolve({ params: segments }),
  });
}

/** The item of a create expected to succeed. */
async function created(response: Response): Promise<CreatedPageItem> {
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { item: CreatedPageItem }).item;
}

/** The field issues a refused create names, as the dialog reads them. */
async function issues(
  response: Response
): Promise<{ path: string; message: string }[]> {
  expect(response.status, await response.clone().text()).toBe(400);
  const body = (await response.json()) as {
    error?: { data?: { errors?: { path: string; message: string }[] } };
  };
  return body.error?.data?.errors ?? [];
}

/** How many roles this file has made, for names that stay short. */
let rolesMade = 0;

describe.each(getConfiguredTestDialects())(
  "the New page dialog's create and read (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let direct: Direct;
    /** May read, create and update pages and articles. */
    let editor = "";
    /** May create pages, and nothing else: not read them, not change them. */
    let createOnly = "";
    /** May read pages, not create them. */
    let reader = "";

    /** Every stored page of `collection` at `slug`, read trusted. */
    async function storedAt(
      collection: string,
      slug: string
    ): Promise<Record<string, unknown>[]> {
      return (
        await direct.find({
          collection,
          where: { slug: { equals: slug } },
          status: "all",
        })
      ).items;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [articles, notes],
        plugins: [pageBuilder({ pagePreviewPath: "/{slug}" })],
      });
      direct = t.nextly as unknown as Direct;
      const owner = await direct.users.create({
        data: {
          email: "owner@example.com",
          password: "Password123!",
          name: "Owner",
          isActive: true,
        },
      });
      const seeded = await direct.permissions.find({ limit: 500 });

      /** A key whose role holds exactly the permissions named. */
      async function keyHolding(slugs: string[]): Promise<string> {
        // Numbered, so the role's name fits the roles table on every
        // dialect; tagged by file, so files sharing a database never clash.
        rolesMade += 1;
        const roleTag = `np-${rolesMade}`;
        const ids = slugs.map(slug => {
          const found = seeded.items.find(item => item.slug === slug);
          if (found === undefined) {
            throw new Error(`${slug} is not seeded, so a role grants nothing`);
          }
          return found.id;
        });
        const role = await direct.roles.create({
          data: {
            name: `Role ${roleTag}`,
            slug: `r-${roleTag}`,
            permissionIds: ids,
          },
        });
        const keys = t.getService("apiKeyService") as unknown as ApiKeys;
        const { key } = await keys.createApiKey(owner.item.id, {
          name: `key ${slugs.join(" ")}`,
          tokenType: "role-based",
          roleId: role.item.id,
          expiresIn: "unlimited",
        });
        return key;
      }

      const all = (collection: string) =>
        ["create", "read", "update"].map(action => `${action}-${collection}`);
      editor = await keyHolding([
        ...all(PAGES),
        ...all(ARTICLES),
        ...all(NOTES),
      ]);
      createOnly = await keyHolding([`create-${PAGES}`]);
      reader = await keyHolding([`read-${PAGES}`]);
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("moves an address made from a taken title on to -2, and says so before creating", async () => {
      const first = await created(
        await ask("POST", PAGES_ROUTE_PATH, editor, {
          collection: PAGES,
          title: "Pricing",
        })
      );
      expect(first.mayUpdate).toBe(true);

      const read = await ask(
        "GET",
        newPagePath({ collection: PAGES, title: "Pricing" }),
        editor
      );
      expect(read.status).toBe(200);
      const facts = (await read.json()) as NewPageFacts;
      expect(facts.address).toMatchObject({
        before: "/",
        after: "",
        slug: "pricing-2",
        wanted: "pricing",
      });
      expect(facts).toMatchObject({
        drafts: true,
        headerFooter: true,
        mayUpdate: true,
        starters: [],
      });

      const second = await created(
        await ask("POST", PAGES_ROUTE_PATH, editor, {
          collection: PAGES,
          title: "Pricing",
        })
      );
      expect((await storedAt(PAGES, "pricing-2"))[0]).toMatchObject({
        id: second.id,
        status: "draft",
      });
    });

    it("refuses a typed address another page holds, naming it, and makes nothing", async () => {
      await created(
        await ask("POST", PAGES_ROUTE_PATH, editor, {
          collection: PAGES,
          title: "Our team",
          slug: "team",
        })
      );
      const read = (await (
        await ask(
          "GET",
          newPagePath({ collection: PAGES, title: "Team", slug: "team" }),
          editor
        )
      ).json()) as NewPageFacts;
      expect(read.address).toMatchObject({ slug: "team", takenBy: "Our team" });

      expect(
        await issues(
          await ask("POST", PAGES_ROUTE_PATH, editor, {
            collection: PAGES,
            title: "Team",
            slug: "team",
          })
        )
      ).toEqual([
        expect.objectContaining({
          path: "slug",
          message: "That address is used by Our team",
        }),
      ]);
      expect(await storedAt(PAGES, "team")).toHaveLength(1);
      expect(await storedAt(PAGES, "team-2")).toHaveLength(0);
    });

    it("says 'another page' to an author who can't read the page holding a typed address", async () => {
      await created(
        await ask("POST", PAGES_ROUTE_PATH, editor, {
          collection: PAGES,
          title: "Careers",
          slug: "careers",
        })
      );
      expect(
        await issues(
          await ask("POST", PAGES_ROUTE_PATH, createOnly, {
            collection: PAGES,
            title: "Jobs",
            slug: "careers",
          })
        )
      ).toEqual([
        expect.objectContaining({
          path: "slug",
          message: "That address is used by another page",
        }),
      ]);
      expect(await storedAt(PAGES, "careers")).toHaveLength(1);
    });

    it("answers that a create-only author may not change the page they made", async () => {
      const item = await created(
        await ask("POST", PAGES_ROUTE_PATH, createOnly, {
          collection: PAGES,
          title: "Made by a contributor",
        })
      );
      expect(item.mayUpdate).toBe(false);
    });

    it("stores the header & footer choice with the page", async () => {
      const item = await created(
        await ask("POST", PAGES_ROUTE_PATH, editor, {
          collection: PAGES,
          title: "Bare landing",
          layout: null,
          noHeaderFooter: true,
        })
      );
      expect((await storedAt(PAGES, "bare-landing"))[0]).toMatchObject({
        id: item.id,
        noHeaderFooter: true,
      });
    });

    it("refuses a required field the dialog didn't ask for by its path, then makes the page once it is given", async () => {
      expect(
        await issues(
          await ask("POST", PAGES_ROUTE_PATH, editor, {
            collection: ARTICLES,
            title: "Launch notes",
          })
        )
      ).toEqual([expect.objectContaining({ path: "category" })]);
      expect(await storedAt(ARTICLES, "launch-notes")).toHaveLength(0);

      const item = await created(
        await ask("POST", PAGES_ROUTE_PATH, editor, {
          collection: ARTICLES,
          title: "Launch notes",
          fields: { category: "News" },
        })
      );
      expect((await storedAt(ARTICLES, "launch-notes"))[0]).toMatchObject({
        id: item.id,
        category: "News",
      });
    });

    it("checks and stores a typed address as a collection without paths stores it, with no `/`", async () => {
      await created(
        await ask("POST", PAGES_ROUTE_PATH, editor, {
          collection: ARTICLES,
          title: "Docs index",
          slug: "docsinstall",
          fields: { category: "Docs" },
        })
      );
      const read = (await (
        await ask(
          "GET",
          newPagePath({
            collection: ARTICLES,
            title: "Install",
            slug: "docs/install",
          }),
          editor
        )
      ).json()) as NewPageFacts;
      expect(read.address).toMatchObject({
        slug: "docsinstall",
        takenBy: "Docs index",
      });
      expect(
        await issues(
          await ask("POST", PAGES_ROUTE_PATH, editor, {
            collection: ARTICLES,
            title: "Install",
            slug: "docs/install",
            fields: { category: "Docs" },
          })
        )
      ).toEqual([
        expect.objectContaining({
          path: "slug",
          message: "That address is used by Docs index",
        }),
      ]);
      expect(await storedAt(ARTICLES, "docsinstall")).toHaveLength(1);

      // The plugin's own Pages store paths (`db.slugPaths`): the `/` stays.
      await created(
        await ask("POST", PAGES_ROUTE_PATH, editor, {
          collection: PAGES,
          title: "Install",
          slug: "docs/install",
        })
      );
      expect(await storedAt(PAGES, "docs/install")).toHaveLength(1);
    });

    it("answers that an author whose update rule is a row filter may change the page they made", async () => {
      const item = await created(
        await ask("POST", PAGES_ROUTE_PATH, editor, {
          collection: NOTES,
          title: "Standup",
        })
      );
      expect(item.mayUpdate).toBe(true);
      const read = (await (
        await ask(
          "GET",
          newPagePath({ collection: NOTES, title: "Retro" }),
          editor
        )
      ).json()) as NewPageFacts;
      expect(read.mayUpdate).toBe(true);
    });

    it("refuses a role that may not create pages, making nothing", async () => {
      const response = await ask("POST", PAGES_ROUTE_PATH, reader, {
        collection: PAGES,
        title: "Not allowed",
      });
      expect(response.status).toBe(403);
      expect(await storedAt(PAGES, "not-allowed")).toHaveLength(0);
    });
  }
);
