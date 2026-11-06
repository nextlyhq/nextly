/**
 * Remove Layout against a real instance: the route over REST as a signed-in
 * person, the fence in the plugin's own table, and the guards that leave it
 * the only way a Layout is deleted or unpublished.
 *
 * What only a server can show: that the fence row's compare-and-set steps hold
 * on each dialect; that a plain delete or unpublish, a forged fence row and a
 * scheduled release are all refused; that a promotion racing a removal, in
 * either order, ends with one published default and no page changed; and that
 * a Layout deleted from under a promotion is restored from its copy, by the
 * route or later by the repair, without ever overwriting a Layout that exists.
 *
 * Races are injected with the instance's own hook registry: a test hook is
 * registered after the plugin's, so on one phase it runs after the plugin's
 * guards, at the moment the other write would land in a real race.
 *
 * @module __tests__/layout-removal.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  definePlugin,
  NextlyError,
  text,
  type PluginDefinition,
} from "@nextlyhq/plugin-sdk";
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
import { PAGES_SLUG } from "../collections/pages";
import { ensureDefaultLayout } from "../default-layout/ensure-default";
import { PAGE_BUILDER_SETTINGS_SLUG } from "../default-layout/settings-single";
import {
  readLayoutSettings,
  relationId,
  writeLayoutSettings,
} from "../default-layout/store";
import { readLayoutCopy } from "../layout-removal/layout-copy";
import { settleLayoutRemovals } from "../layout-removal/settle";
import { LAYOUT_REMOVAL_CONTEXT_KEY } from "../layout-removal/layout-removal-guard";
import { LAYOUT_CLEAR_CONTEXT_KEY } from "../layout-removal/page-reference-guard";
import { PAGES_PER_TICK } from "../layout-removal/move-pages";
import {
  layoutRemovalStore,
  REMOVAL_LEASE_MS,
  type LayoutRemovalStore,
} from "../layout-removal/store";
import {
  ALREADY_BEING_REMOVED,
  BEING_REMOVED_NOT_DEFAULT,
  CANT_EDIT_PAGE,
  KEPT_AS_DEFAULT,
  LAYOUT_EDIT_DURING_REMOVAL,
  pageLayoutRefusal,
  REMOVE_LAYOUT_REFUSAL,
} from "../layout-removal/words";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

const SLUGS = {
  layouts: LAYOUTS_SLUG,
  settings: PAGE_BUILDER_SETTINGS_SLUG,
} as const;

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

interface Answer {
  status: number;
  body: Record<string, unknown>;
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

/** The refusal's message in an error envelope. */
function told(answer: Answer): string {
  const error = answer.body.error as { message?: unknown } | undefined;
  return typeof error?.message === "string" ? error.message : "";
}

/**
 * A plugin that depends on the page builder, which is what lets it reach the
 * page builder's tables through its own `ctx.db`: the test's way to read the
 * fence, and to write the rows a stopped request or a forger would leave.
 */
function probePlugin(holder: Probe): PluginDefinition {
  return definePlugin({
    name: "@test/layout-removal-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      holder.store = layoutRemovalStore(ctx.db, ctx.dialect);
      holder.raced = afterRead =>
        layoutRemovalStore(readsThen(ctx.db, afterRead), ctx.dialect);
    },
  });
}

/** What the probe hands the tests. */
interface Probe {
  store?: LayoutRemovalStore;
  /** A store whose every single-row read runs `afterRead` before it answers. */
  raced?: (afterRead: () => Promise<void>) => LayoutRemovalStore;
}

/**
 * `db`, with `afterRead` run after each single-row read and before its answer
 * is handed back: how a test lands another request's write between a read and
 * the compare-and-set that acts on it.
 */
function readsThen<T extends object>(db: T, afterRead: () => Promise<void>): T {
  const chain = (builder: object): object =>
    new Proxy(builder, {
      get(target, key, receiver) {
        const value: unknown = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        if (key === "first") {
          return async (...args: unknown[]) => {
            const row: unknown = await Reflect.apply(value, target, args);
            await afterRead();
            return row;
          };
        }
        return (...args: unknown[]) => {
          const next: unknown = Reflect.apply(value, target, args);
          return typeof next === "object" && next !== null ? chain(next) : next;
        };
      },
    });
  return new Proxy(db, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (key !== "select" || typeof value !== "function") return value;
      return (...args: unknown[]) =>
        chain(Reflect.apply(value, target, args) as object);
    },
  });
}

/** A plugin adding its own field to Layouts, as any plugin may. */
function taglinePlugin(): PluginDefinition {
  return definePlugin({
    name: "@test/layout-tagline",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    contributes: {
      extend: [{ target: LAYOUTS_SLUG, fields: [text({ name: "tagline" })] }],
    },
  });
}

/**
 * A plugin hiding the pages' title from every read that keeps to access: a
 * field-level read rule, the kind a site sets on a field it keeps private.
 */
