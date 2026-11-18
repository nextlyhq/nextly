/**
 * Starter pages as an author reaches them: registered in the site's config
 * and in a plugin's declaration, listed through core's request handler with
 * a real API key, and a page made from one against a real database.
 *
 * The unit suites pin what is decided (`starter-pages.test.ts`,
 * `starter-offer.test.ts`, `new-page-route.test.ts`). This pins what it
 * MEANS on each dialect: both registered starters are listed beside each
 * other with their name, description and blocks; a page made from one
 * stores a copy under new ids, its header and footer as the author chose;
 * two pages from one starter share no block and carry no link back to it;
 * a change to one page reaches neither the other nor the starter; and a
 * starter needing a variable the site doesn't have is neither listed nor
 * made.
 *
 * @module __tests__/starter-pages.integration.test
 */

// Read once, when the harness validates its environment; API keys are signed
// with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { walkNodes, type BlockNode } from "@nextlyhq/blocks-engine";
import { definePlugin } from "@nextlyhq/plugin-sdk";
import type { StarterPageDefinition } from "@nextlyhq/plugin-sdk/blocks";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  newPagePath,
  PAGES_ROUTE_PATH,
  type CreatedPageItem,
  type NewPageFacts,
} from "../pages-write-contract";
import { pageBuilder } from "../plugin";
import { fixtureStarter } from "../starter-pages/starter-pages.fixture";
import {
  STARTER_PAGES_ROUTE_PATH,
  type StarterPagesResponse,
} from "../starter-pages/starter-pages-contract";

/** The plugin's own page collection. */
const PAGES = "pages";

/** The site's own starter, registered in its config. */
const siteStarter = fixtureStarter("site-welcome", "Welcome");

/** A starter needing a variable no site here defines: never offered. */
const needsMissingVariable: StarterPageDefinition = {
  id: "needs-missing",
  label: "Missing colour",
  description: "Coloured with a variable this site does not have.",
  blocks: [
    {
      id: "only",
      type: "core/heading",
      version: 1,
      props: { text: "Hi", level: "h2" },
      styles: { base: { base: { color: { $token: "color.not-here" } } } },
    },
  ],
};

/** A plugin declaring a starter of its own. */
const declaring = definePlugin({
  name: "@test/starter-pages",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    declarations: {
      [PAGE_BUILDER_PLUGIN_NAME]: {
        starterPages: [fixtureStarter("plugin-welcome", "From a plugin")],
      },
    },
  },
});

/** The Direct API calls this suite makes staff and reads pages with, trusted. */
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
  findByID(args: {
    collection: string;
    id: string;
    status?: string;
  }): Promise<Record<string, unknown> | null>;
  update(args: {
    collection: string;
    id: string;
    data: Record<string, unknown>;
  }): Promise<unknown>;
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

/** Every node of a forest, in document order. */
function nodesOf(nodes: readonly BlockNode[]): BlockNode[] {
  const found: BlockNode[] = [];
  walkNodes([...nodes], node => {
    found.push(node);
  });
  return found;
}

/** A stored blocks value as a forest, SQLite's text included. */
function forestOf(value: unknown): BlockNode[] {
  const document = (typeof value === "string" ? JSON.parse(value) : value) as {
    nodes?: BlockNode[];
  } | null;
  return document?.nodes ?? [];
}

