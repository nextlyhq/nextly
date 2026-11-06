/**
 * Variables over HTTP, on a real site: the usage read counts the pages and
 * shared styles naming a variable, and says when it is a floor; a variable in
 * use is refused removal on the remove route and on a whole-section write of
 * the site style alike; the stored pages are read again rather than an index
 * zero trusted; once nothing uses it, it is removed; and a page may not add a
 * reference to a variable the site does not define.
 */

import { randomUUID } from "node:crypto";

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

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import { SITE_STYLE_SLUG } from "../site-style-storage";
import { USAGE_BACKFILL_JOB } from "../usage-backfill-job";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
/** Where the variable usage index's rows live. */
const TOKEN_ROWS = "page_builder__token_usage";
/** Where the usage backfill records its run. */
const RUNS = "page_builder__usage_runs";

/** A colour variable the site added, by id. */
const variable = (id: string, label: string) => ({
  id,
  name: `color.${id.replace(/^t-/, "")}`,
  label,
  kind: "color",
  values: { light: "#123456" },
});
const accent = variable("t-accent", "Accent");
const styled = variable("t-styled", "Styled");
const spare = variable("t-spare", "Spare");

/** A shared style whose own colour is `styled`. */
const card = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: { base: { base: { color: { $token: "t-styled" } } } },
};