function hiddenTitlesPlugin(): PluginDefinition {
  return definePlugin({
    name: "@test/hidden-page-titles",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    contributes: {
      transforms: [
        {
          target: PAGES_SLUG,
          transform: entity => ({
            ...entity,
            fields: (Array.isArray(entity.fields) ? entity.fields : []).map(
              (field: unknown) =>
                typeof field === "object" &&
                field !== null &&
                (field as { name?: unknown }).name === "title"
                  ? { ...field, access: { read: () => false } }
                  : field
            ),
          }),
        },
      ],
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "Remove Layout (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    const probe: Probe = {};

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
      probe.store = undefined;
      probe.raced = undefined;
    });

    function fence(): LayoutRemovalStore {
      if (probe.store === undefined) throw new Error("the probe did not boot");
      return probe.store;
    }

    function ensure(t: TestNextly) {
      return ensureDefaultLayout({
        nextly: t.nextly,
        slugs: SLUGS,
        pagesSlug: "pages",
        removals: fence(),
        warn: () => {},
      });
    }

    async function boot(
      extra: readonly PluginDefinition[] = []
    ): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), probePlugin(probe), ...extra],
        seedPublic: true,
      });
      await ensure(current);
      return current;
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

    async function page(
      t: TestNextly,
      title: string,
      data: Record<string, unknown>
    ): Promise<string> {
      const created = await t.nextly.create({
        collection: PAGES_SLUG,
        data: { title, slug: title.toLowerCase(), ...data },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function layoutRow(
      t: TestNextly,
      id: string
    ): Promise<Record<string, unknown> | undefined> {
      const found = await t.nextly.find({
        collection: LAYOUTS_SLUG,
        where: { id: { equals: id } },
        status: "all",
        limit: 1,
        depth: 0,
        overrideAccess: true,
      });
      return found.items[0] as Record<string, unknown> | undefined;
    }

    function settingsOf(t: TestNextly) {
      return readLayoutSettings(t.nextly, SLUGS);
    }

    async function person(t: TestNextly, name: string): Promise<string> {
      const created = await t.nextly.users.create({
        email: `${name}@example.com`,
        password: "Password123!",
        data: { name, isActive: true },
      });
      return created.item.id;
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

    /** POST one of the plugin's routes as the session's owner. */
    async function post(
      cookie: string,
      sub: string[],
      body: unknown
    ): Promise<Answer> {
      const handlers = createDynamicHandlers();
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

    const remove = (
      cookie: string,
      id: string,
      action: "delete" | "unpublish",
      dryRun?: boolean
    ) =>
      post(cookie, ["layouts", id, "remove"], {
        action,
        ...(dryRun === undefined ? {} : { dryRun }),
      });

    const makeDefault = (cookie: string, id: string, dryRun?: boolean) =>
      post(
        cookie,
        ["layouts", id, "make-default"],
        dryRun === undefined ? {} : { dryRun }
      );

    /** The instance's first user, its super admin, and a session for them. */
    async function owner(t: TestNextly) {
      const id = await person(t, "owner");
      return { id, cookie: await sessionOf(t, id) };
    }

    describe("with nothing in the way", () => {
      it("deletes a Layout no page names, and leaves its row settled", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");

        const answer = await remove(cookie, other, "delete");

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(await layoutRow(t, other)).toBeUndefined();
        const row = await fence().removalOf(other);
        expect(row).toMatchObject({
          step: "removed",
          action: "delete",
          copy: null,
        });
        expect(row?.settledAt).toBeInstanceOf(Date);
      });

      it("unpublishes one, keeping its row until it is published again", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");

        const answer = await remove(cookie, other, "unpublish");

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect((await layoutRow(t, other))?.status).toBe("draft");
        expect(await fence().removalOf(other)).toMatchObject({
          step: "removed",
          action: "unpublish",
        });

        await t.nextly.update({
          collection: LAYOUTS_SLUG,
          id: other,
          data: { status: "published", _overwrite: true },
          overrideAccess: true,
        });
        expect(await fence().removalOf(other)).toBeNull();
        expect((await makeDefault(cookie, other)).status).toBe(200);
      });

      it("answers a dry run with what stands in the way, and writes nothing", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        const home = await page(t, "Home", {
          layout: other,
          status: "published",
        });

        const answer = await remove(cookie, other, "delete", true);

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect((answer.body.item as { check?: unknown }).check).toEqual({
          isDefault: false,
          pages: [{ id: home, title: "Home", state: "published" }],
          unreadable: 0,
          complete: true,
          pagesCollection: PAGES_SLUG,
          liveRows: 1,
          siteDefault: expect.any(String),
        });
        expect(await fence().removalOf(other)).toBeNull();
        expect(await layoutRow(t, other)).toBeDefined();
      });
      it("never names a page whose title a field rule hides from the remover", async () => {
        const t = await boot([hiddenTitlesPlugin()]);
        const me = await owner(t);
        const other = await layout(t, "Other", "other");
        await page(t, "Secret plans", { layout: other, status: "published" });
        // The rule holds for the remover's own read of the page.
        const asOwner = await t.nextly.find({
          collection: PAGES_SLUG,
          where: { layout: { equals: other } },
          status: "all",
          depth: 0,
          overrideAccess: false,
          user: { id: me.id },
        });
        expect(asOwner.items[0]).not.toHaveProperty("title");

        const answer = await remove(me.cookie, other, "delete", true);

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(JSON.stringify(answer.body)).not.toContain("Secret plans");
        expect((answer.body.item as { check?: unknown }).check).toMatchObject({
          pages: [],
          unreadable: 1,
        });
      });
    });

    describe("what stops it", () => {
      it.each([
        ["a published page", { status: "published" }, false],
        ["an unpublished page", { status: "draft" }, false],
        [
          "a published page's working draft alone",
          { status: "published" },
          true,
        ],
      ])(
        "refuses while %s names the Layout, and changes nothing",
        async (_label, state, draftOnly) => {
          const t = await boot();
          const { cookie } = await owner(t);
          const other = await layout(t, "Other", "other");
          const home = await page(t, "Home", {
            ...state,
            ...(draftOnly ? {} : { layout: other }),
          });
          if (draftOnly) {
            // A save without a status keeps the live row and stores the edit
            // beside it: only the working draft names the Layout.
            await t.nextly.update({
              collection: PAGES_SLUG,
              id: home,
              data: { layout: other, _overwrite: true },
              overrideAccess: true,
            });
          }

          const answer = await remove(cookie, other, "delete");

          expect(answer.status).toBe(409);
          expect(told(answer)).toBe(
            '1 page uses this Layout: "Home". Choose another Layout for it first.'
          );
          expect((await layoutRow(t, other))?.status).toBe("published");
          expect(await fence().removalOf(other)).toBeNull();
          const stored = await t.nextly.findByID({
            collection: PAGES_SLUG,
            id: home,
            draft: true,
            depth: 0,
            overrideAccess: true,
          });
          expect(relationId(stored?.layout)).toBe(other);
        }
      );

      it("refuses when a page that exists can't be read, never reading it as gone", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        const home = await page(t, "Home", { status: "published" });
        // Only the working draft names the Layout.
        await t.nextly.update({
          collection: PAGES_SLUG,
          id: home,
          data: { layout: other, _overwrite: true },
          overrideAccess: true,
        });
        // A read hook answers not found for the page's working draft (the one
        // read that names the Layout), as one that looks up something the
        // page relates to can: the page itself is still there.
        t.hooks.register("afterRead", PAGES_SLUG, async context => {
          const doc = (context as { data?: Record<string, unknown> }).data;
          if (relationId(doc) === home && relationId(doc?.layout) === other) {
            throw NextlyError.notFound();
          }
        });

        const answer = await remove(cookie, other, "delete");

        expect(answer.status, JSON.stringify(answer.body)).toBe(409);
        expect(told(answer)).toContain("Not every page could be checked");
        expect((await layoutRow(t, other))?.status).toBe("published");
        expect(await fence().removalOf(other)).toBeNull();
      });

      it("refuses the site's default, saying to choose another first", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const fallback = String((await settingsOf(t)).defaultLayout);

        const answer = await remove(cookie, fallback, "delete");

        expect(answer.status).toBe(409);
        expect(told(answer)).toContain("Choose another default first");
        expect((await layoutRow(t, fallback))?.status).toBe("published");
        expect(await fence().removalOf(fallback)).toBeNull();
      });

      it("refuses a person who may not delete Layouts at the write itself, changing nothing", async () => {
        const t = await boot();
        await owner(t);
        const reader = await person(t, "reader");
        const other = await layout(t, "Other", "other");
        const permissions = await t.nextly.permissions.find({ limit: 500 });
        const read = permissions.items.find(p => p.slug === "read-layouts");
        if (read === undefined) throw new Error("read-layouts is not seeded");
        const role = await t.nextly.roles.create({
          data: {
            name: "Reader",
            slug: "layout-reader",
            permissionIds: [read.id],
          },
        });
        const assigned = await new ServiceContainer(
          t.adapter
        ).userRoles.assignRoleToUser(reader, role.item.id);
        expect(assigned.success).toBe(true);

        const answer = await remove(
          await sessionOf(t, reader),
          other,
          "delete"
        );

        expect(answer.status).toBe(403);
        expect(await layoutRow(t, other)).toBeDefined();
        // The fence the request put up came down with the refusal.
        expect(await fence().removalOf(other)).toBeNull();
      });
    });

    describe("the only way", () => {
      it("refuses a plain delete and a plain unpublish, naming Remove Layout", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");

        const deleted = await refusalOf(
          t.nextly.delete({
            collection: LAYOUTS_SLUG,
            id: other,
            overrideAccess: true,
          })
        );
        const unpublished = await refusalOf(
          t.nextly.update({
            collection: LAYOUTS_SLUG,
            id: other,
            data: { status: "draft", _overwrite: true },
            overrideAccess: true,
          })
        );

        expect(messageOf(deleted)).toBe(REMOVE_LAYOUT_REFUSAL);
        expect(messageOf(unpublished)).toBe(REMOVE_LAYOUT_REFUSAL);
        expect((await layoutRow(t, other))?.status).toBe("published");
      });

      it("refuses unpublishing every language at once, the site's default included", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        const fallback = String((await settingsOf(t)).defaultLayout);

        // Core runs the Layout's hooks for a move of every language, so the
        // guards that refuse a plain unpublish refuse this one too.
        const unpublished = await allLanguages(cookie, other, "unpublish-all");
        const defaultUnpublished = await allLanguages(
          cookie,
          fallback,
          "unpublish-all"
        );

        expect(unpublished.status, JSON.stringify(unpublished.body)).toBe(409);
        expect(told(unpublished)).toBe(REMOVE_LAYOUT_REFUSAL);
        expect(
          defaultUnpublished.status,
          JSON.stringify(defaultUnpublished.body)
        ).toBe(409);
        expect((await layoutRow(t, other))?.status).toBe("published");
        expect((await layoutRow(t, fallback))?.status).toBe("published");
      });

      it("lets an edit that unpublishes nothing through", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");

        await t.nextly.update({
          collection: LAYOUTS_SLUG,
          id: other,
          data: { title: "Renamed", status: "published", _overwrite: true },
          overrideAccess: true,
        });

        expect((await layoutRow(t, other))?.title).toBe("Renamed");
      });

      it("refuses a delete carrying a token a forged row holds, written straight to the table", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        const copy = await readLayoutCopy(t.nextly, LAYOUTS_SLUG, other);
        const forged = "forged00-0000-4000-8000-000000000000";
        await fence().mark({
          layoutId: other,
          action: "delete",
          token: forged,
          startedBy: null,
          now: new Date(),
        });
        await fence().advance({
          layoutId: other,
          token: forged,
          from: "marked",
          to: "checked",
        });
        await fence().advance({
          layoutId: other,
          token: forged,
          from: "checked",
          to: "final",
          set: { copy: copy?.copy ?? null, copyVersion: copy?.version ?? null },
        });

        // Without the token, the row alone admits nothing.
        const plain = await refusalOf(
          t.nextly.delete({
            collection: LAYOUTS_SLUG,
            id: other,
            overrideAccess: true,
          })
        );
        const guessed = await refusalOf(
          t.nextly.delete({
            collection: LAYOUTS_SLUG,
            id: other,
            overrideAccess: true,
            context: { [LAYOUT_REMOVAL_CONTEXT_KEY]: "guessed" },
          })
        );

        expect(messageOf(plain)).toBe(REMOVE_LAYOUT_REFUSAL);
        expect(messageOf(guessed)).toBe(REMOVE_LAYOUT_REFUSAL);
        expect(await layoutRow(t, other)).toBeDefined();
        // The positive control: the row's own token at its final step, with
        // the version unchanged, is exactly what the route's write carries.
        await t.nextly.delete({
          collection: LAYOUTS_SLUG,
          id: other,
          overrideAccess: true,
          context: { [LAYOUT_REMOVAL_CONTEXT_KEY]: forged },
        });
        expect(await layoutRow(t, other)).toBeUndefined();
      });

      it("refuses a scheduled release that unpublishes a Layout at the drain, and keeps the release", async () => {
        const t = await boot();
        const { id: author } = await owner(t);
        const other = await layout(t, "Other", "other");
        const release = await t.nextly.releases.create({
          title: "Take it down",
        });
        await t.nextly.releases.addMember({
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug: LAYOUTS_SLUG,
          entryId: other,
          locale: null,
          action: "unpublish",
          userId: author,
        });

        const ran = await t.nextly.releases.publishNow({ id: release.id });

        expect(ran.state).toBe("scheduled");
        expect((await layoutRow(t, other))?.status).toBe("published");
      });
    });

    describe("make default and the fence", () => {
      it("refuses a Layout being removed, in a dry run too", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        await fence().mark({
          layoutId: other,
          action: "delete",
          token: "running0-0000-4000-8000-000000000000",
          startedBy: null,
          now: new Date(),
        });
        const before = (await settingsOf(t)).defaultLayout;

        const dry = await makeDefault(cookie, other, true);
        const real = await makeDefault(cookie, other);

        expect(dry.status).toBe(409);
        expect(told(dry)).toBe(BEING_REMOVED_NOT_DEFAULT);
        expect(real.status).toBe(409);
        expect((await settingsOf(t)).defaultLayout).toBe(before);
      });

      it("refuses a Layout an unpublish removal took down, even once it is published past the hooks", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        expect((await remove(cookie, other, "unpublish")).status).toBe(200);
        // Published again by a batch that skips hooks, so the tombstone is
        // not dropped: the fence still stands.
        const entries = (
          t.getService("collectionsHandler") as unknown as {
            getEntryService(): {
              updateEntries(
                params: { collectionName: string; overrideAccess?: boolean },
                entries: { id: string; data: Record<string, unknown> }[],
                options?: { skipHooks?: boolean }
              ): Promise<{ successful: number }>;
            };
          }
        ).getEntryService();
        const published = await entries.updateEntries(
          { collectionName: LAYOUTS_SLUG, overrideAccess: true },
          [{ id: other, data: { status: "published", _overwrite: true } }],
          { skipHooks: true }
        );
        expect(published.successful).toBe(1);
        expect((await layoutRow(t, other))?.status).toBe("published");

        const answer = await makeDefault(cookie, other);

        expect(answer.status).toBe(409);
        expect(told(answer)).toBe(BEING_REMOVED_NOT_DEFAULT);
      });
    });

    describe("a promotion racing a removal", () => {
      it("is refused when it arrives after the fence is up, and the removal goes ahead with the default unchanged", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const before = (await settingsOf(t)).defaultLayout;
        const other = await layout(t, "Other", "other");
        const kept = await layout(t, "Kept", "kept");
        const home = await page(t, "Home", {
          layout: kept,
          status: "published",
        });
        let promoted = 0;
        let armed = true;
        t.hooks.register("beforeDelete", LAYOUTS_SLUG, async context => {
          if (
            !armed ||
            relationId((context as { data?: unknown }).data) !== other
          )
            return;
          armed = false;
          promoted = (await makeDefault(cookie, other)).status;
        });

        const answer = await remove(cookie, other, "delete");

        expect(promoted).toBe(409);
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect((await settingsOf(t)).defaultLayout).toBe(before);
        expect(await layoutRow(t, other)).toBeUndefined();
        const stored = await t.nextly.findByID({
          collection: PAGES_SLUG,
          id: home,
          depth: 0,
          overrideAccess: true,
        });
        expect(relationId(stored?.layout)).toBe(kept);
      });

      it("stops the removal when the promotion committed first, leaving both as they were", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        // The removal starts right after the promotion's write commits and
        // before the promotion's own check after it.
        let removal: Answer | undefined;
        let armed = true;
        t.hooks.register(
          "afterUpdate",
          `single:${PAGE_BUILDER_SETTINGS_SLUG}`,
          async context => {
            const data = (context as { data?: Record<string, unknown> }).data;
            if (!armed || relationId(data?.defaultLayout) !== other) return;
            armed = false;
            removal = await remove(cookie, other, "delete");
          }
        );

        const promoted = await makeDefault(cookie, other);

        expect(removal?.status).toBe(409);
        expect(told(removal ?? { status: 0, body: {} })).toContain(
          "Choose another default first"
        );
        expect(promoted.status).toBe(200);
        expect((await settingsOf(t)).defaultLayout).toBe(other);
        expect((await layoutRow(t, other))?.status).toBe("published");
        expect(await fence().removalOf(other)).toBeNull();
      });

      it("refuses the promotion whose check came before the fence and whose write came after the removal, putting the old default back", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const before = (await settingsOf(t)).defaultLayout;
        const other = await layout(t, "Other", "other");
        // The promotion reads the settings after its fence check and before
        // its write: the whole removal lands in that gap.
        let removal: Answer | undefined;
        let armed = false;
        t.hooks.register(
          "afterRead",
          `single:${PAGE_BUILDER_SETTINGS_SLUG}`,
          async () => {
            if (!armed) return;
            armed = false;
            removal = await remove(cookie, other, "delete");
          }
        );

        armed = true;
        const promoted = await makeDefault(cookie, other);

        expect(removal?.status, JSON.stringify(removal?.body)).toBe(200);
        expect(promoted.status).toBe(409);
        expect((await settingsOf(t)).defaultLayout).toBe(before);
        expect((await layoutRow(t, String(before)))?.status).toBe("published");
        expect(await layoutRow(t, other)).toBeUndefined();
      });

      it("puts the old default back when the fence went up after the promotion's check and before its check after the write", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const before = (await settingsOf(t)).defaultLayout;
        const other = await layout(t, "Other", "other");
        // A removal marks the Layout right after the promotion's write
        // commits; the Layout is still published, so only the fence tells.
        let armed = true;
        t.hooks.register(
          "afterUpdate",
          `single:${PAGE_BUILDER_SETTINGS_SLUG}`,
          async context => {
            const data = (context as { data?: Record<string, unknown> }).data;
            if (!armed || relationId(data?.defaultLayout) !== other) return;
            armed = false;
            await fence().mark({
              layoutId: other,
              action: "delete",
              token: "marking0-0000-4000-8000-000000000000",
              startedBy: null,
              now: new Date(),
            });
          }
        );

        const promoted = await makeDefault(cookie, other);

        expect(promoted.status).toBe(409);
        expect(told(promoted)).toBe(BEING_REMOVED_NOT_DEFAULT);
        expect((await settingsOf(t)).defaultLayout).toBe(before);
        expect((await layoutRow(t, other))?.status).toBe("published");
      });

      it("takes its copy again when another plugin's field changed after the copy, in the same stored second", async () => {
        const t = await boot([taglinePlugin()]);
        const { cookie } = await owner(t);
        const created = await t.nextly.create({
          collection: LAYOUTS_SLUG,
          data: {
            title: "Other",
            slug: "other",
            areas: [],
            status: "published",
            tagline: "Before",
          },
          overrideAccess: true,
        });
        const other = String(created.item.id);
        const table = await tableOf(t, LAYOUTS_SLUG);
        // Right after the removal reads its copy, an edit lands that changes
        // only the extension field and leaves the stored timestamp as it was.
        let edited = false;
        t.hooks.register("afterRead", LAYOUTS_SLUG, async () => {
          if (edited) return;
          if ((await fence().removalOf(other))?.step !== "checked") return;
          edited = true;
          await t.adapter.update(
            table,
            { tagline: "Edited meanwhile" },
            { and: [{ column: "id", op: "=", value: other }] }
          );
        });
        // A promotion racing the delete, so the Layout comes back from the
        // copy the delete was finally admitted with.
        let promoted = false;
        t.hooks.register("beforeDelete", LAYOUTS_SLUG, async context => {
          if (
            promoted ||
            relationId((context as { data?: unknown }).data) !== other
          )
            return;
          promoted = true;
          await writeLayoutSettings(
            t.nextly,
            SLUGS,
            await readLayoutSettings(t.nextly, SLUGS),
            { defaultLayout: other }
          );
        });

        const answer = await remove(cookie, other, "delete");

        expect(edited).toBe(true);
        expect(told(answer)).toBe(KEPT_AS_DEFAULT);
        const restored = String((await settingsOf(t)).defaultLayout);
        expect(await layoutRow(t, restored)).toMatchObject({
          title: "Other",
          tagline: "Edited meanwhile",
        });
      });

      it("restores a Layout deleted under a promotion that committed after the removal's last look, under a new id, and points the default at it", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        const bystander = await layout(t, "Bystander", "bystander");
        // A promotion that passed its own checks before the fence went up,
        // committing between the removal's last read of the default and its
        // delete, and never reaching its own check after.
        let armed = true;
        t.hooks.register("beforeDelete", LAYOUTS_SLUG, async context => {
          if (
            !armed ||
            relationId((context as { data?: unknown }).data) !== other
          )
            return;
          armed = false;
          await writeLayoutSettings(
            t.nextly,
            SLUGS,
            await readLayoutSettings(t.nextly, SLUGS),
            { defaultLayout: other }
          );
        });

        const answer = await remove(cookie, other, "delete");

        expect(answer.status).toBe(409);
        expect(told(answer)).toBe(KEPT_AS_DEFAULT);
        expect(await layoutRow(t, other)).toBeUndefined();
        const restored = String((await settingsOf(t)).defaultLayout);
        expect(restored).not.toBe(other);
        expect(await layoutRow(t, restored)).toMatchObject({
          title: "Other",
          slug: "other",
          status: "published",
        });
        expect((await layoutRow(t, bystander))?.title).toBe("Bystander");
      });

      it("leaves an unpublish under such a promotion to the repair, which points the default at the seed", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const seed = String((await settingsOf(t)).seededLayout);
        const other = await layout(t, "Other", "other");
        let armed = true;
        t.hooks.register("beforeUpdate", LAYOUTS_SLUG, async context => {
          const original = (context as { originalData?: unknown }).originalData;
          if (!armed || relationId(original) !== other) return;
          armed = false;
          await writeLayoutSettings(
            t.nextly,
            SLUGS,
            await readLayoutSettings(t.nextly, SLUGS),
            { defaultLayout: other }
          );
        });

        const answer = await remove(cookie, other, "unpublish");

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect((await layoutRow(t, other))?.status).toBe("draft");
        await ensure(t);
        expect((await settingsOf(t)).defaultLayout).toBe(seed);
      });
    });

    /** Put a removal's fence up on `id`, as a removal still running holds it. */
    async function fenced(
      id: string,
      step: "marked" | "checked" | "final" = "marked"
    ) {
      const token = "holding0-0000-4000-8000-000000000000";
      await fence().mark({
        layoutId: id,
        action: "delete",
        token,
        startedBy: null,
        now: new Date(),
      });
      if (step !== "marked") {
        await fence().advance({
          layoutId: id,
          token,
          from: "marked",
          to: "checked",
        });
      }
      if (step === "final") {
        await fence().advance({
          layoutId: id,
          token,
          from: "checked",
          to: "final",
        });
      }
      return token;
    }

    /** Core's batch writer, hooks run inside its own transaction or skipped. */
    function entriesService(t: TestNextly) {
      return (
        t.getService("collectionsHandler") as unknown as {
          getEntryService(): {
            updateEntries(
              params: { collectionName: string; overrideAccess?: boolean },
              entries: { id: string; data: Record<string, unknown> }[],
              options?: { skipHooks?: boolean }
            ): Promise<{
              successful: number;
              failed: number;
              errors: { error: string }[];
            }>;
          };
        }
      ).getEntryService();
    }

    async function pageLayout(t: TestNextly, id: string, draft = false) {
      const page = await t.nextly.findByID({
        collection: PAGES_SLUG,
        id,
        depth: 0,
        overrideAccess: true,
        ...(draft ? { draft: true } : {}),
      });
      return relationId(page?.layout);
    }

    /** PATCH a page over REST as the session's owner. */
    async function patchPage(
      cookie: string,
      id: string,
      data: Record<string, unknown>
    ): Promise<Answer> {
      const handlers = createDynamicHandlers();
      const path = ["collections", PAGES_SLUG, "entries", id];
      const response = await handlers.PATCH(
        new Request(`${ORIGIN}/api/${path.join("/")}`, {
          method: "PATCH",
          headers: {
            cookie: `${cookie}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          body: JSON.stringify(data),
        }),
        { params: Promise.resolve({ params: path }) }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
      };
    }

    describe("pages and a Layout being removed", () => {
      it("refuses a page put on it, over REST and the Direct API, naming the reason on the field", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        const home = await page(t, "Home", { status: "draft" });
        await fenced(other);

        const created = await refusalOf(
          t.nextly.create({
            collection: PAGES_SLUG,
            data: { title: "About", slug: "about", layout: other },
            overrideAccess: true,
          })
        );
        const patched = await patchPage(cookie, home, {
          layout: other,
          _overwrite: true,
        });

        expect(JSON.stringify(created)).toContain(
          pageLayoutRefusal("removing")
        );
        expect(patched.status).toBe(400);
        expect(JSON.stringify(patched.body)).toContain(
          pageLayoutRefusal("removing")
        );
        expect(await pageLayout(t, home)).toBeNull();
      });

      it("keeps a page already on it through a title edit, and refuses a stale save re-adding it after its draft moved off", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        const home = await page(t, "Home", {
          status: "published",
          layout: other,
        });
        // The page's working draft moves off the Layout before the fence.
        await t.nextly.update({
          collection: PAGES_SLUG,
          id: home,
          data: { layout: null, _overwrite: true },
          overrideAccess: true,
        });
        await fenced(other);

        // A save that sends the draft's value along with a title keeps it.
        await t.nextly.update({
          collection: PAGES_SLUG,
          id: home,
          data: { title: "Home, renamed", layout: null, _overwrite: true },
          overrideAccess: true,
        });
        // A stale copy naming the Layout again adds a reference: refused, and
        // its other edits are not stored.
        const stale = await refusalOf(
          t.nextly.update({
            collection: PAGES_SLUG,
            id: home,
            data: { title: "Stale", layout: other, _overwrite: true },
            overrideAccess: true,
          })
        );

        expect(JSON.stringify(stale)).toContain(pageLayoutRefusal("removing"));
        const draft = await t.nextly.findByID({
          collection: PAGES_SLUG,
          id: home,
          draft: true,
          depth: 0,
          overrideAccess: true,
        });
        expect(draft?.title).toBe("Home, renamed");
        expect(await pageLayout(t, home)).toBe(other);
      });

      it("lets a title edit through on a page that sits on the Layout", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        const home = await page(t, "Home", { status: "draft", layout: other });
        await fenced(other);

        await t.nextly.update({
          collection: PAGES_SLUG,
          id: home,
          data: { title: "Home, renamed", layout: other, _overwrite: true },
          overrideAccess: true,
        });

        expect(await pageLayout(t, home)).toBe(other);
      });

      it("judges a batch page write on the batch's own transaction, refusing a Layout being removed", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        const free = await layout(t, "Free", "free");
        const home = await page(t, "Home", { status: "draft" });
        await fenced(other);
        const inTime = <T>(work: Promise<T>): Promise<T> =>
          Promise.race([
            work,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("the batch hung")), 15_000)
            ),
          ]);

        const allowed = await inTime(
          entriesService(t).updateEntries(
            { collectionName: PAGES_SLUG, overrideAccess: true },
            [{ id: home, data: { layout: free, _overwrite: true } }]
          )
        );
        const refused = await inTime(
          entriesService(t).updateEntries(
            { collectionName: PAGES_SLUG, overrideAccess: true },
            [{ id: home, data: { layout: other, _overwrite: true } }]
          )
        );

        expect(allowed.successful, JSON.stringify(allowed)).toBe(1);
        expect(refused.failed, JSON.stringify(refused)).toBe(1);
        expect(JSON.stringify(refused.errors)).toContain("VALIDATION_ERROR");
        expect(await pageLayout(t, home)).toBe(free);
      });

      it("refuses a batch that skips hooks, through the field's floor, read from inside the batch's transaction", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        const home = await page(t, "Home", { status: "draft" });
        // The control: with no fence the same batch goes through.
        const free = await layout(t, "Free", "free");
        const control = await entriesService(t).updateEntries(
          { collectionName: PAGES_SLUG, overrideAccess: true },
          [{ id: home, data: { layout: free, _overwrite: true } }],
          { skipHooks: true }
        );
        expect(control.successful, JSON.stringify(control)).toBe(1);
        await fenced(other);

        const answer = await entriesService(t).updateEntries(
          { collectionName: PAGES_SLUG, overrideAccess: true },
          [{ id: home, data: { layout: other, _overwrite: true } }],
          { skipHooks: true }
        );

        // A batch reports a validation refusal by its code; the field's
        // sentence is the floor's, which only it returns for this value.
        expect(answer.failed, JSON.stringify(answer)).toBe(1);
        expect(JSON.stringify(answer.errors)).toContain("VALIDATION_ERROR");
        expect(await pageLayout(t, home)).toBe(free);
      });

      it("clears a page whose save began before the fence and committed after the removal", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        const home = await page(t, "Home", { status: "draft" });
        // The page save has passed its checks; the whole removal runs before
        // it commits, so the removal's own scans never see it.
        let removal: Answer | undefined;
        let armed = true;
        t.hooks.register("beforeChange", PAGES_SLUG, async context => {
          const data = (context as { data?: Record<string, unknown> }).data;
          if (!armed || relationId(data?.layout) !== other) return;
          armed = false;
          removal = await remove(cookie, other, "delete");
        });

        await t.nextly.update({
          collection: PAGES_SLUG,
          id: home,
          data: { layout: other, _overwrite: true },
          overrideAccess: true,
        });

        expect(removal?.status, JSON.stringify(removal?.body)).toBe(200);
        expect(await layoutRow(t, other)).toBeUndefined();
        // The page's own look after its commit found the removal done.
        expect(await pageLayout(t, home)).toBeNull();
      });

      it("clears a page that a write committed onto the Layout after the removal's last scan", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        const home = await page(t, "Home", { status: "draft" });
        const registry = t.getService(
          "collectionRegistryService"
        ) as unknown as {
          getCollectionBySlug(
            slug: string
          ): Promise<{ tableName: string } | null>;
        };
        const table = (await registry.getCollectionBySlug(PAGES_SLUG))
          ?.tableName;
        if (table === undefined) throw new Error("no pages table");
        // A write that passed its checks before the fence, committing between
        // the removal's last scan and its delete, past every hook.
        let armed = true;
        t.hooks.register("beforeDelete", LAYOUTS_SLUG, async context => {
          if (
            !armed ||
            relationId((context as { data?: unknown }).data) !== other
          )
            return;
          armed = false;
          await t.adapter.update(
            table,
            { layout: other },
            { and: [{ column: "id", op: "=", value: home }] }
          );
        });

        const answer = await remove(cookie, other, "delete");

        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(armed).toBe(false);
        // The removal's own scan after its delete cleared it.
        expect(await pageLayout(t, home)).toBeNull();
      });
    });

    describe("a Layout edit while its removal runs", () => {
      it("is refused, for a plain save and inside a batch's transaction, and goes through once the fence is down", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        const token = await fenced(other, "checked");

        const plain = await refusalOf(
          t.nextly.update({
            collection: LAYOUTS_SLUG,
            id: other,
            data: { title: "Renamed", _overwrite: true },
            overrideAccess: true,
          })
        );
        const batch = await entriesService(t).updateEntries(
          { collectionName: LAYOUTS_SLUG, overrideAccess: true },
          [
            {
              id: other,
              data: { title: "Renamed in a batch", _overwrite: true },
            },
          ]
        );

        expect(messageOf(plain)).toBe(LAYOUT_EDIT_DURING_REMOVAL);
        expect(batch.failed, JSON.stringify(batch)).toBe(1);
        expect(JSON.stringify(batch.errors)).toContain(
          LAYOUT_EDIT_DURING_REMOVAL
        );
        expect((await layoutRow(t, other))?.title).toBe("Other");

        await fence().stop(other, token);
        await t.nextly.update({
          collection: LAYOUTS_SLUG,
          id: other,
          data: { title: "Renamed", _overwrite: true },
          overrideAccess: true,
        });
        // A save of a published Layout lands in its working draft.
        const draft = await t.nextly.findByID({
          collection: LAYOUTS_SLUG,
          id: other,
          draft: true,
          depth: 0,
          overrideAccess: true,
        });
        expect(draft?.title).toBe("Renamed");
      });

      it("drops an unpublish's tombstone when a batch publishes the Layout again", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        expect((await remove(cookie, other, "unpublish")).status).toBe(200);
        expect(await fence().removalOf(other)).not.toBeNull();

        const answer = await entriesService(t).updateEntries(
          { collectionName: LAYOUTS_SLUG, overrideAccess: true },
          [{ id: other, data: { status: "published", _overwrite: true } }]
        );

        expect(answer.successful, JSON.stringify(answer)).toBe(1);
        expect(await fence().removalOf(other)).toBeNull();
      });
    });

    /** POST core's all-languages lifecycle route for one Layout, as the owner. */
    async function allLanguages(
      cookie: string,
      id: string,
      verb: "publish-all" | "unpublish-all"
    ): Promise<Answer> {
      const handlers = createDynamicHandlers();
      const path = ["collections", LAYOUTS_SLUG, "entries", id, verb];
      const response = await handlers.POST(
        new Request(`${ORIGIN}/api/${path.join("/")}`, {
          method: "POST",
          headers: {
            cookie: `${cookie}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          body: "{}",
        }),
        { params: Promise.resolve({ params: path }) }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
      };
    }

    /** The pages table, as the registry resolved it. */
    async function pagesTable(t: TestNextly): Promise<string> {
      return tableOf(t, PAGES_SLUG);
    }

    async function tableOf(t: TestNextly, slug: string): Promise<string> {
      const registry = t.getService("collectionRegistryService") as unknown as {
        getCollectionBySlug(
          slug: string
        ): Promise<{ tableName: string } | null>;
      };
      const table = (await registry.getCollectionBySlug(slug))?.tableName;
      if (table === undefined) throw new Error(`no ${slug} table`);
      return table;
    }

    describe("a page published while the Layout is being removed", () => {
      /**
       * A page publish whose checks passed before the fence, committing as the
       * removal's own write starts: past every hook, as it would have been.
       */
      async function publishedAsTheWriteStarts(
        t: TestNextly,
        phase: "beforeDelete" | "beforeChange",
        layoutId: string,
        pageId: string
      ) {
        const table = await pagesTable(t);
        let armed = true;
        t.hooks.register(phase, LAYOUTS_SLUG, async context => {
          const hook = context as { data?: unknown; originalData?: unknown };
          const id = relationId(hook.originalData) ?? relationId(hook.data);
          if (!armed || id !== layoutId) return;
          armed = false;
          await t.adapter.update(
            table,
            { layout: layoutId, status: "published" },
            { and: [{ column: "id", op: "=", value: pageId }] }
          );
        });
        return () => armed;
      }

      it("undoes an unpublish, answering the page that uses the Layout, so nothing changed", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        const home = await page(t, "Home", { status: "draft" });
        const pending = await publishedAsTheWriteStarts(
          t,
          "beforeChange",
          other,
          home
        );

        const answer = await remove(cookie, other, "unpublish");

        expect(pending()).toBe(false);
        expect(answer.status).toBe(409);
        expect(told(answer)).toBe(
          '1 page uses this Layout: "Home". Choose another Layout for it first.'
        );
        expect((await layoutRow(t, other))?.status).toBe("published");
        expect(await fence().removalOf(other)).toBeNull();
        expect(await pageLayout(t, home)).toBe(other);
        // Nothing left behind: the Layout can be made the default again.
        expect((await makeDefault(cookie, other)).status).toBe(200);
      });

      it("lets a delete stand, saying which page still uses the Layout and what it shows", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        const home = await page(t, "Home", { status: "draft" });
        const pending = await publishedAsTheWriteStarts(
          t,
          "beforeDelete",
          other,
          home
        );

        const answer = await remove(cookie, other, "delete");

        expect(pending()).toBe(false);
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.body.message).toBe(
          "Home still uses this Layout. It shows the site default until it is published with another Layout."
        );
        expect(
          (answer.body.item as { stillUsedBy?: unknown }).stillUsedBy
        ).toEqual({ pages: [{ id: home, title: "Home" }], unreadable: 0 });
        expect(await layoutRow(t, other)).toBeUndefined();
      });
    });

    describe("publishing every language of a Layout Remove Layout unpublished", () => {
      it("leaves no tombstone once the sweep runs, so it can be made the default", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        expect((await remove(cookie, other, "unpublish")).status).toBe(200);
        // Core's all-languages publish runs the Layout's after-write, which
        // drops the tombstone; the sweep after it finds nothing left.
        expect((await allLanguages(cookie, other, "publish-all")).status).toBe(
          200
        );
        expect((await layoutRow(t, other))?.status).toBe("published");
        expect(await fence().removalOf(other)).toBeNull();

        await settleLayoutRemovals({
          nextly: t.nextly,
          slugs: SLUGS,
          pagesSlug: PAGES_SLUG,
          store: fence(),
          warn: () => {},
        });

        expect(await fence().removalOf(other)).toBeNull();
        expect((await makeDefault(cookie, other)).status).toBe(200);
      });
    });

    describe("the sweep beside a removal still running", () => {
      const token = "running0-0000-4000-8000-000000000000";
      const past = () => new Date(Date.now() + REMOVAL_LEASE_MS + 60_000);

      async function leftAtChecked(id: string): Promise<void> {
        await fence().mark({
          layoutId: id,
          action: "delete",
          token,
          startedBy: null,
          now: new Date(),
        });
        await fence().advance({
          layoutId: id,
          token,
          from: "marked",
          to: "checked",
        });
      }

      function sweep(t: TestNextly, store: LayoutRemovalStore) {
        return settleLayoutRemovals({
          nextly: t.nextly,
          slugs: SLUGS,
          pagesSlug: PAGES_SLUG,
          store,
          warn: () => {},
          now: past,
        });
      }

      it("clears a row left at checked once its lease is past", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        await leftAtChecked(other);

        await sweep(t, fence());

        expect(await fence().removalOf(other)).toBeNull();
      });

      it("is not taken over by a later removal when its lease is renewed after that removal read it", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        await leftAtChecked(other);
        // Past a second, so the renewal moves `updatedAt` on every database.
        await new Promise(resolve => setTimeout(resolve, 1100));
        let renewed = false;
        if (probe.raced === undefined)
          throw new Error("the probe did not boot");
        const later = probe.raced(async () => {
          if (renewed) return;
          renewed = true;
          // The running removal renews its lease between the later removal's
          // read of the row and its takeover.
          await fence().renew(other, token, "checked");
        });

        const outcome = await later.mark({
          layoutId: other,
          action: "delete",
          token: "later000-0000-4000-8000-000000000000",
          startedBy: null,
          now: past(),
        });

        expect(outcome.kind).toBe("busy");
        expect(await fence().removalOf(other)).toMatchObject({
          step: "checked",
          token,
        });
      });

      it("leaves a row that moved on after the sweep read it", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        await leftAtChecked(other);
        const store = fence();
        // The removal finishes its scan and moves on between the sweep's read
        // and its clear.
        const racing: LayoutRemovalStore = {
          ...store,
          unsettled: async () => {
            const read = await store.unsettled();
            await store.advance({
              layoutId: other,
              token,
              from: "checked",
              to: "final",
            });
            return read;
          },
        };

        await sweep(t, racing);

        expect(await fence().removalOf(other)).toMatchObject({
          step: "final",
          token,
        });
      });
    });

    describe("the repair after a removal that stopped", () => {
      /** The token of the removal these cases leave stopped. */
      const token = "stopped0-0000-4000-8000-000000000000";

      /** A delete removal taken to its final step, copy and all, then stopped. */
      async function stoppedAtFinal(t: TestNextly, id: string) {
        const copy = await readLayoutCopy(t.nextly, LAYOUTS_SLUG, id);
        await fence().mark({
          layoutId: id,
          action: "delete",
          token,
          startedBy: null,
          now: new Date(),
        });
        await fence().advance({
          layoutId: id,
          token,
          from: "marked",
          to: "checked",
        });
        await fence().advance({
          layoutId: id,
          token,
          from: "checked",
          to: "final",
          set: { copy: copy?.copy ?? null, copyVersion: copy?.version ?? null },
        });
      }

      /**
       * The same, then its delete exactly as the route makes it: the state a
       * process that exited after the delete leaves.
       */
      async function deletedThenStopped(t: TestNextly, id: string) {
        await stoppedAtFinal(t, id);
        await t.nextly.delete({
          collection: LAYOUTS_SLUG,
          id,
          overrideAccess: true,
          context: { [LAYOUT_REMOVAL_CONTEXT_KEY]: token },
        });
      }

      it("finishes a restore that stopped after its create, with one restored Layout and the default on it", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        await deletedThenStopped(t, other);
        await writeLayoutSettings(
          t.nextly,
          SLUGS,
          await readLayoutSettings(t.nextly, SLUGS),
          { defaultLayout: other }
        );
        /** The Layouts titled as the deleted one, other than the deleted id. */
        const restoredOnes = async () =>
          (
            await t.nextly.find({
              collection: LAYOUTS_SLUG,
              where: { title: { equals: "Other" } },
              status: "all",
              limit: 10,
              depth: 0,
              overrideAccess: true,
            })
          ).items.filter(row => relationId(row) !== other);
        // The process stops once the restored Layout is created: the next
        // read of the settings, the one before the default is pointed at it,
        // fails.
        let stopped = false;
        t.hooks.register(
          "afterRead",
          `single:${PAGE_BUILDER_SETTINGS_SLUG}`,
          async () => {
            if (stopped || (await restoredOnes()).length === 0) return;
            stopped = true;
            throw new Error("the process stopped");
          }
        );

        await expect(ensure(t)).rejects.toThrow();
        expect(stopped).toBe(true);
        await settleLayoutRemovals({
          nextly: t.nextly,
          slugs: SLUGS,
          pagesSlug: PAGES_SLUG,
          store: fence(),
          warn: () => {},
          now: () => new Date(Date.now() + 10 * 60_000),
        });

        const restored = await restoredOnes();
        expect(restored).toHaveLength(1);
        expect((await settingsOf(t)).defaultLayout).toBe(
          relationId(restored[0])
        );
        expect(await fence().removalOf(other)).toMatchObject({
          step: "removed",
          copy: null,
        });
      });

      it("falls back to the seed when the Layout a stopped restore recorded was deleted since", async () => {
        const t = await boot();
        const seed = String((await settingsOf(t)).seededLayout);
        const other = await layout(t, "Other", "other");
        await deletedThenStopped(t, other);
        await writeLayoutSettings(
          t.nextly,
          SLUGS,
          await readLayoutSettings(t.nextly, SLUGS),
          { defaultLayout: other }
        );
        const restoredOnes = async () =>
          (
            await t.nextly.find({
              collection: LAYOUTS_SLUG,
              where: { title: { equals: "Other" } },
              status: "all",
              limit: 10,
              depth: 0,
              overrideAccess: true,
            })
          ).items.filter(row => relationId(row) !== other);
        // The first repair stops once the restored Layout is created and
        // recorded, before it points the default at it.
        let stopped = false;
        t.hooks.register(
          "afterRead",
          `single:${PAGE_BUILDER_SETTINGS_SLUG}`,
          async () => {
            if (stopped || (await restoredOnes()).length === 0) return;
            stopped = true;
            throw new Error("the process stopped");
          }
        );
        await expect(ensure(t)).rejects.toThrow();
        const recorded = (await fence().removalOf(other))?.copy?.restoredAs;
        expect(recorded).toBeDefined();
        // The restored Layout is deleted before anything resumes, past every
        // hook.
        await t.adapter.delete(await tableOf(t, LAYOUTS_SLUG), {
          and: [{ column: "id", op: "=", value: recorded }],
        });

        expect(await ensure(t)).toBe("repointed");

        expect((await settingsOf(t)).defaultLayout).toBe(seed);
        expect(await fence().removalOf(other)).toMatchObject({
          step: "removed",
          copy: null,
        });
      });

      it("falls back to the seed when the Layout a stopped restore recorded was unpublished since", async () => {
        const t = await boot();
        const seed = String((await settingsOf(t)).seededLayout);
        const other = await layout(t, "Other", "other");
        await deletedThenStopped(t, other);
        await writeLayoutSettings(
          t.nextly,
          SLUGS,
          await readLayoutSettings(t.nextly, SLUGS),
          { defaultLayout: other }
        );
        const restoredOnes = async () =>
          (
            await t.nextly.find({
              collection: LAYOUTS_SLUG,
              where: { title: { equals: "Other" } },
              status: "all",
              limit: 10,
              depth: 0,
              overrideAccess: true,
            })
          ).items.filter(row => relationId(row) !== other);
        // The first repair stops once the restored Layout is created and
        // recorded, before it points the default at it.
        let stopped = false;
        t.hooks.register(
          "afterRead",
          `single:${PAGE_BUILDER_SETTINGS_SLUG}`,
          async () => {
            if (stopped || (await restoredOnes()).length === 0) return;
            stopped = true;
            throw new Error("the process stopped");
          }
        );
        await expect(ensure(t)).rejects.toThrow();
        const recorded = (await fence().removalOf(other))?.copy?.restoredAs;
        expect(recorded).toBeDefined();
        // The restored Layout is unpublished before anything resumes, past
        // every hook: it still exists, but can't be a default.
        await t.adapter.update(
          await tableOf(t, LAYOUTS_SLUG),
          { status: "draft" },
          { and: [{ column: "id", op: "=", value: recorded }] }
        );

        expect(await ensure(t)).toBe("repointed");

        expect((await settingsOf(t)).defaultLayout).toBe(seed);
        expect(await fence().removalOf(other)).toMatchObject({
          step: "removed",
          copy: null,
        });
      });

      it("falls back to the seed when the Layout a stopped restore recorded is unpublished after the resume checked it", async () => {
        const t = await boot();
        const seed = String((await settingsOf(t)).seededLayout);
        const other = await layout(t, "Other", "other");
        await deletedThenStopped(t, other);
        await writeLayoutSettings(
          t.nextly,
          SLUGS,
          await readLayoutSettings(t.nextly, SLUGS),
          { defaultLayout: other }
        );
        const restoredOnes = async () =>
          (
            await t.nextly.find({
              collection: LAYOUTS_SLUG,
              where: { title: { equals: "Other" } },
              status: "all",
              limit: 10,
              depth: 0,
              overrideAccess: true,
            })
          ).items.filter(row => relationId(row) !== other);
        // The first repair stops once the restored Layout is created and
        // recorded, before it points the default at it.
        let stopped = false;
        t.hooks.register(
          "afterRead",
          `single:${PAGE_BUILDER_SETTINGS_SLUG}`,
          async () => {
            if (stopped || (await restoredOnes()).length === 0) return;
            stopped = true;
            throw new Error("the process stopped");
          }
        );
        await expect(ensure(t)).rejects.toThrow();
        const recorded = (await fence().removalOf(other))?.copy?.restoredAs;
        expect(recorded).toBeDefined();
        // Another removal unpublishes the recorded Layout, past every hook,
        // right after the resume reads it as published: between the resume's
        // check and its write of the default.
        let unpublished = false;
        // A list read hands the hook every row it read.
        t.hooks.register("afterRead", LAYOUTS_SLUG, async context => {
          const rows = (context as { data?: unknown }).data;
          const readIt =
            Array.isArray(rows) &&
            rows.some(row => relationId(row) === recorded);
          if (unpublished || !readIt) return;
          unpublished = true;
          await t.adapter.update(
            await tableOf(t, LAYOUTS_SLUG),
            { status: "draft" },
            { and: [{ column: "id", op: "=", value: recorded }] }
          );
        });

        expect(await ensure(t)).toBe("repointed");

        expect(unpublished).toBe(true);
        expect((await settingsOf(t)).defaultLayout).toBe(seed);
        expect(await fence().removalOf(other)).toMatchObject({
          step: "removed",
          copy: null,
        });
      });

      it("settles a check after the write that stops at its page budget, which no later sweep would get past", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        for (const title of ["One", "Two", "Three"]) {
          await page(t, title, { status: "published" });
        }
        await deletedThenStopped(t, other);
        const warned: string[] = [];

        await settleLayoutRemovals({
          nextly: t.nextly,
          slugs: SLUGS,
          pagesSlug: PAGES_SLUG,
          store: fence(),
          warn: message => warned.push(message),
          now: () => new Date(Date.now() + 10 * 60_000),
          // Fewer page reads than the site has published pages.
          budget: 2,
        });

        expect((await fence().removalOf(other))?.settledAt).not.toBeNull();
        expect(warned.some(message => message.includes("budget"))).toBe(true);
      });

      it("has the default repair finish a restore that stopped after its create, before it would fall back to the seed", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        await deletedThenStopped(t, other);
        await writeLayoutSettings(
          t.nextly,
          SLUGS,
          await readLayoutSettings(t.nextly, SLUGS),
          { defaultLayout: other }
        );
        const restoredOnes = async () =>
          (
            await t.nextly.find({
              collection: LAYOUTS_SLUG,
              where: { title: { equals: "Other" } },
              status: "all",
              limit: 10,
              depth: 0,
              overrideAccess: true,
            })
          ).items.filter(row => relationId(row) !== other);
        // The first repair stops once the restored Layout is created and
        // recorded, before it points the default at it.
        let stopped = false;
        t.hooks.register(
          "afterRead",
          `single:${PAGE_BUILDER_SETTINGS_SLUG}`,
          async () => {
            if (stopped || (await restoredOnes()).length === 0) return;
            stopped = true;
            throw new Error("the process stopped");
          }
        );
        await expect(ensure(t)).rejects.toThrow();
        expect(stopped).toBe(true);

        // The next repair, as startup or the default job runs it, before any
        // sweep has found the row stale.
        expect(await ensure(t)).toBe("restored");

        const restored = await restoredOnes();
        expect(restored).toHaveLength(1);
        expect((await settingsOf(t)).defaultLayout).toBe(
          relationId(restored[0])
        );
        expect(await fence().removalOf(other)).toMatchObject({
          step: "removed",
          copy: null,
        });
      });

      it("keeps the copy when every address a restore could take is taken, and restores once one is free", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        await deletedThenStopped(t, other);
        // Every address the restore tries: the Layout's own, the numbered
        // ones after it, and the one named for its removal.
        const taken = [
          "other",
          "other-2",
          "other-3",
          "other-4",
          "other-5",
          "other-stopped0",
        ];
        const holders: string[] = [];
        for (const [at, slug] of taken.entries()) {
          holders.push(await layout(t, `Holder ${String(at)}`, slug));
        }
        await writeLayoutSettings(
          t.nextly,
          SLUGS,
          await readLayoutSettings(t.nextly, SLUGS),
          { defaultLayout: other }
        );

        await expect(ensure(t)).rejects.toThrow();
        await settleLayoutRemovals({
          nextly: t.nextly,
          slugs: SLUGS,
          pagesSlug: PAGES_SLUG,
          store: fence(),
          warn: () => {},
          now: () => new Date(Date.now() + 10 * 60_000),
        });

        const kept = await fence().removalOf(other);
        expect(kept?.copy).not.toBeNull();
        expect(kept?.settledAt).toBeNull();

        // An address comes free, and the next repair restores the Layout. Published
        // in the same write, so the live row moves rather than a working draft.
        await t.nextly.update({
          collection: LAYOUTS_SLUG,
          id: String(holders[0]),
          data: { slug: "elsewhere", status: "published", _overwrite: true },
          overrideAccess: true,
        });
        expect(await ensure(t)).toBe("restored");
        const restored = String((await settingsOf(t)).defaultLayout);
        expect(await layoutRow(t, restored)).toMatchObject({
          title: "Other",
          slug: "other",
        });
      });

      it("restores the default from the copy under a new id", async () => {
        const t = await boot();
        const other = await layout(t, "Other", "other");
        await deletedThenStopped(t, other);
        await writeLayoutSettings(
          t.nextly,
          SLUGS,
          await readLayoutSettings(t.nextly, SLUGS),
          { defaultLayout: other }
        );

        expect(await ensure(t)).toBe("restored");

        const restored = String((await settingsOf(t)).defaultLayout);
        expect(restored).not.toBe(other);
        expect(await layoutRow(t, restored)).toMatchObject({
          title: "Other",
          status: "published",
        });
        // Once: a second run finds a usable default and restores nothing.
        expect(await ensure(t)).toBe("kept");
      });

      it("keeps another plugin's fields on the Layout it restores", async () => {
        const t = await boot([taglinePlugin()]);
        const created = await t.nextly.create({
          collection: LAYOUTS_SLUG,
          data: {
            title: "Other",
            slug: "other",
            areas: [],
            status: "published",
            tagline: "Made for landing pages",
          },
          overrideAccess: true,
        });
        const other = String(created.item.id);
        await deletedThenStopped(t, other);
        await writeLayoutSettings(
          t.nextly,
          SLUGS,
          await readLayoutSettings(t.nextly, SLUGS),
          { defaultLayout: other }
        );

        expect(await ensure(t)).toBe("restored");

        const restored = String((await settingsOf(t)).defaultLayout);
        expect(await layoutRow(t, restored)).toMatchObject({
          title: "Other",
          tagline: "Made for landing pages",
          status: "published",
        });
      });

      it("never writes a copy over a Layout that still exists", async () => {
        const t = await boot();
        const seed = String((await settingsOf(t)).seededLayout);
        // An unpublished Layout whose delete removal stopped at its final
        // step, before the delete: its row holds a copy, and the Layout is
        // still there. The default names it, so the default is unusable.
        const other = await layout(t, "Other", "other", "draft");
        await stoppedAtFinal(t, other);
        await writeLayoutSettings(
          t.nextly,
          SLUGS,
          await readLayoutSettings(t.nextly, SLUGS),
          { defaultLayout: other }
        );
        const count = (
          await t.nextly.find({
            collection: LAYOUTS_SLUG,
            status: "all",
            limit: 50,
            overrideAccess: true,
          })
        ).items.length;

        expect(await ensure(t)).toBe("repointed");

        expect((await settingsOf(t)).defaultLayout).toBe(seed);
        expect(
          (
            await t.nextly.find({
              collection: LAYOUTS_SLUG,
              status: "all",
              limit: 50,
              overrideAccess: true,
            })
          ).items
        ).toHaveLength(count);
        expect(await layoutRow(t, other)).toMatchObject({
          title: "Other",
          status: "draft",
        });
      });
    });

    describe("moving the pages to the site default first", () => {
      /** One tick of a move, as the dialog sends it. */
      const tick = (
        cookie: string,
        id: string,
        body: Record<string, unknown>
      ) =>
        post(cookie, ["layouts", id, "remove"], {
          action: "delete",
          move: true,
          ...body,
        });

      /** A move's progress, from a tick's answer. */
      function progressOf(answer: Answer): Record<string, unknown> {
        const item = answer.body.item as { move?: Record<string, unknown> };
        if (item.move === undefined) {
          throw new Error(`no move in ${JSON.stringify(answer.body)}`);
        }
        return item.move;
      }

      /** Tick until the move leaves `moving`; answers the last progress. */
      async function runMove(
        cookie: string,
        id: string,
        action: "delete" | "unpublish" = "delete"
      ): Promise<Record<string, unknown>> {
        let body: Record<string, unknown> = { action };
        for (let i = 0; i < 20; i += 1) {
          const answer = await tick(cookie, id, body);
          expect(answer.status, JSON.stringify(answer.body)).toBe(200);
          const move = progressOf(answer);
          if (move.state !== "moving") return move;
          body = { action, token: move.token, after: move.after };
        }
        throw new Error("the move never finished");
      }

      /** The Layout a page names: its working draft's, else its row's. */
      async function pageLayout(t: TestNextly, id: string): Promise<unknown> {
        const read = await t.nextly.findByID({
          collection: PAGES_SLUG,
          id,
          draft: true,
          depth: 0,
          overrideAccess: true,
        });
        return relationId(read?.layout);
      }

      /** The Layout a published page's live row names. */
      async function liveLayout(t: TestNextly, id: string): Promise<unknown> {
        const found = await t.nextly.find({
          collection: PAGES_SLUG,
          where: { id: { equals: id } },
          status: "published",
          limit: 1,
          depth: 0,
          overrideAccess: true,
        });
        return relationId(
          (found.items[0] as { layout?: unknown } | undefined)?.layout
        );
      }

      /** `count` unpublished pages on `layoutId`. */
      async function unpublishedPages(
        t: TestNextly,
        layoutId: string,
        count: number
      ): Promise<string[]> {
        const ids: string[] = [];
        for (let i = 0; i < count; i += 1) {
          ids.push(
            await page(t, `Draft ${String(i)}`, {
              layout: layoutId,
              status: "draft",
            })
          );
        }
        return ids;
      }

      /** Give `userId` a role holding exactly the permissions `slugs`. */
      async function grant(
        t: TestNextly,
        userId: string,
        slugs: readonly string[]
      ): Promise<void> {
        const permissions = await t.nextly.permissions.find({ limit: 500 });
        const granted = permissions.items.filter(p => slugs.includes(p.slug));
        expect(granted).toHaveLength(slugs.length);
        const role = await t.nextly.roles.create({
          data: {
            name: `Role of ${userId}`,
            slug: `role-${userId}`.toLowerCase().slice(0, 60),
            permissionIds: granted.map(p => p.id),
          },
        });
        const assigned = await new ServiceContainer(
          t.adapter
        ).userRoles.assignRoleToUser(userId, role.item.id);
        expect(assigned.success).toBe(true);
      }

      /** The sweep, as the jobs pass runs it, judged once the lease is past. */
      const sweepLate = (t: TestNextly) =>
        settleLayoutRemovals({
          nextly: t.nextly,
          slugs: SLUGS,
          pagesSlug: PAGES_SLUG,
          store: fence(),
          warn: () => {},
          now: () => new Date(Date.now() + REMOVAL_LEASE_MS + 60_000),
        });

      it("moves unpublished pages and working drafts, leaves live rows, and deletes the Layout", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        const drafts = await unpublishedPages(t, other, 2);
        const live = await page(t, "Live", {
          layout: other,
          status: "published",
        });
        const edited = await page(t, "Edited", {
          layout: other,
          status: "published",
        });
        // A save without a status: the working draft names it beside the live row.
        await t.nextly.update({
          collection: PAGES_SLUG,
          id: edited,
          data: { title: "Edited again", _overwrite: true },
          overrideAccess: true,
        });

        const last = await runMove(cookie, other);

        expect(last.state).toBe("done");
        expect(await layoutRow(t, other)).toBeUndefined();
        for (const id of drafts) expect(await pageLayout(t, id)).toBeNull();
        expect(await pageLayout(t, edited)).toBeNull();
        // Live rows are left; they draw the site default now it is gone.
        expect(await liveLayout(t, edited)).toBe(other);
        expect(await liveLayout(t, live)).toBe(other);
        expect(await fence().removalOf(other)).toMatchObject({
          step: "removed",
          pagesLeft: 0,
        });
      });

      it("clears the deleted Layout from a published page's live row when the page is next published", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        const kept = await layout(t, "Kept", "kept");
        const hidden = await layout(t, "Hidden", "hidden", "draft");
        const live = await page(t, "Live", {
          layout: other,
          status: "published",
        });
        const resent = await page(t, "Resent", {
          layout: other,
          status: "published",
        });
        const onKept = await page(t, "On kept", {
          layout: kept,
          status: "published",
        });
        const onHidden = await page(t, "On hidden", {
          layout: hidden,
          status: "published",
        });

        expect((await runMove(cookie, other)).state).toBe("done");
        expect(await layoutRow(t, other)).toBeUndefined();
        // The live rows still name it until the pages are published again.
        expect(await liveLayout(t, live)).toBe(other);
        expect(await liveLayout(t, resent)).toBe(other);

        const publish = (id: string, data: Record<string, unknown>) =>
          t.nextly.update({
            collection: PAGES_SLUG,
            id,
            data: { ...data, status: "published", _overwrite: true },
            overrideAccess: true,
          });
        // A publish that leaves the Layout out, and one that sends the stored
        // choice back, as a form holding the whole page does.
        await publish(live, { title: "Live again" });
        await publish(resent, { layout: other });
        await publish(onKept, { title: "On kept again" });
        await publish(onHidden, { title: "On hidden again" });

        expect(await liveLayout(t, live)).toBeNull();
        expect(await liveLayout(t, resent)).toBeNull();
        // The controls: a Layout that exists stays chosen, published or not.
        expect(await liveLayout(t, onKept)).toBe(kept);
        expect(await liveLayout(t, onHidden)).toBe(hidden);
      });

      it("moves the pages and then unpublishes the Layout", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        const [draft] = await unpublishedPages(t, other, 1);
        const live = await page(t, "Live", {
          layout: other,
          status: "published",
        });

        const last = await runMove(cookie, other, "unpublish");

        expect(last.state).toBe("done");
        expect((await layoutRow(t, other))?.status).toBe("draft");
        expect(await pageLayout(t, String(draft))).toBeNull();
        expect(await liveLayout(t, live)).toBe(other);
        expect(await fence().removalOf(other)).toMatchObject({
          step: "removed",
          action: "unpublish",
        });
      });

      it("keeps the Layout and every page moved when the dialog goes away, and finishes when started again", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        const ids = await unpublishedPages(t, other, PAGES_PER_TICK + 2);

        const first = progressOf(await tick(cookie, other, {}));
        expect(first).toMatchObject({ state: "moving", moved: PAGES_PER_TICK });
        // The dialog closed: no more ticks, and the lease lapses.
        await sweepLate(t);

        expect(await fence().removalOf(other)).toBeNull();
        expect(await layoutRow(t, other)).toBeDefined();
        const moved = [];
        for (const id of ids) {
          if ((await pageLayout(t, id)) === null) moved.push(id);
        }
        expect(moved).toHaveLength(PAGES_PER_TICK);
        // A late tick of the lapsed move writes nothing.
        const late = progressOf(
          await tick(cookie, other, { token: first.token, after: first.after })
        );
        expect(late.state).toBe("stopped");

        const resumed = await runMove(cookie, other);

        expect(resumed).toMatchObject({ state: "done", moved: 2 });
        expect(await layoutRow(t, other)).toBeUndefined();
      });

      it("refuses a new reference to the Layout while its pages move", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        await unpublishedPages(t, other, PAGES_PER_TICK + 1);
        const first = progressOf(await tick(cookie, other, {}));
        expect(first.state).toBe("moving");

        const added = await refusalOf(
          page(t, "Newcomer", { layout: other, status: "draft" })
        );

        expect(JSON.stringify(added)).toContain(pageLayoutRefusal("removing"));
      });

      it("refuses a second person's move while the first runs", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        await unpublishedPages(t, other, PAGES_PER_TICK + 1);
        const first = progressOf(await tick(cookie, other, {}));
        expect(first.state).toBe("moving");
        const secondId = await person(t, "second");
        // A person who may remove Layouts and edit pages, but did not start it.
        await grant(t, secondId, [
          "read-layouts",
          "delete-layouts",
          "read-pages",
          "update-pages",
        ]);
        const second = await sessionOf(t, secondId);

        const started = await tick(second, other, {});
        const continued = await tick(second, other, {
          token: first.token,
          after: first.after,
        });

        expect(started.status).toBe(409);
        expect(told(started)).toBe(ALREADY_BEING_REMOVED);
        expect(continued.status).toBe(409);
        expect(await fence().removalOf(other)).toMatchObject({
          step: "moving",
          token: first.token,
        });
      });

      it("leaves the pages a person may not edit, names them with why, and keeps the Layout", async () => {
        const t = await boot();
        await owner(t);
        const reader = await person(t, "reader");
        const other = await layout(t, "Other", "other");
        const [draft] = await unpublishedPages(t, other, 1);
        // May remove Layouts and read pages, but not edit them.
        await grant(t, reader, [
          "read-layouts",
          "delete-layouts",
          "read-pages",
        ]);

        const last = await runMove(await sessionOf(t, reader), other);

        expect(last).toMatchObject({
          state: "refused",
          moved: 0,
          pages: [{ id: draft, title: "Draft 0", reason: CANT_EDIT_PAGE }],
          unreadable: 0,
          complete: true,
        });
        expect(await layoutRow(t, other)).toBeDefined();
        expect(await pageLayout(t, String(draft))).toBe(other);
        expect(await fence().removalOf(other)).toBeNull();
      });

      it("refuses a person who may edit pages but not remove the Layout, before any page moves", async () => {
        const t = await boot();
        await owner(t);
        const editor = await person(t, "editor");
        const other = await layout(t, "Other", "other");
        const [draft] = await unpublishedPages(t, other, 1);
        // May edit every page, but may neither delete nor unpublish Layouts.
        await grant(t, editor, [
          "read-layouts",
          "update-layouts",
          "read-pages",
          "update-pages",
        ]);
        const session = await sessionOf(t, editor);

        const deleting = await tick(session, other, {});
        const unpublishing = await tick(session, other, {
          action: "unpublish",
        });

        expect(deleting.status).toBe(403);
        expect(unpublishing.status).toBe(403);
        expect(await pageLayout(t, String(draft))).toBe(other);
        expect(await layoutRow(t, other)).toBeDefined();
        expect(await fence().removalOf(other)).toBeNull();
      });

      it("keeps another author's newer Layout choice over a clear that read the page before it", async () => {
        const t = await boot();
        await owner(t);
        const other = await layout(t, "Other", "other");
        const chosen = await layout(t, "Chosen", "chosen");
        const [page] = await unpublishedPages(t, other, 1);
        // Another author picks a Layout after the clear read "Other".
        await t.nextly.update({
          collection: PAGES_SLUG,
          id: String(page),
          data: { layout: chosen, _overwrite: true },
          overrideAccess: true,
        });

        // The clear's own write, carrying the Layout it read.
        const stale = await refusalOf(
          t.nextly.update({
            collection: PAGES_SLUG,
            id: String(page),
            data: { layout: null, _overwrite: true },
            context: { [LAYOUT_CLEAR_CONTEXT_KEY]: other },
            overrideAccess: true,
          })
        );

        expect(stale).toBeDefined();
        expect(await pageLayout(t, String(page))).toBe(chosen);
        // The positive control: a clear that read what the page names now.
        await t.nextly.update({
          collection: PAGES_SLUG,
          id: String(page),
          data: { layout: null, _overwrite: true },
          context: { [LAYOUT_CLEAR_CONTEXT_KEY]: chosen },
          overrideAccess: true,
        });
        expect(await pageLayout(t, String(page))).toBeNull();
      });

      it("leaves plain Remove Layout as strict as before: a live row alone still refuses it", async () => {
        const t = await boot();
        const { cookie } = await owner(t);
        const other = await layout(t, "Other", "other");
        await page(t, "Live", { layout: other, status: "published" });

        const answer = await remove(cookie, other, "delete");

        expect(answer.status).toBe(409);
        expect(told(answer)).toBe(
          '1 page uses this Layout: "Live". Choose another Layout for it first.'
        );
        expect(await layoutRow(t, other)).toBeDefined();
      });
    });
  }
);
