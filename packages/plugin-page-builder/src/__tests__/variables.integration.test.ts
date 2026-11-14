/**
 * Variables over HTTP, on a real site: the usage read counts the pages and
 * shared styles naming a variable, and says when it is a floor; a variable in
 * use is refused removal on the remove route and on a whole-section write of
 * the site style alike; the stored pages are read again rather than an index
 * zero trusted; once nothing uses it, it is removed; a page may not add a
 * reference to a variable the site does not define; and a role that may read
 * Design but not change it is refused every variable change, on the Single's
 * write and the remove route alike, while it can still read them.
 */

import { randomUUID } from "node:crypto";

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { getCachedNextly, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BLOCKS_TYPE } from "../fields/blocksField";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import type { StoredDocuments } from "../shared-style-rescan";
import type { SharedStyleUsageSource } from "../shared-styles-routes";
import { SITE_STYLE_SLUG } from "../site-style-storage";
import { USAGE_BACKFILL_JOB } from "../usage-backfill-job";
import {
  removeVariables,
  siteStyleVariableStore,
  variableRemovalChecks,
} from "../variables-routes";

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
/** A stored variable, with or without a dark value. */
type StoredVariable = Omit<ReturnType<typeof variable>, "values"> & {
  values: { light: string; dark?: string };
};
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

/**
 * A page past the walk's node bound, so the index cannot read it whole; its
 * last node, the one past the bound, names `identity`, or nothing.
 */
const oversizedUsing = (identity?: string) => {
  const last = DEFAULT_LIMITS.maxNodes;
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: Array.from({ length: last + 1 }, (_, at) => ({
      id: `n${at}`,
      type: "core/heading",
      version: 1,
      props: { text: "a", level: 2 },
      ...(at === last && identity !== undefined
        ? { styles: { base: { base: { color: { $token: identity } } } } }
        : {}),
    })),
  };
};

/** A collection whose blocks sit in a field under a named group. */
const LANDING = "landing";
const landing = {
  slug: LANDING,
  fields: [
    { name: "title", type: "text" },
    {
      name: "hero",
      type: "group",
      fields: [{ name: "body", type: BLOCKS_TYPE }],
    },
  ],
};

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

/** The context a plugin's `init` is handed, which `onMigrate` is handed too. */
type PluginContextOf = Parameters<NonNullable<PluginDefinition["init"]>>[0];

/** The slice of the Direct API the remove route's store reads and writes. */
type VariableApi = Parameters<typeof siteStyleVariableStore>[1];

/**
 * The usage index's answer, and the stored documents, of a site whose
 * variables no page uses. The index and the rescan are driven over HTTP
 * above; these cases are about the Single's write and the shared styles.
 */
const NOTHING_USED: SharedStyleUsageSource = {
  health: async () => ({
    coversExistingDocuments: true,
    anyUndetermined: false,
  }),
  documentsUsingEach: async ids =>
    new Map(ids.map(id => [id, { collections: [], complete: true }])),
  kindOf: () => "pages",
};
const NO_DOCUMENTS: StoredDocuments = {
  collections: async () => [],
  singles: async () => [],
  rowsAfter: async () => ({ items: [], hasNext: false }),
  rowForms: async () => [],
  singleForms: async () => [],
};

/** The removal's checks over those: the shared styles are the site's own. */
const CHECKS = variableRemovalChecks({
  usage: NOTHING_USED,
  blocks: () => [],
  documents: async () => NO_DOCUMENTS,
  limits: DEFAULT_LIMITS,
  pathOf: id => id,
});

