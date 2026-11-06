/**
 * Shared styles over HTTP and the Direct API, on a real site: a locked style
 * holds for every Design manager without the lock permission, a lock moves and
 * a style leaves only through their own routes, usage counts gated content and
 * says when it is a floor, where-used names only what the caller may read,
 * removal reads the stored pages again rather than trusting an index zero,
 * and a page may not add a reference to a style the site does not define.
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type { PluginDefinition } from "@nextlyhq/plugin-sdk";
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

import { CLASS_USAGE_INDEX_SLUG } from "../collections/class-usage-index";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import { SITE_STYLE_SLUG } from "../site-style-storage";
import { USAGE_BACKFILL_JOB } from "../usage-backfill-job";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

const card = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: { base: { base: { color: "#111111" } } },
};
const hero = {
  id: "c-hero",
  slug: "hero",
  orderIndex: 1,
  styles: { base: { base: { color: "#222222" } } },
};
const spare = {
  id: "c-spare",
  slug: "spare",
  orderIndex: 2,
  styles: { base: { base: { color: "#333333" } } },
};

type Node = Record<string, unknown>;

const text = (id: string, extra: Node = {}): Node => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
  ...extra,
});

const pageOf = (nodes: Node[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** A page whose only use of `classId` sits on a node a condition gates. */
const gatedUse = (classId: string) =>
  pageOf([
    text("always"),
    text("gated", {
      classes: [classId],
      visibility: {
        conditions: [[{ field: "title", op: "eq", value: "Nobody" }]],
      },
    }),
  ]);

/** The plugin's own backfill job, as it contributes it. */
function backfillTick(plugin: PluginDefinition): () => Promise<unknown> {
  const job = plugin.contributes?.jobs?.find(
    entry => entry.slug === USAGE_BACKFILL_JOB
  );
  if (job === undefined) throw new Error("the page builder has no backfill");
  return async () =>
    job.handler(
      null as never,
      {
        user: null,
        now: new Date(),
        deadline: new Date(Date.now() + 60_000),
        content: {},
      } as never
    );
}

