/**
 * The pages search as an author reaches it: through core's request handler,
 * with a real API key per role, against a real database.
 *
 * The unit suites pin what the route asks of the Direct API. This pins what
 * that asking MEANS — that `overrideAccess: false` with the caller's identity
 * really keeps a collection the caller may not read out of the answer, that a
 * collection without a Page Builder field is never searched however well its
 * titles match, that `contains`, the limit and `exclude` really narrow in the
 * database, and that a title field the caller may not read is met with the
 * refusal shape the route expects from core.
 *
 * @module __tests__/pages-search.integration.test
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

import { blocks } from "../fields/blocksHelper";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  PAGES_SEARCH_LIMIT_MAX,
  PAGES_SEARCH_ROUTE_PATH,
  PAGES_UNTITLED,
  type PagesSearchResponse,
} from "../pages-search-contract";
import { pageBuilder } from "../plugin";

/** The plugin's own page collection, which has the Draft/Published lifecycle. */
const PAGES = "pages";
/** A second collection with a Page Builder field, gated by its own permission. */
const ARTICLES = "articles";
/**
 * A collection WITHOUT a Page Builder field, whose titles match the searches
 * below. Its grant is also what the article title's read rule asks for.
 */
const NOTES = "notes";

/** Articles beyond the named ones, so a capped answer is observably cut. */
const FILLER = PAGES_SEARCH_LIMIT_MAX + 2;

const articles = defineCollection({
  slug: ARTICLES,
  labels: { singular: "Article", plural: "Articles" },
  admin: { useAsTitle: "headline" },
  fields: [
    text({
      name: "headline",
      // A field-level read rule, in the spelling core hands a rule: the
      // stored permission slug. A caller without `read-notes` reads the row
      // and not its title.
      access: {
        read: ({ permissions }: { permissions: string[] }) =>
          permissions.includes(`read-${NOTES}`),
      },
    } as never),
    blocks({ name: "body" }),
  ],
});

const notes = defineCollection({
  slug: NOTES,
  fields: [text({ name: "title" })],
});

/** The Direct API calls this suite makes staff and content with. */
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
  create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<{ item: { id: string | number } }>;
  find(args: { collection: string }): Promise<{ items: unknown[] }>;
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

/** The route's own path segments under the dispatcher. */
const SEGMENTS = [
  "plugins",
  ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
  ...PAGES_SEARCH_ROUTE_PATH.slice(1).split("/"),
];

/** One request to the route through core's handler, with `key` when given. */
async function ask(
  query: Record<string, string>,
  key?: string
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const search = new URLSearchParams(query).toString();
  const request = new Request(
    `http://localhost/api/${SEGMENTS.join("/")}?${search}`,
    {
      method: "GET",
      headers: key === undefined ? {} : { authorization: `Bearer ${key}` },
    }
  );
  return handlers.GET(request, {
    params: Promise.resolve({ params: SEGMENTS }),
  });
}

/** The answer of a request expected to succeed. */
async function search(
  query: Record<string, string>,
  key: string
): Promise<PagesSearchResponse> {
  const response = await ask(query, key);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as PagesSearchResponse;
}

