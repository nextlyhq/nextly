/**
 * The site's settings over HTTP, as Settings and any API caller reach them:
 * the breakpoints change through one door, the Settings route, and the Site
 * tab is told what each role may change.
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
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import { SITE_STYLE_SLUG } from "../site-style-storage";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

const TABLET = {
  viewport: [{ id: "tablet", label: "Tablet", maxWidth: 900 }],
  container: [],
};

describe.each(getConfiguredTestDialects())(
  "the site's settings over HTTP (%s)",
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
      // The site's first user is its owner, granted everything. Made first, so
      // every person below holds only what the test gives them.
      await current.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
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

    /** One request through the real dispatcher, as a browser would make it. */
    async function call(
      method: "GET" | "POST" | "PATCH",
      path: string[],
      cookie: string,
      body?: unknown
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const handlers = createDynamicHandlers();
      const response = await handlers[method](
        new Request(`${ORIGIN}/api/${path.join("/")}`, {
          method,
          headers: {
            cookie: `${cookie}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        { params: Promise.resolve({ params: path }) }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
      };
    }

    const plugin = (...sub: string[]) => [
      "plugins",
      ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
      ...sub,
    ];

    async function storedBreakpoints(t: TestNextly): Promise<unknown> {
      const doc = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as Record<string, unknown> | null;
      return doc?.breakpoints ?? null;
    }

    it("refuses a breakpoint change through the Single, even holding both permissions", async () => {
      const t = await boot();
      const cookie = await holding(
        t,
        "read-site-style",
        "update-site-style",
        "manage-page-builder-site"
      );
      const answer = await call("PATCH", ["singles", SITE_STYLE_SLUG], cookie, {
        breakpoints: TABLET,
        _overwrite: true,
      });
      expect(answer.status).toBe(403);
      expect(JSON.stringify(answer.body)).toContain(
        "The site's breakpoints are changed in the page builder's Settings."
      );
      expect(await storedBreakpoints(t)).toBeNull();
    });

    it("lets the Single change its tokens, which is Design's", async () => {
      const t = await boot();
      const cookie = await holding(t, "read-site-style", "update-site-style");
      const answer = await call("PATCH", ["singles", SITE_STYLE_SLUG], cookie, {
        tokens: { tokens: [] },
        _overwrite: true,
      });
      expect(answer.status).toBe(200);
    });

    it("changes the breakpoints through Settings' route with the site permission alone", async () => {
      const t = await boot();
      const cookie = await holding(t, "manage-page-builder-site");
      const answer = await call("POST", plugin("site", "breakpoints"), cookie, {
        breakpoints: TABLET,
      });
      expect(answer.status).toBe(200);
      expect(await storedBreakpoints(t)).toMatchObject(TABLET);
    });

    it("refuses the route to a role with Design's permission but not the site's", async () => {
      const t = await boot();
      const cookie = await holding(t, "read-site-style", "update-site-style");
      const answer = await call("POST", plugin("site", "breakpoints"), cookie, {
        breakpoints: TABLET,
      });
      expect(answer.status).toBe(403);
      expect(await storedBreakpoints(t)).toBeNull();
    });

    async function storedTokens(t: TestNextly): Promise<unknown> {
      const doc = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as Record<string, unknown> | null;
      const tokens = doc?.tokens ?? null;
      // SQLite hands a JSON column back as text.
      return typeof tokens === "string" ? JSON.parse(tokens) : tokens;
    }

    it("changes the CSS variable prefix through Settings' route with the site permission alone", async () => {
      const t = await boot();
      const cookie = await holding(t, "manage-page-builder-site");
      const dry = await call("POST", plugin("site", "css-prefix"), cookie, {
        prefix: "--brand-",
        dryRun: true,
      });
      expect(dry.status).toBe(200);
      expect(dry.body.item).toMatchObject({
        dryRun: true,
        prefix: "--brand-",
        oldPrefixUses: 0,
      });
      // The dry run saves nothing.
      expect(await storedTokens(t)).toBeNull();

      const saved = await call("POST", plugin("site", "css-prefix"), cookie, {
        prefix: "--brand-",
      });
      expect(saved.status).toBe(200);
      expect(saved.body.item).toEqual({
        prefix: { current: "--brand-", stored: "--brand-" },
      });
      expect(await storedTokens(t)).toMatchObject({ prefix: "--brand-" });
      const read = await call("GET", plugin("site", "settings"), cookie);
      expect(read.body.prefix).toEqual({
        current: "--brand-",
        stored: "--brand-",
      });

      // Back to the default clears the saved prefix rather than storing it.
      const back = await call("POST", plugin("site", "css-prefix"), cookie, {
        prefix: "--site-",
      });
      expect(back.status).toBe(200);
      expect(back.body.item).toEqual({ prefix: { current: "--site-" } });
      expect(await storedTokens(t)).not.toHaveProperty("prefix");
    });

    it("refuses the prefix route to a role with Design's permission but not the site's", async () => {
      const t = await boot();
      const cookie = await holding(t, "read-site-style", "update-site-style");
      const answer = await call("POST", plugin("site", "css-prefix"), cookie, {
        prefix: "--brand-",
      });
      expect(answer.status).toBe(403);
      expect(await storedTokens(t)).toBeNull();
    });

    it.each([
      ["--nx-", "--nx- is kept for the admin's own styles."],
      ["--tw-", "--tw- is used by Tailwind."],
      ["brand", "A prefix starts with two dashes"],
    ])("refuses the prefix %s with the reason", async (prefix, reason) => {
      const t = await boot();
      const cookie = await holding(t, "manage-page-builder-site");
      const answer = await call("POST", plugin("site", "css-prefix"), cookie, {
        prefix,
      });
      expect(answer.status).toBe(400);
      expect(JSON.stringify(answer.body)).toContain(reason);
      expect(await storedTokens(t)).toBeNull();
    });

    it("refuses a prefix change through the Single, even holding both permissions", async () => {
      const t = await boot();
      const cookie = await holding(
        t,
        "read-site-style",
        "update-site-style",
        "manage-page-builder-site"
      );
      const answer = await call("PATCH", ["singles", SITE_STYLE_SLUG], cookie, {
        tokens: { tokens: [], prefix: "--brand-" },
        _overwrite: true,
      });
      expect(answer.status).toBe(403);
      expect(JSON.stringify(answer.body)).toContain(
        "The CSS variable prefix is changed in Settings → Site."
      );
      expect(await storedTokens(t)).toBeNull();
    });

    it("lets Design's save carry a saved prefix through unchanged", async () => {
      const t = await boot();
      const site = await holding(t, "manage-page-builder-site");
      const set = await call("POST", plugin("site", "css-prefix"), site, {
        prefix: "--brand-",
      });
      expect(set.status).toBe(200);
      const design = await holding(t, "read-site-style", "update-site-style");
      const answer = await call("PATCH", ["singles", SITE_STYLE_SLUG], design, {
        tokens: {
          tokens: [
            { name: "color.ink", kind: "color", values: { light: "#111" } },
          ],
          prefix: "--brand-",
        },
        _overwrite: true,
      });
      expect(answer.status).toBe(200);
      expect(await storedTokens(t)).toMatchObject({ prefix: "--brand-" });
    });

    it("tells the Site tab what each role may change", async () => {
      const t = await boot();
      const nobody = await holding(t);
      const site = await holding(t, "manage-page-builder-site");
      const chooser = await holding(
        t,
        "manage-page-builder-site",
        "update-layouts",
        "publish-layouts"
      );
      const read = async (cookie: string) =>
        (await call("GET", plugin("site", "settings"), cookie)).body;

      expect(await read(nobody)).toMatchObject({
        mayManageSite: false,
        mayChooseDefaultLayout: false,
        layouts: [],
      });
      expect(await read(site)).toMatchObject({
        mayManageSite: true,
        mayChooseDefaultLayout: false,
      });
      expect(await read(chooser)).toMatchObject({
        mayManageSite: true,
        mayChooseDefaultLayout: true,
      });
    });
  }
);
