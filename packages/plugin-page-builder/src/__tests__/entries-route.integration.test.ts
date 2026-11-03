/**
 * The entries route as an author reaches it: through core's request handler,
 * with a real API key per role, against a real database on each dialect.
 *
 * The unit suites pin what the route asks of the Direct API. This pins what
 * that asking MEANS — that `overrideAccess: false` with the caller's identity
 * really applies the collection's read permission and its field-level read
 * rules on every dialect, that `contains` really matches case-insensitively,
 * and that the refusal for a collection no block names reads the same whether
 * or not the collection exists.
 *
 * @module __tests__/entries-route.integration.test
 */

// Read once, when the harness validates its environment; API keys are signed
// with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { clearBlocks } from "@nextlyhq/blocks-engine";
import { definePlugin } from "@nextlyhq/plugin-sdk";
import { defineBlock } from "@nextlyhq/plugin-sdk/blocks";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN } from "../blocks/registration-service";
import {
  ENTRIES_LIMIT_MAX,
  ENTRIES_ROUTE_PATH,
  ENTRIES_UNTITLED,
  type EntriesResponse,
} from "../entries-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

/** The collection a block names as a relation target. */
const ARTICLES = "articles";
/**
 * A collection that exists and that NO block names. Its grant is also what
 * the title field's read rule asks for, so one key can read articles with
 * their titles and another without.
 */
const NOTES = "notes";

/** How many articles beyond the named ones, so a capped page is observably cut. */
const FILLER = ENTRIES_LIMIT_MAX + 5;

const articles = defineCollection({
  slug: ARTICLES,
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
    text({ name: "body" }),
  ],
});

const notes = defineCollection({
  slug: NOTES,
  fields: [text({ name: "title" })],
});

/** A block whose prop stores one article, declared as a plugin declares one. */
const teaser = defineBlock({
  name: "test/article-teaser",
  version: 1,
  description: "A teaser of one article.",
  example: { props: {} },
  props: { article: { type: "relation", relationTo: ARTICLES } },
  render: () => null,
});

const declaring = definePlugin({
  name: "@test/relation-blocks",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    declarations: {
      [PAGE_BUILDER_PLUGIN]: {
        blocks: [teaser],
        // Named as the editor's module: the route reads only for relation
        // props of blocks the editor can draw, and a declaration without an
        // editor entry reaches the server alone.
        editorEntry: "@test/relation-blocks/editor#blocks",
      },
    },
  },
} as never);

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
  ENTRIES_ROUTE_PATH.slice(1),
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
async function entries(
  query: Record<string, string>,
  key: string
): Promise<EntriesResponse> {
  const response = await ask(query, key);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as EntriesResponse;
}

/** An error answer's status, code and message, without its per-request id. */
async function refusalOf(
  response: Response
): Promise<{ status: number; code: unknown; message: unknown }> {
  const body = (await response.json()) as {
    error?: { code?: unknown; message?: unknown };
  };
  return {
    status: response.status,
    code: body.error?.code,
    message: body.error?.message,
  };
}

/** Items in a stable order, so an assertion does not depend on the read's. */
function byId(items: EntriesResponse["items"]): EntriesResponse["items"] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

