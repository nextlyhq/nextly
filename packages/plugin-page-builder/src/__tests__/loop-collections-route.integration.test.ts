/**
 * The loop collections route as an author reaches it: through core's request
 * handler, with a real API key per role, against a real database on each
 * dialect.
 *
 * The unit suite pins how the route narrows the fields it offers from core's
 * refusals. This pins that core's answer is the caller's own on every
 * dialect: a field with a read rule the caller fails is not offered, the
 * fields the caller may read are, and the probe that asks (a read that no row
 * can match, so nothing is sorted) is accepted rather than refused.
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
  fields: [
    text({
      name: "headline",
      // A field-level read rule, in the spelling core hands a rule: the
      // stored permission slug. A caller without `read-notes` reads the row
      // and not its headline, so it may not order rows by it either.
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
function sortNames(
  answer: LoopCollectionsResponse,
  slug: string
): string[] | undefined {
  return answer.items
    .find(item => item.slug === slug)
    ?.sortFields.map(field => field.name);
}

describe.each(getConfiguredTestDialects())(
  "the loop collections route (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    /** Reads articles and their headlines. */
    let reader = "";
    /** Reads articles, and not the headline field. */
    let headlineBlind = "";

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

      reader = await keyHolding([`read-${ARTICLES}`, `read-${NOTES}`]);
      headlineBlind = await keyHolding([`read-${ARTICLES}`]);

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

    it("offers every field a caller who may read them all can sort by", async () => {
      const names = sortNames(await listed(reader), ARTICLES);

      expect(names).toEqual(expect.arrayContaining(["headline", "body"]));
    });

    it("leaves out a field whose read rule the caller fails, keeping the rest", async () => {
      const names = sortNames(await listed(headlineBlind), ARTICLES);

      expect(names).toContain("body");
      expect(names).not.toContain("headline");
    });

    it("lists only the collections the caller may read", async () => {
      const answer = await listed(headlineBlind);

      expect(sortNames(answer, ARTICLES)).toBeDefined();
      expect(sortNames(answer, NOTES)).toBeUndefined();
    });
  }
);
