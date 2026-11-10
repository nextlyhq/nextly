/**
 * Saving a breakpoint set that removes a breakpoint strips every value stored
 * under it from the whole site: pages (their live rows and working drafts),
 * components, patterns, the shared styles, locked blocks and contentOnly
 * slots included; one removal is open at a time; an id being removed cannot
 * be defined again until its removal is done; a removal its save did not
 * finish is carried on by its own route; and every removal is audited. On
 * every configured dialect.
 *
 * And the window a save's validation leaves open: a save judged against the
 * set before the removal, committed after the removal's walk passed that
 * document, holds the removed values again. Two tests name it, one for a
 * write whose hooks run (re-queued after commit) and one for a write inside a
 * transaction (caught by the final walk), and in both the document ends
 * stripped.
 *
 * And what a done removal is owed afterwards: a write bringing its values back
 * opens it again whatever it was a moment before (the run store decides, at
 * the moment it acts), the removal job carries a reopened run on with nobody
 * asking, and a breakpoint defined again since keeps its values.
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  DOCUMENT_FORMAT_VERSION,
  expandSlotDefaults,
  hasBlock,
  makeNode,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { group, text } from "nextly/config";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { BREAKPOINT_REMOVAL_JOB } from "../breakpoint-removal/job";
import {
  removalRunStore,
  type RemovalRunStore,
} from "../breakpoint-removal/run-store";
import {
  BREAKPOINT_REMOVAL_SERVICE,
  type BreakpointRemovalService,
} from "../breakpoint-removal/service";
import { asDocument } from "../component-store-source";
import { blocks } from "../fields/blocksHelper";
import { documentKeyOf, type RewriteReport } from "../host-rewrite/contract";
import { documentHasWorkingDraft } from "../host-rewrite/site";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import { BREAKPOINT_REMOVED_AUDIT } from "../site-settings";
import {
  SITE_SETTINGS_WRITE_CONTEXT,
  SITE_STYLE_SLUG,
} from "../site-style-storage";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

type Node = Record<string, unknown>;

const DESKTOP = { id: "desktop", label: "Desktop" };
const TABLET = { id: "tablet", label: "Tablet", maxWidth: 900 };
const MOBILE = { id: "mobile", label: "Mobile", maxWidth: 600 };

const heading = (id: string, extra: Node = {}): Node => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
  ...extra,
});

/** A colour at Mobile beside one at Tablet, which the removal keeps. */
const styledAtMobile: Node = {
  styles: {
    base: { tablet: { color: "#444444" }, mobile: { color: "#222222" } },
    hover: { mobile: { color: "#333333" } },
  },
};

/** What `styledAtMobile` leaves once Mobile is removed. */
const styledAfter: Node = {
  styles: { base: { tablet: { color: "#444444" } } },
};

const doc = (kind: "page" | "component" | "pattern", nodes: Node[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind,
  nodes,
});

/**
 * A card whose body slot is locked contentOnly, registered once per process:
 * the registry refuses a name registered twice.
 */
function registerSealedCard(): void {
  if (hasBlock("bp/sealed-card")) return;
  const base = {
    version: 1,
    description: "A block.",
    example: { props: {} },
    render: () => null,
  };
  registerBlocks(
    [
      {
        ...base,
        name: "bp/headline",
        props: { text: { type: "text", role: "content" } },
        defaultProps: { text: "Title" },
      },
      {
        ...base,
        name: "bp/sealed-card",
        slots: {
          body: {
            defaultBlock: [{ type: "bp/headline" }],
            lock: "contentOnly",
          },
        },
      },
    ] as never,
    { source: "bp" }
  );
}

/** The sealed card as inserting it places it. */
function sealedCard(): BlockNode {
  return makeNode(
    "bp/sealed-card",
    1,
    {},
    expandSlotDefaults(
      "bp/sealed-card",
      registryBlockSource(),
      registryNestingSource()
    )
  );
}

/**
 * A plugin that depends on the page builder, which is what lets it reach the
 * page builder's tables through its own `ctx.db`: the test's way to the run
 * store, as the write report calls it.
 */
function probePlugin(holder: Probe): PluginDefinition {
  return definePlugin({
    name: "@test/breakpoint-removal-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      holder.runs = removalRunStore(ctx.db, ctx.dialect);
      // A store whose first read of every run lands another save's write
      // before it answers: how a test races a retirement.
      holder.raced = afterRead => {
        let done = false;
        const db = new Proxy(ctx.db, {
          get(target, key, receiver) {
            const value: unknown = Reflect.get(target, key, receiver);
            if (key !== "select" || typeof value !== "function") return value;
            return (...args: unknown[]) => {
              const query = Reflect.apply(value, target, args) as {
                all: () => Promise<unknown[]>;
              };
              return new Proxy(query, {
                get(q, k, r) {
                  const member: unknown = Reflect.get(q, k, r);
                  if (k !== "all" || typeof member !== "function") {
                    return typeof member === "function"
                      ? member.bind(q)
                      : member;
                  }
                  return async () => {
                    const rows = (await Reflect.apply(
                      member,
                      q,
                      []
                    )) as unknown[];
                    if (!done) {
                      done = true;
                      await afterRead();
                    }
                    return rows;
                  };
                },
              });
            };
          },
        });
        return removalRunStore(db, ctx.dialect);
      };
    },
  });
}

