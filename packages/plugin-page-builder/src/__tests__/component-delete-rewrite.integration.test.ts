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
 * cannot.
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
import { asDocument } from "../component-store-source";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { documentKeyOf, type RewriteReport } from "../host-rewrite/contract";
import type { DeletionRun, RunPurpose } from "../host-rewrite/fence";
import {
  COMPONENT_DELETE_REWRITE_SERVICE,
  type ComponentDeleteRewriteService,
} from "../host-rewrite/service";
import { pageBuilder } from "../plugin";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
const HARNESS = "@t/rewrite-harness";
const NOTES = "notes";

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
  /** Run once, the next time a note is read by id. */
  onNoteRead?: (id: string) => Promise<void>;
  /** Hold the next note write with this title after its validation. */
  holdAfterValidation?: {
    title: string;
    reached: () => void;
    release: Promise<void>;
  };
  /** Fail the next update of this note as if the process stopped. */
  crashOn?: string;
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
      ctx.hooks.on("afterRead", NOTES, async context => {
        const data = (context as { data?: unknown }).data;
        const run = switches.onNoteRead;
        if (run === undefined || Array.isArray(data)) return;
        const id = (data as { id?: unknown } | undefined)?.id;
        if (typeof id !== "string") return;
        switches.onNoteRead = undefined;
        await run(id);
      });
      ctx.hooks.on("beforeChange", NOTES, async context => {
        const hold = switches.holdAfterValidation;
        const title = (context as { data?: { title?: unknown } }).data?.title;
        if (hold === undefined || title !== hold.title) return;
        switches.holdAfterValidation = undefined;
        hold.reached();
        await hold.release;
      });
      ctx.hooks.on("beforeUpdate", NOTES, context => {
        const original = (context as { originalData?: { id?: unknown } })
          .originalData;
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
      const anAuthor = async (name: string) => {
        const id = await person(t, name);
        await grant(t, id, AUTHOR_GRANTS, singleSlugs);
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
        data: { title: "Renamed", content: pageDoc([copyOf("i1", cardId)]) },
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

      // The author saves the moment the rewrite has read the note.
      switches.onNoteRead = async readId => {
        if (readId !== id) return;
        await t.nextly.update({
          collection: NOTES,
          id,
          data: {
            content: pageDoc([
              heading("own", "Own"),
              copyOf("i1", cardId),
              heading("edit", "Author edit"),
            ]),
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
        data: { content: pageDoc([heading("en", "English")]) },
        overrideAccess: true,
      });
      // The copy is only in German, which the default language never shows.
      await t.nextly.updateSingle({
        slug: HOME,
        locale: "de",
        data: {
          content: pageDoc([heading("de", "Deutsch"), copyOf("i1", cardId)]),
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
  }
);