describe.each(getConfiguredTestDialects())(
  "the pages search (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    /** Reads pages, articles and their titles, and notes. */
    let reader = "";
    /** Reads pages and notes, and not articles. */
    let outsider = "";
    /** Reads pages and articles, and not the article title field. */
    let titleBlind = "";
    let alphaPageId = "";
    let alphaArticleId = "";

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [articles, notes],
        plugins: [pageBuilder()],
      });
      const direct = t.nextly as unknown as Direct;

      // The first user is the super-admin every key is minted by; a key may
      // hold no more than its owner does.
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
        const ids = slugs.map(slug => {
          const found = seeded.items.find(item => item.slug === slug);
          if (found === undefined) {
            throw new Error(`${slug} is not seeded, so a role grants nothing`);
          }
          return found.id;
        });
        const role = await direct.roles.create({
          data: {
            name: `Role ${slugs.join(" ")}`,
            slug: `r-${slugs.join("-")}`,
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

      reader = await keyHolding([
        `read-${PAGES}`,
        `read-${ARTICLES}`,
        `read-${NOTES}`,
      ]);
      outsider = await keyHolding([`read-${PAGES}`, `read-${NOTES}`]);
      titleBlind = await keyHolding([`read-${PAGES}`, `read-${ARTICLES}`]);

      const idOf = (created: { item: { id: string | number } }) =>
        String(created.item.id);
      alphaPageId = idOf(
        await direct.create({
          collection: PAGES,
          data: { title: "Alpha page", slug: "alpha", status: "published" },
        })
      );
      await direct.create({
        collection: PAGES,
        data: { title: "Beta page", slug: "beta", status: "draft" },
      });
      alphaArticleId = idOf(
        await direct.create({
          collection: ARTICLES,
          data: { headline: "Alpha article" },
        })
      );
      for (let i = 0; i < FILLER; i += 1) {
        await direct.create({
          collection: ARTICLES,
          data: { headline: `Filler ${i}` },
        });
      }
      await direct.create({
        collection: NOTES,
        data: { title: "Alpha note" },
      });
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    describe("a caller who may read every page collection", () => {
      it("finds the pages whose title holds the search, ignoring case, by title", async () => {
        const answer = await search({ q: "ALPHA" }, reader);

        expect(answer.items).toEqual([
          {
            id: alphaArticleId,
            collection: ARTICLES,
            collectionLabel: "Article",
            field: "body",
            title: "Alpha article",
          },
          {
            id: alphaPageId,
            collection: PAGES,
            collectionLabel: "Page",
            field: "content",
            title: "Alpha page",
            status: "published",
          },
        ]);
        expect(answer.meta.total).toBe(2);
      });

      it("sends a draft page's status as draft", async () => {
        const answer = await search({ q: "beta" }, reader);

        expect(answer.items.map(item => [item.title, item.status])).toEqual([
          ["Beta page", "draft"],
        ]);
      });

      it("leaves out the excluded page, and counts without it", async () => {
        const answer = await search(
          { q: "alpha", exclude: `${PAGES}:${alphaPageId}` },
          reader
        );

        expect(answer.items.map(item => item.id)).toEqual([alphaArticleId]);
        expect(answer.meta.total).toBe(1);
      });

      it("returns at most the limit asked for, and the total that matched", async () => {
        const answer = await search({ limit: "2" }, reader);

        expect(answer.items).toHaveLength(2);
        expect(answer.meta.limit).toBe(2);
        // Two pages, the named article and the fillers.
        expect(answer.meta.total).toBe(2 + 1 + FILLER);
        expect(answer.meta.hasNext).toBe(true);
      });

      it("caps a limit above the ceiling rather than refusing it", async () => {
        const answer = await search({ limit: "1000" }, reader);

        expect(answer.items).toHaveLength(PAGES_SEARCH_LIMIT_MAX);
        expect(answer.meta.limit).toBe(PAGES_SEARCH_LIMIT_MAX);
      });
    });

    describe("a collection without a Page Builder field", () => {
      it("is never listed, however well its titles match", async () => {
        const answer = await search({ q: "note" }, reader);

        expect(answer.items).toEqual([]);
        expect(answer.meta.total).toBe(0);
      });

      it("CONTROL: it holds a matching entry this caller may read, so the absence is the route's", async () => {
        const read = await (t.nextly as unknown as Direct).find({
          collection: NOTES,
        });
        expect(read.items).toHaveLength(1);
        const answer = await search({ q: "alpha" }, reader);
        expect(answer.items.map(item => item.collection)).not.toContain(NOTES);
      });
    });

    describe("a caller who may not read a page collection", () => {
      it("gets none of its pages, and the pages it may read", async () => {
        const answer = await search({ q: "alpha" }, outsider);

        // Core refused the articles read for this caller; the route adds no
        // decision of its own, and the refusal does not sink the search.
        expect(answer.items.map(item => item.id)).toEqual([alphaPageId]);
        expect(answer.meta.total).toBe(1);
      });

      it("is refused before any of it when not signed in at all", async () => {
        expect((await ask({ q: "alpha" })).status).toBe(401);
      });
    });

    describe("a caller who may read the pages but not their title field", () => {
      it("finds none of them by a title it may not read", async () => {
        const answer = await search({ q: "alpha" }, titleBlind);

        expect(answer.items.map(item => item.collection)).toEqual([PAGES]);
      });

      it("lists them under the neutral label, never another field", async () => {
        const answer = await search(
          { limit: String(PAGES_SEARCH_LIMIT_MAX) },
          titleBlind
        );

        const listed = answer.items.filter(
          item => item.collection === ARTICLES
        );
        expect(listed.length).toBeGreaterThan(0);
        for (const item of listed) expect(item.title).toBe(PAGES_UNTITLED);
      });
    });
  }
);
