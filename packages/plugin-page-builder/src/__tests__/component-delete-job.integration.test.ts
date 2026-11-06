/**
 * Delete component, end to end against a real database per dialect, through
 * its routes as a signed-in person.
 *
 * What only a server shows: that each copy is turned into plain blocks and the
 * component then deleted, through the steps the person's own requests carry;
 * that anything which would stop it part way stops it before any document
 * changes, and takes the fence down; that a page with unpublished changes
 * keeps the component; that nobody else can carry a delete on, and nobody
 * without the right can start one; that the component's own delete and an
 * unpublish of a used one are refused, the index's "none" confirmed by
 * reading every document; that a person a rule lets delete some components
 * but not this one converts nothing; and that a save already in flight when
 * the delete runs never leaves a copy of the deleted component, in either
 * commit order and however long it was held (the fence inside the write's
 * own transaction, and the deleted component's tombstone).
 *
 * @module __tests__/component-delete-job.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
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
import { asDocument } from "../component-store-source";
import type { ComponentDeleteResult } from "../component-delete/contract";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import { COMPONENT_DELETE_JOB } from "../component-delete/sweep";
import { USAGE_BACKFILL_JOB } from "../usage-backfill-job";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
const HARNESS = "@t/delete-harness";
const NOTES = "notes";
/** A collection whose blocks values sit in a repeater: no fixed path reaches them. */
const BOARDS = "boards";

type Node = Record<string, unknown>;

const heading = (id: string, text: string): Node => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
});

const copyOf = (id: string, componentId: string): Node => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});

