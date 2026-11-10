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
import { defineCollection, group, text } from "nextly/config";
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

/** How a locked article's headline starts: its body is withheld from everyone. */
const LOCKED = "Locked";

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
    blocks({
      name: "body",
      // A field-level read rule on the Page Builder field itself: a caller
      // without `read-pages` reads the article and its title, not its body;
      // and nobody reads the body of a LOCKED article, decided row by row.
      access: {
        read: ({
          permissions,
          data,
        }: {
          permissions: string[];
          data?: { headline?: unknown };
        }) =>
          permissions.includes(`read-${PAGES}`) &&
          !String(data?.headline ?? "").startsWith(LOCKED),
      },
    } as never),
  ],
});

const notes = defineCollection({
  slug: NOTES,
  fields: [text({ name: "title" })],
});

/** A collection whose Page Builder field sits inside a named group. */
const LANDINGS = "landings";

const landings = defineCollection({
  slug: LANDINGS,
  fields: [
    text({ name: "title" }),
    group({ name: "hero", fields: [blocks({ name: "body" })] } as never),
  ],
});

/**
 * A collection the registry holds whose table was never created: its schema
 * change is still pending, as when a blocks field is added and not migrated.
 */
const GHOSTS = "ghosts";

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

/** How many roles this file has made, for names that stay short. */
let rolesMade = 0;

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
    /** Reads articles and their titles, and not their Page Builder field. */
    let bodyBlind = "";
    let alphaPageId = "";
    let alphaArticleId = "";

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [articles, notes, landings],
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
      // Registered past the schema pipeline, so it has a registry row and no
      // table. Before the keys, so its read permission is seeded and granted.
      const registry = t.getService("collectionRegistryService") as unknown as {
        registerCollection(data: Record<string, unknown>): Promise<unknown>;
      };
      await registry.registerCollection({
        slug: GHOSTS,
        labels: { singular: "Ghost", plural: "Ghosts" },
        tableName: GHOSTS,
        fields: [
          { name: "title", type: "text" },
          { name: "content", type: "blocks" },
        ],
        source: "ui",
        migrationStatus: "pending",
      });
      const seeded = await direct.permissions.find({ limit: 500 });

      /** A key whose role holds exactly the permissions named. */
      async function keyHolding(slugs: string[]): Promise<string> {
        // Numbered rather than spelled from the permissions, so the role's
        // name stays inside the roles table's length on Postgres and MySQL,
        // which refuse a longer one (SQLite doesn't check). Tagged by file,
        // so two files sharing a database never name the same role.
        rolesMade += 1;
        const roleTag = `ps-${rolesMade}`;
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

      reader = await keyHolding([
        `read-${PAGES}`,
        `read-${ARTICLES}`,
        `read-${NOTES}`,
        `read-${LANDINGS}`,
        `read-${GHOSTS}`,
      ]);
      outsider = await keyHolding([`read-${PAGES}`, `read-${NOTES}`]);
      titleBlind = await keyHolding([`read-${PAGES}`, `read-${ARTICLES}`]);
      bodyBlind = await keyHolding([`read-${ARTICLES}`, `read-${NOTES}`]);

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
      // A landing whose group was stored without the Page Builder field, as a
      // row saved before the field was added holds it.
      await direct.create({
        collection: LANDINGS,
        data: { title: "Grouped yy", hero: {} },
      });
      // Titles whose order depends on case: by code point, SQLite's order,
      // "Qx Zulu" < "Qx mango" < "qx apple"; ignoring case, "qx apple" first.
      for (const headline of ["Qx Zulu", "qx apple"]) {
        await direct.create({ collection: ARTICLES, data: { headline } });
      }
      await direct.create({
        collection: PAGES,
        data: { title: "Qx mango", slug: "qx-mango", status: "published" },
      });
      // Two locked articles that sort before two open ones ("L" < "O"), so a
      // limit of two reads only locked rows first.
      for (const headline of [
        `${LOCKED} zq 1`,
        `${LOCKED} zq 2`,
        "Open zq 3",
        "Open zq 4",
      ]) {
        await direct.create({ collection: ARTICLES, data: { headline } });
      }
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
            collectionPluralLabel: "Articles",
            field: "body",
            title: "Alpha article",
            rev: "1",
          },
          {
            id: alphaPageId,
            collection: PAGES,
            collectionLabel: "Page",
            collectionPluralLabel: "Pages",
            field: "content",
            title: "Alpha page",
            status: "published",
            rev: "1",
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
        // Every match: three pages, the named article, the fillers, the two
        // "Qx" articles, the four "zq" ones and the one landing. Exact here,
        // because the rows read from each collection were all openable and
        // every match not read is counted (an upper bound in general, see the
        // contract).
        expect(answer.meta.total).toBe(3 + 1 + FILLER + 2 + 4 + 1);
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

    describe("the order across collections", () => {
      // Each database orders titles by its own collation (code point on
      // SQLite, a locale's rules on PostgreSQL and MySQL), and the route
      // merges those orders without re-sorting them. So the invariant on every
      // dialect is that asking for fewer rows answers a prefix of asking for
      // more; the exact titles are pinned on SQLite, where code-point order is
      // the true order the merge compares by.
      const titles = (answer: { items: { title: string }[] }) =>
        answer.items.map(item => item.title);

      it("never ranks a row the database's limit cut above one it kept", async () => {
        // Articles answer their first title for a limit of one and cut the
        // rest. A merge that ranked a cut row above a kept one would answer a
        // first row the full listing doesn't start with.
        const first = await search({ q: "qx", limit: "1" }, reader);
        const all = await search({ q: "qx", limit: "3" }, reader);
        expect(titles(first)).toEqual(titles(all).slice(0, 1));
        if (dialect === "sqlite") expect(titles(first)).toEqual(["Qx Zulu"]);
      });

      it("answers the same order however many rows are asked for", async () => {
        const all = await search({ q: "qx", limit: "3" }, reader);
        const two = await search({ q: "qx", limit: "2" }, reader);
        expect(titles(all)).toHaveLength(3);
        expect(titles(two)).toEqual(titles(all).slice(0, 2));
        if (dialect === "sqlite") {
          expect(titles(all)).toEqual(["Qx Zulu", "Qx mango", "qx apple"]);
        }
      });
    });

    describe("a caller who may read a page but not its Page Builder field", () => {
      it("is not offered the page, since the editor would open on a field it may not read", async () => {
        const answer = await search({ q: "alpha" }, bodyBlind);

        expect(answer.items.map(item => item.collection)).not.toContain(
          ARTICLES
        );
      });

      it("reads past rows whose field is withheld row by row, to the openable ones behind them", async () => {
        const answer = await search({ q: "zq", limit: "2" }, reader);

        expect(answer.items.map(item => item.title)).toEqual([
          "Open zq 3",
          "Open zq 4",
        ]);
        // Every match was read, so the count is exact: the two open ones.
        expect(answer.meta.total).toBe(2);
        expect(answer.meta.hasNext).toBe(false);
      });

      it("CONTROL: a caller who may read the field is offered the same article", async () => {
        const answer = await search({ q: "alpha" }, reader);
        expect(answer.items.map(item => item.id)).toContain(alphaArticleId);
      });
    });

    describe("a Page Builder field inside a group", () => {
      it("lists a page whose group holds no value for the field yet", async () => {
        const answer = await search({ q: "grouped" }, reader);

        expect(
          answer.items.map(item => [item.collection, item.field, item.title])
        ).toEqual([[LANDINGS, "hero.body", "Grouped yy"]]);
      });
    });

    describe("a collection whose schema is not live", () => {
      it("is not read while its migration is pending, so the search still answers", async () => {
        const answer = await search({ q: "alpha" }, reader);

        expect(answer.items.map(item => item.collection)).toEqual([
          ARTICLES,
          PAGES,
        ]);
      });

      it("is left out alone when its read fails anyway, and the others still answer", async () => {
        // The registry now claims a table that does not exist, so the read
        // reaches the database and fails there.
        const registry = t.getService(
          "collectionRegistryService"
        ) as unknown as {
          updateMigrationStatus(slug: string, status: string): Promise<void>;
        };
        await registry.updateMigrationStatus(GHOSTS, "applied");
        try {
          const answer = await search({ q: "alpha" }, reader);
          expect(answer.items.map(item => item.collection)).toEqual([
            ARTICLES,
            PAGES,
          ]);
        } finally {
          await registry.updateMigrationStatus(GHOSTS, "pending");
        }
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