describe.each(getConfiguredTestDialects())(
  "the entries route (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    /** Reads articles and their titles. */
    let reader = "";
    /** Reads articles, and not the title field. */
    let titleBlind = "";
    /** Reads notes and not articles. */
    let outsider = "";
    let alphaId = "";
    let alphabetId = "";

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [articles, notes],
        plugins: [pageBuilder(), declaring],
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

      reader = await keyHolding([`read-${ARTICLES}`, `read-${NOTES}`]);
      titleBlind = await keyHolding([`read-${ARTICLES}`]);
      outsider = await keyHolding([`read-${NOTES}`]);

      const idOf = (created: { item: { id: string | number } }) =>
        String(created.item.id);
      alphaId = idOf(
        await direct.create({
          collection: ARTICLES,
          data: { headline: "Alpha", body: "first body" },
        })
      );
      alphabetId = idOf(
        await direct.create({
          collection: ARTICLES,
          data: { headline: "The alphabet", body: "second body" },
        })
      );
      for (let i = 0; i < FILLER; i += 1) {
        await direct.create({
          collection: ARTICLES,
          data: { headline: `Filler ${i}`, body: "filler" },
        });
      }
      await direct.create({
        collection: NOTES,
        data: { title: "A note no block names" },
      });
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
      clearBlocks();
    });

    describe("a caller who may read the collection", () => {
      it("gets { id, title } items, and nothing else of each entry", async () => {
        const answer = await entries(
          { collection: ARTICLES, ids: alphaId },
          reader
        );

        expect(answer.items).toEqual([{ id: alphaId, title: "Alpha" }]);
      });

      it("finds entries whose title holds the search, ignoring case", async () => {
        const answer = await entries(
          { collection: ARTICLES, search: "ALPHA" },
          reader
        );

        expect(byId(answer.items)).toEqual(
          byId([
            { id: alphaId, title: "Alpha" },
            { id: alphabetId, title: "The alphabet" },
          ])
        );
      });

      it("resolves stored ids to their titles, leaving out an id that names nothing", async () => {
        const answer = await entries(
          {
            collection: ARTICLES,
            ids: [alphaId, alphabetId, "no-such-entry"].join(","),
          },
          reader
        );

        expect(byId(answer.items)).toEqual(
          byId([
            { id: alphaId, title: "Alpha" },
            { id: alphabetId, title: "The alphabet" },
          ])
        );
      });

      it("caps a page at the ceiling however many are asked for", async () => {
        const answer = await entries(
          { collection: ARTICLES, limit: "1000" },
          reader
        );

        expect(answer.items).toHaveLength(ENTRIES_LIMIT_MAX);
        expect(answer.meta.limit).toBe(ENTRIES_LIMIT_MAX);
        // The collection holds more than a page, so the cap is what cut it.
        expect(answer.meta.total).toBeGreaterThan(ENTRIES_LIMIT_MAX);
        expect(answer.meta.hasNext).toBe(true);
      });
    });

    describe("a collection no registered block names", () => {
      it("is refused with the same answer whether or not it exists", async () => {
        const existing = await refusalOf(
          await ask({ collection: NOTES }, reader)
        );
        const missing = await refusalOf(
          await ask({ collection: "no_such_collection" }, reader)
        );

        expect(existing.status).toBe(403);
        expect(existing.code).toBe("FORBIDDEN");
        expect(missing).toEqual(existing);
      });

      it("CONTROL: that collection exists and holds an entry, so the refusal is the route's", async () => {
        const read = await (t.nextly as unknown as Direct).find({
          collection: NOTES,
        });
        expect(read.items).toHaveLength(1);
      });
    });

    describe("a caller who may not read the collection", () => {
      it("is refused by core, with nothing of any entry", async () => {
        const response = await ask({ collection: ARTICLES }, outsider);

        // Core's own answer to a read its gate refuses. The route adds no
        // decision of its own.
        expect(await refusalOf(response)).toMatchObject({
          status: 403,
          code: "FORBIDDEN",
        });
      });

      it("is refused before any of it when not signed in at all", async () => {
        expect((await ask({ collection: ARTICLES })).status).toBe(401);
      });
    });

    describe("a caller who may read the entries but not their title field", () => {
      it("gets each entry under the neutral label, never another field", async () => {
        const answer = await entries(
          { collection: ARTICLES, ids: [alphaId, alphabetId].join(",") },
          titleBlind
        );

        expect(byId(answer.items)).toEqual(
          byId([
            { id: alphaId, title: ENTRIES_UNTITLED },
            { id: alphabetId, title: ENTRIES_UNTITLED },
          ])
        );
      });

      it("CONTROL: the same entries carry their titles for a caller who may read them", async () => {
        const answer = await entries(
          { collection: ARTICLES, ids: alphaId },
          reader
        );
        expect(answer.items[0]?.title).toBe("Alpha");
      });

      it("finds nothing by searching the title, rather than failing", async () => {
        // Core refuses a filter on a field the caller may not read, as a
        // validation error naming FIELD_NOT_FILTERABLE. For this caller the
        // honest answer to a search on the title is no match.
        const answer = await entries(
          { collection: ARTICLES, search: "alp" },
          titleBlind
        );
        expect(answer.items).toEqual([]);
      });

      it("CONTROL: the same search finds entries for a caller who may read the title", async () => {
        const answer = await entries(
          { collection: ARTICLES, search: "alp" },
          reader
        );
        expect(answer.items.length).toBeGreaterThan(0);
      });
    });
  }
);