describe.each(getConfiguredTestDialects())(
  "starter pages (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let direct: Direct;
    /** May read, create and update pages. */
    let editor = "";

    /** The stored page body of the page `id`. */
    async function bodyOf(id: string): Promise<BlockNode[]> {
      const row = await direct.findByID({
        collection: PAGES,
        id,
        status: "all",
      });
      return forestOf(row?.content);
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [
          pageBuilder({
            pagePreviewPath: "/{slug}",
            starterPages: [siteStarter, needsMissingVariable],
          }),
          declaring,
        ],
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
      const ids = ["create", "read", "update"].map(action => {
        const slug = `${action}-${PAGES}`;
        const found = seeded.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      const role = await direct.roles.create({
        data: { name: "Role sp-1", slug: "r-sp-1", permissionIds: ids },
      });
      const keys = t.getService("apiKeyService") as unknown as ApiKeys;
      editor = (
        await keys.createApiKey(owner.item.id, {
          name: "starter pages editor",
          tokenType: "role-based",
          roleId: role.item.id,
          expiresIn: "unlimited",
        })
      ).key;
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("lists the site's and a plugin's starters with a name, a description and blocks, leaving out one the site can't draw", async () => {
      const response = await ask("GET", STARTER_PAGES_ROUTE_PATH, editor);
      expect(response.status, await response.clone().text()).toBe(200);
      const listed = (await response.json()) as StarterPagesResponse;
      expect(
        listed.items.map(item => [item.id, item.label, item.description])
      ).toEqual([
        ["site-welcome", "Welcome", siteStarter.description],
        ["plugin-welcome", "From a plugin", siteStarter.description],
      ]);
      expect(listed.items[0]?.document).toEqual({
        formatVersion: 1,
        kind: "page",
        nodes: siteStarter.blocks,
      });

      // The New page dialog reads the same list.
      const facts = (await (
        await ask("GET", newPagePath({ collection: PAGES }), editor)
      ).json()) as NewPageFacts;
      expect(facts.starters.map(item => item.id)).toEqual([
        "site-welcome",
        "plugin-welcome",
      ]);
    });

    it("makes a page from a starter as a copy under new ids, its header and footer as chosen", async () => {
      const page = await created(
        await ask("POST", PAGES_ROUTE_PATH, editor, {
          collection: PAGES,
          title: "From the starter",
          starter: "site-welcome",
          layout: null,
          noHeaderFooter: true,
        })
      );
      const stored = await direct.findByID({
        collection: PAGES,
        id: page.id,
        status: "all",
      });
      expect(stored).toMatchObject({ noHeaderFooter: true });
      const body = nodesOf(forestOf(stored?.content));
      const starterNodes = nodesOf(siteStarter.blocks);
      expect(body.map(node => node.type)).toEqual(
        starterNodes.map(node => node.type)
      );
      expect(body.map(node => node.props)).toEqual(
        starterNodes.map(node => node.props)
      );
      for (const node of body) {
        expect(starterNodes.map(each => each.id)).not.toContain(node.id);
        // Nothing links the page back to the starter, so no later change to
        // the starter can be followed into it.
        expect(node.origin).toBeUndefined();
      }
    });

    it("keeps each page its own: no shared block, and no change reaching the other page or the starter", async () => {
      const make = async (title: string) =>
        created(
          await ask("POST", PAGES_ROUTE_PATH, editor, {
            collection: PAGES,
            title,
            starter: "plugin-welcome",
          })
        );
      const first = await make("First copy");
      const second = await make("Second copy");
      const firstBody = await bodyOf(first.id);
      const secondBody = await bodyOf(second.id);
      const secondIds = nodesOf(secondBody).map(node => node.id);
      for (const node of nodesOf(firstBody)) {
        expect(secondIds).not.toContain(node.id);
      }

      // A change on the first page reaches neither the second nor the list.
      const changed = structuredClone(firstBody);
      (changed[0] as { props: Record<string, unknown> }).props.as = "div";
      await direct.update({
        collection: PAGES,
        id: first.id,
        // A trusted write over whatever is stored: the test made the page.
        data: {
          content: { formatVersion: 1, kind: "page", nodes: changed },
          _overwrite: true,
        },
      });
      expect((await bodyOf(first.id))[0]?.props).toMatchObject({ as: "div" });
      expect(await bodyOf(second.id)).toEqual(secondBody);
      const listed = (await (
        await ask("GET", STARTER_PAGES_ROUTE_PATH, editor)
      ).json()) as StarterPagesResponse;
      expect(
        listed.items.find(item => item.id === "plugin-welcome")?.document
          .nodes[0]?.props
      ).toMatchObject({ as: "section" });
    });

    it("refuses a page from a starter the site doesn't offer, and makes nothing", async () => {
      const response = await ask("POST", PAGES_ROUTE_PATH, editor, {
        collection: PAGES,
        title: "Missing colour",
        starter: "needs-missing",
      });
      expect(response.status, await response.clone().text()).toBe(400);
      const body = (await response.json()) as {
        error?: { data?: { errors?: { path: string }[] } };
      };
      expect(body.error?.data?.errors?.map(issue => issue.path)).toEqual([
        "starter",
      ]);
    });
  }
);
