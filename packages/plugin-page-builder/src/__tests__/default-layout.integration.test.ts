/**
 * The site's one default Layout, against a real instance.
 *
 * What only a server can show: that the seed and its repair leave exactly one
 * published default and never adopt an authored Layout; that the make-default
 * route is the only way to choose one, with its preconditions checked before it
 * writes; that the default cannot be deleted or unpublished from under the
 * site; and that the settings Single refuses every other writer, a system
 * write included.
 *
 * The route is called through Nextly's real request handler with a signed
 * session, so the permission gate, the caller's grants and the envelope are the
 * ones a browser meets.
 *
 * @module __tests__/default-layout.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type CreateTestNextlyOptions,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LAYOUTS_SLUG } from "../collections/layouts";
import { effectiveLayoutFor } from "../default-layout/effective-layout";
import {
  ensureDefaultLayout,
  queueDefaultLayoutRepair,
} from "../default-layout/ensure-default";
import {
  PAGE_BUILDER_SETTINGS_SLUG,
  SETTINGS_WRITE_REFUSAL,
} from "../default-layout/settings-single";
import {
  readLayoutSettings,
  relationId,
  writeLayoutSettings,
} from "../default-layout/store";
import {
  layoutRemovalStore,
  type LayoutRemovalStore,
} from "../layout-removal/store";
import { KEPT_AS_DEFAULT } from "../layout-removal/words";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

const SLUGS = {
  layouts: LAYOUTS_SLUG,
  settings: PAGE_BUILDER_SETTINGS_SLUG,
} as const;

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

interface LayoutRow {
  id: string;
  title: string;
  slug: string;
  status: string;
}

async function refusalOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A plugin depending on the page builder, so its `ctx.db` reaches the page
 * builder's tables: the repair restores from Layout removals' copies, and the
 * test hands it the same fence the plugin keeps.
 */
