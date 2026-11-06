/**
 * Making a component from a selection, against a real instance, through
 * Nextly's own request handler with a signed session.
 *
 * What only a server shows: that a stored convert's two writes are one
 * transaction on every dialect, so a page update refused partway leaves no
 * component behind; that a successful one lists the page as the component's
 * host in the usage index once it commits; that a dry run writes nothing;
 * and who each write is attributed to.
 *
 * @module __tests__/component-from-selection.integration.test
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
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
const ROUTE = ["components", "from-selection"];

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
      ]);
      return { id, cookie: await sessionOf(t, id) };
    }

    async function post(
      cookie: string,
      body: unknown
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const handlers = createDynamicHandlers();
      const url = `${ORIGIN}/api/plugins/${PAGE_BUILDER_PLUGIN_NAME}/${ROUTE.join("/")}`;
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
              ...ROUTE,
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

    const convert = (pageId: string, extra: Record<string, unknown> = {}) => ({
      action: "convert",
      apply: "stored",
      page: { collection: "pages", id: pageId },
      selectedIds: ["b"],
      fields: { title: "Second heading" },
      ...extra,
    });

    it("converts a stored page in one transaction, and lists the page as the component's host", async () => {
      const t = await boot();
      const { id: userId, cookie } = await author(t);
      const pageId = await pageWith(t, "Convert me");

      const answered = await post(cookie, convert(pageId));

      expect(answered.status).toBe(201);
      const item = answered.body.item as {
        component: { id: string };
        by: { kind: string; userId: string };
      };
      expect(item.by).toEqual({ kind: "user", userId });
      const content = await storedContent(t, pageId);
      expect(content.nodes.map(node => node.type)).toEqual([
        "core/heading",
        COMPONENT_INSTANCE_TYPE,
      ]);
      expect(content.nodes[1]?.props.componentId).toBe(item.component.id);
      const made = (await components(t)).find(
        row => row.id === item.component.id
      );
      expect(made).toMatchObject({
        title: "Second heading",
        status: "published",
      });

      const hosts = await t.adapter.select<{ entityKey: string }>(
        "page_builder__component_usage",
        {
          where: {
            and: [{ column: "componentId", op: "=", value: item.component.id }],
          },
        }
      );
      expect(hosts.map(row => row.entityKey)).toContain(pageId);
    });

    it("leaves no component behind when the page's update is refused", async () => {
      const t = await boot();
      const { cookie } = await author(t);
      const pageId = await pageWith(t, `Locked ${REFUSE_MARK}`);
      const before = (await components(t)).length;

      const answered = await post(cookie, convert(pageId));

      expect(answered.status).toBeGreaterThanOrEqual(400);
      expect(await components(t)).toHaveLength(before);
      const content = await storedContent(t, pageId);
      expect(content.nodes.map(node => node.type)).toEqual([
        "core/heading",
        "core/heading",
      ]);
    });

    it("writes nothing on a dry run", async () => {
      const t = await boot();
      const { cookie } = await author(t);
      const pageId = await pageWith(t, "Dry");
      const before = (await components(t)).length;

      const answered = await post(cookie, convert(pageId, { dryRun: true }));

      expect(answered.status).toBe(200);
      expect((answered.body.item as { dryRun: boolean }).dryRun).toBe(true);
      expect(await components(t)).toHaveLength(before);
      expect(
        (await storedContent(t, pageId)).nodes.map(node => node.type)
      ).toEqual(["core/heading", "core/heading"]);
    });

    it("refuses an author who may create components but not publish them", async () => {
      const t = await boot();
      const id = await person(t, "drafter");
      await grant(t, id, [
        "create-components",
        "read-components",
        "update-pages",
        "read-pages",
      ]);
      const cookie = await sessionOf(t, id);
      const pageId = await pageWith(t, "Not mine to publish");
      const before = (await components(t)).length;

      const answered = await post(cookie, convert(pageId));

      expect(answered.status).toBe(403);
      expect(await components(t)).toHaveLength(before);
    });
  }
);