describe.each(getConfiguredTestDialects())(
  "variables (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /**
     * A site storing three variables and a shared style naming one, with any
     * collections of its own beside the page builder's.
     */
    async function boot(collections: unknown[] = []) {
      const built = pageBuilder();
      // The plugin's own context, as `nextly migrate` hands its `onMigrate`:
      // the one `init` is handed, kept as it is.
      let context: PluginContextOf | undefined;
      const plugin: PluginDefinition = {
        ...built,
        init: ctx => {
          context = ctx;
          return built.init?.(ctx);
        },
      };
      current = await createTestNextly({
        dialect,
        plugins: [plugin],
        seedPublic: true,
        ...(collections.length === 0
          ? {}
          : { collections: collections as never[] }),
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
      const contextOf = (): PluginContextOf => {
        if (context === undefined)
          throw new Error("the plugin never initialised");
        return context;
      };
      return { t, tick: backfillTick(plugin), plugin, contextOf };
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

    /** A page's stored content, set past every check on the page's row. */
    async function plantContent(
      t: TestNextly,
      id: string,
      content: unknown
    ): Promise<void> {
      const registry = t.getService("collectionRegistryService") as unknown as {
        getCollectionBySlug(
          slug: string
        ): Promise<{ tableName: string } | null>;
      };
      const table = (await registry.getCollectionBySlug("pages"))?.tableName;
      if (table === undefined) throw new Error("the pages table is missing");
      await t.adapter.update(
        table,
        // SQLite stores a JSON column as text; the others take the value.
        { content: dialect === "sqlite" ? JSON.stringify(content) : content },
        { and: [{ column: "id", op: "=", value: id }] }
      );
    }

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

    it("removes an unused variable on a site no scheduler counted, counting the pages in the request", async () => {
      const { t } = await boot();
      await t.nextly.create({
        collection: "pages",
        data: { title: "Home", slug: "home", content: pageUsing("t-accent") },
        overrideAccess: true,
      });
      const designer = await holding(t, ...DESIGN);
      // CONTROL: nothing has counted the page, so the index is not whole and
      // a removal has to count before it can judge.
      const before = await call(
        "GET",
        `${route("usage")}?id=t-spare`,
        designer
      );
      expect(before.body).toMatchObject({ whole: false });

      const removed = await call("POST", route("remove"), designer, {
        ids: ["t-spare"],
      });
      expect(removed.status).toBe(200);
      expect(await storedIds(t)).toEqual(["t-accent", "t-styled"]);
      // The removal's own count left every page counted.
      const after = await call(
        "GET",
        `${route("usage")}?id=t-accent`,
        designer
      );
      expect(after.body).toMatchObject({
        whole: true,
        variables: { "t-accent": { documents: 1, complete: true } },
      });
    });

    it("refuses a used variable on a site no scheduler counted, once the request has counted the pages", async () => {
      const { t } = await boot();
      await t.nextly.create({
        collection: "pages",
        data: { title: "Home", slug: "home", content: pageUsing("t-accent") },
        overrideAccess: true,
      });
      const designer = await holding(t, ...DESIGN);
      const refused = await call("POST", route("remove"), designer, {
        ids: ["t-accent"],
      });
      // Refused as in use, on the count the request made, not as uncounted.
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain('"code":"IN_USE"');
      expect(JSON.stringify(refused.body)).toContain(
        "Accent is used on 1 document."
      );
      expect(await storedIds(t)).toEqual(["t-accent", "t-styled", "t-spare"]);
    });

    it("counts the pages left uncounted after a migrate, and a second count at once stops quietly", async () => {
      const { t, plugin, contextOf } = await boot();
      await t.nextly.create({
        collection: "pages",
        data: { title: "Home", slug: "home", content: pageUsing("t-accent") },
        overrideAccess: true,
      });
      const designer = await holding(t, ...DESIGN);
      const usage = () =>
        call("GET", `${route("usage")}?id=t-accent`, designer);
      // CONTROL: nothing has counted the page yet.
      expect((await usage()).body).toMatchObject({ whole: false });

      // Two migrates' hooks at once, as two deploys, or a deploy beside a
      // running app, can run them: neither fails, and the pages are counted.
      const onMigrate = plugin.onMigrate;
      if (onMigrate === undefined) throw new Error("no onMigrate declared");
      await Promise.all([
        onMigrate(contextOf(), { applied: 0 }),
        onMigrate(contextOf(), { applied: 0 }),
      ]);
      expect((await usage()).body).toMatchObject({
        whole: true,
        variables: { "t-accent": { documents: 1, complete: true } },
      });
    });

    it("counts the pages left uncounted after an install, as after a migrate", async () => {
      const { t, plugin, contextOf } = await boot();
      await t.nextly.create({
        collection: "pages",
        data: { title: "Home", slug: "home", content: pageUsing("t-accent") },
        overrideAccess: true,
      });
      const designer = await holding(t, ...DESIGN);
      const usage = () =>
        call("GET", `${route("usage")}?id=t-accent`, designer);
      // CONTROL: nothing has counted the page yet.
      expect((await usage()).body).toMatchObject({ whole: false });

      // A first deploy migrates before the plugin is installed, which skips
      // its `onMigrate`: the install counts the pages instead.
      const onInstall = plugin.onInstall;
      if (onInstall === undefined) throw new Error("no onInstall declared");
      await onInstall(contextOf());
      expect((await usage()).body).toMatchObject({
        whole: true,
        variables: { "t-accent": { documents: 1, complete: true } },
      });
    });

    describe("where the index cannot become whole", () => {
      it("removes a variable an oversized page does not use, and refuses one used past the walk's bound, naming the page", async () => {
        const { t, tick } = await boot();
        const created = await t.nextly.create({
          collection: "pages",
          data: { title: "Big", slug: "big", content: pageUsing() },
          overrideAccess: true,
        });
        // Larger than any page the editor saves: stored past its checks.
        await plantContent(
          t,
          String(created.item.id),
          oversizedUsing("t-accent")
        );
        await tick();
        const designer = await holding(t, ...DESIGN, "read-pages");
        // CONTROL: every page walked, and the index still cannot be whole.
        expect(
          (await call("GET", `${route("usage")}?id=t-spare`, designer)).body
        ).toMatchObject({ whole: false });

        const removed = await call("POST", route("remove"), designer, {
          ids: ["t-spare"],
        });
        expect(removed.status).toBe(200);
        expect(await storedIds(t)).toEqual(["t-accent", "t-styled"]);

        const refused = await call("POST", route("remove"), designer, {
          ids: ["t-accent"],
        });
        expect(refused.status).toBe(400);
        expect(JSON.stringify(refused.body)).toContain('"code":"IN_USE"');
        expect(JSON.stringify(refused.body)).toContain(
          "Accent is used on Big."
        );
        expect(await storedIds(t)).toEqual(["t-accent", "t-styled"]);
      });

      it("refuses a variable a block under a named group uses, naming the page, and removes one it does not", async () => {
        const { t, tick } = await boot([landing]);
        await t.nextly.create({
          collection: LANDING,
          data: { title: "Pricing", hero: { body: pageUsing("t-accent") } },
          overrideAccess: true,
        } as never);
        await tick();
        const designer = await holding(t, ...DESIGN, `read-${LANDING}`);
        // CONTROL: the group's blocks are out of the index's reach.
        expect(
          (await call("GET", `${route("usage")}?id=t-accent`, designer)).body
        ).toMatchObject({ whole: false });

        const refused = await call("POST", route("remove"), designer, {
          ids: ["t-accent"],
        });
        expect(refused.status).toBe(400);
        expect(JSON.stringify(refused.body)).toContain('"code":"IN_USE"');
        expect(JSON.stringify(refused.body)).toContain(
          "Accent is used on Pricing."
        );

        const removed = await call("POST", route("remove"), designer, {
          ids: ["t-spare"],
        });
        expect(removed.status).toBe(200);
        expect(await storedIds(t)).toEqual(["t-accent", "t-styled"]);
      });

      it("refuses a removal, naming the page, where a page the index does not cover cannot be read", async () => {
        const { t, tick } = await boot([landing]);
        await t.nextly.create({
          collection: LANDING,
          data: { title: "About", hero: { body: pageUsing() } },
          overrideAccess: true,
        } as never);
        const pricing = await t.nextly.create({
          collection: LANDING,
          data: { title: "Pricing", hero: { body: pageUsing() } },
          overrideAccess: true,
        } as never);
        const pricingId = String(pricing.item.id);
        await tick();
        const designer = await holding(t, ...DESIGN, `read-${LANDING}`);

        // The database fails the system's read of that one page; the
        // caller's read of its title, a different query, still answers.
        const direct = await getCachedNextly();
        const findByID = direct.findByID.bind(direct);
        const failing = vi
          .spyOn(direct, "findByID")
          .mockImplementation(async args =>
            (args as { collection?: string; id?: unknown }).collection ===
              LANDING && String((args as { id?: unknown }).id) === pricingId
              ? Promise.reject(new Error("the read failed"))
              : findByID(args as never)
          );
        try {
          const refused = await call("POST", route("remove"), designer, {
            ids: ["t-spare"],
          });
          expect(refused.status).toBe(409);
          expect(JSON.stringify(refused.body)).toContain(
            "Pricing could not be read to check whether it uses the variable"
          );
          expect(JSON.stringify(refused.body)).not.toContain("IN_USE");
        } finally {
          failing.mockRestore();
        }
        expect(await storedIds(t)).toEqual(["t-accent", "t-styled", "t-spare"]);

        // CONTROL: read again, the same page lets the removal through.
        const removed = await call("POST", route("remove"), designer, {
          ids: ["t-spare"],
        });
        expect(removed.status).toBe(200);
      });
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

    /** The stored tokens section, read as the system, as JSON to compare. */
    async function storedSection(t: TestNextly): Promise<string> {
      const doc = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as Record<string, unknown> | null;
      const raw = doc?.tokens;
      return JSON.stringify(typeof raw === "string" ? JSON.parse(raw) : raw);
    }

    it("refuses every variable change to a role that may read Design but not change it, and lets it read", async () => {
      const { t, tick } = await boot();
      // Whole, so a removal below is judged on who asks and not refused as
      // not counted yet.
      await tick();
      const reader = await holding(t, "read-site-style");
      const designer = await holding(t, ...DESIGN);

      // The Variables panel's whole-section save, as each action makes it,
      // each built from the set as the previous accepted step left it.
      let shown: StoredVariable[] = [accent, styled, spare];
      const added = variable("t-added", "Added");
      const steps: [string, StoredVariable[]][] = [];
      const step = (name: string, next: StoredVariable[]) => {
        steps.push([name, next]);
        shown = next;
      };
      step("adds a variable", [...shown, added]);
      step(
        "changes a value",
        shown.map(entry =>
          entry.id === "t-accent"
            ? { ...entry, values: { light: "#654321" } }
            : entry
        )
      );
      step(
        "sets a dark value",
        shown.map(entry =>
          entry.id === "t-spare"
            ? { ...entry, values: { light: "#123456", dark: "#abcdef" } }
            : entry
        )
      );
      step(
        "clears the dark value",
        shown.map(entry =>
          entry.id === "t-spare"
            ? { ...entry, values: { light: "#123456" } }
            : entry
        )
      );
      step(
        "removes a variable nothing uses",
        shown.filter(entry => entry.id !== "t-added")
      );

      for (const [name, tokens] of steps) {
        const before = await storedSection(t);
        const body = { tokens: { tokens }, _overwrite: true };
        const refused = await call("PATCH", SINGLE, reader, body);
        expect(refused.status, `the reader ${name}`).toBe(403);
        expect(await storedSection(t), `the reader ${name}`).toBe(before);
        // CONTROL: the same save by a Design manager is stored, so the
        // refusal above is about who asked and not about the save.
        const accepted = await call("PATCH", SINGLE, designer, body);
        expect(accepted.status, `the designer ${name}`).toBe(200);
        expect(
          JSON.parse(await storedSection(t)),
          `the designer ${name}`
        ).toMatchObject({ tokens });
      }

      // The remove route declares Design's update: refused before its write.
      const removal = { ids: ["t-spare"] };
      const routeRefused = await call("POST", route("remove"), reader, removal);
      expect(routeRefused.status).toBe(403);
      expect(await storedIds(t)).toEqual(["t-accent", "t-styled", "t-spare"]);
      // CONTROL: the same removal by a Design manager goes ahead.
      const routeRemoved = await call(
        "POST",
        route("remove"),
        designer,
        removal
      );
      expect(routeRemoved.status).toBe(200);
      expect(await storedIds(t)).toEqual(["t-accent", "t-styled"]);

      // Still read, so the panel can show the variables read-only: the
      // Single itself and how widely each is used.
      const read = await call("GET", SINGLE, reader);
      expect(read.status).toBe(200);
      // SQLite hands the section back as text, so it is matched as text.
      expect(JSON.stringify(read.body)).toContain("t-styled");
      const usage = await call("GET", `${route("usage")}?id=t-styled`, reader);
      expect(usage.status).toBe(200);
      expect(usage.body).toMatchObject({
        variables: { "t-styled": { sharedStyles: ["c-card"] } },
      });
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

    /**
     * The remove route's store over the Direct API, with `foreign` saved to
     * the Single just before the route's first write: a fixed interleave,
     * not a race.
     */
    function interleaved(t: TestNextly, foreign: Record<string, unknown>) {
      const real = t.nextly as unknown as VariableApi;
      const writes = { count: 0 };
      const api: VariableApi = {
        findSingle: args => real.findSingle(args),
        updateSingle: async args => {
          writes.count += 1;
          if (writes.count === 1) {
            await t.nextly.updateSingle({
              slug: SITE_STYLE_SLUG,
              data: { ...foreign, _overwrite: true },
              overrideAccess: true,
            });
          }
          return real.updateSingle(args);
        },
      };
      const store = siteStyleVariableStore(
        { self: { singles: {}, collections: {} }, user: null } as never,
        api,
        undefined
      );
      return { store, writes };
    }

    const removeRequest = (ids: string[]) =>
      new Request(`${ORIGIN}/x`, {
        method: "POST",
        body: JSON.stringify({ ids }),
      });

    it("removes a variable when another save adds one first, keeping both changes", async () => {
      const { t } = await boot();
      const added = variable("t-added", "Added");
      const { store, writes } = interleaved(t, {
        tokens: { tokens: [accent, styled, spare, added] },
      });
      const answer = await removeVariables(
        removeRequest(["t-spare"]),
        store,
        new Set(),
        CHECKS
      );
      expect(answer.status).toBe(200);
      // Refused once as made from a replaced version, then made again.
      expect(writes.count).toBe(2);
      expect(await storedIds(t)).toEqual(["t-accent", "t-styled", "t-added"]);
    });

    it("refuses a removal as in use when a shared style saved first starts using the variable", async () => {
      const { t } = await boot();
      const naming = {
        id: "c-new",
        slug: "new",
        label: "New",
        orderIndex: 1,
        styles: { base: { base: { color: { $token: "t-spare" } } } },
      };
      const { store, writes } = interleaved(t, { classes: [card, naming] });
      await expect(
        removeVariables(removeRequest(["t-spare"]), store, new Set(), CHECKS)
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            {
              path: "t-spare",
              code: "IN_USE",
              message: "Spare is used by the shared style New.",
            },
          ],
        },
      });
      // Judged again on the newest read, so its write was never made.
      expect(writes.count).toBe(1);
      expect(await storedIds(t)).toEqual(["t-accent", "t-styled", "t-spare"]);
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

      // A page holding `spare` after the site removed it: the page's
      // reference is to a variable the site lacks. Removed while nothing uses
      // it, since a removal is refused while a page does, then planted in the
      // page's stored row past every check, as a page stored before the
      // removal rules existed holds it.
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: { tokens: { tokens: [accent, styled] }, _overwrite: true },
        overrideAccess: true,
      });
      const created = await t.nextly.create({
        collection: "pages",
        data: { title: "Old", slug: "old", content: pageUsing() },
        overrideAccess: true,
      });
      await plantContent(t, String(created.item.id), pageUsing("t-spare"));
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
