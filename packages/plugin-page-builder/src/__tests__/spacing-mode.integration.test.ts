/**
 * The site's spacing model, against a real instance.
 *
 * What only a server can show: that the one-time step tells a site with
 * content from a fresh one (the seeded default Layout not counting as
 * content), that it writes once and never again, that it never replaces the
 * owner's choice, that two runs at once leave one row, and that the owner's
 * route asks for the Site Style update permission before it writes. Also that
 * a render reading the stored style through the Direct API receives the model.
 *
 * @module __tests__/spacing-mode.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import { eq } from "@nextlyhq/plugin-sdk/db";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";
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
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { PAGE_BUILDER_SETTINGS_SLUG } from "../default-layout/settings-single";
import {
  readLayoutSettings,
  writeLayoutSettings,
} from "../default-layout/store";
import {
  PAGE_BUILDER_PLUGIN_NAME,
  SPACING_MODE_ROUTE_PATH,
} from "../library-contract";
import { pageBuilder } from "../plugin";
import { siteOptions } from "../schema/tables";
import { loadSiteStyle } from "../site-style-storage";
import {
  settleSpacingModeAtStart,
  settleSpacingModeOnce,
  type SpacingModeAtStartDeps,
} from "../spacing-mode-at-start";
import {
  SPACING_MODE_OPTION,
  spacingModeStore,
  type SpacingModeStore,
} from "../spacing-mode-store";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

const SLUGS = {
  pages: PAGES_SLUG,
  components: COMPONENTS_SLUG,
  layouts: LAYOUTS_SLUG,
  settings: PAGE_BUILDER_SETTINGS_SLUG,
} as const;

/**
 * A plugin depending on the page builder, so its `ctx.db` reaches the page
 * builder's tables: the cases read and clear the option row directly.
 */
interface Probe {
  db?: PluginDatabase;
  store?: SpacingModeStore;
}