describe.each(getConfiguredTestDialects())(
  "shared styles (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** A site storing `card` (locked), `hero` and `spare`, set as the system. */
    async function boot() {
      const plugin = pageBuilder();
      current = await createTestNextly({
        dialect,
        plugins: [plugin],
        seedPublic: true,
      });
      const t = current;
      // The site's first user is its owner, granted everything. Made first, so
      // every person below holds only what the test gives them.
      await t.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      // As nobody, which the Single's guard trusts: a lock set here is the
      // fixture, not the behaviour under test.
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          classes: [{ ...card, locked: true }, hero, spare],
          _overwrite: true,
        },
        overrideAccess: true,
      });
      return { t, tick: backfillTick(plugin) };
    }

    let people = 0;
    let roles = 0;

    /** A signed-in person holding exactly the permissions named. */
    async function holding(t: TestNextly, ...slugs: string[]): Promise<string> {
      people += 1;
      const created = await t.nextly.users.create({
        email: `styles-${people}@example.com`,
        password: "Password123!",
        data: { name: `Person ${people}`, isActive: true },
      });
      const userId = created.item.id;
      const permissions = await t.nextly.permissions.find({ limit: 500 });
      const ids = slugs.map(slug => {
        const found = permissions.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      roles += 1;
      const role = await t.nextly.roles.create({
        data: {
          name: `Styles ${roles}`,
          slug: `s-${roles}`,
          permissionIds: ids,
        },
      });
      const assigned = await new ServiceContainer(
        t.adapter
      ).userRoles.assignRoleToUser(userId, role.item.id);
      expect(assigned.success).toBe(true);
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
      path: string,
      cookie: string,
      body?: unknown
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const [pathname, query] = path.split("?");
      const params = (pathname ?? "").split("/").filter(Boolean);
      const response = await createDynamicHandlers()[method](
        new Request(
          `${ORIGIN}/api/${params.join("/")}${query === undefined ? "" : `?${query}`}`,
          {
            method,
            headers: {
              cookie: `${cookie}; nextly_csrf=${CSRF}`,
              "x-csrf-token": CSRF,
              origin: ORIGIN,
              "content-type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }
        ),
        { params: Promise.resolve({ params }) }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
      };
    }

    const route = (sub: string) =>
      `plugins/${PAGE_BUILDER_PLUGIN_NAME}/shared-styles/${sub}`;
    const SINGLE = `singles/${SITE_STYLE_SLUG}`;

    /** The stored class list, read as the system. */
    async function stored(t: TestNextly): Promise<Record<string, unknown>[]> {
      const doc = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as Record<string, unknown> | null;
      const raw = doc?.classes;
      const list = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
      return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
    }

    const lockedCard = { ...card, locked: true };
    const DESIGN = ["read-site-style", "update-site-style"];

    it("holds a locked style against a Design manager without the lock permission", async () => {
      const { t } = await boot();
      const designer = await holding(t, ...DESIGN);
      const writes = [
        // A property change, a rename, and a removal.
        [
          { ...lockedCard, styles: { base: { base: { color: "#ff0000" } } } },
          hero,
          spare,
        ],
        [{ ...lockedCard, slug: "promo" }, hero, spare],
        [hero, spare],
      ];
      for (const classes of writes) {
        const answer = await call("PATCH", SINGLE, designer, {
          classes,
          _overwrite: true,
        });
        expect(answer.status).toBe(409);
        expect(JSON.stringify(answer.body)).toContain(
          "Card is locked, so it can't be changed, renamed or removed. Unlock it first."
        );
      }
      const unlock = await call("POST", route("lock"), designer, {
        classId: "c-card",
        locked: false,
      });
      expect(unlock.status).toBe(403);
      expect(await stored(t)).toEqual([lockedCard, hero, spare]);
    });

    it("lets a manager holding the lock permission unlock, change and lock again", async () => {
      const { t } = await boot();
      const keeper = await holding(
        t,
        ...DESIGN,
        "lock-page-builder-shared-styles"
      );
      const unlock = await call("POST", route("lock"), keeper, {
        classId: "c-card",
        locked: false,
      });
      expect(unlock.status).toBe(200);
      const red = { ...card, styles: { base: { base: { color: "#ff0000" } } } };
      const change = await call("PATCH", SINGLE, keeper, {
        classes: [red, hero, spare],
        _overwrite: true,
      });
      expect(change.status).toBe(200);
      const lock = await call("POST", route("lock"), keeper, {
        classId: "c-card",
        locked: true,
      });
      expect(lock.status).toBe(200);
      expect(await stored(t)).toEqual([{ ...red, locked: true }, hero, spare]);
    });

    it("moves a lock through its route with the lock permission alone, and through no other write", async () => {
      const { t } = await boot();
      const lockOnly = await holding(t, "lock-page-builder-shared-styles");
      expect(
        (
          await call("POST", route("lock"), lockOnly, {
            classId: "c-hero",
            locked: true,
          })
        ).status
      ).toBe(200);
      const designer = await holding(t, ...DESIGN);
      const flip = await call("PATCH", SINGLE, designer, {
        classes: [
          lockedCard,
          { ...hero, locked: true },
          { ...spare, locked: true },
        ],
        _overwrite: true,
      });
      expect(flip.status).toBe(400);
      expect(JSON.stringify(flip.body)).toContain(
        "A shared style is locked and unlocked with its own action"
      );
      expect((await stored(t)).map(entry => entry.locked === true)).toEqual([
        true,
        true,
        false,
      ]);
    });

    it("lets a signed-in write remove an unlocked style, as undo does, but never a locked one", async () => {
      const { t } = await boot();
      const designer = await holding(t, ...DESIGN);
      // Undoing a style just made writes the section back without it.
      const undone = await call("PATCH", SINGLE, designer, {
        classes: [lockedCard, hero],
        _overwrite: true,
      });
      expect(undone.status).toBe(200);
      expect((await stored(t)).map(entry => entry.id)).toEqual([
        "c-card",
        "c-hero",
      ]);
      const dropped = await call("PATCH", SINGLE, designer, {
        classes: [hero],
        _overwrite: true,
      });
      expect(dropped.status).toBe(409);
      expect((await stored(t)).map(entry => entry.id)).toEqual([
        "c-card",
        "c-hero",
      ]);
    });

    it("counts a style used only inside gated content, as a floor until the index is whole", async () => {
      const { t, tick } = await boot();
      await t.nextly.create({
        collection: "pages",
        data: { title: "Gated", slug: "gated", content: gatedUse("c-hero") },
        overrideAccess: true,
      });
      const reader = await holding(t, "read-site-style");
      const ask = async () =>
        (await call("GET", `${route("usage")}?id=c-hero&id=c-spare`, reader))
          .body;
      expect(await ask()).toMatchObject({
        whole: false,
        mayLock: false,
        styles: {
          "c-hero": {
            documents: 1,
            byKind: { pages: 1, components: 0, patterns: 0, layouts: 0 },
            complete: false,
          },
          "c-spare": { documents: 0, complete: false },
        },
      });
      await tick();
      expect(await ask()).toMatchObject({
        whole: true,
        styles: {
          "c-hero": { documents: 1, complete: true },
          "c-spare": { documents: 0, complete: true },
        },
      });
    });

    it("names where a style is used only to a caller who may read the page", async () => {
      const { t } = await boot();
      await t.nextly.create({
        collection: "pages",
        data: { title: "Home", slug: "home", content: gatedUse("c-hero") },
        overrideAccess: true,
      });
      const where = `${route("where-used")}?id=c-hero`;
      const pageReader = await holding(t, "read-site-style", "read-pages");
      const named = await call("GET", where, pageReader);
      expect(named.status).toBe(200);
      expect(named.body).toMatchObject({
        items: [{ title: "Home", collection: "pages", kind: "pages" }],
        meta: { total: 1, hiddenCount: 0 },
      });
      const styleReader = await holding(t, "read-site-style");
      const hidden = await call("GET", where, styleReader);
      expect(hidden.body).toMatchObject({
        items: [],
        meta: { total: 0, hiddenCount: 1 },
      });
    });

    it("removes an unused style only once the index is whole, and never a used one", async () => {
      const { t, tick } = await boot();
      await t.nextly.create({
        collection: "pages",
        data: { title: "Gated", slug: "gated", content: gatedUse("c-hero") },
        overrideAccess: true,
      });
      const designer = await holding(t, ...DESIGN);
      const remove = (ids: string[]) =>
        call("POST", route("remove"), designer, { ids });

      const early = await remove(["c-spare"]);
      expect(early.status).toBe(409);
      expect(JSON.stringify(early.body)).toContain(
        "Some pages haven't been counted yet, so no shared style can be removed."
      );

      await tick();
      // CONTROL: the index now reads as whole, so what follows is the count's
      // answer and not a site that never could be.
      const usage = await call("GET", `${route("usage")}?id=c-spare`, designer);
      expect(usage.body).toMatchObject({ whole: true });

      const used = await remove(["c-hero", "c-spare"]);
      // The in-use refusal, whichever check found the use.
      expect(used.status).toBe(400);
      expect(JSON.stringify(used.body)).toContain('"code":"IN_USE"');
      expect(JSON.stringify(used.body)).toContain(
        "hero is used on 1 document."
      );
      expect(await stored(t)).toHaveLength(3);

      const locked = await remove(["c-card"]);
      expect(locked.status).toBe(409);

      const unused = await remove(["c-spare"]);
      expect(unused.status).toBe(200);
      expect((await stored(t)).map(entry => entry.id)).toEqual([
        "c-card",
        "c-hero",
      ]);
    });

    it("counts the pages now for a Design manager, with no scheduler, and refuses a reader", async () => {
      // No `tick`: nothing drains the queue in this run, as on a site with no
      // scheduler, so only the count route can make the index whole.
      const { t } = await boot();
      await t.nextly.create({
        collection: "pages",
        data: { title: "Gated", slug: "gated", content: gatedUse("c-hero") },
        overrideAccess: true,
      });
      const designer = await holding(t, ...DESIGN);
      const reader = await holding(t, "read-site-style");
      const usage = (cookie: string) =>
        call("GET", `${route("usage")}?id=c-hero`, cookie);

      // CONTROL: not whole before, and the panel is told who may count.
      expect((await usage(designer)).body).toMatchObject({
        whole: false,
        counting: true,
        mayCount: true,
      });
      expect((await usage(reader)).body).toMatchObject({ mayCount: false });

      const refused = await call("POST", route("count"), reader, {});
      expect(refused.status).toBe(403);
      expect((await usage(designer)).body).toMatchObject({ whole: false });

      const counted = await call("POST", route("count"), designer, {});
      expect(counted.status).toBe(200);
      expect(counted.body).toMatchObject({
        item: { ran: true, whole: true, counting: false },
      });
      expect((await usage(designer)).body).toMatchObject({
        whole: true,
        styles: { "c-hero": { documents: 1, complete: true } },
      });
    });

    it("reads usage with the lock permission alone, and refuses a caller holding neither", async () => {
      const { t } = await boot();
      const usage = `${route("usage")}?id=c-hero`;
      const lockOnly = await holding(t, "lock-page-builder-shared-styles");
      const locker = await call("GET", usage, lockOnly);
      expect(locker.status).toBe(200);
      expect(locker.body).toMatchObject({
        mayLock: true,
        styles: { "c-hero": { documents: 0 } },
      });
      expect(
        (await call("GET", `${route("where-used")}?id=c-hero`, lockOnly)).status
      ).toBe(200);

      const pageReader = await holding(t, "read-pages");
      expect((await call("GET", usage, pageReader)).status).toBe(403);
      expect(
        (await call("GET", `${route("where-used")}?id=c-hero`, pageReader))
          .status
      ).toBe(403);
    });

    it("refuses removing a style a stored page still uses though the index counts none", async () => {
      const { t, tick } = await boot();
      await t.nextly.create({
        collection: "pages",
        data: {
          title: "Home",
          slug: "home",
          content: pageOf([text("a", { classes: ["c-spare"] })]),
        },
        overrideAccess: true,
      });
      await tick();
      // The row two interleaved saves can lose, lost here directly.
      const rows = await t.nextly.find({
        collection: CLASS_USAGE_INDEX_SLUG,
        where: { classId: { equals: "c-spare" } },
        limit: 100,
        overrideAccess: true,
      });
      expect(rows.items.length).toBeGreaterThan(0);
      for (const row of rows.items) {
        await t.nextly.delete({
          collection: CLASS_USAGE_INDEX_SLUG,
          id: String((row as { id: unknown }).id),
          overrideAccess: true,
        });
      }
      const designer = await holding(t, ...DESIGN, "read-pages");
      // CONTROL: the index is whole and counts the style on nothing, so the
      // refusal below comes from the stored page and not from the index.
      const usage = await call("GET", `${route("usage")}?id=c-spare`, designer);
      expect(usage.body).toMatchObject({
        whole: true,
        styles: { "c-spare": { documents: 0, complete: true } },
      });

      const refused = await call("POST", route("remove"), designer, {
        ids: ["c-spare"],
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain(
        "Still used on Home. Remove it from that page first."
      );
      expect((await stored(t)).map(entry => entry.id)).toContain("c-spare");

      // A designer who may not read the page is told how many, never which.
      const blind = await holding(t, ...DESIGN);
      const unnamed = await call("POST", route("remove"), blind, {
        ids: ["c-spare"],
      });
      expect(unnamed.status).toBe(400);
      expect(JSON.stringify(unnamed.body)).toContain(
        "Still used on 1 page you can't open."
      );
      expect(JSON.stringify(unnamed.body)).not.toContain("Home");
    });

    it("refuses a page that adds a class the site does not define, and keeps one it already held", async () => {
      const { t } = await boot();
      const added = t.nextly.create({
        collection: "pages",
        data: {
          title: "New",
          slug: "new",
          content: pageOf([text("a", { classes: ["c-missing"] })]),
        },
        overrideAccess: true,
      });
      await expect(added).rejects.toMatchObject({
        publicData: {
          errors: [expect.objectContaining({ code: "unknown-class" })],
        },
      });

      // A page holding `spare`, which a trusted write then removes from the
      // library: the page's reference is now to a class the site lacks.
      const created = await t.nextly.create({
        collection: "pages",
        data: {
          title: "Old",
          slug: "old",
          content: pageOf([text("a", { classes: ["c-spare"] })]),
        },
        overrideAccess: true,
      });
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: { classes: [lockedCard, hero], _overwrite: true },
        overrideAccess: true,
      });
      const kept = await t.nextly.update({
        collection: "pages",
        id: String(created.item.id),
        data: {
          title: "Old, renamed",
          content: pageOf([text("a", { classes: ["c-spare"] })]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      expect(kept.item).toMatchObject({ title: "Old, renamed" });
    });
  }
);
