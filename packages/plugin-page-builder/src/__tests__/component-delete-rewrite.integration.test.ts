/**
 * Turning every copy of a component into plain blocks before it is deleted,
 * against a real database per dialect, run as a signed-in author through a
 * plugin route, as the delete job will run it.
 *
 * What only a database shows: that the run's row is unique however many start
 * it at once; that the fence refuses a new reference and keeps a stored one;
 * that no author's edit is lost whichever of the two writes commits first;
 * that a run interrupted mid-way resumes without skipping a document; that a
 * progress row nobody's walk wrote skips nothing; and that a published page
 * with a pending draft is converted where it can be and reported where it
 * cannot, and a draft discarded mid-read is never saved again; and that a
 * starter who may update a document has its rewrite made, whatever they may
 * read of it, while one who may not update it is refused.
 *
 * @module __tests__/component-delete-rewrite.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import {
  definePlugin,
  readStoredFields,
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
import { afterEach, describe, expect, it, vi } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { asDocument } from "../component-store-source";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { documentKeyOf, type RewriteReport } from "../host-rewrite/contract";
import type { DeletionRun, RunPurpose } from "../host-rewrite/fence";
import {
  COMPONENT_DELETE_REWRITE_SERVICE,
  type ComponentDeleteRewriteService,
} from "../host-rewrite/service";
import { pageBuilder } from "../plugin";

/**
 * Run after each stored read the plugin makes, with what was asked and what
 * was read, while a test sets it: the one place between the rewrite's live
 * read of a host and its draft read, which no hook of the site reaches.
 */
const storedReads = vi.hoisted(() => ({
  after: undefined as
    | ((request: unknown, read: unknown) => Promise<void>)
    | undefined,
}));

// The SDK as it is, with the stored read passed through to core's and the
// seam above run after it.
vi.mock("@nextlyhq/plugin-sdk", async importOriginal => {
  const sdk = await importOriginal<typeof import("@nextlyhq/plugin-sdk")>();
  return {
    ...sdk,
    readStoredFields: async (
      ...args: Parameters<typeof sdk.readStoredFields>
    ) => {
      const read = await sdk.readStoredFields(...args);
      await storedReads.after?.(args[1], read);
      return read;
    },
  };
});

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
const HARNESS = "@t/rewrite-harness";
const NOTES = "notes";
/** A collection whose blocks values sit in a repeater: no fixed path reaches them. */
const BOARDS = "boards";
/**
 * A collection whose blocks field is laid out in a group with no name, inside
 * a named group: stored in the named group's value.
 */
const PANELS = "panels";
/** A translated collection whose blocks field sits in a group kept per language. */
const ARTICLES = "articles";
/** A collection whose blocks field a field read rule closes to every reader. */
const SEALED = "sealed";
/** A collection whose blocks field a field update rule closes to every writer. */
const LOCKED = "locked";

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
  /**
   * Run once, as the next update of a note starts: after the rewrite has read
   * it, and before the update's transaction takes the row lock.
   */
  onNoteUpdate?: (id: string) => Promise<void>;
  /** Hold the next note write with this title after its validation. */
  holdAfterValidation?: {
    title: string;
    reached: () => void;
    release: Promise<void>;
  };
  /** Hide every component copy from what a read of a note returns. */
  hideCopiesOnRead?: boolean;
  /** Hide every component copy inside a board's rows from what reads return. */
  hideBoardCopiesOnRead?: boolean;
  /** Leave the lifecycle state out of what a read of a page returns. */
  hidePageStatusOnRead?: boolean;
  /** Fail the next update of this note as if the process stopped. */
  crashOn?: string;
  /** Run once, on the `atRead`-th read of this page by id. */
  onPageRead?: { id: string; atRead: number; run: () => Promise<void> };
}

/**
 * A plugin whose route runs the rewrite as its caller, and whose hooks time an
 * author's edit against it.
 */
