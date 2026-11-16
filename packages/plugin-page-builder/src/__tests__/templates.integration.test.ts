/**
 * Collection templates against a real instance: the templates collection the
 * schema pipeline builds, the one-template-per-collection guard, and the
 * template actions an API client makes through Nextly's own request handler.
 *
 * What only a server shows: that the unique index refuses a second template
 * when two creates race past the guard's read, on every dialect, and the
 * route still names the template that won; that the guard holds on the
 * Direct API's write path as well as the route's; that each action asks its
 * right before anything is read; and that a dry run writes nothing.
 *
 * @module __tests__/templates.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { COMPONENT_INSTANCE_TYPE } from "@nextlyhq/blocks-engine";
import {
  definePlugin,
  NextlyError,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, relationship, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { TEMPLATES_SLUG } from "../collections/templates";
import { asOverwrite } from "../document-version";
import { pageBuilder } from "../plugin";
import type { PageActionResult } from "../composition-actions-contract";
import type { TemplateActionResult } from "../templates/template-actions-contract";

import { created, holding, person, post } from "./transfer-harness";

/** Someone who looks after templates, short of nothing. */
const TEMPLATE_AUTHOR = [
  "read-templates",
  "create-templates",
  "update-templates",
  "publish-templates",
];

/**
 * Holds every template create at its `beforeChange` until `width` of them
 * have arrived, so they all pass the guard's read before any is written.
 * Registered after the page builder, so it runs after the guard.
 */
const race = { width: 0, arrived: 0, release: (): void => {} };
let released = Promise.resolve();
function startRace(width: number): void {
  race.width = width;
  race.arrived = 0;
  released = new Promise(resolve => {
    race.release = resolve;
  });
}
const racingCreates = definePlugin({
  name: "@t/racing-creates",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    ctx.hooks.on("beforeChange", TEMPLATES_SLUG, async hook => {
      const { operation } = hook as { operation?: string };
      if (operation !== "create" || race.width === 0) return;
      race.arrived += 1;
      if (race.arrived >= race.width) {
        race.width = 0;
        race.release();
      }
      await released;
    });
  },
});

/** The context of a plugin of someone else's, for its own transactional writes. */
let captured: PluginContext | undefined;
const capturing = definePlugin({
  name: "@t/capturing",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    captured = ctx;
  },
});

/**
 * A template's design holding a list of the entry's related tags: judged
 * against the posts it draws, which relate to tags, it is sound; judged
 * against the templates collection, which holds no `tags`, it is refused.
 */
function relatedTagsDesign(limit?: number) {
  return {
    formatVersion: 1,
    kind: "template",
    nodes: [
      {
        id: "a",
        type: "core/heading",
        version: 1,
        props: { text: "A", level: "h2" },
      },
      {
        id: "b",
        type: "core/heading",
        version: 1,
        props: { text: "B", level: "h2" },
      },
      {
        id: "list",
        type: "core/collection-loop",
        version: 1,
        props: {
          collection: "tags",
          relation: { of: "entry", field: "tags" },
          ...(limit === undefined ? {} : { limit }),
        },
        slots: { children: [] },
      },
    ],
  };
}

function errorOf(body: Record<string, unknown>): {
  code?: string;
  message?: string;
  data?: { errors?: { path: string; message: string }[] };
} {
  return (body.error ?? {}) as ReturnType<typeof errorOf>;
}

