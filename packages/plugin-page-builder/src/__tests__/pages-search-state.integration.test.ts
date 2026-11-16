/**
 * The pages search's paging and publishing state as an author reaches them:
 * through core's request handler, with a real API key per role, against a real
 * database.
 *
 * The unit suite pins the merge and the reads over in-memory tables. This pins
 * that a cursor walks every page of two real collections in order with nothing
 * repeated or skipped, and that core's workflow filters, read as the caller,
 * tell a draft, a published page with a working draft, a page a scheduled
 * release will publish and a plainly published page apart.
 *
 * @module __tests__/pages-search-state.integration.test
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
  pagesSearchPath,
  type PageItem,
  type PagesSearchQuery,
  type PagesSearchResponse,
} from "../pages-search-contract";
import { pageBuilder } from "../plugin";

/** The plugin's own page collection, which has the Draft/Published lifecycle. */
const PAGES = "pages";
/** A second page collection, without the lifecycle. */
const ARTICLES = "articles";

const articles = defineCollection({
  slug: ARTICLES,
  fields: [text({ name: "title" }), blocks({ name: "body" })],
});

/** When the scheduled release runs: far enough ahead never to fall due. */
const LATER = "2099-01-01T09:00:00Z";

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
  create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<{ item: { id: string | number } }>;
  update(args: {
    collection: string;
    id: string;
    data: Record<string, unknown>;
  }): Promise<unknown>;
  releases: {
    create(args: { title: string }): Promise<{ id: string }>;
    addMember(args: Record<string, unknown>): Promise<{ id: string }>;
    schedule(args: {
      id: string;
      at: Date;
      timezone: string;
    }): Promise<unknown>;
  };
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

/** One search through core's handler, as `key`. */
async function search(
  query: PagesSearchQuery,
  key: string
): Promise<PagesSearchResponse> {
  const handlers = createDynamicHandlers();
  const [pathname = "", queryString = ""] = pagesSearchPath(query).split("?");
  const segments = [
    "plugins",
    ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
    ...pathname.slice(1).split("/"),
  ];
  const response = await handlers.GET(
    new Request(`http://localhost/api/${segments.join("/")}?${queryString}`, {
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ params: segments }) }
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as PagesSearchResponse;
}

/** How many roles this file has made, for names that stay short. */
let rolesMade = 0;

describe.each(getConfiguredTestDialects())(
  "the pages search's paging and state (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    /** Reads both page collections, and releases. */
    let reader = "";
    /** Reads both page collections, and not releases. */
    let releaseBlind = "";

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [articles],
        // The boot's seeding, which is where the release permissions come
        // from.
        seedPublic: true,
        plugins: [pageBuilder()],
      });
      const direct = t.nextly as unknown as Direct;

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
        // Numbered rather than spelled from the permissions, so the role's
        // name stays inside the roles table's length on Postgres and MySQL,
        // which refuse a longer one (SQLite doesn't check). Tagged by file,
        // so two files sharing a database never name the same role.
        rolesMade += 1;
        const roleTag = `pss-${rolesMade}`;
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
        "read-content-releases",
      ]);
      releaseBlind = await keyHolding([`read-${PAGES}`, `read-${ARTICLES}`]);

      const page = async (title: string, status: string) =>
        String(
          (
            await direct.create({
              collection: PAGES,
              data: {
                title,
                slug: title.toLowerCase().replace(/ /g, "-"),
                status,
              },
            })
          ).item.id
        );

      // Where a page stands: never published, published with an edit kept
      // as its working draft, published with nothing waiting, and a draft a
      // scheduled release will publish.
      await page("St draft", "draft");
      const changed = await page("St changed", "published");
      await direct.update({
        collection: PAGES,
        id: changed,
        data: { title: "St changed, edited", _overwrite: true },
      });
      await page("St plain", "published");
      const scheduled = await page("St scheduled", "draft");
      const release = await direct.releases.create({ title: "Launch" });
      await direct.releases.addMember({
        releaseId: release.id,
        scopeKind: "collection",
        scopeSlug: PAGES,
        entryId: scheduled,
        locale: null,
        action: "publish",
        userId: owner.item.id,
      });
      await direct.releases.schedule({
        id: release.id,
        at: new Date(LATER),
        timezone: "UTC",
      });

      // Seven pages across both collections, interleaved by title, so every
      // page of a two-row walk takes from both.
      for (const title of ["Pq A", "Pq C", "Pq E"]) {
        await page(title, "published");
      }
      for (const title of ["Pq B", "Pq D", "Pq F", "Pq G"]) {
        await direct.create({ collection: ARTICLES, data: { title } });
      }
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    describe("where each page stands", () => {
      it("says draft, changed or scheduled by core's own reading, and nothing for a plain published page", async () => {
        const answer = await search({ q: "St " }, reader);

        expect(
          answer.items.map(item => [item.title, item.status, item.state])
        ).toEqual([
          ["St changed", "published", "changed"],
          ["St draft", "draft", "draft"],
          ["St plain", "published", undefined],
          ["St scheduled", "draft", "scheduled"],
        ]);
        expect(answer.items[2]).not.toHaveProperty("state");
      });

      it("tells a caller who may not read releases nothing about one", async () => {
        const answer = await search({ q: "St scheduled" }, releaseBlind);

        // Only what the page's own status says.
        expect(answer.items.map(item => item.state)).toEqual(["draft"]);
      });

      it("says nothing of a page in a collection without the lifecycle", async () => {
        const answer = await search({ q: "Pq B" }, reader);

        expect(answer.items).toHaveLength(1);
        expect(answer.items[0]).not.toHaveProperty("state");
      });
    });

    describe("paging", () => {
      it("walks every page across both collections in title order, with nothing repeated or skipped", async () => {
        const pages: PageItem[][] = [];
        const metas: PagesSearchResponse["meta"][] = [];
        let before: string | undefined;
        for (let guard = 0; guard < 10; guard += 1) {
          const answer = await search(
            { q: "Pq", limit: 2, ...(before === undefined ? {} : { before }) },
            reader
          );
          pages.push([...answer.items]);
          metas.push(answer.meta);
          if (!answer.meta.hasNext) break;
          before = answer.meta.nextBefore;
        }

        expect(pages.map(items => items.map(item => item.title))).toEqual([
          ["Pq A", "Pq B"],
          ["Pq C", "Pq D"],
          ["Pq E", "Pq F"],
          ["Pq G"],
        ]);
        expect(pages.map(items => items.map(item => item.collection))).toEqual([
          [PAGES, ARTICLES],
          [PAGES, ARTICLES],
          [PAGES, ARTICLES],
          [ARTICLES],
        ]);
        expect(
          metas.map(meta => [meta.page, meta.hasPrev, meta.hasNext])
        ).toEqual([
          [1, false, true],
          [2, true, true],
          [3, true, true],
          [4, true, false],
        ]);
      });
    });
  }
);
