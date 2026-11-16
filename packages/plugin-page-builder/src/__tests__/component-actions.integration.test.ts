/**
 * Detach, duplicate and update a pattern, against a real instance, through
 * Nextly's own request handler with a signed session.
 *
 * What only a server shows: that a stored duplicate's create and its
 * placement's re-point are one transaction, so a refused page update leaves
 * no copy behind; that the copy's origin is recorded in the plugin's own
 * bookkeeping; that a stored detach writes plain blocks; and that updating a
 * pattern leaves an earlier insert of it unchanged.
 *
 * @module __tests__/component-actions.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { COMPONENT_INSTANCE_TYPE } from "@nextlyhq/blocks-engine";
import { definePlugin } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { COMPONENT_RETIRED_SLUG } from "../collections/component-retired-exposures";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
/** A route's path segments under the plugin. */
type Route = string[];

/** The marker a test page's title carries to have its update refused. */
const REFUSE_MARK = "refuse-updates";

/**
 * A plugin whose only act is to refuse an update of a page whose title
 * carries the marker, so a convert's second write fails after its first.
 */
const refusingPages = definePlugin({
  name: "@t/refusing-pages",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    ctx.hooks.on("beforeUpdate", "pages", hook => {
      const original = (hook as { originalData?: { title?: unknown } })
        .originalData;
      if (String(original?.title ?? "").includes(REFUSE_MARK)) {
        throw new Error("This page refuses every update.");
      }
      return (hook as { data?: unknown }).data;
    });
  },
});

function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