describe.each(getConfiguredTestDialects())(
  "collection templates (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      race.width = 0;
      race.release();
      await current?.destroy();
      current = undefined;
      captured = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), racingCreates, capturing],
        collections: [
          defineCollection({
            slug: "tags",
            access: { read: () => true },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: "posts",
            labels: { singular: "Post", plural: "Posts" },
            status: true,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              text({ name: "slug", unique: true }),
              relationship({ name: "tags", relationTo: "tags", hasMany: true }),
            ],
          }),
          // A plugin-private collection: kept out of the admin, and so no
          // content to design an entry page for.
          defineCollection({
            slug: "notes",
            internal: true,
            fields: [text({ name: "title" })],
          }),
        ],
        seedPublic: true,
      });
      // The instance's first user is its super admin, so it is made here and
      // never acts: every author below holds only what it is granted.
      await person(current, "owner");
      return current;
    }

    const act = (cookie: string, body: unknown) =>
      post(cookie, ["templates", "actions"], body);

    async function stored(
      t: TestNextly,
      id: string
    ): Promise<Record<string, unknown>> {
      return (await t.nextly.findByID({
        collection: TEMPLATES_SLUG,
        id,
        overrideAccess: true,
        status: "all",
        depth: 0,
      })) as unknown as Record<string, unknown>;
    }

    async function templateCount(t: TestNextly): Promise<number> {
      const found = await t.nextly.find({
        collection: TEMPLATES_SLUG,
        overrideAccess: true,
        status: "all",
        limit: 10,
      });
      return found.items.length;
    }

    it("gives a collection its template as a draft", async () => {
      const t = await boot();
      const { cookie } = await holding(t, TEMPLATE_AUTHOR);

      const answered = await act(cookie, {
        action: { kind: "create-template", collection: "posts" },
      });

      expect(answered.status).toBe(200);
      const item = answered.body.item as TemplateActionResult;
      expect(item.dryRun).toBe(false);
      expect(item.template).toMatchObject({
        title: "Post template",
        collection: "posts",
        status: "draft",
      });
      const row = await stored(t, item.template?.id ?? "");
      expect(row.collection).toBe("posts");
      expect(row.status).toBe("draft");
      expect(row.content).toMatchObject({ kind: "template", nodes: [] });
    });

    it("refuses a second template for the collection, naming the first, by the route and the Direct API", async () => {
      const t = await boot();
      const { cookie } = await holding(t, TEMPLATE_AUTHOR);
      const first = await act(cookie, {
        action: {
          kind: "create-template",
          collection: "posts",
          title: "Post page",
        },
      });
      const firstId = (first.body.item as TemplateActionResult).template?.id;

      const second = await act(cookie, {
        action: {
          kind: "create-template",
          collection: "posts",
          title: "Another",
        },
      });
      expect(second.status).toBe(409);
      expect(errorOf(second.body).message).toBe(
        `The collection "posts" already has a template: "Post page" (${String(firstId)}). ` +
          "A collection has one template; change that one, or delete it first."
      );

      // The guard sits on the write, not on the route: a create the route
      // never sees is refused the same way.
      let thrown: unknown;
      try {
        await t.nextly.create({
          collection: TEMPLATES_SLUG,
          data: { title: "Direct", collection: "posts" },
          overrideAccess: true,
        });
      } catch (error) {
        thrown = error;
      }
      expect(NextlyError.isConflict(thrown)).toBe(true);
      expect((thrown as NextlyError).publicMessage).toContain(String(firstId));
      expect(await templateCount(t)).toBe(1);
    });

    it("lets exactly one of two racing creates through, and names it to the other", async () => {
      const t = await boot();
      const { cookie } = await holding(t, TEMPLATE_AUTHOR);
      startRace(2);

      const answers = await Promise.all([
        act(cookie, {
          action: { kind: "create-template", collection: "posts", title: "A" },
        }),
        act(cookie, {
          action: { kind: "create-template", collection: "posts", title: "B" },
        }),
      ]);

      // Both passed the guard's read before either was written, so what
      // refused the second is the unique index.
      expect(race.arrived).toBe(2);
      const statuses = answers.map(answer => answer.status).sort();
      expect(statuses).toEqual([200, 409]);
      const won = answers.find(answer => answer.status === 200);
      const lost = answers.find(answer => answer.status === 409);
      const winner = (won?.body.item as TemplateActionResult).template;
      expect(errorOf(lost?.body ?? {}).message).toContain(
        `"${String(winner?.title)}" (${String(winner?.id)})`
      );
      expect(await templateCount(t)).toBe(1);
    });

    it("keeps the collection's one template whatever its state, and frees the collection when it is deleted", async () => {
      const t = await boot();
      const { cookie } = await holding(t, TEMPLATE_AUTHOR);
      const first = await act(cookie, {
        action: { kind: "create-template", collection: "posts", publish: true },
      });
      const firstId =
        (first.body.item as TemplateActionResult).template?.id ?? "";
      expect((await stored(t, firstId)).status).toBe("published");

      // Unpublished, it is still the collection's template: a second is refused.
      await t.nextly.update({
        collection: TEMPLATES_SLUG,
        id: firstId,
        data: asOverwrite({ status: "draft" }),
        overrideAccess: true,
      });
      const refused = await act(cookie, {
        action: { kind: "create-template", collection: "posts" },
      });
      expect(refused.status).toBe(409);

      // The collection it draws cannot be moved while that collection exists.
      let thrown: unknown;
      try {
        await t.nextly.update({
          collection: TEMPLATES_SLUG,
          id: firstId,
          data: asOverwrite({ collection: "notes" }),
          overrideAccess: true,
        });
      } catch (error) {
        thrown = error;
      }
      expect(NextlyError.isValidation(thrown)).toBe(true);
      expect((await stored(t, firstId)).collection).toBe("posts");

      await t.nextly.delete({
        collection: TEMPLATES_SLUG,
        id: firstId,
        overrideAccess: true,
      });
      const again = await act(cookie, {
        action: { kind: "create-template", collection: "posts" },
      });
      expect(again.status).toBe(200);
    });

    it("refuses a collection that cannot have a template", async () => {
      const t = await boot();
      const { cookie } = await holding(t, TEMPLATE_AUTHOR);

      for (const [collection, message] of [
        [
          "notes",
          'The collection "notes" is kept out of the admin, so its entries are not drawn with a template.',
        ],
        [
          "pages",
          '"pages" belongs to the page builder, and its documents are not drawn with a template.',
        ],
        ["ghosts", 'There is no collection "ghosts" to give a template.'],
      ] as const) {
        const answered = await act(cookie, {
          action: { kind: "create-template", collection },
        });
        expect(answered.status).toBe(422);
        expect(errorOf(answered.body).data?.errors).toEqual([
          { path: "action", code: "REFUSED", message },
        ]);
      }
      expect(await templateCount(t)).toBe(0);
    });

    it("asks each action's right before reading anything", async () => {
      const t = await boot();
      const reader = await holding(t, ["read-templates"]);
      const creator = await holding(t, ["read-templates", "create-templates"]);

      // No create right: refused, even for a collection that does not exist,
      // so the answer says nothing about which collections there are.
      for (const collection of ["posts", "ghosts"]) {
        const answered = await act(reader.cookie, {
          action: { kind: "create-template", collection },
        });
        expect(answered.status).toBe(403);
      }
      // Creating and publishing at once needs both rights.
      const publishing = await act(creator.cookie, {
        action: { kind: "create-template", collection: "posts", publish: true },
      });
      expect(publishing.status).toBe(403);
      expect(await templateCount(t)).toBe(0);

      const draft = await act(creator.cookie, {
        action: { kind: "create-template", collection: "posts" },
      });
      const id = (draft.body.item as TemplateActionResult).template?.id ?? "";
      const publish = await act(creator.cookie, {
        action: { kind: "publish-template", id },
      });
      expect(publish.status).toBe(403);
      expect((await stored(t, id)).status).toBe("draft");
    });

    it("publishes a template, and a dry run of either action writes nothing", async () => {
      const t = await boot();
      const { cookie } = await holding(t, TEMPLATE_AUTHOR);

      const dryCreate = await act(cookie, {
        action: { kind: "create-template", collection: "posts" },
        dryRun: true,
      });
      expect(dryCreate.status).toBe(200);
      expect(dryCreate.body.item).toMatchObject({
        dryRun: true,
        kind: "create-template",
        refusals: [],
        template: { collection: "posts", status: "draft" },
      });
      expect(await templateCount(t)).toBe(0);

      // A dry run of an action the site would refuse answers the refusal.
      const dryRefused = await act(cookie, {
        action: { kind: "create-template", collection: "notes" },
        dryRun: true,
      });
      expect(dryRefused.status).toBe(200);
      expect(dryRefused.body.item).toMatchObject({
        dryRun: true,
        refusals: [
          'The collection "notes" is kept out of the admin, so its entries are not drawn with a template.',
        ],
      });

      const id = await created(t, TEMPLATES_SLUG, {
        title: "Post page",
        collection: "posts",
      });
      const dryPublish = await act(cookie, {
        action: { kind: "publish-template", id },
        dryRun: true,
      });
      expect(dryPublish.status).toBe(200);
      expect((dryPublish.body.item as TemplateActionResult).refusals).toEqual(
        []
      );
      expect((await stored(t, id)).status).toBe("draft");

      const published = await act(cookie, {
        action: { kind: "publish-template", id },
      });
      expect(published.status).toBe(200);
      expect(published.body.item).toMatchObject({
        dryRun: false,
        kind: "publish-template",
        template: {
          id,
          title: "Post page",
          collection: "posts",
          status: "published",
        },
      });
      expect((await stored(t, id)).status).toBe("published");

      const missing = await act(cookie, {
        action: { kind: "publish-template", id: "no-such-template" },
      });
      expect(missing.status).toBe(404);
    });

    it("refuses a malformed action with the path of the problem", async () => {
      const t = await boot();
      const { cookie } = await holding(t, TEMPLATE_AUTHOR);
      const answered = await act(cookie, {
        action: { kind: "create-template", collection: "posts", extra: 1 },
      });
      expect(answered.status).toBe(400);
      expect(errorOf(answered.body).data?.errors?.[0]?.path).toBe("action");
    });

    describe("a template's lists, judged against the collection it draws on every write", () => {
      /** A template of posts, its design holding a list of related tags. */
      async function postsTemplate(t: TestNextly): Promise<string> {
        return created(t, TEMPLATES_SLUG, {
          title: "Post page",
          collection: "posts",
          content: relatedTagsDesign(),
        });
      }

      /** The template's list as stored, its working draft first. */
      async function storedList(t: TestNextly, id: string) {
        const row = (await t.nextly.findByID({
          collection: TEMPLATES_SLUG,
          id,
          overrideAccess: true,
          status: "all",
          draft: true,
          depth: 0,
        })) as unknown as {
          content: {
            nodes: {
              id: string;
              type: string;
              props: Record<string, unknown>;
            }[];
          };
        };
        return row.content.nodes.find(node => node.id === "list");
      }

      it("runs a page action on a template, dry and applied, judged against its collection", async () => {
        const t = await boot();
        const id = await postsTemplate(t);
        const { cookie } = await holding(t, TEMPLATE_AUTHOR);
        const action = {
          page: { collection: TEMPLATES_SLUG, id },
          action: {
            kind: "set-list-query",
            listId: "list",
            query: { limit: 5 },
          },
        };

        // Made inside a transaction: the template's collection is carried
        // with the write, so it is neither refused for want of it nor
        // judged against the templates collection, which has no tags.
        const dry = await post(cookie, ["pages", "actions"], {
          ...action,
          dryRun: true,
        });
        expect(dry.status).toBe(200);
        expect((dry.body.item as PageActionResult).refusals).toEqual([]);
        expect((await storedList(t, id))?.props.limit).toBeUndefined();

        const applied = await post(cookie, ["pages", "actions"], action);
        expect(applied.status, JSON.stringify(applied.body)).toBe(200);
        expect((await storedList(t, id))?.props.limit).toBe(5);
        expect((await stored(t, id)).collection).toBe("posts");
      });

      it("publishes a template holding a list of the entry's related entries", async () => {
        const t = await boot();
        const id = await postsTemplate(t);
        const { cookie } = await holding(t, TEMPLATE_AUTHOR);

        // A status-only write: the content goes live as it was judged when
        // saved, and the publish judges the document going live, which
        // names its collection.
        const dry = await act(cookie, {
          action: { kind: "publish-template", id },
          dryRun: true,
        });
        expect((dry.body.item as TemplateActionResult).refusals).toEqual([]);
        const published = await act(cookie, {
          action: { kind: "publish-template", id },
        });
        expect(published.status, JSON.stringify(published.body)).toBe(200);
        expect((await stored(t, id)).status).toBe("published");
      });

      it("makes a component from a selection on a template", async () => {
        const t = await boot();
        const id = await postsTemplate(t);
        const { cookie } = await holding(t, [
          ...TEMPLATE_AUTHOR,
          "create-components",
          "publish-components",
          "read-components",
          "update-components",
        ]);

        const answered = await post(cookie, ["components", "from-selection"], {
          action: "convert",
          apply: "stored",
          page: { collection: TEMPLATES_SLUG, id },
          selectedIds: ["b"],
          fields: { title: "Second heading" },
        });
        expect(answered.status, JSON.stringify(answered.body)).toBe(201);
        const types = (
          (await t.nextly.findByID({
            collection: TEMPLATES_SLUG,
            id,
            overrideAccess: true,
            status: "all",
            draft: true,
            depth: 0,
          })) as unknown as { content: { nodes: { type: string }[] } }
        ).content.nodes.map(node => node.type);
        // The selected heading is now a placement of the new component.
        expect(types).toEqual([
          "core/heading",
          COMPONENT_INSTANCE_TYPE,
          "core/collection-loop",
        ]);
      });

      it("refuses another writer's transactional content write that names no collection", async () => {
        const t = await boot();
        const id = await postsTemplate(t);
        const ctx = captured;
        if (ctx === undefined) throw new Error("the test plugin never started");
        const write = (data: Record<string, unknown>) =>
          ctx.services.collections
            .withTransaction(tx =>
              ctx.services.collections.updateEntryInTransaction(
                tx,
                TEMPLATES_SLUG,
                id,
                data
              )
            )
            .then(
              () => undefined,
              (caught: unknown) => caught
            );

        const refused = (await write(
          asOverwrite({ content: relatedTagsDesign(3) })
        )) as NextlyError | undefined;
        expect(NextlyError.isValidation(refused)).toBe(true);
        expect(JSON.stringify(refused?.publicData)).toContain(
          "TEMPLATE_COLLECTION_UNKNOWN"
        );
        expect((await storedList(t, id))?.props.limit).toBeUndefined();

        // The control: the same write naming the collection is judged
        // against it and kept.
        expect(
          await write(
            asOverwrite({ content: relatedTagsDesign(3), collection: "posts" })
          )
        ).toBeUndefined();
        expect((await storedList(t, id))?.props.limit).toBe(3);
      });
    });
  }
);