function harness(
  switches: Switches,
  service: () => ComponentDeleteRewriteService
): PluginDefinition {
  return definePlugin({
    name: HARNESS,
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      // A site's presentation hook, reshaping what reads return: the stored
      // value keeps its copies.
      ctx.hooks.on("afterRead", NOTES, context => {
        if (switches.hideCopiesOnRead !== true) return;
        const data = (context as { data?: unknown }).data;
        const hide = (row: unknown) => {
          const content = asDocument(
            (row as { content?: unknown } | null)?.content
          );
          if (content === null) return row;
          return {
            ...(row as Record<string, unknown>),
            content: {
              ...content,
              nodes: content.nodes.filter(
                node => node.type !== COMPONENT_INSTANCE_TYPE
              ),
            },
          };
        };
        return Array.isArray(data) ? data.map(hide) : hide(data);
      });
      // The same presentation hook on a board, whose blocks values sit in the
      // rows of a repeater.
      ctx.hooks.on("afterRead", BOARDS, context => {
        if (switches.hideBoardCopiesOnRead !== true) return;
        const data = (context as { data?: unknown }).data;
        const hide = (row: unknown) => {
          const rows = (row as { rows?: unknown } | null)?.rows;
          if (!Array.isArray(rows)) return row;
          return {
            ...(row as Record<string, unknown>),
            rows: rows.map((entry: Record<string, unknown>) => {
              const body = asDocument(entry.body);
              return body === null
                ? entry
                : {
                    ...entry,
                    body: {
                      ...body,
                      nodes: body.nodes.filter(
                        node => node.type !== COMPONENT_INSTANCE_TYPE
                      ),
                    },
                  };
            }),
          };
        };
        return Array.isArray(data) ? data.map(hide) : hide(data);
      });
      // A presentation hook that leaves a page's state out of what reads
      // return, as a site shaping its public output might.
      ctx.hooks.on("afterRead", "pages", context => {
        if (switches.hidePageStatusOnRead !== true) return;
        const data = (context as { data?: unknown }).data;
        const hide = (row: unknown) => {
          if (typeof row !== "object" || row === null) return row;
          const rest: Record<string, unknown> = { ...row };
          delete rest.status;
          return rest;
        };
        return Array.isArray(data) ? data.map(hide) : hide(data);
      });
      let pageReads = 0;
      ctx.hooks.on("afterRead", "pages", async context => {
        const hold = switches.onPageRead;
        const data = (context as { data?: unknown }).data;
        if (hold === undefined || Array.isArray(data)) return;
        if ((data as { id?: unknown } | undefined)?.id !== hold.id) return;
        pageReads += 1;
        if (pageReads !== hold.atRead) return;
        switches.onPageRead = undefined;
        await hold.run();
      });
      ctx.hooks.on("beforeChange", NOTES, async context => {
        const hold = switches.holdAfterValidation;
        const title = (context as { data?: { title?: unknown } }).data?.title;
        if (hold === undefined || title !== hold.title) return;
        switches.holdAfterValidation = undefined;
        hold.reached();
        await hold.release;
      });
      ctx.hooks.on("beforeUpdate", NOTES, async context => {
        const original = (context as { originalData?: { id?: unknown } })
          .originalData;
        const run = switches.onNoteUpdate;
        if (run !== undefined && typeof original?.id === "string") {
          switches.onNoteUpdate = undefined;
          await run(original.id);
        }
        if (switches.crashOn === undefined) return;
        if (original?.id !== switches.crashOn) return;
        switches.crashOn = undefined;
        throw new Error("the process stopped");
      });
    },
    contributes: {
      routes: [
        {
          method: "POST",
          path: "/open",
          handler: async (req, ctx) => {
            const body = (await req.json()) as {
              componentId: string;
              purpose?: RunPurpose;
            };
            const opened = await service().open(
              body.componentId,
              ctx,
              body.purpose
            );
            return Response.json(opened);
          },
        },
        {
          method: "POST",
          path: "/rewrite",
          handler: async (req, ctx) => {
            const body = (await req.json()) as {
              componentId: string;
              maxDocuments?: number;
            };
            const report = await service().rewrite({
              componentId: body.componentId,
              caller: ctx,
              ...(body.maxDocuments === undefined
                ? {}
                : { maxDocuments: body.maxDocuments }),
            });
            return Response.json(report);
          },
        },
      ],
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "turning a component's copies into plain blocks (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      storedReads.after = undefined;
      await current?.destroy();
      current = undefined;
    });

    /** The grants every author here holds. */
    const AUTHOR_GRANTS = [
      "read-notes",
      "update-notes",
      "read-pages",
      "update-pages",
      "publish-pages",
      "read-components",
    ];

    async function boot(
      switches: Switches = {},
      site: {
        singles?: unknown[];
        localization?: { locales: string[]; defaultLocale: string };
        /** Whether the site also has boards. */
        boards?: boolean;
        /** Whether the site also has panels. */
        panels?: boolean;
        /** Whether the site also has articles (it must then be translated). */
        articles?: boolean;
        /** Whether the site also has sealed notes. */
        sealed?: boolean;
        /** Whether the site also has locked notes. */
        locked?: boolean;
      } = {}
    ) {
      const plugin = pageBuilder();
      const service = () =>
        plugin.contributes?.services?.[
          COMPONENT_DELETE_REWRITE_SERVICE
        ]?.() as ComponentDeleteRewriteService;
      current = await createTestNextly({
        dialect,
        plugins: [plugin, harness(switches, service)],
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
          ...(site.panels === true
            ? [
                {
                  slug: PANELS,
                  fields: [
                    { name: "title", type: "text" },
                    {
                      name: "panel",
                      type: "group",
                      fields: [
                        {
                          type: "group",
                          fields: [{ name: "content", type: BLOCKS_TYPE }],
                        },
                      ],
                    },
                  ],
                } as never,
              ]
            : []),
          ...(site.articles === true
            ? [
                {
                  slug: ARTICLES,
                  localized: true,
                  fields: [
                    { name: "title", type: "text" },
                    {
                      name: "hero",
                      type: "group",
                      localized: true,
                      fields: [{ name: "body", type: BLOCKS_TYPE }],
                    },
                  ],
                } as never,
              ]
            : []),
          ...(site.sealed === true
            ? [
                {
                  slug: SEALED,
                  fields: [
                    { name: "title", type: "text" },
                    {
                      name: "content",
                      type: BLOCKS_TYPE,
                      access: { read: () => false },
                    },
                  ],
                } as never,
              ]
            : []),
          ...(site.locked === true
            ? [
                {
                  slug: LOCKED,
                  fields: [
                    { name: "title", type: "text" },
                    {
                      name: "content",
                      type: BLOCKS_TYPE,
                      access: { update: () => false },
                    },
                  ],
                } as never,
              ]
            : []),
        ],
        ...(site.singles === undefined
          ? {}
          : { singles: site.singles as never }),
        ...(site.localization === undefined
          ? {}
          : { localization: site.localization }),
      });
      const t = current;
      // The first user is the super admin; it is made and never acts.
      await person(t, "owner");
      const singleSlugs = (site.singles ?? []).map(
        single => (single as { slug: string }).slug
      );
      const extra = [
        ...(site.panels === true ? [`read-${PANELS}`, `update-${PANELS}`] : []),
        ...(site.articles === true
          ? [`read-${ARTICLES}`, `update-${ARTICLES}`]
          : []),
        ...(site.sealed === true ? [`read-${SEALED}`, `update-${SEALED}`] : []),
        ...(site.locked === true ? [`read-${LOCKED}`, `update-${LOCKED}`] : []),
      ];
      /** An author, with every author's grants or only the ones given. */
      const anAuthor = async (
        name: string,
        grants: string[] = [...AUTHOR_GRANTS, ...extra]
      ) => {
        const id = await person(t, name);
        await grant(t, id, grants, singleSlugs);
        return { id, cookie: await sessionOf(t, id) };
      };
      const author = await anAuthor("author");
      return {
        t,
        svc: service(),
        author: author.id,
        cookie: author.cookie,
        anAuthor,
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

    async function grant(
      t: TestNextly,
      userId: string,
      slugs: string[],
      singles: string[] = []
    ) {
      const permissions = await t.nextly.permissions.find({ limit: 500 });
      const ids = slugs.map(slug => {
        const found = permissions.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      // Every permission seeded for each Single, whatever its actions are.
      for (const single of singles) {
        const own = permissions.items.filter(item =>
          item.slug.endsWith(`-${single}`)
        );
        if (own.length === 0) throw new Error(`no permission for ${single}`);
        ids.push(...own.map(item => item.id));
      }
      const role = await t.nextly.roles.create({
        data: {
          name: `Rewrite author ${String(Math.random()).slice(2, 10)}`,
          // Not `author`, which a fresh site already seeds.
          slug: `rewrite-author-${String(Math.random()).slice(2, 10)}`,
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

    /** One call of the rewrite through the harness route, as the author. */
    async function rewrite(
      cookie: string,
      body: { componentId: string; maxDocuments?: number }
    ): Promise<{ status: number; report: RewriteReport }> {
      const answered = await post(cookie, "rewrite", body);
      return {
        status: answered.status,
        report: answered.body as RewriteReport,
      };
    }

    /** Open a run through the harness route, as whoever `cookie` signs in. */
    async function open(
      cookie: string,
      componentId: string,
      purpose?: RunPurpose
    ): Promise<{ opened: boolean; run: DeletionRun }> {
      const answered = await post(cookie, "open", { componentId, purpose });
      expect(answered.status, JSON.stringify(answered.body)).toBe(200);
      return answered.body as { opened: boolean; run: DeletionRun };
    }

    /** Discard a page's working draft, as its author does, through core's route. */
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

    /** One POST to a harness route. */
    async function post(
      cookie: string,
      route: "open" | "rewrite",
      body: unknown
    ): Promise<{ status: number; body: unknown }> {
      const handlers = createDynamicHandlers();
      const url = `${ORIGIN}/api/plugins/${HARNESS}/${route}`;
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
            params: ["plugins", ...HARNESS.split("/"), route],
          }),
        }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: text === "" ? {} : (JSON.parse(text) as unknown),
      };
    }

    /** Rewrite until the run says it is finished, at most a few calls. */
    async function rewriteToTheEnd(
      cookie: string,
      componentId: string
    ): Promise<RewriteReport[]> {
      const reports: RewriteReport[] = [];
      for (let call = 0; call < 5; call += 1) {
        const answered = await rewrite(cookie, { componentId });
        // The body says why, when a call is refused.
        expect(answered.status, JSON.stringify(answered.report)).toBe(200);
        reports.push(answered.report);
        if (answered.report.finished) return reports;
      }
      throw new Error("the rewrite did not finish in five calls");
    }

    /** A published component drawing one heading. */
    async function card(t: TestNextly): Promise<string> {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "Card",
          slug: `card-${String(Math.random()).slice(2, 10)}`,
          status: "published",
          content: {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "component",
            nodes: [heading("t", "Card title")],
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

    /** A stored blocks value's top-level nodes, in one form. */
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

    const copies = (nodes: Node[], componentId: string) =>
      nodes.filter(
        node =>
          node.type === COMPONENT_INSTANCE_TYPE &&
          (node.props as { componentId?: unknown }).componentId === componentId
      ).length;

    const texts = (nodes: Node[]) =>
      nodes.map(node => (node.props as { text?: unknown }).text);

    it("opens one run however many start it at once, and fences new references", async () => {
      const { t, svc, cookie } = await boot();
      const cardId = await card(t);
      const holding = await note(t, "Holding", [copyOf("i1", cardId)]);

      const opened = await Promise.all([
        open(cookie, cardId),
        open(cookie, cardId),
      ]);

      expect(opened.filter(one => one.opened)).toHaveLength(1);
      expect(opened[0]?.run.id).toBe(opened[1]?.run.id);

      // A new reference is refused while the run is open...
      await expect(
        note(t, "New", [copyOf("i1", cardId)])
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      // ...and one the stored form already holds may stay.
      await t.nextly.update({
        collection: NOTES,
        id: holding,
        data: {
          title: "Renamed",
          content: pageDoc([copyOf("i1", cardId)]),
          _overwrite: true,
        },
        overrideAccess: true,
      });

      await svc.close(cardId);
      // CONTROL: the same write passes once the run is closed.
      await expect(note(t, "Later", [copyOf("i1", cardId)])).resolves.toEqual(
        expect.any(String)
      );
    });

    it("keeps an author's edit committed between the rewrite's read and its write", async () => {
      const switches: Switches = {};
      const { t, cookie } = await boot(switches);
      const cardId = await card(t);
      const id = await note(t, "Note", [
        heading("own", "Own"),
        copyOf("i1", cardId),
      ]);
      await open(cookie, cardId);

      // The author saves once the rewrite has read the note and its write has
      // started, before that write takes the row lock.
      switches.onNoteUpdate = async writtenId => {
        if (writtenId !== id) return;
        await t.nextly.update({
          collection: NOTES,
          id,
          data: {
            content: pageDoc([
              heading("own", "Own"),
              copyOf("i1", cardId),
              heading("edit", "Author edit"),
            ]),
            _overwrite: true,
          },
          overrideAccess: true,
        });
      };

      await rewriteToTheEnd(cookie, cardId);

      const nodes = await nodesOf(t, NOTES, id);
      expect(copies(nodes, cardId)).toBe(0);
      expect(texts(nodes)).toEqual(["Own", "Card title", "Author edit"]);
    });

    it("keeps an author's edit committed after the rewrite converted the note", async () => {
      const switches: Switches = {};
      const { t, cookie } = await boot(switches);
      const cardId = await card(t);
      const id = await note(t, "Note", [copyOf("i1", cardId)]);
      await open(cookie, cardId);

      // The author's save is judged while the note still holds the copy, and
      // commits after the rewrite has converted it.
      let reached!: () => void;
      let release!: () => void;
      const held = new Promise<void>(resolve => (reached = resolve));
      switches.holdAfterValidation = {
        title: "Edited",
        reached: () => reached(),
        release: new Promise<void>(resolve => (release = resolve)),
      };
      const save = t.nextly.update({
        collection: NOTES,
        id,
        data: {
          title: "Edited",
          content: pageDoc([
            copyOf("i1", cardId),
            heading("edit", "Author edit"),
          ]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      await held;
      const first = await rewriteToTheEnd(cookie, cardId);
      expect(first.at(-1)?.finished).toBe(true);
      release();
      await save;
      // The save put the copy back; the note was re-queued.
      expect(copies(await nodesOf(t, NOTES, id), cardId)).toBe(1);

      await rewriteToTheEnd(cookie, cardId);

      const nodes = await nodesOf(t, NOTES, id);
      expect(copies(nodes, cardId)).toBe(0);
      expect(texts(nodes)).toEqual(["Card title", "Author edit"]);
    });

    it("resumes after a crash mid-run without skipping a note", async () => {
      const switches: Switches = {};
      const { t, cookie } = await boot(switches);
      const cardId = await card(t);
      const ids = [
        await note(t, "One", [copyOf("i1", cardId)]),
        await note(t, "Two", [copyOf("i1", cardId)]),
        await note(t, "Three", [copyOf("i1", cardId)]),
      ];
      await open(cookie, cardId);
      switches.crashOn = ids[1];

      const crashed = await rewrite(cookie, { componentId: cardId });
      expect(
        crashed.status,
        JSON.stringify(crashed.report)
      ).toBeGreaterThanOrEqual(500);
      const reports = await rewriteToTheEnd(cookie, cardId);

      for (const id of ids) {
        expect(copies(await nodesOf(t, NOTES, id), cardId)).toBe(0);
      }
      // The resumed converting walk did the work; the final walk found none.
      expect(reports.flatMap(report => report.caughtByFinalWalk)).toEqual([]);
    });

    it("does not let a forged progress row skip the final walk", async () => {
      const { t, cookie } = await boot();
      const cardId = await card(t);
      const id = await note(t, "Note", [copyOf("i1", cardId)]);
      const { run } = await open(cookie, cardId);
      // A row no walk wrote, claiming the note is already converted.
      await t.adapter.insert("page_builder__component_deletion_hosts", {
        id: globalThis.crypto.randomUUID(),
        deletion_id: run.id,
        host_key: documentKeyOf({ kind: "collection", slug: NOTES, id }),
        state: "rewritten",
        reason: null,
      });

      const reports = await rewriteToTheEnd(cookie, cardId);

      expect(copies(await nodesOf(t, NOTES, id), cardId)).toBe(0);
      expect(
        reports.flatMap(report => report.caughtByFinalWalk).map(host => host.id)
      ).toEqual([id]);
    });

    it("converts a published page's pending draft and reports its live row", async () => {
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
      await open(cookie, cardId);

      const reports = await rewriteToTheEnd(cookie, cardId);
      const final = reports.at(-1);

      expect(final?.left).toContainEqual(
        expect.objectContaining({
          host: expect.objectContaining({ slug: "pages", id: pageId }),
          reason: "pending-draft",
        })
      );
      const draft = await nodesOf(t, "pages", pageId, true);
      expect(copies(draft, cardId)).toBe(0);
      expect(texts(draft)).toEqual(["Card title", "Draft edit"]);
      expect(copies(await nodesOf(t, "pages", pageId), cardId)).toBe(1);
    });

    it("refuses a rewrite asked for by anybody but the person who opened the run", async () => {
      const { t, cookie, anAuthor } = await boot();
      const cardId = await card(t);
      const id = await note(t, "Note", [copyOf("i1", cardId)]);
      await open(cookie, cardId);
      const other = await anAuthor("other");

      // The same grants, a different person: the run's writes are not theirs.
      const refused = await rewrite(other.cookie, { componentId: cardId });
      // And the person whose run it is reaching it second is answered the run
      // as it was opened, not a run of their own.
      const reopened = await open(other.cookie, cardId);

      expect(refused.status).toBe(403);
      expect(reopened.opened).toBe(false);
      expect(copies(await nodesOf(t, NOTES, id), cardId)).toBe(1);
      // CONTROL: the person who opened it may.
      await rewriteToTheEnd(cookie, cardId);
      expect(copies(await nodesOf(t, NOTES, id), cardId)).toBe(0);
    });

    it("walks every language of a translated Single", async () => {
      const HOME = "home";
      const { t, cookie } = await boot(
        {},
        {
          singles: [
            {
              slug: HOME,
              localized: true,
              // Stored per language: the registry's listing drops this flag,
              // so it is read from the Single's declaration.
              fields: [{ name: "content", type: BLOCKS_TYPE, localized: true }],
            },
          ],
          localization: { locales: ["en", "de"], defaultLocale: "en" },
        }
      );
      const cardId = await card(t);
      await t.nextly.updateSingle({
        slug: HOME,
        locale: "en",
        data: {
          content: pageDoc([heading("en", "English")]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      // The copy is only in German, which the default language never shows.
      await t.nextly.updateSingle({
        slug: HOME,
        locale: "de",
        data: {
          content: pageDoc([heading("de", "Deutsch"), copyOf("i1", cardId)]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      await open(cookie, cardId);

      await rewriteToTheEnd(cookie, cardId);

      const read = async (locale: string) =>
        (asDocument(
          (
            (await t.nextly.findSingle({
              slug: HOME,
              locale,
              fallbackLocale: false,
              overrideAccess: true,
              depth: 0,
            })) as unknown as Record<string, unknown>
          ).content
        )?.nodes ?? []) as Node[];
      const german = await read("de");
      expect(copies(german, cardId)).toBe(0);
      expect(texts(german)).toEqual(["Deutsch", "Card title"]);
      expect(texts(await read("en"))).toEqual(["English"]);
    });

    it("keeps a strip run and a delete run of one component apart, and only the delete run fences", async () => {
      const { t, svc, cookie } = await boot();
      const cardId = await card(t);
      const id = await note(t, "Note", [copyOf("i1", cardId)]);

      const strip = await open(cookie, cardId, "strip-retired");
      // A strip run fences nothing: a new copy may still be added.
      await expect(
        note(t, "During strip", [copyOf("i1", cardId)])
      ).resolves.toEqual(expect.any(String));
      const remove = await open(cookie, cardId, "delete");
      await expect(
        note(t, "During delete", [copyOf("i1", cardId)])
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      await rewriteToTheEnd(cookie, cardId);

      expect(remove.run.id).not.toBe(strip.run.id);
      expect(copies(await nodesOf(t, NOTES, id), cardId)).toBe(0);
      expect(await svc.progress(cardId, "strip-retired")).toEqual([]);
      expect(
        (await svc.progress(cardId, "delete")).map(row => row.documentKey)
      ).toContain(documentKeyOf({ kind: "collection", slug: NOTES, id }));
    });

    it("does not publish a draft an author saved between the rewrite's read and its write", async () => {
      const switches: Switches = {};
      const { t, cookie } = await boot(switches);
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
      await open(cookie, cardId);
      // The rewrite reads the live row and finds no draft (its second read);
      // the author then saves a draft that changes only the title.
      switches.onPageRead = {
        id: pageId,
        atRead: 2,
        run: async () => {
          await t.nextly.update({
            collection: "pages",
            id: pageId,
            data: { title: "Author draft", _overwrite: true },
            overrideAccess: true,
          });
        },
      };

      const reports = await rewriteToTheEnd(cookie, cardId);

      const live = (await t.nextly.findByID({
        collection: "pages",
        id: pageId,
        overrideAccess: true,
        status: "all",
        depth: 0,
      })) as unknown as { title: string; content: unknown };
      // The draft stayed a draft: its title is not live.
      expect(live.title).toBe("Live");
      expect(copies(await nodesOf(t, "pages", pageId), cardId)).toBe(1);
      const draft = (await t.nextly.findByID({
        collection: "pages",
        id: pageId,
        overrideAccess: true,
        status: "all",
        depth: 0,
        draft: true,
      })) as unknown as { title: string };
      expect(draft.title).toBe("Author draft");
      expect(copies(await nodesOf(t, "pages", pageId, true), cardId)).toBe(0);
      expect(reports.at(-1)?.left).toContainEqual(
        expect.objectContaining({
          host: expect.objectContaining({ id: pageId }),
          reason: "pending-draft",
        })
      );
    });

    it("records a document both walks find unchanged once, in that state", async () => {
      const { t, svc, cookie } = await boot();
      const cardId = await card(t);
      await note(t, "Note", [copyOf("i1", cardId)]);
      await open(cookie, cardId);

      await rewriteToTheEnd(cookie, cardId);

      // The component's own document holds no copy of itself, so the
      // converting walk and the final walk both record it unchanged: the second
      // record writes the state the row already holds.
      const own = documentKeyOf({
        kind: "collection",
        slug: COMPONENTS_SLUG,
        id: cardId,
      });
      const rows = (await svc.progress(cardId)).filter(
        row => row.documentKey === own
      );
      expect(rows).toEqual([
        { documentKey: own, state: "unchanged", reason: null },
      ]);
    });

    it("converts a page draft from the component's pending draft, and a live page from its published definition", async () => {
      const { t, cookie } = await boot();
      const cardId = await card(t);
      const publishedPage = async (title: string) =>
        String(
          (
            await t.nextly.create({
              collection: "pages",
              data: {
                title,
                slug: `${title.toLowerCase()}-${String(Math.random()).slice(2, 10)}`,
                status: "published",
                content: pageDoc([copyOf("i1", cardId)]),
              },
              overrideAccess: true,
            })
          ).item.id
        );
      const withDraft = await publishedPage("Drafted");
      const liveOnly = await publishedPage("Live");
      await t.nextly.update({
        collection: "pages",
        id: withDraft,
        data: {
          content: pageDoc([copyOf("i1", cardId), heading("d", "Draft edit")]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      // The component's own pending change: "New title" over the published
      // "Card title".
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: cardId,
        data: {
          content: {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "component",
            nodes: [heading("t", "New title")],
          },
          _overwrite: true,
        },
        overrideAccess: true,
      });
      await open(cookie, cardId);

      await rewriteToTheEnd(cookie, cardId);

      // The draft shows what its author saw in the editor...
      expect(texts(await nodesOf(t, "pages", withDraft, true))).toEqual([
        "New title",
        "Draft edit",
      ]);
      // ...and a live page what its visitors saw.
      expect(texts(await nodesOf(t, "pages", liveOnly))).toEqual([
        "Card title",
      ]);
    });

    it("refuses a bulk write that skips hooks and keeps a fenced reference", async () => {
      const { t, cookie } = await boot();
      const cardId = await card(t);
      const id = await note(t, "Note", [copyOf("i1", cardId)]);
      await open(cookie, cardId);
      const entries = (
        t.getService("collectionsHandler") as unknown as {
          getEntryService(): {
            updateEntries(
              params: { collectionName: string; overrideAccess?: boolean },
              entries: { id: string; data: Record<string, unknown> }[],
              options?: { skipHooks?: boolean }
            ): Promise<{ failed: number }>;
          };
        }
      ).getEntryService();

      // Its hooks would re-queue the note after commit; skipped, nothing would.
      const kept = await entries.updateEntries(
        { collectionName: NOTES, overrideAccess: true },
        [
          {
            id,
            data: {
              title: "Bulk",
              content: pageDoc([copyOf("i1", cardId)]),
              _overwrite: true,
            },
          },
        ],
        { skipHooks: true }
      );
      // CONTROL: the same bulk write without the copy goes through.
      const dropped = await entries.updateEntries(
        { collectionName: NOTES, overrideAccess: true },
        [
          {
            id,
            data: {
              title: "Bulk",
              content: pageDoc([heading("h", "Plain")]),
              _overwrite: true,
            },
          },
        ],
        { skipHooks: true }
      );

      expect(kept.failed).toBe(1);
      expect(dropped.failed).toBe(0);
    });

    it("finds a copy a site's read hook hides, by reading what is stored", async () => {
      const switches: Switches = {};
      const { t, cookie } = await boot(switches);
      const cardId = await card(t);
      const id = await note(t, "Note", [
        heading("own", "Own"),
        copyOf("i1", cardId),
      ]);
      await open(cookie, cardId);
      switches.hideCopiesOnRead = true;

      await rewriteToTheEnd(cookie, cardId);

      // Read with the hook off: what is stored.
      switches.hideCopiesOnRead = false;
      const nodes = await nodesOf(t, NOTES, id);
      expect(copies(nodes, cardId)).toBe(0);
      expect(texts(nodes)).toEqual(["Own", "Card title"]);
    });

    it("reports a board whose repeater holds a copy a site's read hook hides, by reading what is stored", async () => {
      const switches: Switches = {};
      const { t, cookie } = await boot(switches, { boards: true });
      const cardId = await card(t);
      const created = await t.nextly.create({
        collection: BOARDS,
        data: {
          title: "Board",
          rows: [
            { body: pageDoc([heading("own", "Own"), copyOf("i1", cardId)]) },
          ],
        },
        overrideAccess: true,
      });
      const boardId = String(created.item.id);
      await open(cookie, cardId);
      switches.hideBoardCopiesOnRead = true;

      const reports = await rewriteToTheEnd(cookie, cardId);

      // No path a write can name reaches a repeater's rows, so the copy is
      // reported rather than converted; the hook hid it from reads alone.
      expect(reports.at(-1)?.left).toContainEqual(
        expect.objectContaining({
          host: expect.objectContaining({ slug: BOARDS, id: boardId }),
        })
      );
    });

    it("converts a published page's live row while a site's read hook hides its state", async () => {
      const switches: Switches = {};
      const { t, cookie } = await boot(switches);
      const cardId = await card(t);
      const created = await t.nextly.create({
        collection: "pages",
        data: {
          title: "Live",
          slug: `live-${String(Math.random()).slice(2, 10)}`,
          status: "published",
          content: pageDoc([heading("own", "Own"), copyOf("i1", cardId)]),
        },
        overrideAccess: true,
      });
      const pageId = String(created.item.id);
      await open(cookie, cardId);
      switches.hidePageStatusOnRead = true;

      const reports = await rewriteToTheEnd(cookie, cardId);

      switches.hidePageStatusOnRead = false;
      // Published again in its state, not saved as a draft beside it: the
      // live row is converted and no draft is left pending.
      expect(reports.at(-1)?.left ?? []).not.toContainEqual(
        expect.objectContaining({
          host: expect.objectContaining({ slug: "pages", id: pageId }),
        })
      );
      const live = await nodesOf(t, "pages", pageId);
      expect(copies(live, cardId)).toBe(0);
      expect(texts(live)).toEqual(["Own", "Card title"]);
      expect(copies(await nodesOf(t, "pages", pageId, true), cardId)).toBe(0);
    });

    /** Whether the run's last report leaves a host of this document. */
    const leaves = (reports: RewriteReport[], slug: string, id: string) =>
      (reports.at(-1)?.left ?? []).some(
        left => left.host.slug === slug && left.host.id === id
      );

    it("reads a copy in a blocks field laid out in a group with no name, inside a named group, and leaves it to its author", async () => {
      const { t, cookie } = await boot({}, { panels: true });
      const cardId = await card(t);
      const created = await t.nextly.create({
        collection: PANELS,
        data: {
          title: "Panel",
          panel: {
            content: pageDoc([heading("own", "Own"), copyOf("i1", cardId)]),
          },
        },
        overrideAccess: true,
      });
      const panelId = String(created.item.id);
      await open(cookie, cardId);

      const reports = await rewriteToTheEnd(cookie, cardId);

      // Read where it is stored, in the named group's value: a host below a
      // group is never written, so the copy is reported, never unreadable.
      expect(reports.at(-1)?.left).toContainEqual(
        expect.objectContaining({
          host: expect.objectContaining({
            slug: PANELS,
            id: panelId,
            path: ["panel", "content"],
          }),
          reason: "unaddressable",
        })
      );
      const row = (await t.nextly.findByID({
        collection: PANELS,
        id: panelId,
        overrideAccess: true,
        depth: 0,
      })) as unknown as { panel?: { content?: unknown } };
      const nodes = (asDocument(row.panel?.content)?.nodes ?? []) as Node[];
      expect(copies(nodes, cardId)).toBe(1);
      expect(nodes).toHaveLength(2);
    });

    /** An article's hero body in one language, as stored. */
    async function heroOf(t: TestNextly, id: string, locale: string) {
      const row = (await t.nextly.findByID({
        collection: ARTICLES,
        id,
        locale,
        fallbackLocale: false,
        overrideAccess: true,
        status: "all",
        depth: 0,
      } as never)) as unknown as { hero?: { body?: unknown } };
      return (asDocument(row.hero?.body)?.nodes ?? []) as Node[];
    }

    const TRANSLATED = {
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      articles: true,
    };

    it("reads a copy in a group kept per language, in each language, and leaves it to its author", async () => {
      const { t, cookie } = await boot({}, TRANSLATED);
      const cardId = await card(t);
      const created = await t.nextly.create({
        collection: ARTICLES,
        data: {
          title: "Article",
          hero: {
            body: pageDoc([heading("en", "English"), copyOf("i1", cardId)]),
          },
        },
        locale: "en",
        overrideAccess: true,
      } as never);
      const articleId = String((created as { item: { id: unknown } }).item.id);
      await t.nextly.update({
        collection: ARTICLES,
        id: articleId,
        data: {
          hero: {
            body: pageDoc([heading("de", "Deutsch"), copyOf("i2", cardId)]),
          },
        },
        locale: "de",
        overrideAccess: true,
      } as never);
      await open(cookie, cardId);

      const reports = await rewriteToTheEnd(cookie, cardId);

      // Each language is read through the group's stored value: a host below
      // a group is never written, so each copy is reported, never unreadable,
      // and neither language is changed.
      for (const locale of ["en", "de"]) {
        expect(reports.at(-1)?.left).toContainEqual(
          expect.objectContaining({
            host: expect.objectContaining({
              slug: ARTICLES,
              id: articleId,
              path: ["hero", "body"],
              locale,
            }),
            reason: "unaddressable",
          })
        );
      }
      const en = await heroOf(t, articleId, "en");
      const de = await heroOf(t, articleId, "de");
      expect(copies(en, cardId)).toBe(1);
      expect(en).toHaveLength(2);
      expect(texts(en)[0]).toBe("English");
      expect(copies(de, cardId)).toBe(1);
      expect(de).toHaveLength(2);
      expect(texts(de)[0]).toBe("Deutsch");
    });

    it("clears a run once an author removed a copy from a group kept per language by hand", async () => {
      const { t, cookie } = await boot({}, TRANSLATED);
      const cardId = await card(t);
      const created = await t.nextly.create({
        collection: ARTICLES,
        data: {
          title: "Article",
          hero: {
            body: pageDoc([heading("en", "English"), copyOf("i1", cardId)]),
          },
        },
        locale: "en",
        overrideAccess: true,
      } as never);
      const articleId = String((created as { item: { id: unknown } }).item.id);
      await open(cookie, cardId);
      // The author takes the copy out by hand before the rewrite comes to it.
      await t.nextly.update({
        collection: ARTICLES,
        id: articleId,
        data: { hero: { body: pageDoc([heading("en", "English")]) } },
        locale: "en",
        overrideAccess: true,
      } as never);

      const reports = await rewriteToTheEnd(cookie, cardId);

      expect(reports.at(-1)?.finished).toBe(true);
      expect(leaves(reports, ARTICLES, articleId)).toBe(false);
      expect(texts(await heroOf(t, articleId, "en"))).toEqual(["English"]);
    });

    it("does not let a document whose blocks field was never filled hold the run back", async () => {
      const { t, cookie } = await boot();
      const cardId = await card(t);
      const created = await t.nextly.create({
        collection: NOTES,
        data: { title: "Empty" },
        overrideAccess: true,
      });
      const emptyId = String(created.item.id);
      const id = await note(t, "Note", [copyOf("i1", cardId)]);
      await open(cookie, cardId);

      const reports = await rewriteToTheEnd(cookie, cardId);

      expect(reports.at(-1)?.finished).toBe(true);
      expect(reports.at(-1)?.left ?? []).toEqual([]);
      expect(leaves(reports, NOTES, emptyId)).toBe(false);
      expect(copies(await nodesOf(t, NOTES, id), cardId)).toBe(0);
    });

    it("does not save as a draft the live row of a page whose draft its author discarded between the rewrite's reads", async () => {
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
      await t.nextly.update({
        collection: "pages",
        id: pageId,
        data: {
          content: pageDoc([copyOf("i1", cardId), heading("d", "Draft edit")]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      await open(cookie, cardId);
      // Once the rewrite's live read has found the draft pending, and before
      // its draft read, the author discards the draft.
      const discards: number[] = [];
      storedReads.after = async (request, read) => {
        const asked = request as { id?: string; form?: string };
        const answer = read as { live?: { workingDraft?: boolean } };
        if (discards.length > 0 || asked.id !== pageId) return;
        if (asked.form !== "published" || answer.live?.workingDraft !== true) {
          return;
        }
        discards.push(await discardDraft(cookie, pageId));
      };

      const reports = await rewriteToTheEnd(cookie, cardId);
      storedReads.after = undefined;

      expect(discards).toEqual([200]);
      // No working draft was made again: the live row is all there is, and
      // it was converted and published in its place.
      const now = await readStoredFields(
        { overrideAccess: true },
        { collection: "pages", id: pageId, fields: ["content"], form: "draft" }
      );
      expect(now).toMatchObject({ live: { workingDraft: false } });
      expect(texts(await nodesOf(t, "pages", pageId))).toEqual(["Card title"]);
      expect(texts(await nodesOf(t, "pages", pageId, true))).toEqual([
        "Card title",
      ]);
      expect(leaves(reports, "pages", pageId)).toBe(false);
    });

    it("completes the rewrite of a starter who may update the documents but not read them", async () => {
      const { t, anAuthor } = await boot();
      const cardId = await card(t);
      const id = await note(t, "Note", [copyOf("i1", cardId)]);
      const updater = await anAuthor(
        "updater",
        AUTHOR_GRANTS.filter(slug => slug !== "read-notes")
      );
      await open(updater.cookie, cardId);

      const reports = await rewriteToTheEnd(updater.cookie, cardId);

      expect(leaves(reports, NOTES, id)).toBe(false);
      expect(texts(await nodesOf(t, NOTES, id))).toEqual(["Card title"]);
    });

    it("completes the rewrite of a blocks field a field read rule closes to its starter", async () => {
      const { t, cookie } = await boot({}, { sealed: true });
      const cardId = await card(t);
      const created = await t.nextly.create({
        collection: SEALED,
        data: { title: "Sealed", content: pageDoc([copyOf("i1", cardId)]) },
        overrideAccess: true,
      });
      const id = String(created.item.id);
      await open(cookie, cardId);

      const reports = await rewriteToTheEnd(cookie, cardId);

      expect(leaves(reports, SEALED, id)).toBe(false);
      expect(texts(await nodesOf(t, SEALED, id))).toEqual(["Card title"]);
    });

    it("leaves a document its starter may not update, as not permitted, and unchanged", async () => {
      const { t, anAuthor } = await boot();
      const cardId = await card(t);
      const id = await note(t, "Note", [copyOf("i1", cardId)]);
      const reader = await anAuthor(
        "reader",
        AUTHOR_GRANTS.filter(slug => slug !== "update-notes")
      );
      await open(reader.cookie, cardId);

      const reports = await rewriteToTheEnd(reader.cookie, cardId);

      expect(reports.at(-1)?.left).toContainEqual(
        expect.objectContaining({
          host: expect.objectContaining({ slug: NOTES, id }),
          reason: "not-permitted",
        })
      );
      expect(copies(await nodesOf(t, NOTES, id), cardId)).toBe(1);
    });

    it("leaves a document whose blocks field a field update rule closes to its starter, as not permitted, and unchanged", async () => {
      const { t, cookie } = await boot({}, { locked: true });
      const cardId = await card(t);
      const created = await t.nextly.create({
        collection: LOCKED,
        data: { title: "Locked", content: pageDoc([copyOf("i1", cardId)]) },
        overrideAccess: true,
      });
      const id = String(created.item.id);
      await open(cookie, cardId);

      const reports = await rewriteToTheEnd(cookie, cardId);

      expect(reports.at(-1)?.left).toContainEqual(
        expect.objectContaining({
          host: expect.objectContaining({ slug: LOCKED, id }),
          reason: "not-permitted",
        })
      );
      expect(copies(await nodesOf(t, LOCKED, id), cardId)).toBe(1);
    });
  }
);