function probePlugin(holder: Probe): PluginDefinition {
  return definePlugin({
    name: "@test/spacing-mode-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      holder.db = ctx.db;
      holder.store = spacingModeStore(ctx.db, ctx.dialect);
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "the site's spacing model (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    const probe: Probe = {};

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    function store(): SpacingModeStore {
      if (probe.store === undefined) throw new Error("the probe did not boot");
      return probe.store;
    }

    function db(): PluginDatabase {
      if (probe.db === undefined) throw new Error("the probe did not boot");
      return probe.db;
    }

    function deps(t: TestNextly): SpacingModeAtStartDeps {
      return { nextly: t.nextly, store: store(), slugs: SLUGS };
    }

    /**
     * Boot, let the boot's own step finish (a run started now joins it), and
     * then clear what it recorded, so each case starts from a site upgraded
     * from before the model existed.
     */
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), probePlugin(probe)],
        seedPublic: true,
      });
      // The boot seeds the default Layout and then runs the step, neither
      // awaited by the boot. Waiting for the seed's record first, then joining
      // the step, leaves nothing of the boot still running.
      await waitFor(
        async () =>
          (await readLayoutSettings((current as TestNextly).nextly, SLUGS))
            .seededLayout !== null
      );
      await settleSpacingModeAtStart(deps(current));
      await forgetTheModel();
      return current;
    }

    async function waitFor(check: () => Promise<boolean>): Promise<void> {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("the boot's default Layout was never recorded");
    }

    async function forgetTheModel(): Promise<void> {
      const t = db().table(siteOptions);
      await db().delete(siteOptions).where(eq(t.name, SPACING_MODE_OPTION));
    }

    /** Every stored option row named for the spacing model. */
    async function modelRows(): Promise<{ value: string }[]> {
      const t = db().table(siteOptions);
      const rows = await db()
        .select(siteOptions)
        .where(eq(t.name, SPACING_MODE_OPTION))
        .all();
      return rows as unknown as { value: string }[];
    }

    async function page(t: TestNextly, title: string): Promise<string> {
      const created = await t.nextly.create({
        collection: PAGES_SLUG,
        data: { title, slug: title.toLowerCase() },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function layout(t: TestNextly, slug: string): Promise<string> {
      const created = await t.nextly.create({
        collection: LAYOUTS_SLUG,
        data: { title: slug, slug, areas: [], status: "draft" },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    it("records gaps on a fresh site, whose only Layout is the seed", async () => {
      const t = await boot();
      const found = await t.nextly.find({
        collection: LAYOUTS_SLUG,
        status: "all",
        depth: 0,
        overrideAccess: true,
      });
      // The control: the seed IS there, so the step had to leave it out.
      expect(found.items).toHaveLength(1);

      expect(await settleSpacingModeAtStart(deps(t))).toBe("gaps");
      expect(await store().read()).toBe("gaps");
    });

    it("records classic on a site that has a page, a draft included", async () => {
      const t = await boot();
      await page(t, "About");

      expect(await settleSpacingModeAtStart(deps(t))).toBe("classic");
      expect(await store().read()).toBe("classic");
    });

    it("records classic on a site whose only content is a component", async () => {
      const t = await boot();
      await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "Header",
          slug: "header",
          content: { formatVersion: 1, kind: "component", nodes: [] },
          status: "draft",
        },
        overrideAccess: true,
      });

      expect(await settleSpacingModeAtStart(deps(t))).toBe("classic");
    });

    it("records classic on a site with a Layout of its own beside the seed", async () => {
      const t = await boot();
      await layout(t, "marketing");

      expect(await settleSpacingModeAtStart(deps(t))).toBe("classic");
    });

    it("decides nothing while a Layout is the only content and no seed is recorded", async () => {
      const t = await boot();
      // As between another instance creating its seed and recording it.
      await writeLayoutSettings(t.nextly, SLUGS, {
        defaultLayout: null,
        seededLayout: null,
      });

      expect(await settleSpacingModeAtStart(deps(t))).toBe("deferred");
      expect(await modelRows()).toHaveLength(0);
    });

    it("runs once: a page added after a fresh site was recorded does not change it", async () => {
      const t = await boot();
      expect(await settleSpacingModeAtStart(deps(t))).toBe("gaps");

      await page(t, "Later");

      expect(await settleSpacingModeAtStart(deps(t))).toBe("kept");
      expect(await modelRows()).toEqual([
        expect.objectContaining({ value: "gaps" }),
      ]);
    });

    it("never replaces the owner's choice", async () => {
      const t = await boot();
      await page(t, "About");
      await store().choose("gaps");

      expect(await settleSpacingModeAtStart(deps(t))).toBe("kept");
      expect(await store().read()).toBe("gaps");
    });

    it("never replaces an owner's choice made while the step was deciding", async () => {
      const t = await boot();
      await page(t, "About");
      // The step read no model; the owner then chose before its write.
      const staleRead: SpacingModeAtStartDeps = {
        ...deps(t),
        store: { read: async () => null, adoptIfUnset: store().adoptIfUnset },
      };
      await store().choose("gaps");

      expect(await settleSpacingModeOnce(staleRead)).toBe("kept");
      expect(await modelRows()).toEqual([
        expect.objectContaining({ value: "gaps" }),
      ]);
    });

    it("writes once when two runs decide at the same moment", async () => {
      const t = await boot();
      await page(t, "About");

      // Unjoined, as two instances would run: both decide, both insert, and
      // the unique name keeps one.
      const outcomes = await Promise.all([
        settleSpacingModeOnce(deps(t)),
        settleSpacingModeOnce(deps(t)),
      ]);

      expect([...outcomes].sort()).toEqual(["classic", "kept"]);
      expect(await modelRows()).toEqual([
        expect.objectContaining({ value: "classic" }),
      ]);
    });

    it("hands the recorded model to a render reading the stored style", async () => {
      const t = await boot();
      expect((await loadSiteStyle({ nextly: t.nextly })).spacingMode).toBe(
        undefined
      );

      await store().choose("classic");

      expect((await loadSiteStyle({ nextly: t.nextly })).spacingMode).toBe(
        "classic"
      );
    });

    describe("the owner's route", () => {
      async function person(t: TestNextly, name: string): Promise<string> {
        const created = await t.nextly.users.create({
          email: `${name}@example.com`,
          password: "Password123!",
          data: { name, isActive: true },
        });
        return created.item.id;
      }

      async function grant(t: TestNextly, userId: string, slugs: string[]) {
        const permissions = await t.nextly.permissions.find({ limit: 500 });
        const ids = slugs.map(slug => {
          const found = permissions.items.find(item => item.slug === slug);
          if (found === undefined) throw new Error(`${slug} is not seeded`);
          return found.id;
        });
        const role = await t.nextly.roles.create({
          data: {
            name: `Role ${userId}`,
            slug: `r-${userId}`,
            permissionIds: ids,
          },
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

      async function choose(
        cookie: string,
        body: unknown
      ): Promise<{ status: number; body: Record<string, unknown> }> {
        const handlers = createDynamicHandlers();
        const sub = SPACING_MODE_ROUTE_PATH.split("/").filter(Boolean);
        const url = `${ORIGIN}/api/plugins/${PAGE_BUILDER_PLUGIN_NAME}/${sub.join("/")}`;
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
                ...sub,
              ],
            }),
          }
        );
        const text = await response.text();
        return {
          status: response.status,
          body: (text === "" ? {} : JSON.parse(text)) as Record<
            string,
            unknown
          >,
        };
      }

      it("refuses a caller who may only read the site's design, before writing", async () => {
        const t = await boot();
        // The instance's first user is its super admin, so the reader is not.
        await person(t, "owner");
        const reader = await person(t, "reader");
        await grant(t, reader, ["read-site-style"]);

        const answer = await choose(await sessionOf(t, reader), {
          mode: "classic",
        });

        expect(answer.status).toBe(403);
        expect(await modelRows()).toHaveLength(0);
      });

      it("saves the choice of a caller who may change the site's design", async () => {
        const t = await boot();
        await person(t, "owner");
        const designer = await person(t, "designer");
        await grant(t, designer, ["read-site-style", "update-site-style"]);
        const cookie = await sessionOf(t, designer);

        const answer = await choose(cookie, { mode: "classic" });

        expect(answer.status).toBe(200);
        expect(answer.body).toEqual(
          expect.objectContaining({ item: { spacingMode: "classic" } })
        );
        expect(await store().read()).toBe("classic");

        // A value that is not a model is refused and changes nothing.
        expect((await choose(cookie, { mode: "tight" })).status).toBe(400);
        expect(await store().read()).toBe("classic");
      });
    });
  }
);
