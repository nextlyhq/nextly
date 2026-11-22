/**
 * How many pages use each header & footer set, against a real instance,
 * through Nextly's own request handler with a signed session: gated by `read`
 * on the sets, answering the sets the caller may read, and counting every
 * stored page as the system, a page the caller may not read included, as a
 * number only. With the bounds lowered, the counts say they are floors.
 *
 * @module __tests__/layout-page-counts.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { NextlyError } from "@nextlyhq/plugin-sdk";
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
  LAYOUT_COUNTS_ROUTE_PATH,
  type LayoutPageCountsResponse,
} from "../layout-counts-contract";
import {
  readLayoutPageCounts,
  type LayoutCountsContext,
} from "../layout-counts-route";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

const SLUGS = {
  layouts: LAYOUTS_SLUG,
  settings: PAGE_BUILDER_SETTINGS_SLUG,
} as const;
const ORIGIN = "http://localhost";
const PAGES = "pages";

const idOf = (created: unknown) =>
  String((created as { item: { id: string | number } }).item.id);

describe.each(getConfiguredTestDialects())(
  "how many pages use each header & footer set (%s)",
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

    /** The route, as the editor calls it, and the raw text it answered. */
    async function counts(cookie: string): Promise<{
      status: number;
      text: string;
      body: LayoutPageCountsResponse;
    }> {
      const handlers = createDynamicHandlers();
      const sub = LAYOUT_COUNTS_ROUTE_PATH.split("/").filter(Boolean);
      const url = `${ORIGIN}/api/plugins/${PAGE_BUILDER_PLUGIN_NAME}/${sub.join("/")}`;
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
        text,
        body: (text === "" ? {} : JSON.parse(text)) as LayoutPageCountsResponse,
      };
    }

    async function set(
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

    async function page(
      t: TestNextly,
      slug: string,
      choice: { layout?: string; noHeaderFooter?: boolean },
      status: "published" | "draft" = "published"
    ): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: PAGES,
          data: {
            title: `Title ${slug}`,
            slug,
            content: { formatVersion: 1, kind: "page", nodes: [] },
            ...choice,
            status,
          },
          overrideAccess: true,
        })
      );
    }

    /**
     * A published default ("everywhere"), a published "landing", an
     * unpublished "unfinished", and a page for each way of using them, one
     * of them a draft.
     */
    async function site(t: TestNextly) {
      const header = idOf(
        await t.nextly.create({
          collection: "components",
          data: {
            title: "header",
            slug: "header",
            content: { formatVersion: 1, kind: "component", nodes: [] },
            status: "published",
          },
          overrideAccess: true,
        })
      );
      const everywhere = await set(t, "everywhere", header, "published");
      const landing = await set(t, "landing", header, "published");
      const unfinished = await set(t, "unfinished", header, "draft");
      await writeLayoutSettings(
        t.nextly,
        SLUGS,
        await readLayoutSettings(t.nextly, SLUGS),
        { defaultLayout: everywhere }
      );
      const { seededLayout } = await readLayoutSettings(t.nextly, SLUGS);
      // Follows the default.
      await page(t, "home", {});
      // Names the default.
      await page(t, "contact", { layout: everywhere });
      // Names a published set of its own.
      await page(t, "about", { layout: landing });
      // Names an unpublished set: its page, and meanwhile the default's.
      await page(t, "soon", { layout: unfinished });
      // Switched to "None": no set's.
      await page(t, "bare", { layout: landing, noHeaderFooter: true });
      // A draft that follows the default: stored, and published to no one.
      const hidden = await page(t, "hidden-draft", {}, "draft");
      return { everywhere, landing, unfinished, seededLayout, hidden };
    }

    it("answers an author who may read the sets, counting every page as the system", async () => {
      const t = await boot();
      const { everywhere, landing, unfinished, seededLayout } = await site(t);
      await person(t, "owner");
      const reader = await person(t, "reader");
      await grant(t, reader, ["read-layouts"]);

      const answer = await counts(await sessionOf(t, reader));

      expect(answer.status, answer.text).toBe(200);
      expect(answer.body[everywhere]).toEqual({ pages: 4, floor: false });
      expect(answer.body[landing]).toEqual({ pages: 1, floor: false });
      expect(answer.body[unfinished]).toEqual({ pages: 1, floor: false });
      // The seeded set the site started on is still a set, used by no page.
      expect(seededLayout).not.toBeNull();
      expect(answer.body[seededLayout ?? ""]).toEqual({
        pages: 0,
        floor: false,
      });
      expect(Object.keys(answer.body).sort()).toEqual(
        [everywhere, landing, unfinished, seededLayout].sort()
      );
    });

    it("counts pages the reader may not read, and answers nothing of them but the number", async () => {
      const t = await boot();
      const { everywhere, hidden } = await site(t);
      await person(t, "owner");
      const reader = await person(t, "reader");
      await grant(t, reader, ["read-layouts"]);

      // The control: this reader may read no page at all, so their own read
      // of the pages is refused, while the pages, the draft among them, are
      // stored.
      const own = t.nextly.find({
        collection: PAGES,
        status: "all",
        limit: 100,
        depth: 0,
        overrideAccess: false,
        user: { id: reader },
      });
      await expect(own).rejects.toSatisfy(NextlyError.isForbidden);
      const stored = await t.nextly.find({
        collection: PAGES,
        status: "all",
        limit: 100,
        depth: 0,
        overrideAccess: true,
      });
      const storedRows = stored.items as Record<string, unknown>[];
      expect(storedRows.map(row => String(row.id))).toContain(hidden);

      const answer = await counts(await sessionOf(t, reader));

      expect(answer.status, answer.text).toBe(200);
      // home, contact, soon and the hidden draft.
      expect(answer.body[everywhere]).toEqual({ pages: 4, floor: false });
      // Numbers only: no page's id, title or slug, anywhere in the answer.
      for (const row of storedRows) {
        for (const trace of [row.id, row.title, row.slug]) {
          expect(answer.text).not.toContain(String(trace));
        }
      }
      for (const count of Object.values(answer.body)) {
        expect(Object.keys(count).sort()).toEqual(["floor", "pages"]);
      }
    });

    it("refuses an author who may not read the sets", async () => {
      const t = await boot();
      await site(t);
      await person(t, "owner");
      const blind = await person(t, "blind");
      await grant(t, blind, ["read-pages"]);

      const answer = await counts(await sessionOf(t, blind));

      // Refused at the route's gate; the read of the sets made as this
      // caller would refuse them too, so the gate's own permission is held
      // by `layout-counts-route.test.ts`.
      expect(answer.status, answer.text).toBe(403);
      expect(answer.text).not.toContain('pages":');
    });

    it("says each count is a floor, never more than the truth, when the page read stops at a lowered bound", async () => {
      const t = await boot();
      const { everywhere, landing, unfinished } = await site(t);
      await person(t, "owner");
      const reader = await person(t, "reader");
      await grant(t, reader, ["read-layouts"]);
      const ctx = {
        self: { collections: {}, singles: {} },
        caller: { identity: async () => ({ user: { id: reader } }) },
      } as unknown as LayoutCountsContext;

      const whole = await readLayoutPageCounts(ctx, t.nextly);
      const bounded = await readLayoutPageCounts(ctx, t.nextly, {
        pages: { rowsPerRead: 2, mostReads: 2 },
      });

      // The same reads, whole: the route's own answer.
      expect(whole[everywhere]).toEqual({ pages: 4, floor: false });
      // Four of the six pages read: every count a floor, none above the
      // whole count.
      for (const id of [everywhere, landing, unfinished]) {
        expect(bounded[id]?.floor).toBe(true);
        expect(bounded[id]?.pages).toBeLessThanOrEqual(whole[id]?.pages ?? 0);
      }
      const read = Object.values(bounded).reduce(
        (sum, count) => sum + count.pages,
        0
      );
      expect(read).toBeLessThan(
        Object.values(whole).reduce((sum, count) => sum + count.pages, 0)
      );
    });

    it("says the default's count is a floor when the published sets read stops at a lowered bound", async () => {
      const t = await boot();
      const { everywhere, landing, unfinished } = await site(t);
      await person(t, "owner");
      const reader = await person(t, "reader");
      await grant(t, reader, ["read-layouts"]);
      const ctx = {
        self: { collections: {}, singles: {} },
        caller: { identity: async () => ({ user: { id: reader } }) },
      } as unknown as LayoutCountsContext;

      // One published set read of the three: "unfinished" is never among
      // them, and whether it is unpublished or past the bound is unknown.
      const bounded = await readLayoutPageCounts(ctx, t.nextly, {
        published: { rowsPerRead: 1, mostReads: 1 },
      });

      // "soon", naming "unfinished", is left out of the default: home,
      // contact and the hidden draft remain, and the count says so.
      expect(bounded[everywhere]).toEqual({ pages: 3, floor: true });
      // The page read was whole, so every other set's count is exact.
      expect(bounded[landing]).toEqual({ pages: 1, floor: false });
      expect(bounded[unfinished]).toEqual({ pages: 1, floor: false });
    });
  }
);