/** What the probe hands the tests. */
interface Probe {
  runs?: RemovalRunStore;
  raced?: (afterRead: () => Promise<void>) => RemovalRunStore;
}

/** The plugin's removal job, as a jobs pass runs it. */
function removalJobPass(plugin: PluginDefinition): () => Promise<unknown> {
  const job = plugin.contributes?.jobs?.find(
    entry => entry.slug === BREAKPOINT_REMOVAL_JOB
  );
  if (job === undefined) throw new Error("the page builder has no removal job");
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
  "removing a breakpoint strips what it held (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<{
      t: TestNextly;
      svc: BreakpointRemovalService;
      cookie: string;
      runs: () => RemovalRunStore;
      raced: (afterRead: () => Promise<void>) => RemovalRunStore;
      jobPass: () => Promise<unknown>;
      owner: string;
    }> {
      const plugin = pageBuilder();
      const probe: Probe = {};
      current = await createTestNextly({
        dialect,
        plugins: [plugin, probePlugin(probe)],
        seedPublic: true,
        // Entries whose blocks sit inside a group, which the walk reads but
        // does not write.
        collections: [
          {
            slug: "features",
            fields: [
              text({ name: "title" }),
              group({ name: "hero", fields: [blocks({ name: "body" })] }),
            ],
          } as never,
        ],
      });
      // After the boot, which starts the block registry afresh.
      registerSealedCard();
      const t = current;
      // The site's first user is its owner, granted everything. Made first, so
      // the person below holds only what the test gives them.
      const owner = await t.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      await t.nextly.updateSingle({
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
              styles: {
                base: { base: { color: "#111111" }, mobile: { color: "#222" } },
              },
            },
            {
              id: "c-band",
              slug: "band",
              orderIndex: 1,
              styles: { base: { mobile: { color: "#555555" } } },
            },
          ],
          _overwrite: true,
        },
        overrideAccess: true,
        context: { ...SITE_SETTINGS_WRITE_CONTEXT },
      });
      const svc = plugin.contributes?.services?.[
        BREAKPOINT_REMOVAL_SERVICE
      ]?.() as BreakpointRemovalService;
      return {
        t,
        svc,
        cookie: await manager(t),
        runs: () => {
          if (probe.runs === undefined) throw new Error("no probe");
          return probe.runs;
        },
        raced: afterRead => {
          if (probe.raced === undefined) throw new Error("no probe");
          return probe.raced(afterRead);
        },
        jobPass: removalJobPass(plugin),
        owner: await sessionOf(owner.item.id, owner.item.email, "Owner"),
      };
    }

    /** A signed-in person who may manage the site and nothing else. */
    async function manager(t: TestNextly): Promise<string> {
      const created = await t.nextly.users.create({
        email: "manager@example.com",
        password: "Password123!",
        data: { name: "Manager", isActive: true },
      });
      const userId = created.item.id;
      const permissions = await t.nextly.permissions.find({ limit: 500 });
      const found = permissions.items.find(
        item => item.slug === "manage-page-builder-site"
      );
      if (found === undefined) throw new Error("the permission is not seeded");
      const role = await t.nextly.roles.create({
        data: { name: "Manager", slug: "manager", permissionIds: [found.id] },
      });
      const assigned = await new ServiceContainer(
        t.adapter
      ).userRoles.assignRoleToUser(userId, role.item.id);
      expect(assigned.success).toBe(true);
      return sessionOf(userId, created.item.email, "Manager");
    }

    /** A signed-in session cookie for a user. */
    async function sessionOf(
      userId: string,
      email: string,
      name: string
    ): Promise<string> {
      const token = await signAccessToken(
        buildClaims({
          userId,
          email,
          name,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    /** Discard a page's working draft, as the editor does, through core's route. */
    async function discardDraft(cookie: string, id: string): Promise<number> {
      const path = [
        "collections",
        "pages",
        "entries",
        id,
        "versions",
        "working-draft",
      ];
      const response = await createDynamicHandlers().DELETE(
        new Request(`${ORIGIN}/api/${path.join("/")}`, {
          method: "DELETE",
          headers: {
            cookie: `${cookie}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
          },
        }),
        { params: Promise.resolve({ params: path }) }
      );
      await response.text();
      return response.status;
    }

    /** One of the plugin's site routes, through the real dispatcher. */
    async function post(
      cookie: string,
      route: string[],
      body: unknown
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const path = [
        "plugins",
        ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
        ...route,
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

    /**
     * A save the person confirmed after the dry run, as the editor sends it:
     * the dry run first, then the confirmation with the version it answered.
     */
    const save = async (cookie: string, viewport: unknown[]) => {
      const breakpoints = { viewport, container: [] };
      const checked = await post(cookie, ["site", "breakpoints"], {
        breakpoints,
        dryRun: true,
      });
      const version = (checked.body.item as { version?: unknown } | undefined)
        ?.version;
      return post(cookie, ["site", "breakpoints"], {
        breakpoints,
        confirmRemoval: true,
        ...(typeof version === "string" ? { version } : {}),
      });
    };

    /** A stored blocks value's nodes, in one form. */
    async function nodesOf(
      t: TestNextly,
      collection: string,
      id: string,
      draft = false
    ): Promise<Node[]> {
      const row = (await t.nextly.findByID({
        collection,
        id,
        overrideAccess: true,
        status: "all",
        depth: 0,
        ...(draft ? { draft: true } : {}),
      })) as unknown as Record<string, unknown>;
      return (asDocument(row.content)?.nodes ?? []) as Node[];
    }

    async function create(
      t: TestNextly,
      collection: string,
      data: Record<string, unknown>
    ): Promise<string> {
      const created = await t.nextly.create({
        collection,
        data,
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    /** The site style's stored shared styles, by id. */
    async function storedClasses(
      t: TestNextly
    ): Promise<Map<string, Record<string, unknown>>> {
      const row = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as { classes?: unknown };
      const list = (
        typeof row.classes === "string" ? JSON.parse(row.classes) : row.classes
      ) as Record<string, unknown>[];
      return new Map(list.map(entry => [String(entry.id), entry]));
    }

    /** Plant a value into a page's live row past every check, as a fixture. */
    async function plant(
      t: TestNextly,
      id: string,
      content: unknown
    ): Promise<void> {
      const registry = t.getService("collectionRegistryService") as unknown as {
        getCollectionBySlug(
          slug: string
        ): Promise<{ tableName: string } | null>;
      };
      const table = (await registry.getCollectionBySlug("pages"))!.tableName;
      await t.adapter.update(
        table,
        // SQLite stores a JSON column as text; the others take the value.
        { content: dialect === "sqlite" ? JSON.stringify(content) : content },
        { and: [{ column: "id", op: "=", value: id }] }
      );
    }

    /** Walk a run to its end, a document at a time. */
    async function walkToTheEnd(
      svc: BreakpointRemovalService,
      runId: string
    ): Promise<RewriteReport[]> {
      const reports: RewriteReport[] = [];
      for (let call = 0; call < 200; call += 1) {
        const report = await svc.walk(runId, { maxDocuments: 1 });
        reports.push(report);
        if (report.finished) return reports;
      }
      throw new Error("the walk did not finish");
    }

    /**
     * Write Mobile's values back into a page inside a transaction, which the
     * save check skips, as a write validated before a removal and committed
     * after it would.
     */
    async function writeBackInATransaction(
      t: TestNextly,
      id: string,
      node: Node = heading("a", styledAtMobile)
    ): Promise<void> {
      const service = t.getService("collectionService") as unknown as {
        updateMany: (
          slug: string,
          entries: Array<{ id: string; data: Record<string, unknown> }>,
          ctx: Record<string, unknown>
        ) => Promise<{ successful: number; failed: number }>;
      };
      const result = await service.updateMany(
        "pages",
        [
          {
            id,
            data: { content: doc("page", [node]) },
          },
        ],
        { overrideAccess: true }
      );
      expect(result.successful).toBe(1);
    }

    /** Carry a removal on through its route, as the person managing the site. */
    const carryOn = (cookie: string, runId: string) =>
      post(cookie, ["site", "breakpoints", "removal"], { runId });

    /** The removal's audit rows. */
    async function auditRows(
      t: TestNextly
    ): Promise<Array<Record<string, unknown>>> {
      const rows = await t.adapter.select<{ metadata: unknown }>("audit_log", {
        where: {
          and: [{ column: "kind", op: "=", value: BREAKPOINT_REMOVED_AUDIT }],
        },
      });
      return rows.map(
        row =>
          (typeof row.metadata === "string"
            ? JSON.parse(row.metadata)
            : row.metadata) as Record<string, unknown>
      );
    }

    it("strips pages, drafts, components, patterns, shared styles and locks, and audits it", async () => {
      const { t, svc, cookie } = await boot();
      const live = await create(t, "pages", {
        title: "Home",
        slug: "home",
        status: "published",
        content: doc("page", [
          heading("a", styledAtMobile),
          heading("locked", { ...styledAtMobile, locked: true }),
          heading("hidden", { visibility: { devices: { mobile: false } } }),
        ]),
      });
      const draftOnly = await create(t, "pages", {
        title: "Draft",
        slug: "draft",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      const withDraft = await create(t, "pages", {
        title: "Pending",
        slug: "pending",
        status: "published",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      // An edit saved without publishing: a pending draft over the live row.
      await t.nextly.update({
        collection: "pages",
        id: withDraft,
        data: {
          content: doc("page", [heading("a", styledAtMobile), heading("b")]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      const card = sealedCard();
      expect(card.slots?.body).toHaveLength(1);
      const sealed = await create(t, "pages", {
        title: "Sealed",
        slug: "sealed",
        content: doc("page", [structuredClone(card) as unknown as Node]),
      });
      // A contentOnly child styled at Mobile, which no save could have put
      // there after its creation: planted as a page stored before the lock.
      card.slots!.body![0]!.styles = styledAtMobile.styles as never;
      await plant(t, sealed, doc("page", [card as unknown as Node]));
      const component = await create(t, "components", {
        title: "Promo",
        slug: "promo",
        status: "published",
        content: doc("component", [heading("x", styledAtMobile)]),
      });
      const pattern = await create(t, "patterns", {
        title: "Hero",
        slug: "hero",
        granularity: "section",
        content: doc("pattern", [heading("p", styledAtMobile)]),
      });

      const saved = await save(cookie, [TABLET]);

      expect(saved.status).toBe(200);
      const item = saved.body.item as Record<string, unknown>;
      expect(item.removal).toMatchObject({ finished: true, left: 1 });
      // The live page, its locked block, its hide; still published.
      const home = await nodesOf(t, "pages", live);
      expect(home[0]).toEqual(heading("a", styledAfter));
      expect(home[1]).toEqual(
        heading("locked", { ...styledAfter, locked: true })
      );
      // Mobile was the narrowest device, so its hide leaves nothing behind.
      expect(home[2]).toEqual(heading("hidden"));
      const homeRow = (await t.nextly.findByID({
        collection: "pages",
        id: live,
        overrideAccess: true,
        depth: 0,
      })) as { status?: unknown };
      expect(homeRow.status).toBe("published");
      // A page never published, and a pending draft over a live row: the
      // draft is stripped, the live row is reported left for its author.
      expect((await nodesOf(t, "pages", draftOnly))[0]).toEqual(
        heading("a", styledAfter)
      );
      expect((await nodesOf(t, "pages", withDraft, true))[0]).toEqual(
        heading("a", styledAfter)
      );
      expect((await nodesOf(t, "pages", withDraft))[0]).toEqual(
        heading("a", styledAtMobile)
      );
      // The contentOnly child.
      const sealedAfter = (
        await nodesOf(t, "pages", sealed)
      )[0] as unknown as BlockNode;
      expect(sealedAfter.slots?.body?.[0]?.styles).toEqual(styledAfter.styles);
      // A component and a pattern.
      expect((await nodesOf(t, "components", component))[0]).toEqual(
        heading("x", styledAfter)
      );
      expect((await nodesOf(t, "patterns", pattern))[0]).toEqual(
        heading("p", styledAfter)
      );
      // The shared styles, the locked one still locked.
      const classes = await storedClasses(t);
      expect(classes.get("c-card")).toMatchObject({
        locked: true,
        styles: { base: { base: { color: "#111111" } } },
      });
      expect(classes.get("c-band")?.styles).toEqual({});
      // Done: no removal is open, and the run is kept as the record.
      expect(await svc.openRun()).toBeNull();
      const runId = (item.removal as { runId: string }).runId;
      expect(await svc.runById(runId)).toMatchObject({
        open: false,
        phase: "done",
        removedIds: ["mobile"],
        before: { viewport: [TABLET, MOBILE], container: [] },
      });
      // One audit row, with what the removal dropped.
      const audit = await auditRows(t);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        runId,
        breakpointId: "mobile",
        breakpointLabel: "Mobile",
        sharedStyles: 2,
        components: 1,
        patterns: 1,
        complete: true,
      });
      expect(audit[0]?.pages).toBeGreaterThanOrEqual(4);
    });

    it("refuses a second removal while one is open", async () => {
      const { svc, cookie } = await boot();
      // Open for a breakpoint the set below does not define again.
      await svc.begin(["wide"], null, "user:someone");

      const second = await save(cookie, [TABLET]);

      expect(second.status).toBe(409);
      expect(JSON.stringify(second.body)).toContain(
        "Another breakpoint removal is still running. Try again when it has finished."
      );
    });

    it("refuses a set defining a breakpoint still being removed, and allows it once done", async () => {
      const { t, svc, cookie } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      const run = await svc.begin(["mobile"], null, "user:someone");
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          breakpoints: { viewport: [TABLET], container: [] },
          _overwrite: true,
        },
        overrideAccess: true,
        context: { ...SITE_SETTINGS_WRITE_CONTEXT },
      });
      await svc.publish(run.id);

      const readded = await save(cookie, [TABLET, MOBILE]);
      expect(readded.status).toBe(409);
      expect(JSON.stringify(readded.body)).toContain(
        "A breakpoint in this set is still being removed."
      );

      await walkToTheEnd(svc, run.id);
      const again = await save(cookie, [TABLET, MOBILE]);
      expect(again.status).toBe(200);
      // Defined again, Mobile starts empty.
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );
    });

    it("carries on a removal its save did not finish, through its own route", async () => {
      const { t, svc, cookie } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      // A removal whose save stored the set and ran out of time to walk.
      const run = await svc.begin(["mobile"], null, "user:someone");
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          breakpoints: { viewport: [TABLET], container: [] },
          _overwrite: true,
        },
        overrideAccess: true,
        context: { ...SITE_SETTINGS_WRITE_CONTEXT },
      });
      await svc.publish(run.id);

      const carried = await post(cookie, ["site", "breakpoints", "removal"], {
        runId: run.id,
      });

      expect(carried.status).toBe(200);
      expect(carried.body.item).toMatchObject({
        runId: run.id,
        finished: true,
      });
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );
      expect(await svc.openRun()).toBeNull();
    });

    it("closes a published removal whose breakpoints the site still defines, stripping nothing", async () => {
      const { t, svc, cookie } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      // A save that stopped before storing its set: its run published by
      // the removal job once it was past being prepared.
      const run = await svc.begin(["mobile"], null, "user:someone");
      await svc.publish(run.id);

      const carried = await post(cookie, ["site", "breakpoints", "removal"], {
        runId: run.id,
      });

      expect(carried.status).toBe(200);
      expect(carried.body.item).toMatchObject({ finished: true, left: 0 });
      // Closed and kept as the record, so the open slot is free.
      expect(await svc.runById(run.id)).toMatchObject({ open: false });
      expect(await svc.openRun()).toBeNull();
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAtMobile)
      );
    });

    it("strips a page re-queued by a save committed after the walk passed it", async () => {
      const { t, svc } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      const run = await svc.begin(["mobile"], null, "user:someone");
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          breakpoints: { viewport: [TABLET], container: [] },
          _overwrite: true,
        },
        overrideAccess: true,
        context: { ...SITE_SETTINGS_WRITE_CONTEXT },
      });
      await svc.publish(run.id);
      // Walked until the converting walk has passed the page.
      for (let call = 0; call < 50; call += 1) {
        await svc.walk(run.id, { maxDocuments: 1 });
        if ((await svc.runById(run.id))?.phase === "final") break;
      }
      expect((await svc.runById(run.id))?.phase).toBe("final");
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );

      // The racing save commits, bringing the removed values back: one
      // validated before the set was stored, as a write inside a transaction
      // is not judged against it, whose hooks still run after commit.
      await writeBackInATransaction(t, id);
      // CONTROL: the page holds them again.
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAtMobile)
      );
      // Re-queued after commit: the run is back on its converting walk.
      expect((await svc.runById(run.id))?.phase).toBe("converting");

      const reports = await walkToTheEnd(svc, run.id);

      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );
      expect(reports.flatMap(report => report.rewritten)).toContainEqual(
        expect.objectContaining({ slug: "pages", id })
      );
    });

    it("strips a page a write with no hooks put the removed values back into, in the final walk", async () => {
      const { t, svc } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      const run = await svc.begin(["mobile"], null, "user:someone");
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          breakpoints: { viewport: [TABLET], container: [] },
          _overwrite: true,
        },
        overrideAccess: true,
        context: { ...SITE_SETTINGS_WRITE_CONTEXT },
      });
      await svc.publish(run.id);
      // Walked until the page is stripped and the run is not yet done.
      for (let call = 0; call < 50; call += 1) {
        const report = await svc.walk(run.id, { maxDocuments: 1 });
        expect(report.finished).toBe(false);
        if (report.rewritten.some(host => host.id === id)) break;
      }
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );

      // A write whose hooks did not run (as a bulk import's may not) brings
      // the removed values back after the walk passed the page: nothing
      // re-queues it, and its progress row still says it was stripped.
      await plant(t, id, doc("page", [heading("a", styledAtMobile)]));
      // CONTROL: the page holds them again.
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAtMobile)
      );

      const reports = await walkToTheEnd(svc, run.id);

      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );
      expect(
        reports.flatMap(report => report.caughtByFinalWalk)
      ).toContainEqual(expect.objectContaining({ slug: "pages", id }));
      expect(await svc.openRun()).toBeNull();
    });

    it("keeps a breakpoint a left draft still holds from being added again until it is carried on", async () => {
      const { t, svc, cookie } = await boot();
      const id = await create(t, "pages", {
        title: "Pending",
        slug: "pending",
        status: "published",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      // An edit saved without publishing: a pending draft over the live row.
      await t.nextly.update({
        collection: "pages",
        id,
        data: {
          content: doc("page", [heading("a", styledAtMobile), heading("b")]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      const saved = await save(cookie, [TABLET]);
      expect(saved.body.item).toMatchObject({
        removal: { finished: true, left: 1 },
      });
      const runId = (saved.body.item as { removal: { runId: string } }).removal
        .runId;
      // CONTROL: done, with the live row under the draft still holding Mobile.
      expect(await svc.runById(runId)).toMatchObject({ open: false });
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAtMobile)
      );

      const refused = await save(cookie, [TABLET, MOBILE]);
      expect(refused.status).toBe(409);
      expect(JSON.stringify(refused.body)).toContain(
        "Some pages still hold styles for that breakpoint (a draft is waiting to be published). Publish or discard those drafts, then add it again."
      );

      // The author publishes the draft, which the removal had stripped.
      const draft = await nodesOf(t, "pages", id, true);
      await t.nextly.update({
        collection: "pages",
        id,
        data: {
          content: doc("page", draft),
          status: "published",
          _overwrite: true,
        },
        overrideAccess: true,
      });
      const carried = await carryOn(cookie, runId);
      expect(carried.status).toBe(200);
      expect(carried.body.item).toMatchObject({ finished: true, left: 0 });

      const readded = await save(cookie, [TABLET, MOBILE]);
      expect(readded.status).toBe(200);
      // Defined again, Mobile starts empty on the live row.
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );
    });

    it("opens a done removal again for a write that brings its values back, and strips it when carried on", async () => {
      const { t, svc, cookie } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      const saved = await save(cookie, [TABLET]);
      const runId = (saved.body.item as { removal: { runId: string } }).removal
        .runId;
      expect(await svc.runById(runId)).toMatchObject({ open: false });

      await writeBackInATransaction(t, id);
      // CONTROL: the page holds Mobile's values again.
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAtMobile)
      );
      // The done run is open again, back on its converting walk.
      expect(await svc.runById(runId)).toMatchObject({
        open: true,
        phase: "converting",
      });

      const carried = await carryOn(cookie, runId);
      expect(carried.body.item).toMatchObject({ finished: true });
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );
      expect(await svc.runById(runId)).toMatchObject({ open: false });
    });

    it("leaves a done removal closed for values under a breakpoint the site defines again", async () => {
      const { t, svc, cookie } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a")]),
      });
      const saved = await save(cookie, [TABLET]);
      const runId = (saved.body.item as { removal: { runId: string } }).removal
        .runId;
      expect((await save(cookie, [TABLET, MOBILE])).status).toBe(200);

      // Styles at Mobile, which the site defines again: the site's own.
      await writeBackInATransaction(t, id);

      expect(await svc.runById(runId)).toMatchObject({ open: false });
      expect(await svc.holding()).toEqual([]);
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAtMobile)
      );
    });

    it("records a write brought back while another removal is open as left, which keeps the breakpoint out", async () => {
      const { t, svc, cookie } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      const saved = await save(cookie, [TABLET]);
      const runId = (saved.body.item as { removal: { runId: string } }).removal
        .runId;
      const other = await svc.begin(["wide"], null, "user:someone");

      await writeBackInATransaction(t, id);

      // The open slot is taken, so the done run records the page as left.
      expect(await svc.runById(runId)).toMatchObject({ open: false });
      await svc.abandon(other.id);
      const refused = await save(cookie, [TABLET, MOBILE]);
      expect(refused.status).toBe(409);
      expect(JSON.stringify(refused.body)).toContain(
        "Some content still holds styles for that breakpoint"
      );

      const carried = await carryOn(cookie, runId);
      expect(carried.body.item).toMatchObject({ finished: true, left: 0 });
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );
      expect((await save(cookie, [TABLET, MOBILE])).status).toBe(200);
    });

    it("strips only the breakpoints still removed from a run opened again after one was defined again", async () => {
      const { t, svc, cookie } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      // Tablet and Mobile removed together, then Tablet defined again.
      const saved = await save(cookie, [DESKTOP]);
      const runId = (saved.body.item as { removal: { runId: string } }).removal
        .runId;
      expect(await svc.runById(runId)).toMatchObject({
        open: false,
        removedIds: ["tablet", "mobile"],
      });
      expect((await save(cookie, [DESKTOP, TABLET])).status).toBe(200);

      // A write validated before the removal brings both back.
      await writeBackInATransaction(t, id);
      // CONTROL: opened again, for Mobile, which the site does not define.
      expect(await svc.runById(runId)).toMatchObject({ open: true });
      // The set defining Tablet already is not taken for a re-add of it.
      expect((await save(cookie, [DESKTOP, TABLET])).status).toBe(200);

      const carried = await carryOn(cookie, runId);

      expect(carried.body.item).toMatchObject({ finished: true });
      // Mobile stripped; Tablet's value, under a breakpoint the site emits
      // again, kept.
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );
      expect(await svc.runById(runId)).toMatchObject({ open: false });
    });

    it("opens a run again for a write committed after the run closed, deciding when it acts", async () => {
      const { t, svc, cookie, runs } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      const run = await svc.begin(["mobile"], null, "user:someone");
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          breakpoints: { viewport: [TABLET], container: [] },
          _overwrite: true,
        },
        overrideAccess: true,
        context: { ...SITE_SETTINGS_WRITE_CONTEXT },
      });
      await svc.publish(run.id);
      const key = documentKeyOf({ kind: "collection", slug: "pages", id });
      // Re-queued while the run is open.
      expect(await runs().requeueDocument(run.id, key)).toBe("requeued");
      // The run closes, as its final walk would between a write report's
      // read of the runs and its act: the report still finds it open.
      await walkToTheEnd(svc, run.id);
      expect(await svc.runById(run.id)).toMatchObject({ open: false });
      // A write the walk did not see brings the values back.
      await plant(t, id, doc("page", [heading("a", styledAtMobile)]));

      expect(await runs().requeueDocument(run.id, key)).toBe("reopened");

      expect(await svc.runById(run.id)).toMatchObject({
        open: true,
        phase: "converting",
      });
      const carried = await carryOn(cookie, run.id);
      expect(carried.body.item).toMatchObject({ finished: true });
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );
    });

    it("carries a run a write opened again on in the removal job, with nobody asking", async () => {
      const { t, svc, cookie, jobPass } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      const saved = await save(cookie, [TABLET]);
      const runId = (saved.body.item as { removal: { runId: string } }).removal
        .runId;
      await writeBackInATransaction(t, id);
      // CONTROL: opened again, and the page holds Mobile's values.
      expect(await svc.runById(runId)).toMatchObject({ open: true });
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAtMobile)
      );

      await jobPass();

      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );
      expect(await svc.runById(runId)).toMatchObject({ open: false });
      expect(await svc.openRun()).toBeNull();
    });

    it("stores a set removing a breakpoint without stripping anything when the removal is not confirmed", async () => {
      const { t, cookie, runs } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });

      const saved = await post(cookie, ["site", "breakpoints"], {
        breakpoints: { viewport: [TABLET], container: [] },
      });

      expect(saved.status).toBe(200);
      expect(saved.body.item).not.toHaveProperty("removal");
      const stored = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as { breakpoints?: unknown };
      const breakpoints =
        typeof stored.breakpoints === "string"
          ? (JSON.parse(stored.breakpoints) as unknown)
          : stored.breakpoints;
      expect(breakpoints).toEqual({ viewport: [TABLET], container: [] });
      // Nothing opened, and nothing stripped: the page and the shared style
      // keep their Mobile values.
      expect(await runs().runs()).toEqual([]);
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAtMobile)
      );
      expect(JSON.stringify((await storedClasses(t)).get("c-band"))).toContain(
        "mobile"
      );
    });

    it("lets a breakpoint a published draft resolved be added again once the removal job has run", async () => {
      const { t, svc, cookie, jobPass } = await boot();
      const id = await create(t, "pages", {
        title: "Pending",
        slug: "pending",
        status: "published",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      await t.nextly.update({
        collection: "pages",
        id,
        data: {
          content: doc("page", [heading("a", styledAtMobile), heading("b")]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      const saved = await save(cookie, [TABLET]);
      const runId = (saved.body.item as { removal: { runId: string } }).removal
        .runId;
      // CONTROL: done, with the page left and Mobile refused.
      expect(saved.body.item).toMatchObject({
        removal: { finished: true, left: 1 },
      });
      expect((await save(cookie, [TABLET, MOBILE])).status).toBe(409);

      // The author publishes the draft, which the removal had stripped: the
      // write holds nothing under Mobile.
      const draft = await nodesOf(t, "pages", id, true);
      await t.nextly.update({
        collection: "pages",
        id,
        data: {
          content: doc("page", draft),
          status: "published",
          _overwrite: true,
        },
        overrideAccess: true,
      });
      await jobPass();

      // No carry-on route called: the run walked the page again and closed.
      expect(await svc.runById(runId)).toMatchObject({ open: false });
      expect(await svc.holding()).toEqual([]);
      expect((await save(cookie, [TABLET, MOBILE])).status).toBe(200);
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );
    });

    it("records the breakpoints the stylesheet was emitted under when a removal begins", async () => {
      const { svc, cookie } = await boot();
      const saved = await save(cookie, [TABLET]);
      const runId = (saved.body.item as { removal: { runId: string } }).removal
        .runId;

      expect(await svc.runById(runId)).toMatchObject({
        before: { viewport: [TABLET, MOBILE], container: [] },
        beforeEmitted: { viewport: [TABLET, MOBILE], container: [] },
      });
    });

    it("keeps a page saving with what it held after an unconfirmed removal", async () => {
      const { t, cookie } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      const saved = await post(cookie, ["site", "breakpoints"], {
        breakpoints: { viewport: [TABLET], container: [] },
      });
      expect(saved.status).toBe(200);

      // The author saves the page as it is, Mobile's values and all, and
      // copies the style onto another block: none of it is new to the page.
      const written = await t.nextly.update({
        collection: "pages",
        id,
        data: {
          content: doc("page", [
            heading("a", styledAtMobile),
            heading("b", styledAtMobile),
          ]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      expect(written.item).toMatchObject({ id });
    });

    it("re-queues a page whose blocks sit in a group once a write clears what a removal left there", async () => {
      const { t, svc, cookie, jobPass } = await boot();
      const fid = await create(t, "features", {
        title: "Feature",
        hero: { body: doc("page", [heading("a", styledAtMobile)]) },
      });
      await save(cookie, [TABLET]);
      // CONTROL: the walk could not write the group's blocks, so the entry is
      // left and the breakpoint refused.
      expect(await svc.holding()).toHaveLength(1);
      expect((await save(cookie, [TABLET, MOBILE])).status).toBe(409);

      // The author clears the value; the write holds no blocks at its top
      // level.
      await t.nextly.update({
        collection: "features",
        id: fid,
        data: { hero: { body: doc("page", [heading("a")]) }, _overwrite: true },
        overrideAccess: true,
      });
      await jobPass();

      expect(await svc.holding()).toEqual([]);
      expect((await save(cookie, [TABLET, MOBILE])).status).toBe(200);
    });

    it("strips nothing with an old run once its breakpoint was defined again and removed unconfirmed", async () => {
      const { t, svc, cookie } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      const saved = await save(cookie, [TABLET]);
      const runId = (saved.body.item as { removal: { runId: string } }).removal
        .runId;
      // Mobile defined again: the run gives up its claim on it.
      expect((await save(cookie, [TABLET, MOBILE])).status).toBe(200);
      expect(await svc.runById(runId)).toMatchObject({
        removedIds: [],
        readdedIds: ["mobile"],
      });
      // The author styles at Mobile again, then Mobile is removed without
      // confirming, which promises to leave those values alone.
      await t.nextly.update({
        collection: "pages",
        id,
        data: {
          content: doc("page", [heading("a", styledAtMobile)]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      const unconfirmed = await post(cookie, ["site", "breakpoints"], {
        breakpoints: { viewport: [TABLET], container: [] },
      });
      expect(unconfirmed.status).toBe(200);

      // A save carrying them is no reason to open the old run.
      await writeBackInATransaction(t, id);

      expect(await svc.runById(runId)).toMatchObject({ open: false });
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAtMobile)
      );
    });

    it("lets a breakpoint a discarded draft resolved be added again once the removal job has run", async () => {
      const { t, svc, cookie, jobPass, owner } = await boot();
      const id = await create(t, "pages", {
        title: "Pending",
        slug: "pending",
        status: "published",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      await t.nextly.update({
        collection: "pages",
        id,
        data: {
          content: doc("page", [heading("a", styledAtMobile), heading("b")]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      const saved = await save(cookie, [TABLET]);
      expect(saved.body.item).toMatchObject({
        removal: { finished: true, left: 1 },
      });
      // CONTROL: a pass with the draft still there opens nothing.
      await jobPass();
      expect(await svc.openRun()).toBeNull();
      expect((await save(cookie, [TABLET, MOBILE])).status).toBe(409);
      // What the pass asks of the page, read as the system.
      const site = {
        nextly: async () => t.nextly as never,
        locales: () => [] as string[],
      };
      const page = { kind: "collection" as const, slug: "pages", id };
      expect(await documentHasWorkingDraft(site, page)).toBe(true);

      // The author throws the draft away, which runs no write hook.
      expect(await discardDraft(owner, id)).toBe(200);
      expect(await documentHasWorkingDraft(site, page)).toBe(false);
      await jobPass();

      expect(await svc.holding()).toEqual([]);
      expect((await save(cookie, [TABLET, MOBILE])).status).toBe(200);
      // The live row, written once its draft was gone.
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );
    });

    it("leaves a run its save has not stored the set for yet to that save, in the removal job", async () => {
      const { t, svc, jobPass } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      // A save has opened its run and is still counting: Mobile is defined.
      const run = await svc.begin(["mobile"], null, "user:someone");

      await jobPass();
      // Walked by nobody before it is published, the save's route included.
      expect((await svc.walk(run.id, {})).finished).toBe(false);

      // Not closed with nothing done: still open, still being prepared.
      expect(await svc.runById(run.id)).toMatchObject({
        open: true,
        preparing: true,
      });
      // The save stores its set and walks: the page is stripped.
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          breakpoints: { viewport: [TABLET], container: [] },
          _overwrite: true,
        },
        overrideAccess: true,
        context: { ...SITE_SETTINGS_WRITE_CONTEXT },
      });
      await svc.publish(run.id);
      await walkToTheEnd(svc, run.id);
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAfter)
      );
    });

    it("retires a re-added id from an open run too", async () => {
      const { svc, runs } = await boot();
      const run = await svc.begin(["tablet", "mobile"], null, "user:someone");
      await svc.publish(run.id);

      await runs().retire(["mobile"]);

      expect(await svc.runById(run.id)).toMatchObject({
        open: true,
        removedIds: ["tablet"],
        readdedIds: ["mobile"],
      });
    });

    it("retires every id two saves re-add at once from one run", async () => {
      const { svc, cookie, runs, raced } = await boot();
      // Tablet and Mobile removed together, the run done.
      await save(cookie, [DESKTOP]);
      const [run] = await runs().runs();
      if (run === undefined) throw new Error("no run");
      // One save retires Tablet while another, which has read the run,
      // retires Mobile.
      await raced(() => runs().retire(["tablet"])).retire(["mobile"]);

      expect(await svc.runById(run.id)).toMatchObject({
        removedIds: [],
        readdedIds: expect.arrayContaining(["tablet", "mobile"]),
      });
    });

    it("refuses a confirmed removal the site style changed under since its dry run", async () => {
      const { t, cookie, runs } = await boot();
      const id = await create(t, "pages", {
        title: "Home",
        slug: "home",
        content: doc("page", [heading("a", styledAtMobile)]),
      });
      const breakpoints = { viewport: [TABLET], container: [] };
      const checked = await post(cookie, ["site", "breakpoints"], {
        breakpoints,
        dryRun: true,
      });
      const version = (checked.body.item as { version?: unknown }).version;
      expect(typeof version).toBe("string");
      // Another manager changes the site's style after the dry run.
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          breakpoints: {
            viewport: [
              TABLET,
              MOBILE,
              { id: "wide", label: "Wide", maxWidth: 1400 },
            ],
            container: [],
          },
          _overwrite: true,
        },
        overrideAccess: true,
        context: { ...SITE_SETTINGS_WRITE_CONTEXT },
      });

      const confirmed = await post(cookie, ["site", "breakpoints"], {
        breakpoints,
        confirmRemoval: true,
        version,
      });
      const unversioned = await post(cookie, ["site", "breakpoints"], {
        breakpoints,
        confirmRemoval: true,
      });

      expect(confirmed.status).toBe(409);
      expect(JSON.stringify(confirmed.body)).toContain(
        "The site's breakpoints changed after you checked what removing them drops."
      );
      expect(unversioned.status).toBe(400);
      // Nothing opened, nothing stripped.
      expect(await runs().runs()).toEqual([]);
      expect((await nodesOf(t, "pages", id))[0]).toEqual(
        heading("a", styledAtMobile)
      );
    });

    it("refuses a save of the site style from a version another save replaced", async () => {
      const { t } = await boot();
      const read = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as { _rev?: unknown };
      // The version a breakpoint save hands back, as this site gives it.
      expect(typeof read._rev).toBe("string");
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          breakpoints: { viewport: [TABLET], container: [] },
          _overwrite: true,
        },
        overrideAccess: true,
        context: { ...SITE_SETTINGS_WRITE_CONTEXT },
      });

      await expect(
        t.nextly.updateSingle({
          slug: SITE_STYLE_SLUG,
          data: {
            breakpoints: { viewport: [TABLET, MOBILE], container: [] },
            _rev: read._rev,
          },
          overrideAccess: true,
          context: { ...SITE_SETTINGS_WRITE_CONTEXT },
        })
      ).rejects.toMatchObject({ code: "STALE_VERSION" });
    });
  }
);
