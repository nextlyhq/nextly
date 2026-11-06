/**
 * The component library as an author reaches it: through core's request
 * handler, with a real API key per role, against a real database.
 *
 * This read is the one catalogue the editor offers components from: the Add
 * panel's "Your components" group, the editor's search and the Components
 * panel are all handed its rows. So a component this answer leaves out is
 * offered nowhere, and what is pinned here is the line between the two
 * callers: one holding the collection's read permission is listed the
 * site's components, and one without it is refused, so none reaches any of
 * the three.
 *
 * @module __tests__/component-library-access.integration.test
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
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import {
  COMPONENT_LIBRARY_ROUTE_PATH,
  PAGE_BUILDER_PLUGIN_NAME,
  type ComponentLibraryResponse,
} from "../library-contract";
import { pageBuilder } from "../plugin";

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
    overrideAccess?: boolean;
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
  ...COMPONENT_LIBRARY_ROUTE_PATH.slice(1).split("/"),
];

/** One request to the library through core's handler, as `key`. */
async function ask(key: string): Promise<Response> {
  const handlers = createDynamicHandlers();
  const request = new Request(`http://localhost/api/${SEGMENTS.join("/")}`, {
    method: "GET",
    headers: { authorization: `Bearer ${key}` },
  });
  return handlers.GET(request, {
    params: Promise.resolve({ params: SEGMENTS }),
  });
}

/** A component definition with one heading, as an author saves one. */
function definition(text: string): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [
      {
        id: "root",
        type: "core/heading",
        version: 1,
        props: { text, level: "h2" },
      },
    ],
  };
}

describe.each(getConfiguredTestDialects())(
  "the component library, read as an author (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    /** Reads pages and components. */
    let reader = "";
    /** Reads pages and not components. */
    let outsider = "";

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
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

      reader = await keyHolding(["read-pages", `read-${COMPONENTS_SLUG}`]);
      outsider = await keyHolding(["read-pages"]);

      for (const [title, slug] of [
        ["Promo card", "promo-card"],
        ["Call to action", "call-to-action"],
      ]) {
        await direct.create({
          collection: COMPONENTS_SLUG,
          data: {
            title,
            slug,
            status: "published",
            content: definition(title),
          },
          overrideAccess: true,
        });
      }
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("lists the site's components to an author who may read them", async () => {
      const response = await ask(reader);
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as ComponentLibraryResponse;

      expect(body.items.map(item => item.title).sort()).toEqual([
        "Call to action",
        "Promo card",
      ]);
    });

    it("lists none to an author who may not read components at all", async () => {
      const response = await ask(outsider);

      expect(response.status).toBe(403);
      const text = await response.text();
      expect(text).not.toContain("Promo card");
      expect(text).not.toContain("Call to action");
    });
  }
);
