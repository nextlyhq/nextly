/**
 * The loop collections route as an author reaches it: through core's request
 * handler, with a real API key per role, against a real database on each
 * dialect.
 *
 * The unit suite pins how the route chooses the fields it offers from the
 * public's. This pins, on every dialect, that the fields are the PUBLIC's as
 * core judges them, whoever asks: a field visitors may not read is not
 * offered even to a caller who may read it, a collection visitors may read
 * none of offers no field, and the collections listed are the caller's.
 *
 * @module __tests__/loop-collections-route.integration.test
 */

// Read once, when the harness validates its environment; API keys are signed
// with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { clearBlocks } from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  LOOP_COLLECTIONS_ROUTE_PATH,
  type LoopCollectionsResponse,
} from "../loop-collections-contract";
import { pageBuilder } from "../plugin";

/** The collection a loop repeats over. */
const ARTICLES = "articles";
/** A second collection, whose grant the headline's read rule asks for. */
const NOTES = "notes";

const articles = defineCollection({
  slug: ARTICLES,
  // Visitors may read articles, as a published page's list does.
  access: { read: () => true },
  fields: [
    text({
      name: "headline",
      // A field-level read rule a visitor fails and a signed-in caller
      // passes: a list may not name it, since the entries shown would reveal
      // its values to visitors.
      access: { read: ({ user }: { user: unknown }) => user != null },
    } as never),
    text({ name: "body" }),
  ],
});

/** A collection visitors may not read, which the caller may. */
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
  LOOP_COLLECTIONS_ROUTE_PATH.slice(1),
];

/** The route's answer for `key`, expected to succeed. */
async function listed(key: string): Promise<LoopCollectionsResponse> {
  const handlers = createDynamicHandlers();
  const response = await handlers.GET(
    new Request(`http://localhost/api/${SEGMENTS.join("/")}`, {
      method: "GET",
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ params: SEGMENTS }) }
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as LoopCollectionsResponse;
}

/** The names of the fields offered for `slug`, or `undefined` if it is not listed. */
function fieldNames(
  answer: LoopCollectionsResponse,
  slug: string
): string[] | undefined {
  return answer.items
    .find(item => item.slug === slug)
    ?.fields.map(field => field.name);
}

describe.each(getConfiguredTestDialects())(
  "the loop collections route (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    /** Reads articles, their headlines and notes. */
    let reader = "";
    /** Reads articles only. */
    let articlesOnly = "";

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        // The Public role, granted each collection's read where its rule
        // answers true, as boot grants it: the fields offered are its.
        seedPublic: true,
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

      reader = await keyHolding([`read-${ARTICLES}`, `read-${NOTES}`]);
      articlesOnly = await keyHolding([`read-${ARTICLES}`]);

      // Rows to order: a probe that read them would have something to sort.
      for (const headline of ["Beta", "Alpha", "Gamma"]) {
        await direct.create({
          collection: ARTICLES,
          data: { headline, body: `${headline} body` },
        });
      }
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
      clearBlocks();
    });

    it("offers the fields visitors may read, even to a caller who may read more", async () => {
      const names = fieldNames(await listed(reader), ARTICLES);

      expect(names).toContain("body");
      expect(names).not.toContain("headline");
    });

    it("offers no field of a collection visitors may read none of", async () => {
      expect(fieldNames(await listed(reader), NOTES)).toEqual([]);
    });

    it("lists only the collections the caller may read", async () => {
      const answer = await listed(articlesOnly);

      expect(fieldNames(answer, ARTICLES)).toContain("body");
      expect(fieldNames(answer, NOTES)).toBeUndefined();
    });
  }
);