/** A page whose one heading's colour names `identity`, or nothing. */
const pageUsing = (identity?: string) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "a",
      type: "core/heading",
      version: 1,
      props: { text: "a", level: 2 },
      ...(identity === undefined
        ? {}
        : { styles: { base: { base: { color: { $token: identity } } } } }),
    },
  ],
});

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
  "variables (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** A site storing three variables and a shared style naming one. */
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
      // As nobody, which the Single's guard trusts: the fixture, not the
      // behaviour under test.
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          tokens: { tokens: [accent, styled, spare] },
          classes: [card],
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
        email: `variables-${people}@example.com`,
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
          name: `Variables ${roles}`,
          slug: `v-${roles}`,
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
      `plugins/${PAGE_BUILDER_PLUGIN_NAME}/variables/${sub}`;
    const SINGLE = `singles/${SITE_STYLE_SLUG}`;
    const DESIGN = ["read-site-style", "update-site-style"];

    /** The stored variables' ids, read as the system. */
    async function storedIds(t: TestNextly): Promise<string[]> {
      const doc = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as Record<string, unknown> | null;
      const raw = doc?.tokens;
      const section = (typeof raw === "string" ? JSON.parse(raw) : raw) as
        | { tokens?: { id?: string }[] }
        | undefined;
      return (section?.tokens ?? []).map(entry => String(entry.id));
    }

    it("counts a variable's pages and shared styles, as a floor until every page is counted", async () => {
      const { t, tick } = await boot();
      await t.nextly.create({
        collection: "pages",
        data: { title: "Home", slug: "home", content: pageUsing("t-accent") },
        overrideAccess: true,
      });
      const reader = await holding(t, "read-site-style", "read-pages");
      const usage = `${route("usage")}?id=t-accent&id=t-styled&id=t-spare`;

      const early = await call("GET", usage, reader);
      expect(early.status).toBe(200);
      expect(early.body).toMatchObject({
        whole: false,
        mayCount: false,
        variables: { "t-accent": { documents: 1, complete: false } },
      });

      await tick();
      expect((await call("GET", usage, reader)).body).toMatchObject({
        whole: true,
        variables: {
          "t-accent": {
            documents: 1,
            byKind: { pages: 1, components: 0, patterns: 0, layouts: 0 },
            sharedStyles: [],
            complete: true,
          },
          "t-styled": { documents: 0, sharedStyles: ["c-card"] },
          "t-spare": { documents: 0, sharedStyles: [], complete: true },
        },
      });

      // Where it is used: the shared style first, then the readable pages.
      const where = await call(
        "GET",
        `${route("where-used")}?id=t-styled`,
        reader
      );
      expect(where.body).toMatchObject({
        items: [
          {
            id: "c-card",
            title: "Card",
            collection: SITE_STYLE_SLUG,
            kind: "shared-style",
          },
        ],
        meta: { total: 1, hiddenCount: 0 },
      });
      const home = await call(
        "GET",
        `${route("where-used")}?id=t-accent`,
        reader
      );
      expect(home.body).toMatchObject({
        items: [{ title: "Home", collection: "pages", kind: "pages" }],
      });

      // A caller who may not read Design is refused the counts.
      const outsider = await holding(t, "read-pages");
      expect((await call("GET", usage, outsider)).status).toBe(403);
    });

    it("refuses removing a variable in use on every path, and removes it once nothing uses it", async () => {
      const { t, tick } = await boot();
      const created = await t.nextly.create({
        collection: "pages",
        data: { title: "Home", slug: "home", content: pageUsing("t-accent") },
        overrideAccess: true,
      });
      const designer = await holding(t, ...DESIGN);
      const remove = (ids: string[]) =>
        call("POST", route("remove"), designer, { ids });

      const early = await remove(["t-spare"]);
      expect(early.status).toBe(409);
      expect(JSON.stringify(early.body)).toContain(
        "Some pages haven't been counted yet, so no variable can be removed."
      );

      await tick();
      // CONTROL: the index now reads as whole, so what follows is the count's
      // answer and not a site that never could be.
      const usage = await call("GET", `${route("usage")}?id=t-spare`, designer);
      expect(usage.body).toMatchObject({ whole: true });

      const onPage = await remove(["t-accent"]);
      expect(onPage.status).toBe(400);
      expect(JSON.stringify(onPage.body)).toContain('"code":"IN_USE"');
      expect(JSON.stringify(onPage.body)).toContain(
        "Accent is used on 1 document."
      );
      const byStyle = await remove(["t-styled"]);
      expect(byStyle.status).toBe(400);
      expect(JSON.stringify(byStyle.body)).toContain(
        "Styled is used by the shared style Card."
      );

      // The Variables panel's whole-section save, or an undo, dropping it.
      const section = await call("PATCH", SINGLE, designer, {
        tokens: { tokens: [styled, spare] },
        _overwrite: true,
      });
      expect(section.status).toBe(400);
      expect(JSON.stringify(section.body)).toContain('"code":"IN_USE"');
      expect(await storedIds(t)).toEqual(["t-accent", "t-styled", "t-spare"]);

      // CONTROL: the same save keeping every variable is not refused.
      const kept = await call("PATCH", SINGLE, designer, {
        tokens: { tokens: [{ ...accent, label: "Accent 2" }, styled, spare] },
        _overwrite: true,
      });
      expect(kept.status).toBe(200);

      // The page stops using it; its save updates the index.
      await t.nextly.update({
        collection: "pages",
        id: String(created.item.id),
        data: { content: pageUsing(), _overwrite: true },
        overrideAccess: true,
      });
      const gone = await remove(["t-accent", "t-spare"]);
      expect(gone.status).toBe(200);
      expect(await storedIds(t)).toEqual(["t-styled"]);
    });

    it("refuses removing a variable a stored page still uses though the index counts none", async () => {
      const { t, tick } = await boot();
      await t.nextly.create({
        collection: "pages",
        data: { title: "Home", slug: "home", content: pageUsing("t-spare") },
        overrideAccess: true,
      });
      await tick();
      // The row two interleaved saves can lose, lost here directly.
      const spareRows = {
        and: [{ column: "tokenId", op: "=" as const, value: "t-spare" }],
      };
      const rows = await t.adapter.select(TOKEN_ROWS, { where: spareRows });
      expect(rows.length).toBeGreaterThan(0);
      await t.adapter.delete(TOKEN_ROWS, spareRows);
      const designer = await holding(t, ...DESIGN, "read-pages");
      // CONTROL: the index is whole and counts the variable on nothing, so
      // the refusal below comes from the stored page and not from the index.
      const usage = await call("GET", `${route("usage")}?id=t-spare`, designer);
      expect(usage.body).toMatchObject({
        whole: true,
        variables: { "t-spare": { documents: 0, complete: true } },
      });

      const refused = await call("POST", route("remove"), designer, {
        ids: ["t-spare"],
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain(
        "Still used on Home. Remove it from that page first."
      );
      expect(await storedIds(t)).toContain("t-spare");
    });

    it("fills the variable index for pages the backfill walks again", async () => {
      const { t, tick } = await boot();
      await t.nextly.create({
        collection: "pages",
        data: { title: "Home", slug: "home", content: pageUsing("t-accent") },
        overrideAccess: true,
      });
      await tick();
      // A page stored before the variable index counted: its rows absent,
      // and the run marked dirty with a new token, as a failed maintenance
      // write leaves it, so the next pass walks every scope again.
      await t.adapter.delete(TOKEN_ROWS, {
        and: [{ column: "tokenId", op: "=" as const, value: "t-accent" }],
      });
      await t.adapter.update(
        RUNS,
        { token: randomUUID(), dirty: true },
        { and: [{ column: "name", op: "=" as const, value: "usage" }] }
      );
      const reader = await holding(t, "read-site-style");
      const usage = `${route("usage")}?id=t-accent`;
      // CONTROL: the row is gone, so a count of 1 below is the backfill's.
      expect((await call("GET", usage, reader)).body).toMatchObject({
        whole: false,
        variables: { "t-accent": { documents: 0 } },
      });

      await tick();
      expect((await call("GET", usage, reader)).body).toMatchObject({
        whole: true,
        variables: { "t-accent": { documents: 1, complete: true } },
      });
    });

    it("refuses a page that adds a variable the site does not define, and keeps one it already held", async () => {
      const { t } = await boot();
      const added = t.nextly.create({
        collection: "pages",
        data: { title: "New", slug: "new", content: pageUsing("t-missing") },
        overrideAccess: true,
      });
      await expect(added).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });

      // A page holding `spare`, which a trusted write then removes from the
      // site: the page's reference is now to a variable the site lacks.
      const created = await t.nextly.create({
        collection: "pages",
        data: { title: "Old", slug: "old", content: pageUsing("t-spare") },
        overrideAccess: true,
      });
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: { tokens: { tokens: [accent, styled] }, _overwrite: true },
        overrideAccess: true,
      });
      const kept = await t.nextly.update({
        collection: "pages",
        id: String(created.item.id),
        data: {
          title: "Old, renamed",
          content: pageUsing("t-spare"),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      expect(kept.item).toMatchObject({ title: "Old, renamed" });
    });
  }
);
