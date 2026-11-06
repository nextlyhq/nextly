/**
 * The site style as the editor reads it over HTTP: the plugin's own route,
 * through the real dispatcher, as each kind of caller reaches it.
 *
 * The canvas cannot draw a block without the site style, so an author who may
 * edit a page must be able to read it without Design's `read-site-style`; a
 * caller who may edit nothing the builder opens, or nobody at all, may not.
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { defineCollection, text } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { BLOCKS_TYPE } from "../fields/blocksField";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import { SITE_STYLE_SLUG } from "../site-style-storage";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

/** What the Single holds before each read: two sections stored, two not. */
const TOKENS = {
  tokens: [
    {
      id: "brand",
      name: "brand",
      kind: "color",
      values: { light: "#123456" },
    },
  ],
};
const CLASSES = [
  { id: "c1", slug: "card", orderIndex: 0, styles: { base: {} } },
];

describe.each(getConfiguredTestDialects())(
  "the site style over the editor's route (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        seedPublic: true,
        collections: [
          // A collection the builder opens, whose authors may update only the
          // entries they own: the rule answers a row filter, not a yes.
          defineCollection({
            slug: "articles",
            access: {
              read: () => true,
              update: ({ user }) => ({ owner: { equals: user?.id ?? "" } }),
            },
            fields: [
              text({ name: "owner" }),
              { name: "body", type: BLOCKS_TYPE },
            ],
          }),
        ],
      });
      // The site's first user is its owner, granted everything. Made first, so
      // every person below holds only what the test gives them.
      await current.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      await current.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: { tokens: TOKENS, classes: CLASSES, _overwrite: true },
        overrideAccess: true,
      });
      return current;
    }

    let people = 0;
    let roles = 0;

    /** A signed-in person holding exactly the permissions named. */
    async function holding(t: TestNextly, ...slugs: string[]): Promise<string> {
      people += 1;
      const created = await t.nextly.users.create({
        email: `person-${people}@example.com`,
        password: "Password123!",
        data: { name: `Person ${people}`, isActive: true },
      });
      const userId = created.item.id;
      if (slugs.length > 0) {
        const permissions = await t.nextly.permissions.find({ limit: 500 });
        const ids = slugs.map(slug => {
          const found = permissions.items.find(item => item.slug === slug);
          if (found === undefined) throw new Error(`${slug} is not seeded`);
          return found.id;
        });
        roles += 1;
        const role = await t.nextly.roles.create({
          data: {
            name: `Role ${roles}`,
            slug: `r-${roles}`,
            permissionIds: ids,
          },
        });
        const assigned = await new ServiceContainer(
          t.adapter
        ).userRoles.assignRoleToUser(userId, role.item.id);
        expect(assigned.success).toBe(true);
      }
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: created.item.email,
          name: `Person ${people}`,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    /** The route, through the real dispatcher, as the browser asks it. */
    async function read(
      cookie: string | null
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const path = [
        "plugins",
        ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
        "site",
        "style",
      ];
      const handlers = createDynamicHandlers();
      const response = await handlers.GET(
        new Request(`${ORIGIN}/api/${path.join("/")}`, {
          method: "GET",
          headers: {
            cookie:
              cookie === null
                ? `nextly_csrf=${CSRF}`
                : `${cookie}; nextly_csrf=${CSRF}`,
            origin: ORIGIN,
          },
        }),
        { params: Promise.resolve({ params: path }) }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
      };
    }

    it("lets an author who may edit pages read it without Design's permission", async () => {
      const t = await boot();
      // The least-privilege author the browser suite signs in as.
      const author = await holding(
        t,
        "read-pages",
        "update-pages",
        "read-components"
      );
      const answer = await read(author);
      expect(answer.status).toBe(200);
      expect(answer.body.tokens).toEqual(TOKENS);
      expect(answer.body.classes).toEqual(CLASSES);
    });

    it("answers the four stored sections and the spacing model, and nothing else", async () => {
      const t = await boot();
      const author = await holding(t, "read-pages", "update-pages");
      const answer = await read(author);
      expect(answer.status).toBe(200);
      expect(Object.keys(answer.body).sort()).toEqual([
        "breakpoints",
        "classes",
        "fonts",
        "spacingMode",
        "tokens",
      ]);
      // A section the Single does not hold reads as empty, not as missing.
      expect(answer.body.fonts).toBeNull();
      expect(answer.body.breakpoints).toBeNull();
    });

    it("lets an author who may update components read it", async () => {
      const t = await boot();
      const author = await holding(t, "read-components", "update-components");
      expect((await read(author)).status).toBe(200);
    });

    it("lets a role holding Design's read permission read it", async () => {
      const t = await boot();
      const designer = await holding(t, "read-site-style");
      const answer = await read(designer);
      expect(answer.status).toBe(200);
      expect(answer.body.tokens).toEqual(TOKENS);
    });

    it("refuses a caller who is not signed in", async () => {
      await boot();
      const answer = await read(null);
      expect(answer.status).toBe(401);
      expect(answer.body.tokens).toBeUndefined();
    });

    it("lets an author whose update is limited to their own entries read it", async () => {
      const t = await boot();
      // The rule's filter decides which articles this author may update; it
      // may update some, so it may draw them.
      const author = await holding(t, "read-articles", "update-articles");
      const answer = await read(author);
      expect(answer.status).toBe(200);
      expect(answer.body.tokens).toEqual(TOKENS);
    });

    it("refuses an author who may only read the entries the builder opens", async () => {
      const t = await boot();
      const reader = await holding(t, "read-articles");
      expect((await read(reader)).status).toBe(403);
    });

    it("refuses a signed-in caller who may edit nothing the builder opens", async () => {
      const t = await boot();
      // May read pages and components, update neither.
      const reader = await holding(t, "read-pages", "read-components");
      const answer = await read(reader);
      expect(answer.status).toBe(403);
      expect(answer.body.tokens).toBeUndefined();
    });
  }
);
