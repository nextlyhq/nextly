/**
 * The Layout choices route, against a real instance, through Nextly's own
 * request handler with a signed session: gated by `read` on Layouts, read as
 * the caller, and answering the published regions the editor draws.
 *
 * @module __tests__/layout-choices.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { COMPONENT_INSTANCE_TYPE } from "@nextlyhq/blocks-engine";
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

import { LAYOUTS_SLUG } from "../collections/layouts";
import { ensureDefaultLayout } from "../default-layout/ensure-default";
import { PAGE_BUILDER_SETTINGS_SLUG } from "../default-layout/settings-single";
import {
  readLayoutSettings,
  writeLayoutSettings,
} from "../default-layout/store";
import {
  LAYOUT_CHOICES_ROUTE_PATH,
  LAYOUT_CHOICES_SELECTED_PARAM,
  type LayoutChoicesResponse,
} from "../layout-choices-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

const SLUGS = {
  layouts: LAYOUTS_SLUG,
  settings: PAGE_BUILDER_SETTINGS_SLUG,
} as const;
const ORIGIN = "http://localhost";
/** The grant to publish Layouts, as it is stored. */
const PUBLISH_LAYOUTS = "publish-layouts";

const idOf = (created: unknown) =>
  String((created as { item: { id: string | number } }).item.id);