describe.each(getConfiguredTestDialects())(
  "making a component from a selection (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), refusingPages],
        seedPublic: true,
      });
      // The instance's first user is its super admin, so it is made here
      // and never acts: every author below holds only what it is granted.
      await person(current, "owner");
      return current;
    }

    async function person(t: TestNextly, name: string): Promise<string> {
      const created = await t.nextly.users.create({
        email: `${name}-${Date.now()}@example.com`,
        password: "Password123!",
        data: { name, isActive: true },
      });
      return created.item.id;
    }

    let roles = 0;

    async function grant(t: TestNextly, userId: string, slugs: string[]) {
      const permissions = await t.nextly.permissions.find({ limit: 500 });
      const ids = slugs.map(slug => {
        const found = permissions.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      roles += 1;
      const role = await t.nextly.roles.create({
        data: { name: `Role ${roles}`, slug: `r-${roles}`, permissionIds: ids },
      });
      const assigned = await new ServiceContainer(
        t.adapter
      ).userRoles.assignRoleToUser(userId, role.item.id);
      expect(assigned.success).toBe(true);
    }

    async function sessionOf(t: TestNextly, userId: string): Promise<string> {
      const user = await t.nextly.users.findByID({ id: userId });
      if (user === null) throw new Error(`no user ${userId}`);
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: user.email,
          name: user.name ?? "",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    /** An author who may create and publish components and update pages. */
    async function author(
      t: TestNextly
    ): Promise<{ id: string; cookie: string }> {
      const id = await person(t, "author");
      await grant(t, id, [
        "create-components",
        "publish-components",
        "read-components",
        "update-components",
        "read-pages",
        "update-pages",
        "read-patterns",
        "update-patterns",
        "publish-patterns",
      ]);
      return { id, cookie: await sessionOf(t, id) };
    }

    async function post(
      cookie: string,
      route: Route,
      body: unknown
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const handlers = createDynamicHandlers();
      const url = `${ORIGIN}/api/plugins/${PAGE_BUILDER_PLUGIN_NAME}/${route.join("/")}`;
      const response = await handlers.POST(
        new Request(url, {
          method: "POST",
          headers: {
            cookie: `${cookie}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        {
          params: Promise.resolve({
            params: [
              "plugins",
              ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
              ...route,
            ],
          }),
        }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
      };
    }

    async function pageWith(t: TestNextly, title: string): Promise<string> {
      const created = await t.nextly.create({
        collection: "pages",
        data: {
          title,
          slug: `p-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          content: {
            formatVersion: 1,
            kind: "page",
            nodes: [heading("a", "First"), heading("b", "Second")],
          },
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function storedContent(t: TestNextly, id: string) {
      const row = (await t.nextly.findByID({
        collection: "pages",
        id,
        overrideAccess: true,
        status: "all",
        depth: 0,
      })) as unknown as {
        content: { nodes: { type: string; props: Record<string, unknown> }[] };
      };
      return row.content;
    }

    async function components(t: TestNextly) {
      const found = await t.nextly.find({
        collection: COMPONENTS_SLUG,
        overrideAccess: true,
        status: "all",
        limit: 50,
        depth: 0,
      });
      return found.items as unknown as {
        id: string;
        title: string;
        status: string;
      }[];
    }

    /** A published component holding one heading, exposing its text. */
    async function card(t: TestNextly): Promise<string> {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "Card",
          slug: `card-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          status: "published",
          content: {
            formatVersion: 1,
            kind: "component",
            nodes: [heading("t", "Card title")],
            exposed: [
              {
                id: "title",
                label: "Title",
                nodeId: "t",
                propPath: "text",
                type: "text",
              },
            ],
          },
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function placing(
      t: TestNextly,
      componentId: string,
      title = "Placing"
    ): Promise<string> {
      const created = await t.nextly.create({
        collection: "pages",
        data: {
          title,
          slug: `p-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          content: {
            formatVersion: 1,
            kind: "page",
            nodes: [
              {
                id: "p1",
                type: COMPONENT_INSTANCE_TYPE,
                version: 1,
                props: { componentId, overrides: { title: "Mine" } },
              },
              {
                id: "p2",
                type: COMPONENT_INSTANCE_TYPE,
                version: 1,
                props: { componentId },
              },
            ],
          },
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    it("duplicates from a stored placement, re-pointing only it, and records the origin", async () => {
      const t = await boot();
      const { cookie } = await author(t);
      const source = await card(t);
      const pageId = await placing(t, source);

      const answered = await post(cookie, ["components", source, "duplicate"], {
        placement: {
          apply: "stored",
          page: { collection: "pages", id: pageId },
          instanceId: "p1",
        },
      });

      expect(answered.status).toBe(201);
      const copy = (answered.body.item as { component: { id: string } })
        .component.id;
      const content = await storedContent(t, pageId);
      expect(content.nodes.map(node => node.props.componentId)).toEqual([
        copy,
        source,
      ]);
      expect(content.nodes[0]?.props.overrides).toEqual({ title: "Mine" });
      const origin = await t.nextly.find({
        collection: COMPONENT_RETIRED_SLUG,
        where: { componentId: { equals: copy } },
        overrideAccess: true,
        limit: 5,
        depth: 0,
      });
      expect(
        (origin.items as unknown as { kind: string; exposureId: string }[]).map(
          row => [row.kind, row.exposureId]
        )
      ).toEqual([["duplicated-from", source]]);
    });

    it("leaves no copy behind when the placement's page refuses the update", async () => {
      const t = await boot();
      const { cookie } = await author(t);
      const source = await card(t);
      const pageId = await placing(t, source, `Locked ${REFUSE_MARK}`);
      const before = (await components(t)).length;

      const answered = await post(cookie, ["components", source, "duplicate"], {
        placement: {
          apply: "stored",
          page: { collection: "pages", id: pageId },
          instanceId: "p1",
        },
      });

      expect(answered.status).toBeGreaterThanOrEqual(400);
      expect(await components(t)).toHaveLength(before);
    });

    it("detaches a stored placement into plain blocks", async () => {
      const t = await boot();
      const { cookie } = await author(t);
      const source = await card(t);
      const pageId = await placing(t, source);

      const answered = await post(cookie, ["components", "detach"], {
        apply: "stored",
        page: { collection: "pages", id: pageId },
        instanceId: "p1",
      });

      expect(answered.status).toBe(200);
      const content = await storedContent(t, pageId);
      expect(content.nodes.map(node => node.type)).toEqual([
        "core/heading",
        COMPONENT_INSTANCE_TYPE,
      ]);
      expect(content.nodes[0]?.props.text).toBe("Mine");
    });

    it("updates a pattern, published, and leaves an earlier insert of it unchanged", async () => {
      const t = await boot();
      const { cookie } = await author(t);
      const pattern = await t.nextly.create({
        collection: "patterns",
        data: {
          title: "Hero",
          slug: `hero-${Date.now()}`,
          granularity: "section",
          status: "published",
          content: {
            formatVersion: 1,
            kind: "pattern",
            nodes: [heading("h", "Old hero")],
          },
        },
        overrideAccess: true,
      });
      const patternId = String(pattern.item.id);
      // A page holding an earlier insert: a copy, no link.
      const earlier = await pageWith(t, "Earlier insert");
      const before = await storedContent(t, earlier);

      const answered = await post(
        cookie,
        ["patterns", patternId, "from-selection"],
        {
          document: {
            formatVersion: 1,
            kind: "page",
            nodes: [heading("n", "New hero")],
          },
          selectedIds: ["n"],
        }
      );

      expect(answered.status).toBe(200);
      const stored = (await t.nextly.findByID({
        collection: "patterns",
        id: patternId,
        overrideAccess: true,
        depth: 0,
      })) as unknown as {
        status: string;
        content: { nodes: { props: { text?: string } }[] };
      };
      expect(stored.status).toBe("published");
      expect(stored.content.nodes[0]?.props.text).toBe("New hero");
      expect(await storedContent(t, earlier)).toEqual(before);
    });
  }
);