function probePlugin(holder: { store?: LayoutRemovalStore }): PluginDefinition {
  return definePlugin({
    name: "@test/default-layout-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      holder.store = layoutRemovalStore(ctx.db, ctx.dialect);
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "the site's default Layout (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    const probe: { store?: LayoutRemovalStore } = {};

    /** What the instance booted last logged as warnings. */
    let warnings: string[] = [];

    /** A logger that keeps the warnings, so a case can assert what was said. */
    const logger: NonNullable<CreateTestNextlyOptions["logger"]> = {
      debug() {},
      info() {},
      warn(message) {
        warnings.push(String(message));
      },
      error() {},
    };

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
      warnings = [];
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        logger,
        plugins: [pageBuilder(), probePlugin(probe)],
        // The boot's permission seeding, which is what stores the plugin's own
        // `manage-page-builder-site` beside the collections' grants.
        seedPublic: true,
      });
      // The boot starts its own seed without awaiting it (`onReady` runs
      // before the Direct API serves). A run started now joins that one, so
      // every case begins from the settled seed rather than racing it.
      await ensure(current);
      return current;
    }

    /**
     * Put the site back to "no seed was ever recorded": the boot's seed gone
     * past every hook and both references cleared, as on a site upgraded from
     * before the default existed.
     */
    async function forgetTheSeed(t: TestNextly, asUser: string) {
      const { seededLayout } = await settingsOf(t);
      if (seededLayout !== null) {
        await deleteSkippingHooks(t, seededLayout, asUser);
      }
      await writeLayoutSettings(
        t.nextly,
        SLUGS,
        await readLayoutSettings(t.nextly, SLUGS),
        {
          defaultLayout: null,
          seededLayout: null,
        }
      );
      expect(await allLayouts(t)).toHaveLength(0);
    }

    function ensure(t: TestNextly) {
      if (probe.store === undefined) throw new Error("the probe did not boot");
      return ensureDefaultLayout({
        nextly: t.nextly,
        slugs: SLUGS,
        pagesSlug: "pages",
        removals: probe.store,
        warn: () => {},
      });
    }

    /** What the settings say, without the read's version, which every write moves. */
    async function settingsOf(t: TestNextly) {
      const { rev: _rev, ...settings } = await readLayoutSettings(
        t.nextly,
        SLUGS
      );
      return settings;
    }

    async function layout(
      t: TestNextly,
      title: string,
      slug: string,
      status: "published" | "draft" = "published"
    ): Promise<string> {
      const created = await t.nextly.create({
        collection: LAYOUTS_SLUG,
        data: { title, slug, areas: [], status },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    /** Every stored Layout, main rows, whatever their state. */
    async function allLayouts(t: TestNextly): Promise<LayoutRow[]> {
      const found = await t.nextly.find({
        collection: LAYOUTS_SLUG,
        status: "all",
        limit: 100,
        depth: 0,
        overrideAccess: true,
      });
      return found.items as unknown as LayoutRow[];
    }

    async function rowOf(t: TestNextly, id: string): Promise<LayoutRow> {
      const row = (await allLayouts(t)).find(item => item.id === id);
      if (row === undefined) throw new Error(`no Layout ${id}`);
      return row;
    }

    /**
     * Remove a Layout with no hooks run, as an import or a bad script might,
     * acting as `asUser` (the batch path judges collection access first).
     */
    async function deleteSkippingHooks(
      t: TestNextly,
      id: string,
      asUser: string
    ) {
      const entries = (
        t.getService("collectionsHandler") as unknown as {
          getEntryService(): {
            deleteEntries(
              params: { collectionName: string; user?: { id: string } },
              ids: string[],
              options?: { skipHooks?: boolean }
            ): Promise<{ successful: number; failed: number }>;
          };
        }
      ).getEntryService();
      const result = await entries.deleteEntries(
        { collectionName: LAYOUTS_SLUG, user: { id: asUser } },
        [id],
        { skipHooks: true }
      );
      expect(result.successful, JSON.stringify(result)).toBe(1);
    }

    /**
     * Unpublish a Layout with no hooks run, so the guard that refuses
     * unpublishing the default is not asked: the write a race lets through.
     */
    async function unpublishSkippingHooks(t: TestNextly, id: string) {
      const entries = (
        t.getService("collectionsHandler") as unknown as {
          getEntryService(): {
            updateEntries(
              params: { collectionName: string; overrideAccess?: boolean },
              entries: { id: string; data: Record<string, unknown> }[],
              options?: { skipHooks?: boolean }
            ): Promise<{ successful: number; failed: number }>;
          };
        }
      ).getEntryService();
      const result = await entries.updateEntries(
        { collectionName: LAYOUTS_SLUG, overrideAccess: true },
        [{ id, data: { status: "draft", _overwrite: true } }],
        { skipHooks: true }
      );
      expect(result.successful, JSON.stringify(result)).toBe(1);
    }

    /** What one batch reports, per item. */
    interface BatchAnswer {
      successful: number;
      failed: number;
      errors: { error: string }[];
    }

    /**
     * Core's atomic batch writer: each item's hooks run inside the batch's own
     * transaction and are handed its `executor`, the path an import or a
     * script takes. Hooks run; nothing is skipped.
     */
    function batchWriter(t: TestNextly) {
      return (
        t.getService("collectionsHandler") as unknown as {
          getEntryService(): {
            updateEntries(
              params: { collectionName: string; overrideAccess?: boolean },
              entries: { id: string; data: Record<string, unknown> }[]
            ): Promise<BatchAnswer>;
            deleteEntries(
              params: { collectionName: string; user?: { id: string } },
              ids: string[]
            ): Promise<BatchAnswer>;
          };
        }
      ).getEntryService();
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

    /** Gives `userId` a role holding exactly the permissions named. */
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

    /** POST the make-default route as the session's owner. */
    function makeDefault(
      cookie: string,
      id: string,
      body: unknown = {}
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      return postLayoutRoute(cookie, [id, "make-default"], body);
    }

    /** POST Remove Layout as the session's owner. */
    function removeLayout(
      cookie: string,
      id: string,
      action: "delete" | "unpublish"
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      return postLayoutRoute(cookie, [id, "remove"], { action });
    }

    /** POST one of the plugin's `/layouts/:id/...` routes. */
    async function postLayoutRoute(
      cookie: string,
      path: string[],
      body: unknown
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const handlers = createDynamicHandlers();
      const sub = ["layouts", ...path];
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
            params: ["plugins", ...PAGE_BUILDER_PLUGIN_NAME.split("/"), ...sub],
          }),
        }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
      };
    }

    /** GET the settings Single over REST, with or without a session. */
    async function readSingleOverRest(cookie?: string): Promise<number> {
      const handlers = createDynamicHandlers();
      const path = ["singles", PAGE_BUILDER_SETTINGS_SLUG];
      const response = await handlers.GET(
        new Request(`${ORIGIN}/api/${path.join("/")}`, {
          headers: cookie === undefined ? {} : { cookie },
        }),
        { params: Promise.resolve({ params: path }) }
      );
      return response.status;
    }

    describe("the seed", () => {
      it("gives a fresh site a published 'Site layout' Layout as its default, recorded as the seed", async () => {
        const t = await boot();
        await ensure(t);

        const settings = await settingsOf(t);
        expect(settings.defaultLayout).not.toBeNull();
        expect(settings.seededLayout).toBe(settings.defaultLayout);
        // The boot's seed and the run above made one seed between them.
        expect(await allLayouts(t)).toHaveLength(1);
        const seed = await rowOf(t, String(settings.defaultLayout));
        expect(seed).toMatchObject({
          title: "Site layout",
          slug: "site-layout",
          status: "published",
        });
      });

      it("never adopts an authored Layout titled Default that holds the seed's slug", async () => {
        const t = await boot();
        await forgetTheSeed(t, await person(t, "owner"));
        const authored = await layout(t, "Default", "site-layout");

        await ensure(t);

        const settings = await settingsOf(t);
        expect(settings.defaultLayout).not.toBe(authored);
        const seed = await rowOf(t, String(settings.defaultLayout));
        expect(seed).toMatchObject({
          title: "Site layout",
          slug: "site-layout-2",
          status: "published",
        });
        expect(await rowOf(t, authored)).toMatchObject({
          title: "Default",
          slug: "site-layout",
          status: "published",
        });
      });
    });

    describe("make default", () => {
      async function withOwner(t: TestNextly) {
        // The instance's first user is its super admin.
        const owner = await person(t, "owner");
        return { owner, cookie: await sessionOf(t, owner) };
      }

      it("makes a published Layout the default and records who chose it", async () => {
        const t = await boot();
        const { owner, cookie } = await withOwner(t);
        const chosen = await layout(t, "Landing", "landing");

        const answer = await makeDefault(cookie, chosen);

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(typeof answer.body.message).toBe("string");
        expect(answer.body.item).toMatchObject({ defaultLayout: chosen });
        const settings = await t.nextly.findSingle({
          slug: PAGE_BUILDER_SETTINGS_SLUG,
          depth: 0,
          overrideAccess: true,
        });
        expect(settings).toMatchObject({
          defaultLayout: chosen,
          defaultLayoutChangedBy: `user:${owner}`,
        });
      });

      it("refuses a Layout that is not published, and leaves the default as it was", async () => {
        const t = await boot();
        const { cookie } = await withOwner(t);
        await ensure(t);
        const before = (await settingsOf(t)).defaultLayout;
        const draft = await layout(t, "Unfinished", "unfinished", "draft");

        const answer = await makeDefault(cookie, draft);

        expect(answer.status).toBe(409);
        expect((await settingsOf(t)).defaultLayout).toBe(before);
      });

      it("answers a dry run without changing the default", async () => {
        const t = await boot();
        const { cookie } = await withOwner(t);
        await ensure(t);
        const before = (await settingsOf(t)).defaultLayout;
        const chosen = await layout(t, "Landing", "landing");

        const answer = await makeDefault(cookie, chosen, { dryRun: true });

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.body.item).toMatchObject({ defaultLayout: chosen });
        expect((await settingsOf(t)).defaultLayout).toBe(before);
      });

      it("refuses a caller without the site permission", async () => {
        const t = await boot();
        await withOwner(t);
        const editor = await person(t, "editor");
        await grant(t, editor, [
          "read-layouts",
          "update-layouts",
          "publish-layouts",
        ]);
        const chosen = await layout(t, "Landing", "landing");

        const answer = await makeDefault(await sessionOf(t, editor), chosen);

        expect(answer.status).toBe(403);
        expect((await settingsOf(t)).defaultLayout).not.toBe(chosen);
      });

      it("refuses a caller with the site permission who may not publish Layouts", async () => {
        const t = await boot();
        await withOwner(t);
        const manager = await person(t, "manager");
        await grant(t, manager, [
          "manage-page-builder-site",
          "read-layouts",
          "update-layouts",
        ]);
        const chosen = await layout(t, "Landing", "landing");

        const answer = await makeDefault(await sessionOf(t, manager), chosen);

        expect(answer.status).toBe(403);
        expect((await settingsOf(t)).defaultLayout).not.toBe(chosen);
      });

      it("admits a caller holding the site permission and publish on Layouts", async () => {
        const t = await boot();
        await withOwner(t);
        const manager = await person(t, "manager");
        await grant(t, manager, [
          "manage-page-builder-site",
          "read-layouts",
          "update-layouts",
          "publish-layouts",
        ]);
        const chosen = await layout(t, "Landing", "landing");

        const answer = await makeDefault(await sessionOf(t, manager), chosen);

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect((await settingsOf(t)).defaultLayout).toBe(chosen);
      });

      it("ends two concurrent calls with exactly one published default, one of the two", async () => {
        const t = await boot();
        const { cookie } = await withOwner(t);
        const first = await layout(t, "First", "first");
        const second = await layout(t, "Second", "second");

        const answers = await Promise.all([
          makeDefault(cookie, first),
          makeDefault(cookie, second),
        ]);

        expect(answers.map(answer => answer.status)).toEqual([200, 200]);
        const chosen = (await settingsOf(t)).defaultLayout;
        expect([first, second]).toContain(chosen);
        expect((await rowOf(t, String(chosen))).status).toBe("published");
      });
    });

    describe("the default cannot be taken away", () => {
      it("refuses deleting the default", async () => {
        const t = await boot();
        await ensure(t);
        const id = String((await settingsOf(t)).defaultLayout);

        const error = await refusalOf(
          t.nextly.delete({
            collection: LAYOUTS_SLUG,
            id,
            overrideAccess: true,
          })
        );

        expect(messageOf(error)).toContain("Choose another default first");
        expect((await rowOf(t, id)).status).toBe("published");
      });

      it("refuses unpublishing the default", async () => {
        const t = await boot();
        await ensure(t);
        const id = String((await settingsOf(t)).defaultLayout);

        const error = await refusalOf(
          t.nextly.update({
            collection: LAYOUTS_SLUG,
            id,
            data: { status: "draft", _overwrite: true },
            overrideAccess: true,
          })
        );

        expect(messageOf(error)).toContain("Choose another default first");
        expect((await rowOf(t, id)).status).toBe("published");
      });

      it("lets a Layout that is not the default be unpublished and deleted, through Remove Layout", async () => {
        const t = await boot();
        await ensure(t);
        const cookie = await sessionOf(t, await person(t, "owner"));
        const other = await layout(t, "Other", "other");

        const unpublished = await removeLayout(cookie, other, "unpublish");
        expect(unpublished.status, JSON.stringify(unpublished.body)).toBe(200);
        expect((await rowOf(t, other)).status).toBe("draft");

        const deleted = await removeLayout(cookie, other, "delete");
        expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
        expect((await allLayouts(t)).map(row => row.id)).not.toContain(other);
      });
    });

    describe("the settings Single has one writer", () => {
      it("refuses a Direct API write without the marker, even overriding access", async () => {
        const t = await boot();
        await ensure(t);
        const before = (await settingsOf(t)).defaultLayout;
        const other = await layout(t, "Other", "other");

        const error = await refusalOf(
          t.nextly.updateSingle({
            slug: PAGE_BUILDER_SETTINGS_SLUG,
            data: { defaultLayout: other, _overwrite: true },
            overrideAccess: true,
          })
        );

        expect(messageOf(error)).toContain(SETTINGS_WRITE_REFUSAL);
        expect((await settingsOf(t)).defaultLayout).toBe(before);
      });

      it("refuses an anonymous REST read, and answers the super admin's", async () => {
        const t = await boot();
        await ensure(t);
        const owner = await person(t, "owner");

        expect([401, 403]).toContain(await readSingleOverRest());
        // The control: the same address answers a caller allowed to read it,
        // so the refusal above is about the caller and not a missing route.
        expect(await readSingleOverRest(await sessionOf(t, owner))).toBe(200);
      });
    });

    describe("the repair", () => {
      it("re-points the default at the seed when the default is removed past the guard, re-creating the seed once if it is gone too", async () => {
        const t = await boot();
        const owner = await person(t, "owner");
        await ensure(t);
        const seed = String((await settingsOf(t)).seededLayout);
        const authored = await layout(t, "Landing", "landing");
        expect(
          (await makeDefault(await sessionOf(t, owner), authored)).status
        ).toBe(200);

        await deleteSkippingHooks(t, authored, owner);
        await ensure(t);
        expect(await settingsOf(t)).toEqual({
          defaultLayout: seed,
          seededLayout: seed,
          // The repair's own choice names nobody.
          defaultLayoutChangedBy: null,
        });

        await deleteSkippingHooks(t, seed, owner);
        await ensure(t);
        const reseeded = await settingsOf(t);
        expect(reseeded.defaultLayout).not.toBe(seed);
        expect(reseeded.seededLayout).toBe(reseeded.defaultLayout);
        expect(await rowOf(t, String(reseeded.defaultLayout))).toMatchObject({
          title: "Site layout",
          slug: "site-layout",
          status: "published",
        });

        const count = (await allLayouts(t)).length;
        await ensure(t);
        expect(await settingsOf(t)).toEqual(reseeded);
        expect((await allLayouts(t)).length).toBe(count);
      });

      it("deletes a seed it could not record, through the Layout fence, leaving no extra Layout", async () => {
        const t = await boot();
        await forgetTheSeed(t, await person(t, "owner"));
        // The settings write that would record the new seed fails once.
        let armed = true;
        t.hooks.register(
          "beforeChange",
          `single:${PAGE_BUILDER_SETTINGS_SLUG}`,
          async context => {
            const data = (context as { data?: Record<string, unknown> }).data;
            if (!armed || relationId(data?.seededLayout) === null) return;
            armed = false;
            throw new Error("the settings write failed");
          }
        );

        await expect(ensure(t)).rejects.toThrow();

        expect(armed).toBe(false);
        // The created seed is gone again: its delete passed the Layout guard.
        expect(await allLayouts(t)).toHaveLength(0);
        await ensure(t);
        expect(await allLayouts(t)).toHaveLength(1);
      });

      it("seeds exactly one Layout beside an authored 'Site layout' when no seed was ever recorded, and adopts nothing", async () => {
        const t = await boot();
        await forgetTheSeed(t, await person(t, "owner"));
        expect((await settingsOf(t)).seededLayout).toBeNull();
        const authored = await layout(t, "Site layout", "site-layout");

        await ensure(t);
        await ensure(t);

        const settings = await settingsOf(t);
        expect(settings.defaultLayout).not.toBe(authored);
        expect(settings.seededLayout).toBe(settings.defaultLayout);
        const rows = await allLayouts(t);
        expect(rows).toHaveLength(2);
        expect(await rowOf(t, String(settings.seededLayout))).toMatchObject({
          title: "Site layout 2",
          slug: "site-layout-2",
          status: "published",
        });
        expect(await rowOf(t, authored)).toMatchObject({
          title: "Site layout",
          slug: "site-layout",
          status: "published",
        });
      });

      it("re-seeds exactly one Layout when the recorded seed was deleted, beside an authored one now at its old address", async () => {
        const t = await boot();
        const owner = await person(t, "owner");
        await ensure(t);
        const seed = String((await settingsOf(t)).seededLayout);
        await deleteSkippingHooks(t, seed, owner);
        const authored = await layout(t, "Site layout", "site-layout");

        await ensure(t);
        await ensure(t);

        const settings = await settingsOf(t);
        expect(settings.seededLayout).not.toBe(seed);
        expect(settings.seededLayout).not.toBe(authored);
        expect(settings.defaultLayout).toBe(settings.seededLayout);
        const rows = await allLayouts(t);
        expect(rows).toHaveLength(2);
        expect(await rowOf(t, String(settings.seededLayout))).toMatchObject({
          title: "Site layout 2",
          slug: "site-layout-2",
          status: "published",
        });
        expect(await rowOf(t, authored)).toMatchObject({
          title: "Site layout",
          slug: "site-layout",
          status: "published",
        });
      });
    });

    /**
     * A make-default and an unpublish or delete of the same Layout, landing in
     * each order. The hooks below are the test's own, registered after boot,
     * so they run after the plugin's guard on the same phase; each fires once,
     * at the moment the other write would land in a real race.
     */
    describe("batch writes inside a transaction", () => {
      const ONE_AT_A_TIME = "delete or unpublish Layouts one at a time";

      it("refuses a batch delete of the default and changes nothing", async () => {
        const t = await boot();
        const owner = await person(t, "owner");
        const fallback = String((await settingsOf(t)).defaultLayout);

        const answer = await batchWriter(t).deleteEntries(
          { collectionName: LAYOUTS_SLUG, user: { id: owner } },
          [fallback]
        );

        expect(answer.failed, JSON.stringify(answer)).toBe(1);
        expect(answer.errors[0]?.error).toContain(ONE_AT_A_TIME);
        expect((await rowOf(t, fallback)).status).toBe("published");
        expect((await settingsOf(t)).defaultLayout).toBe(fallback);
      });

      it("refuses a batch delete of a Layout that is not the default too, since no read is safe there", async () => {
        const t = await boot();
        const owner = await person(t, "owner");
        const fallback = (await settingsOf(t)).defaultLayout;
        const other = await layout(t, "Other", "other");

        const answer = await batchWriter(t).deleteEntries(
          { collectionName: LAYOUTS_SLUG, user: { id: owner } },
          [other]
        );

        expect(answer.failed, JSON.stringify(answer)).toBe(1);
        expect(answer.errors[0]?.error).toContain(ONE_AT_A_TIME);
        expect((await rowOf(t, other)).status).toBe("published");
        expect((await settingsOf(t)).defaultLayout).toBe(fallback);
      });

      it("refuses a batch unpublish of the default and changes nothing", async () => {
        const t = await boot();
        const fallback = String((await settingsOf(t)).defaultLayout);

        const answer = await batchWriter(t).updateEntries(
          { collectionName: LAYOUTS_SLUG, overrideAccess: true },
          [{ id: fallback, data: { status: "draft", _overwrite: true } }]
        );

        expect(answer.failed, JSON.stringify(answer)).toBe(1);
        expect(answer.errors[0]?.error).toContain(ONE_AT_A_TIME);
        expect((await rowOf(t, fallback)).status).toBe("published");
        expect((await settingsOf(t)).defaultLayout).toBe(fallback);
      });

      it("lets a batch edit that unpublishes nothing through, with no read of the settings inside the transaction", async () => {
        const t = await boot();
        const draft = await layout(t, "Unfinished", "unfinished", "draft");
        const reads = vi.spyOn(t.nextly, "findSingle");

        const answer = await batchWriter(t).updateEntries(
          { collectionName: LAYOUTS_SLUG, overrideAccess: true },
          [{ id: draft, data: { title: "Still unfinished", _overwrite: true } }]
        );

        expect(answer.successful, JSON.stringify(answer)).toBe(1);
        expect((await rowOf(t, draft)).title).toBe("Still unfinished");
        expect(
          reads.mock.calls.filter(
            ([args]) => args.slug === PAGE_BUILDER_SETTINGS_SLUG
          )
        ).toHaveLength(0);
        reads.mockRestore();
      });
    });

    describe("make default racing an unpublish or a delete", () => {
      it("restores the previous default when the Layout is unpublished after the route's check but before its write is confirmed", async () => {
        const t = await boot();
        const owner = await person(t, "owner");
        const cookie = await sessionOf(t, owner);
        const previous = (await settingsOf(t)).defaultLayout;
        const target = await layout(t, "Landing", "landing");

        // Fires after the route's write to the Single commits and before the
        // route reads the Layout again: the unpublish lands in that gap.
        let armed = true;
        t.hooks.register(
          "afterUpdate",
          `single:${PAGE_BUILDER_SETTINGS_SLUG}`,
          async context => {
            const data = (context as { data?: Record<string, unknown> }).data;
            if (!armed || relationId(data?.defaultLayout) !== target) return;
            armed = false;
            await unpublishSkippingHooks(t, target);
          }
        );

        const answer = await makeDefault(cookie, target);

        expect(armed).toBe(false);
        expect(answer.status).toBe(409);
        expect(JSON.stringify(answer.body)).toContain(
          "stopped being published"
        );
        expect((await settingsOf(t)).defaultLayout).toBe(previous);
        // The previous default was the plugin's own, so it names nobody, and
        // the refused request is not recorded as having chosen it.
        expect((await settingsOf(t)).defaultLayoutChangedBy).toBeNull();
        expect((await rowOf(t, target)).status).toBe("draft");
        expect(
          warnings.some(message =>
            message.includes("unpublished while it was being made the default")
          )
        ).toBe(true);
      });

      it("restores whoever chose the previous default along with it", async () => {
        const t = await boot();
        const owner = await person(t, "owner");
        const chosen = await layout(t, "Main", "main");
        expect(
          (await makeDefault(await sessionOf(t, owner), chosen)).status
        ).toBe(200);
        expect((await settingsOf(t)).defaultLayoutChangedBy).toBe(
          `user:${owner}`
        );

        const manager = await person(t, "manager");
        await grant(t, manager, [
          "manage-page-builder-site",
          "read-layouts",
          "update-layouts",
          "publish-layouts",
        ]);
        const target = await layout(t, "Landing", "landing");
        let armed = true;
        t.hooks.register(
          "afterUpdate",
          `single:${PAGE_BUILDER_SETTINGS_SLUG}`,
          async context => {
            const data = (context as { data?: Record<string, unknown> }).data;
            if (!armed || relationId(data?.defaultLayout) !== target) return;
            armed = false;
            await unpublishSkippingHooks(t, target);
          }
        );

        const answer = await makeDefault(await sessionOf(t, manager), target);

        expect(answer.status).toBe(409);
        expect(await settingsOf(t)).toMatchObject({
          defaultLayout: chosen,
          defaultLayoutChangedBy: `user:${owner}`,
        });
      });

      it("refuses without restoring when a newer make-default replaced the default before the unpublish landed", async () => {
        const t = await boot();
        const owner = await person(t, "owner");
        const cookie = await sessionOf(t, owner);
        const first = await layout(t, "First", "first");
        const second = await layout(t, "Second", "second");

        // After the first request's write commits: a second request makes
        // `second` the default, then `first` is unpublished past the guard.
        // The first request's re-check then finds `first` unpublished, but the
        // default is no longer its to restore.
        let armed = true;
        let secondAnswer = 0;
        t.hooks.register(
          "afterUpdate",
          `single:${PAGE_BUILDER_SETTINGS_SLUG}`,
          async context => {
            const data = (context as { data?: Record<string, unknown> }).data;
            if (!armed || relationId(data?.defaultLayout) !== first) return;
            armed = false;
            secondAnswer = (await makeDefault(cookie, second)).status;
            await unpublishSkippingHooks(t, first);
          }
        );

        const answer = await makeDefault(cookie, first);

        expect(secondAnswer).toBe(200);
        expect(answer.status).toBe(409);
        expect(JSON.stringify(answer.body)).toContain(
          "stopped being published"
        );
        expect((await settingsOf(t)).defaultLayout).toBe(second);
      });

      it("queues the repair when a Layout is made the default after its unpublish removal's last look at the default, and the repair re-points the default at the seed", async () => {
        const t = await boot();
        const owner = await person(t, "owner");
        const cookie = await sessionOf(t, owner);
        const seed = String((await settingsOf(t)).seededLayout);
        const target = await layout(t, "Landing", "landing");

        // Fires after the default guard has read the default (not this
        // Layout) and before the unpublish commits. Through the route, a
        // make-default arriving now meets the fence and refuses itself, so
        // the promotion that lands here is one whose checks ran before the
        // fence went up: its write, made the way the route makes it.
        let armed = true;
        t.hooks.register("beforeUpdate", LAYOUTS_SLUG, async context => {
          const original = (context as { originalData?: unknown }).originalData;
          if (!armed || relationId(original) !== target) return;
          armed = false;
          await writeLayoutSettings(
            t.nextly,
            SLUGS,
            await readLayoutSettings(t.nextly, SLUGS),
            { defaultLayout: target }
          );
        });

        const answer = await removeLayout(cookie, target, "unpublish");

        expect(armed).toBe(false);
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect((await settingsOf(t)).defaultLayout).toBe(target);
        expect((await rowOf(t, target)).status).toBe("draft");
        // The guard's after-check queued a repair: queueing it again finds
        // that one waiting under the same dedupe key.
        expect((await queueDefaultLayoutRepair(t.nextly)).deduped).toBe(true);

        await ensure(t);
        expect(await settingsOf(t)).toEqual({
          defaultLayout: seed,
          seededLayout: seed,
          // The repair's own choice names nobody.
          defaultLayoutChangedBy: null,
        });
        expect((await rowOf(t, seed)).status).toBe("published");
      });

      it("restores a Layout made the default after its delete removal's last look at the default, and the repair keeps it", async () => {
        const t = await boot();
        const owner = await person(t, "owner");
        const cookie = await sessionOf(t, owner);
        const target = await layout(t, "Landing", "landing");

        let armed = true;
        t.hooks.register("beforeDelete", LAYOUTS_SLUG, async context => {
          const doomed = (context as { data?: unknown }).data;
          if (!armed || relationId(doomed) !== target) return;
          armed = false;
          await writeLayoutSettings(
            t.nextly,
            SLUGS,
            await readLayoutSettings(t.nextly, SLUGS),
            { defaultLayout: target }
          );
        });

        const answer = await removeLayout(cookie, target, "delete");

        expect(armed).toBe(false);
        expect(answer.status).toBe(409);
        expect(JSON.stringify(answer.body)).toContain(KEPT_AS_DEFAULT);
        expect((await allLayouts(t)).map(row => row.id)).not.toContain(target);
        const restored = String((await settingsOf(t)).defaultLayout);
        expect(restored).not.toBe(target);
        expect(await rowOf(t, restored)).toMatchObject({
          title: "Landing",
          slug: "landing",
          status: "published",
        });
        // The default guard's after-check queued a repair when the delete
        // left the default missing; it finds the restored Layout and keeps it.
        expect((await queueDefaultLayoutRepair(t.nextly)).deduped).toBe(true);
        await ensure(t);
        expect((await settingsOf(t)).defaultLayout).toBe(restored);
      });
    });

    describe("the Layout a page is drawn inside", () => {
      it("is the page's own, the site default, or none when switched off", async () => {
        const t = await boot();
        await ensure(t);
        const fallback = String((await settingsOf(t)).defaultLayout);
        const landing = await layout(t, "Landing", "landing");
        const deps = { nextly: t.nextly, slugs: SLUGS };

        expect(await effectiveLayoutFor({ layout: landing }, deps)).toEqual({
          kind: "layout",
          id: landing,
          source: "page",
        });
        expect(await effectiveLayoutFor({}, deps)).toEqual({
          kind: "layout",
          id: fallback,
          source: "default",
        });
        expect(
          await effectiveLayoutFor(
            { layout: landing, noHeaderFooter: true },
            deps
          )
        ).toEqual({ kind: "none", reason: "switched-off" });
      });

      it("answers no-default on a site whose settings were never stored, and leaves them unstored", async () => {
        const t = await boot();
        // The settings Single's table, as core names every Single's.
        const table = `single_${PAGE_BUILDER_SETTINGS_SLUG.replace(/-/g, "_")}`;
        const stored = () => t.adapter.select<{ id: string }>(table, {});
        // The boot's seed stored the settings; remove the row past every hook,
        // as on a site where that seed never ran.
        const rows = await stored();
        expect(rows).toHaveLength(1);
        await t.adapter.delete(table, {
          and: [{ column: "id", op: "=", value: rows[0]?.id }],
        });
        expect(await stored()).toHaveLength(0);

        const answer = await effectiveLayoutFor(
          {},
          { nextly: t.nextly, slugs: SLUGS }
        );

        expect(answer).toEqual({ kind: "none", reason: "no-default" });
        // Drawing a page wrote nothing: the settings are still unstored.
        expect(await stored()).toHaveLength(0);
        expect(
          await t.nextly.findSingle({
            slug: PAGE_BUILDER_SETTINGS_SLUG,
            createIfMissing: false,
          })
        ).toBeNull();
      });

      it("stores a page's Layout and switch", async () => {
        const t = await boot();
        const landing = await layout(t, "Landing", "landing");
        const page = await t.nextly.create({
          collection: "pages",
          data: {
            title: "Home",
            slug: "home",
            layout: landing,
            noHeaderFooter: true,
          },
          overrideAccess: true,
        });
        // Read back rather than taken from the create's answer: what is
        // asserted is what the columns hold.
        const stored = await t.nextly.findByID({
          collection: "pages",
          id: String(page.item.id),
          status: "all",
          depth: 0,
          overrideAccess: true,
        });
        expect(stored).toMatchObject({
          layout: landing,
          noHeaderFooter: true,
        });
      });
    });
  }
);
