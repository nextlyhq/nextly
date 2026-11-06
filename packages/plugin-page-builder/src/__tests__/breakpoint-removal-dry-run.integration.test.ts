/**
 * Settings asks what removing a breakpoint would drop before it saves: over
 * HTTP, as the Site tab asks, every document holding blocks is counted, the
 * ones the person may open are named, and nothing is saved. On every
 * configured dialect.
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
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

import { BLOCKS_TYPE } from "../fields/blocksField";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import {
  SITE_SETTINGS_WRITE_CONTEXT,
  SITE_STYLE_SLUG,
} from "../site-style-storage";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

type Node = Record<string, unknown>;

const heading = (id: string, extra: Node = {}): Node => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
  ...extra,
});

/** Two style values at Mobile. */
const atMobile: Node = {
  styles: {
    base: { mobile: { color: "#111111", backgroundColor: "#eeeeee" } },
  },
};

const doc = (kind: "page" | "component" | "pattern", nodes: Node[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind,
  nodes,
});

const TABLET = { id: "tablet", label: "Tablet", maxWidth: 900 };
const MOBILE = { id: "mobile", label: "Mobile", maxWidth: 600 };

describe.each(getConfiguredTestDialects())(
  "what removing a breakpoint would drop (%s)",
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
        // An entry collection and a Single of the site's own holding blocks,
        // beside the plugin's pages, components and patterns.
        collections: [
          {
            slug: "notes",
            fields: [
              { name: "title", type: "text" },
              { name: "content", type: BLOCKS_TYPE },
            ],
          } as never,
        ],
        singles: [
          {
            slug: "frontpage",
            fields: [{ name: "content", type: BLOCKS_TYPE }],
          } as never,
        ],
      });
      // The site's first user is its owner, granted everything. Made first, so
      // the person below holds only what the test gives them.
      await current.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      await current.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          breakpoints: { viewport: [TABLET, MOBILE], container: [] },
          classes: [
            {
              id: "c-card",
              slug: "card",
              label: "Card",
              orderIndex: 0,
              locked: true,
              styles: { base: { mobile: { color: "#222222" } } },
            },
          ],
          _overwrite: true,
        },
        overrideAccess: true,
        context: { ...SITE_SETTINGS_WRITE_CONTEXT },
      });
      return current;
    }

    /** A signed-in person holding exactly the permissions named. */
    async function holding(t: TestNextly, ...slugs: string[]): Promise<string> {
      const created = await t.nextly.users.create({
        email: "designer@example.com",
        password: "Password123!",
        data: { name: "Designer", isActive: true },
      });
      const userId = created.item.id;
      const permissions = await t.nextly.permissions.find({ limit: 500 });
      const ids = slugs.map(slug => {
        const found = permissions.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      const role = await t.nextly.roles.create({
        data: { name: "Designer", slug: "designer", permissionIds: ids },
      });
      const assigned = await new ServiceContainer(
        t.adapter
      ).userRoles.assignRoleToUser(userId, role.item.id);
      expect(assigned.success).toBe(true);
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: created.item.email,
          name: "Designer",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    /** The breakpoints route, through the real dispatcher, as the Site tab calls it. */
    async function ask(
      cookie: string,
      body: unknown
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const path = [
        "plugins",
        ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
        "site",
        "breakpoints",
      ];
      const response = await createDynamicHandlers().POST(
        new Request(`${ORIGIN}/api/${path.join("/")}`, {
          method: "POST",
          headers: {
            cookie: `${cookie}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ params: path }) }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
      };
    }

    it("counts every place, names what the person may open, and saves nothing", async () => {
      const t = await boot();
      await t.nextly.create({
        collection: "pages",
        data: {
          title: "Home",
          slug: "home",
          content: doc("page", [
            heading("a", atMobile),
            heading("b", {
              locked: true,
              visibility: { devices: { mobile: false } },
            }),
          ]),
        },
        overrideAccess: true,
      });
      await t.nextly.create({
        collection: "pages",
        data: {
          title: "About",
          slug: "about",
          content: doc("page", [
            heading("a", { styles: { base: { tablet: { color: "#333" } } } }),
          ]),
        },
        overrideAccess: true,
      });
      await t.nextly.create({
        collection: "components",
        data: {
          title: "Promo",
          slug: "promo",
          content: doc("component", [heading("x", atMobile)]),
          status: "published",
        },
        overrideAccess: true,
      });
      await t.nextly.create({
        collection: "patterns",
        data: {
          title: "Hero",
          slug: "hero",
          granularity: "section",
          content: doc("pattern", [heading("p", atMobile)]),
          status: "published",
        },
        overrideAccess: true,
      });
      await t.nextly.create({
        collection: "notes",
        data: { title: "Note", content: doc("page", [heading("n", atMobile)]) },
        overrideAccess: true,
      });
      await t.nextly.updateSingle({
        slug: "frontpage",
        data: {
          content: doc("page", [heading("f", atMobile)]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      // May manage the site and open pages; may not open components.
      const designer = await holding(
        t,
        "manage-page-builder-site",
        "read-pages"
      );

      const asked = await ask(designer, {
        breakpoints: { viewport: [TABLET], container: [] },
        dryRun: true,
      });

      expect(asked.status).toBe(200);
      const item = asked.body.item as Record<string, unknown>;
      expect(item).toMatchObject({
        dryRun: true,
        unreadable: 0,
        complete: true,
      });
      const [mobile] = item.removed as Record<string, unknown>[];
      expect(mobile).toMatchObject({
        id: "mobile",
        label: "Mobile",
        unaddressable: 0,
        sharedStyles: { classes: 1, styles: 1, locked: ["Card"] },
        // Home is named; the component, pattern, note and Single, which this
        // person may not open, are counted.
        documents: { named: ["Home"], unnamed: 4 },
        locked: { named: ["Home"], unnamed: 0 },
      });
      const places = mobile?.places as Record<string, unknown>;
      expect(places.pages).toEqual({
        documents: 1,
        drafts: 0,
        styles: 2,
        hides: 1,
      });
      expect(places.components).toMatchObject({ documents: 1, styles: 2 });
      expect(places.patterns).toMatchObject({ documents: 1, styles: 2 });
      expect(places.entries).toMatchObject({ documents: 1, styles: 2 });
      expect(places.singles).toMatchObject({ documents: 1, styles: 2 });
      // A Layout holds no blocks of its own (its areas place components), so
      // no Layout is walked and the place is always empty.
      expect(places.layouts).toMatchObject({ documents: 0 });

      // Nothing was saved.
      const stored = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as { breakpoints?: { viewport?: { id: string }[] } };
      expect(stored.breakpoints?.viewport?.map(entry => entry.id)).toEqual([
        "tablet",
        "mobile",
      ]);
    });

    it("names a page by its saved title, as the editor shows it", async () => {
      // Published as Home, then renamed in a pending working draft: someone
      // who may edit it knows it by the draft's title, as the editor shows.
      const t = await boot();
      const created = await t.nextly.create({
        collection: "pages",
        data: {
          title: "Home",
          slug: "home",
          status: "published",
          content: doc("page", [heading("a", atMobile)]),
        },
        overrideAccess: true,
      });
      await t.nextly.update({
        collection: "pages",
        id: String(created.item.id),
        data: { title: "Home, renamed", _overwrite: true },
        overrideAccess: true,
      });
      const set = {
        breakpoints: { viewport: [TABLET], container: [] },
        dryRun: true,
      };
      const editor = await holding(
        t,
        "manage-page-builder-site",
        "read-pages",
        "update-pages"
      );
      const edited = await ask(editor, set);
      const [mobile] = (edited.body.item as Record<string, unknown>)
        .removed as Record<string, unknown>[];
      expect(mobile?.documents).toEqual({
        named: ["Home, renamed"],
        unnamed: 0,
      });
    });

    it("answers that nothing is dropped when nothing is removed", async () => {
      const t = await boot();
      const designer = await holding(t, "manage-page-builder-site");
      const asked = await ask(designer, {
        breakpoints: {
          viewport: [{ ...TABLET, label: "Small laptop" }, MOBILE],
          container: [],
        },
        dryRun: true,
      });
      expect(asked.status).toBe(200);
      expect(asked.body.item).toMatchObject({
        removed: [],
        unreadable: 0,
        complete: true,
      });
    });

    it("refuses the question to someone who may not manage the site", async () => {
      const t = await boot();
      const reader = await holding(t, "read-pages");
      const asked = await ask(reader, {
        breakpoints: { viewport: [TABLET], container: [] },
        dryRun: true,
      });
      expect(asked.status).toBe(403);
    });
  }
);