const pageDoc = (nodes: Node[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** What the harness's hooks do, switched by each test as it runs. */
interface Switches {
  /** Hold the next note write with this title after its validation. */
  holdAfterValidation?: {
    title: string;
    reached: () => void;
    release: Promise<void>;
  };
  /**
   * Run once, on the next read of a Layout: the final walk reads the Layouts
   * after it has read every document, and before the run is done.
   */
  onLayoutRead?: () => Promise<void>;
}

/** A plugin whose hooks time an author's save against the delete. */
function harness(switches: Switches): PluginDefinition {
  return definePlugin({
    name: HARNESS,
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      // `beforeChange` runs after field validation and before the write's
      // transaction opens: a save held here has passed the reference fence.
      ctx.hooks.on("beforeChange", NOTES, async context => {
        const hold = switches.holdAfterValidation;
        const title = (context as { data?: { title?: unknown } }).data?.title;
        if (hold === undefined || title !== hold.title) return;
        switches.holdAfterValidation = undefined;
        hold.reached();
        await hold.release;
      });
      ctx.hooks.on("afterRead", LAYOUTS_SLUG, async () => {
        const run = switches.onLayoutRead;
        if (run === undefined) return;
        switches.onLayoutRead = undefined;
        await run();
      });
    },
  });
}

/**
 * A plugin limiting deletes of components to the one whose slug is
 * `deletable`: a rule over the row, which the type-level question answers
 * yes for.
 */
function oneDeletableComponent(): PluginDefinition {
  return definePlugin({
    name: "@t/one-deletable-component",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    contributes: {
      transforms: [
        {
          target: COMPONENTS_SLUG,
          transform: entity => ({
            ...entity,
            access: {
              ...((entity as { access?: Record<string, unknown> }).access ??
                {}),
              delete: () =>
                ({ slug: { equals: "deletable" } }) as unknown as boolean,
            },
          }),
        },
      ],
    },
  });
}

/** The plugin's own job of this slug, run once as the runner would. */
function jobTick(
  plugin: PluginDefinition,
  slug: string
): () => Promise<unknown> {
  const job = plugin.contributes?.jobs?.find(entry => entry.slug === slug);
  if (job === undefined) throw new Error(`the page builder has no ${slug}`);
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

/** The plugin's own backfill job, so the usage index is whole. */
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

/** What one route call answered. */
interface Answer {
  readonly status: number;
  readonly item: ComponentDeleteResult;
  readonly message: string;
  readonly body: unknown;
}

describe.each(getConfiguredTestDialects())(
  "Delete component (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(
      switches: Switches = {},
      site: { boards?: boolean; rowRule?: boolean } = {}
    ) {
      const plugin = pageBuilder();
      current = await createTestNextly({
        dialect,
        plugins: [
          plugin,
          harness(switches),
          ...(site.rowRule === true ? [oneDeletableComponent()] : []),
        ],
        seedPublic: true,
        collections: [
          {
            slug: NOTES,
            fields: [
              { name: "title", type: "text" },
              { name: "content", type: BLOCKS_TYPE },
            ],
          } as never,
          ...(site.boards === true
            ? [
                {
                  slug: BOARDS,
                  fields: [
                    { name: "title", type: "text" },
                    {
                      name: "rows",
                      type: "repeater",
                      fields: [{ name: "body", type: BLOCKS_TYPE }],
                    },
                  ],
                } as never,
              ]
            : []),
        ],
      });
      const t = current;
      // The first user is the super admin: the person deleting, here.
      const owner = await person(t, "owner");
      return {
        t,
        cookie: await sessionOf(t, owner),
        backfill: backfillTick(plugin),
        sweep: jobTick(plugin, COMPONENT_DELETE_JOB),
        anAuthor: async (name: string, grants: string[]) => {
          const id = await person(t, name);
          await grant(t, id, grants);
          return sessionOf(t, id);
        },
      };
    }

    async function person(t: TestNextly, name: string): Promise<string> {
      const created = await t.nextly.users.create({
        email: `${name}-${Date.now()}@example.com`,
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
          name: `Delete role ${String(Math.random()).slice(2, 10)}`,
          slug: `delete-role-${String(Math.random()).slice(2, 10)}`,
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

    /** One call of the delete route, as the session's owner. */
    async function call(
      cookie: string,
      componentId: string,
      method: "POST" | "GET",
      body?: unknown
    ): Promise<Answer> {
      const handlers = createDynamicHandlers();
      const sub = ["components", componentId, "delete"];
      const url = `${ORIGIN}/api/plugins/${PAGE_BUILDER_PLUGIN_NAME}/${sub.join("/")}`;
      const request = new Request(url, {
        method,
        headers: {
          cookie: `${cookie}; nextly_csrf=${CSRF}`,
          "x-csrf-token": CSRF,
          origin: ORIGIN,
          "content-type": "application/json",
        },
        ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      });
      const context = {
        params: Promise.resolve({
          params: ["plugins", ...PAGE_BUILDER_PLUGIN_NAME.split("/"), ...sub],
        }),
      };
      const response =
        method === "POST"
          ? await handlers.POST(request, context)
          : await handlers.GET(request, context);
      const text = await response.text();
      const parsed = (text === "" ? {} : JSON.parse(text)) as {
        item?: ComponentDeleteResult;
        message?: string;
      };
      return {
        status: response.status,
        item: parsed.item as ComponentDeleteResult,
        message: parsed.message ?? "",
        body: parsed,
      };
    }

    const dryRun = (cookie: string, id: string) =>
      call(cookie, id, "POST", { dryRun: true });

    /** Step the delete until it stops running, at most a few calls. */
    async function deleteToTheEnd(cookie: string, id: string): Promise<Answer> {
      for (let step = 0; step < 8; step += 1) {
        const answered = await call(cookie, id, "POST", {});
        expect(answered.status, JSON.stringify(answered.body)).toBe(200);
        if (!["preflight", "running"].includes(answered.item.status)) {
          return answered;
        }
      }
      throw new Error("the delete did not finish in eight calls");
    }

    /** A published component drawing one heading. */
    async function card(
      t: TestNextly,
      title = "Card",
      slug = `card-${String(Math.random()).slice(2, 10)}`
    ): Promise<string> {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title,
          slug,
          status: "published",
          content: {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "component",
            nodes: [heading("t", `${title} title`)],
          },
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function note(
      t: TestNextly,
      title: string,
      nodes: Node[]
    ): Promise<string> {
      const created = await t.nextly.create({
        collection: NOTES,
        data: { title, content: pageDoc(nodes) },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

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

    async function exists(t: TestNextly, id: string): Promise<boolean> {
      const found = await t.nextly.find({
        collection: COMPONENTS_SLUG,
        where: { id: { equals: id } },
        status: "all",
        limit: 1,
        depth: 0,
        overrideAccess: true,
      });
      return found.items.length > 0;
    }

    const copies = (nodes: Node[], componentId: string) =>
      nodes.filter(
        node =>
          node.type === COMPONENT_INSTANCE_TYPE &&
          (node.props as { componentId?: unknown }).componentId === componentId
      ).length;

    const texts = (nodes: Node[]) =>
      nodes.map(node => (node.props as { text?: unknown }).text);

    /** Whether a new copy of the component may be added: the fence is down. */
    const addsACopy = (t: TestNextly, id: string) =>
      note(t, `New ${String(Math.random()).slice(2, 8)}`, [copyOf("n1", id)]);

    it("answers what a delete would do, changing nothing", async () => {
      const { t, cookie } = await boot();
      const used = await card(t);
      const spare = await card(t, "Spare");
      await note(t, "Holding", [copyOf("i1", used)]);

      const plan = await dryRun(cookie, used);

      expect(plan.status, JSON.stringify(plan.body)).toBe(200);
      expect(plan.item).toMatchObject({
        status: "used",
        mayDelete: true,
        run: null,
        plan: {
          convert: {
            named: [expect.objectContaining({ slug: NOTES, title: "Holding" })],
            unreadable: 0,
            more: 0,
          },
        },
      });
      // Nothing was fenced: a new copy may still be added.
      await expect(addsACopy(t, used)).resolves.toEqual(expect.any(String));
      expect((await call(cookie, used, "GET")).item.status).toBe("idle");
      // CONTROL: a component nothing uses reads as such.
      expect((await dryRun(cookie, spare)).item.status).toBe("none");
    });

    it("turns every copy into plain blocks, then deletes the component", async () => {
      const { t, cookie } = await boot();
      const cardId = await card(t);
      const id = await note(t, "Holding", [
        heading("own", "Own"),
        copyOf("i1", cardId),
      ]);

      const done = await deleteToTheEnd(cookie, cardId);

      expect(done.item.status, JSON.stringify(done.body)).toBe("done");
      const nodes = await nodesOf(t, NOTES, id);
      expect(copies(nodes, cardId)).toBe(0);
      expect(texts(nodes)).toEqual(["Own", "Card title"]);
      expect(await exists(t, cardId)).toBe(false);
      // The tombstone answers for the gone component, and a save from a
      // stale copy holding it is refused.
      expect((await call(cookie, cardId, "GET")).item.status).toBe("done");
      await expect(addsACopy(t, cardId)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    it("refuses before converting anything while a Layout uses it", async () => {
      const { t, cookie } = await boot();
      const cardId = await card(t);
      const id = await note(t, "Holding", [copyOf("i1", cardId)]);
      await t.nextly.create({
        collection: LAYOUTS_SLUG,
        data: {
          title: "Marketing",
          slug: "marketing",
          areas: [{ area: "header", component: cardId }],
          status: "published",
        },
        overrideAccess: true,
      });

      const plan = await dryRun(cookie, cardId);
      const started = await call(cookie, cardId, "POST", {});

      expect(plan.item.status).toBe("refused");
      expect(plan.item.layouts?.named).toEqual([
        expect.objectContaining({ title: "Marketing" }),
      ]);
      expect(started.item.status, JSON.stringify(started.body)).toBe("refused");
      expect(copies(await nodesOf(t, NOTES, id), cardId)).toBe(1);
      expect(await exists(t, cardId)).toBe(true);
      // The fence came down again.
      await expect(addsACopy(t, cardId)).resolves.toEqual(expect.any(String));
    });

    it("refuses before converting anything when one copy can't be converted", async () => {
      const { t, cookie } = await boot({}, { boards: true });
      const cardId = await card(t);
      const id = await note(t, "Holding", [copyOf("i1", cardId)]);
      // A copy inside a repeater row: no fixed path reaches it to write.
      await t.nextly.create({
        collection: BOARDS,
        data: {
          title: "Board",
          rows: [{ body: pageDoc([copyOf("b1", cardId)]) }],
        },
        overrideAccess: true,
      });

      const started = await call(cookie, cardId, "POST", {});

      expect(started.item.status, JSON.stringify(started.body)).toBe("refused");
      expect(started.item.left).toContainEqual(
        expect.objectContaining({
          document: expect.objectContaining({ slug: BOARDS, title: "Board" }),
          reason: "unaddressable",
        })
      );
      // No host changed, not even the one that could have been.
      expect(copies(await nodesOf(t, NOTES, id), cardId)).toBe(1);
      expect(await exists(t, cardId)).toBe(true);
      expect((await call(cookie, cardId, "GET")).item.status).toBe("idle");
    });

    it("keeps the component while a page holds unpublished changes", async () => {
      const { t, cookie } = await boot();
      const cardId = await card(t);
      const created = await t.nextly.create({
        collection: "pages",
        data: {
          title: "Live",
          slug: `live-${String(Math.random()).slice(2, 10)}`,
          status: "published",
          content: pageDoc([copyOf("i1", cardId)]),
        },
        overrideAccess: true,
      });
      const pageId = String(created.item.id);
      // An edit saved without publishing: a pending draft over the live row.
      await t.nextly.update({
        collection: "pages",
        id: pageId,
        data: {
          content: pageDoc([copyOf("i1", cardId), heading("d", "Draft edit")]),
          _overwrite: true,
        },
        overrideAccess: true,
      });

      const ended = await deleteToTheEnd(cookie, cardId);

      expect(ended.item.status, JSON.stringify(ended.body)).toBe("partly-done");
      expect(ended.item.left).toEqual([
        expect.objectContaining({
          document: expect.objectContaining({ slug: "pages", id: pageId }),
          reason: "pending-draft",
        }),
      ]);
      // The draft was converted; the live row keeps its copy, and so the
      // component is kept, with the fence down.
      expect(copies(await nodesOf(t, "pages", pageId, true), cardId)).toBe(0);
      expect(copies(await nodesOf(t, "pages", pageId), cardId)).toBe(1);
      expect(await exists(t, cardId)).toBe(true);
      expect((await call(cookie, cardId, "GET")).item.status).toBe("idle");
    });

    it("lets only the person who started a delete carry it on", async () => {
      const { t, cookie, anAuthor } = await boot();
      const cardId = await card(t);
      await note(t, "Holding", [copyOf("i1", cardId)]);
      const other = await anAuthor("other", [
        "read-components",
        "delete-components",
        "read-notes",
        "update-notes",
      ]);

      const started = await call(cookie, cardId, "POST", {});
      const refused = await call(other, cardId, "POST", {});
      const seen = await call(other, cardId, "GET");

      expect(started.item.status, JSON.stringify(started.body)).toBe("running");
      expect(refused.status).toBe(409);
      expect(seen.item).toMatchObject({
        status: "running",
        run: { yours: false },
      });
      // CONTROL: the person who started it carries it to the end.
      expect((await deleteToTheEnd(cookie, cardId)).item.status).toBe("done");
    });

    it("tells a person without the right to delete components so, and refuses them", async () => {
      const { t, anAuthor } = await boot();
      const cardId = await card(t);
      const reader = await anAuthor("reader", ["read-components"]);

      const plan = await dryRun(reader, cardId);
      const started = await call(reader, cardId, "POST", {});

      expect(plan.status, JSON.stringify(plan.body)).toBe(200);
      expect(plan.item.mayDelete).toBe(false);
      expect(started.status).toBe(403);
      expect(await exists(t, cardId)).toBe(true);
    });

    it("refuses a component's own delete made any other way", async () => {
      const { t } = await boot();
      const cardId = await card(t);

      await expect(
        t.nextly.delete({
          collection: COMPONENTS_SLUG,
          id: cardId,
          overrideAccess: true,
        })
      ).rejects.toThrow("Delete component");
      expect(await exists(t, cardId)).toBe(true);
    });

    it("refuses unpublishing a component a document places, naming it", async () => {
      const { t, backfill } = await boot();
      const used = await card(t);
      const spare = await card(t, "Spare");
      await note(t, "Holding", [copyOf("i1", used)]);
      await backfill();
      const unpublish = (id: string) =>
        t.nextly.update({
          collection: COMPONENTS_SLUG,
          id,
          data: { status: "draft", _overwrite: true },
          overrideAccess: true,
        });

      await expect(unpublish(used)).rejects.toThrow(
        "can't be unpublished because 1 document uses it"
      );
      // CONTROL: one nothing places unpublishes.
      await expect(unpublish(spare)).resolves.toBeDefined();
    });

    it("refuses a save held past validation that lands after the delete", async () => {
      const switches: Switches = {};
      const { t, cookie } = await boot(switches);
      const cardId = await card(t);
      const id = await note(t, "Holding", [copyOf("i1", cardId)]);
      let reached!: () => void;
      const atHold = new Promise<void>(resolve => {
        reached = resolve;
      });
      let release!: () => void;
      switches.holdAfterValidation = {
        title: "Edited",
        reached,
        release: new Promise<void>(resolve => {
          release = resolve;
        }),
      };
      // Opened first, so the save is judged under the fence: it keeps the
      // copy the note stores now, which the fence lets through.
      expect((await call(cookie, cardId, "POST", {})).item.status).toBe(
        "running"
      );
      const save = t.nextly
        .update({
          collection: NOTES,
          id,
          data: {
            title: "Edited",
            content: pageDoc([copyOf("i1", cardId), heading("e", "Edit")]),
            _overwrite: true,
          },
          overrideAccess: true,
        })
        .then(
          () => undefined,
          (error: unknown) => error
        );
      await atHold;

      const done = await deleteToTheEnd(cookie, cardId);
      release();
      const refused = await save;

      expect(done.item.status).toBe("done");
      expect(refused).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(copies(await nodesOf(t, NOTES, id), cardId)).toBe(0);
      expect(await exists(t, cardId)).toBe(false);
    });

    it("keeps a save held past validation that lands after the final walk read it, before the delete", async () => {
      const switches: Switches = {};
      const { t, cookie } = await boot(switches);
      const cardId = await card(t);
      const id = await note(t, "Holding", [copyOf("i1", cardId)]);
      // A Layout not using the card, so the final walk's scan reads a row.
      await t.nextly.create({
        collection: LAYOUTS_SLUG,
        data: { title: "Plain", slug: "plain", areas: [], status: "published" },
        overrideAccess: true,
      });
      let reached!: () => void;
      const atHold = new Promise<void>(resolve => {
        reached = resolve;
      });
      let release!: () => void;
      switches.holdAfterValidation = {
        title: "Edited",
        reached,
        release: new Promise<void>(resolve => {
          release = resolve;
        }),
      };
      expect((await call(cookie, cardId, "POST", {})).item.status).toBe(
        "running"
      );
      const save = t.nextly.update({
        collection: NOTES,
        id,
        data: {
          title: "Edited",
          content: pageDoc([copyOf("i1", cardId), heading("e", "Edit")]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      await atHold;
      // Once the final walk has read the converted note, the held save
      // lands, putting the copy back with the author's edit. Only the fence
      // in the save's own transaction can tell the run.
      switches.onLayoutRead = async () => {
        release();
        await save;
      };

      const done = await deleteToTheEnd(cookie, cardId);

      expect(done.item.status, JSON.stringify(done.body)).toBe("done");
      const nodes = await nodesOf(t, NOTES, id);
      expect(copies(nodes, cardId)).toBe(0);
      expect(texts(nodes)).toEqual(["Card title", "Edit"]);
      expect(await exists(t, cardId)).toBe(false);
    });
    it("converts nothing for a person a rule lets delete other components but not this one", async () => {
      const { t, anAuthor } = await boot({}, { rowRule: true });
      const kept = await card(t, "Kept");
      const deletable = await card(t, "Deletable", "deletable");
      const id = await note(t, "Holding", [copyOf("i1", kept)]);
      const designer = await anAuthor("designer", [
        "read-components",
        "delete-components",
        "read-notes",
        "update-notes",
      ]);

      const plan = await dryRun(designer, kept);
      const started = await call(designer, kept, "POST", {});

      expect(plan.item.mayDelete).toBe(false);
      expect(started.status, JSON.stringify(started.body)).toBe(403);
      expect(copies(await nodesOf(t, NOTES, id), kept)).toBe(1);
      expect(await exists(t, kept)).toBe(true);
      expect((await call(designer, kept, "GET")).item.status).toBe("idle");
      // CONTROL: the component the rule allows is deleted, through the probe
      // and the real delete alike.
      expect((await dryRun(designer, deletable)).item.mayDelete).toBe(true);
      expect((await deleteToTheEnd(designer, deletable)).item.status).toBe(
        "done"
      );
      expect(await exists(t, deletable)).toBe(false);
    });

    it("refuses unpublishing a component a page holds that the index does not name", async () => {
      const { t, backfill } = await boot();
      const cardId = await card(t);
      await note(t, "Holding", [copyOf("i1", cardId)]);
      await backfill();
      // The index rows gone, as a failed maintenance write leaves them: the
      // index names nobody, and only reading the pages finds the copy.
      await t.adapter.delete("page_builder__component_usage", {
        and: [{ column: "entity", op: "=", value: NOTES }],
      });

      await expect(
        t.nextly.update({
          collection: COMPONENTS_SLUG,
          id: cardId,
          data: { status: "draft", _overwrite: true },
          overrideAccess: true,
        })
      ).rejects.toThrow("can't be unpublished because 1 document uses it");
    });

    it("refuses a save held past validation released long after the delete", async () => {
      const switches: Switches = {};
      const { t, cookie, sweep } = await boot(switches);
      const cardId = await card(t);
      const id = await note(t, "Holding", [copyOf("i1", cardId)]);
      let reached!: () => void;
      const atHold = new Promise<void>(resolve => {
        reached = resolve;
      });
      let release!: () => void;
      switches.holdAfterValidation = {
        title: "Edited",
        reached,
        release: new Promise<void>(resolve => {
          release = resolve;
        }),
      };
      expect((await call(cookie, cardId, "POST", {})).item.status).toBe(
        "running"
      );
      const save = t.nextly
        .update({
          collection: NOTES,
          id,
          data: {
            title: "Edited",
            content: pageDoc([copyOf("i1", cardId), heading("e", "Edit")]),
            _overwrite: true,
          },
          overrideAccess: true,
        })
        .then(
          () => undefined,
          (error: unknown) => error
        );
      await atHold;
      expect((await deleteToTheEnd(cookie, cardId)).item.status).toBe("done");
      // The delete made an hour ago, as far as the row says, and the sweep
      // run since: nothing about the fence is kept by a clock.
      await t.adapter.update(
        "page_builder__component_deletions",
        { cursor: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
        { and: [{ column: "componentId", op: "=", value: cardId }] }
      );
      await sweep();

      release();
      const refused = await save;

      expect(refused).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(copies(await nodesOf(t, NOTES, id), cardId)).toBe(0);
    });

    it("answers a dry run over a slice at a time, never 'none' before the last", async () => {
      const { t, cookie } = await boot();
      const spare = await card(t, "Spare");
      // More documents than one slice judges, none using the component.
      for (let n = 0; n < 30; n += 1) {
        await note(t, `Plain ${String(n)}`, [heading(`h${String(n)}`, "x")]);
      }

      const first = await dryRun(cookie, spare);
      const second = await call(cookie, spare, "POST", {
        dryRun: true,
        after: first.item.plan?.next,
      });

      expect(first.item).toMatchObject({
        status: "counting",
        plan: { complete: false },
      });
      expect(typeof first.item.plan?.next).toBe("string");
      expect(second.item).toMatchObject({
        status: "none",
        plan: { complete: true, next: null },
      });
    });
  }
);