describe.each(getConfiguredTestDialects())(
  "the Layout choices route (%s)",
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
      });
      // Joins the boot's own seed, so every case starts from it settled.
      await ensureDefaultLayout({
        nextly: current.nextly,
        slugs: SLUGS,
        warn: () => {},
      });
      return current;
    }

    async function person(t: TestNextly, name: string): Promise<string> {
      const created = await t.nextly.users.create({
        email: `${name}@example.com`,
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

    async function choices(
      cookie: string,
      selected: string | null = null
    ): Promise<{ status: number; body: LayoutChoicesResponse }> {
      const handlers = createDynamicHandlers();
      const sub = LAYOUT_CHOICES_ROUTE_PATH.split("/").filter(Boolean);
      const query =
        selected === null
          ? ""
          : `?${new URLSearchParams({ [LAYOUT_CHOICES_SELECTED_PARAM]: selected }).toString()}`;
      const url = `${ORIGIN}/api/plugins/${PAGE_BUILDER_PLUGIN_NAME}/${sub.join("/")}${query}`;
      const response = await handlers.GET(
        new Request(url, { headers: { cookie, origin: ORIGIN } }),
        {
          params: Promise.resolve({
            params: ["plugins", ...PAGE_BUILDER_PLUGIN_NAME.split("/"), ...sub],
          }),
        }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: (text === "" ? {} : JSON.parse(text)) as LayoutChoicesResponse,
      };
    }

    async function component(
      t: TestNextly,
      slug: string,
      nodes: unknown[]
    ): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: "components",
          data: {
            title: slug,
            slug,
            content: { formatVersion: 1, kind: "component", nodes },
            status: "published",
          },
          overrideAccess: true,
        })
      );
    }

    async function layout(
      t: TestNextly,
      slug: string,
      header: string,
      status: "published" | "draft"
    ): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: LAYOUTS_SLUG,
          data: {
            title: slug,
            slug,
            areas: [{ area: "header", component: header }],
            status,
          },
          overrideAccess: true,
        })
      );
    }

    /** A site with a published default, an unpublished Layout and one with a pending edit. */
    async function site(t: TestNextly) {
      const logo = await component(t, "logo", []);
      const header = await component(t, "header", [
        {
          id: "logo-at",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: logo },
        },
      ]);
      const main = await layout(t, "main", header, "published");
      const unfinished = await layout(t, "unfinished", header, "draft");
      const landing = await layout(t, "landing", header, "published");
      // An edit saved to a published Layout, naming no status, waits as its
      // working draft while the published version stays live.
      await t.nextly.update({
        collection: LAYOUTS_SLUG,
        id: landing,
        data: { title: "landing, edited", _overwrite: true },
        overrideAccess: true,
      });
      await writeLayoutSettings(
        t.nextly,
        SLUGS,
        await readLayoutSettings(t.nextly, SLUGS),
        { defaultLayout: main }
      );
      return { logo, header, main, unfinished, landing };
    }

    it("answers an author who may read Layouts, as that author", async () => {
      const t = await boot();
      const { logo, header, main, unfinished, landing } = await site(t);
      await person(t, "owner");
      const editor = await person(t, "editor");
      await grant(t, editor, ["read-layouts", "read-components"]);

      const answer = await choices(await sessionOf(t, editor));

      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      const byId = new Map(answer.body.items.map(item => [item.id, item]));
      expect(byId.get(main)).toMatchObject({
        published: true,
        draftChangesNotLive: false,
        regions: [{ area: "header", componentId: header }],
      });
      expect(byId.get(unfinished)).toMatchObject({
        published: false,
        regions: [],
      });
      // The published version, not the pending edit.
      expect(byId.get(landing)).toMatchObject({
        title: "landing",
        published: true,
      });
      expect(answer.body.meta.defaultLayout).toBe(main);
      expect(answer.body.meta.layoutsCollection).toBe(LAYOUTS_SLUG);
      // Read as this author, who may not update Layouts.
      expect(answer.body.meta.canUpdateLayouts).toBe(false);
      // The published definitions the canvas draws, the nested one included.
      expect(Object.keys(answer.body.meta.regionDefinitions).sort()).toEqual(
        [header, logo].sort()
      );
    });

    it("tells an author who may update Layouts that they may, and which Layout has edits not live", async () => {
      const t = await boot();
      const { main, landing } = await site(t);
      await person(t, "owner");
      const manager = await person(t, "manager");
      await grant(t, manager, [
        "read-layouts",
        "update-layouts",
        "read-components",
      ]);

      // Asked about by the page that selected it: draft facts are read for the
      // selected Layout and the default, the two a page can be drawn inside.
      const answer = await choices(await sessionOf(t, manager), landing);

      expect(answer.status).toBe(200);
      expect(answer.body.meta.canUpdateLayouts).toBe(true);
      // A working draft is visible only to someone who may update the Layout,
      // which is who the "Draft changes not live" mark is for.
      const byId = new Map(answer.body.items.map(item => [item.id, item]));
      expect(byId.get(landing)?.draftChangesNotLive).toBe(true);
      expect(byId.get(main)?.draftChangesNotLive).toBe(false);
    });

    it("tells an author who may publish a Layout, though not update it, of its pending draft", async () => {
      // The service shows a working draft to whoever may put it live, so the
      // picker tells a publisher of it as it tells an editor.
      const t = await boot();
      const { landing } = await site(t);
      await person(t, "owner");
      const publisher = await person(t, "publisher");
      await grant(t, publisher, [
        "read-layouts",
        PUBLISH_LAYOUTS,
        "read-components",
      ]);

      const answer = await choices(await sessionOf(t, publisher), landing);

      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      // "Edit Layout" stays with the update grant alone.
      expect(answer.body.meta.canUpdateLayouts).toBe(false);
      const byId = new Map(answer.body.items.map(item => [item.id, item]));
      expect(byId.get(landing)?.draftChangesNotLive).toBe(true);
    });

    it("tells an author who may neither update nor publish a Layout nothing of its draft", async () => {
      const t = await boot();
      const { landing } = await site(t);
      await person(t, "owner");
      const reader = await person(t, "reader");
      await grant(t, reader, ["read-layouts", "read-components"]);

      const answer = await choices(await sessionOf(t, reader), landing);

      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      const byId = new Map(answer.body.items.map(item => [item.id, item]));
      expect(byId.get(landing)?.draftChangesNotLive).toBe(false);
    });

    it("refuses an author who may not read Layouts", async () => {
      const t = await boot();
      await site(t);
      await person(t, "owner");
      const blind = await person(t, "blind");
      await grant(t, blind, ["read-components"]);

      const answer = await choices(await sessionOf(t, blind));

      expect(answer.status).toBe(403);
    });
  }
);
