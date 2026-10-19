/**
 * A subject's content events, read through REST, the Direct API and the plugin
 * service, on every dialect.
 *
 * Each way in is shown paging (more than one page), filtering by kind, and
 * refusing a caller who may not read the subject, with the refusal a "not
 * found". A deleted document is read by its rule's branch, each with a caller
 * the branch lets in and one it keeps out: no rule (the read permission), and a
 * function rule, which only a super-admin passes once the row is gone. (A
 * collection's code-defined rule is always a function: its config refuses a
 * boolean, so no collection can reach a boolean branch.) A release is read with release read authority, live and
 * deleted. And a document id that lived twice shows one life at a time.
 */

// Set before the harness boots: signing API keys reads it once.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { ServiceContainer } from "../../../services/index";
import type { AuthUserId } from "../../../types/auth";
import { seedLiveAuthor } from "../../releases/__tests__/helpers/live-author";
import { ensureCoreContentEventKinds } from "../core-kinds";
import { recordContentEvent } from "../record";

let current: TestNextly | undefined;
let services: PluginContext["services"] | undefined;
/** The first user: a super-admin by being first. It mints every key. */
let founder: string | undefined;
/** The one person the function rule below lets read a "secret". */
let ruleAllows: string | undefined;
/**
 * A "relived" document the next read of deletes and makes again under its id,
 * between that read's authorization and its events.
 */
let relive: { id: string; t: TestNextly } | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  services = undefined;
  founder = undefined;
  ruleAllows = undefined;
  relive = undefined;
});

interface Page {
  items: { id: string; kind: string }[];
  meta: { hasNext: boolean };
}

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const probe = definePlugin({
    name: "@test/subject-events",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: ctx => {
      services = ctx.services;
    },
  });
  current = await createTestNextly({
    dialect,
    collections: [
      // No read rule: the read permission decides.
      defineCollection({
        slug: "posts",
        versions: true,
        db: { allowIdOnCreate: true },
        fields: [text({ name: "title" })],
      }),
      // Reads narrowed by a hook rather than a rule, as a tenant filter is.
      defineCollection({
        slug: "guarded",
        hooks: { beforeRead: [({ data }) => data] },
        fields: [text({ name: "title" })],
      }),
      // A hook that refuses a caller by a custom user property, as a tenant
      // filter does: only the caller's own properties can trigger it.
      defineCollection({
        slug: "tenanted",
        hooks: {
          beforeOperation: [
            ({ user }) => {
              if (
                (user as { tenant?: string } | undefined)?.tenant === "blocked"
              ) {
                throw new Error("This tenant may not read here.");
              }
            },
          ],
        },
        fields: [text({ name: "title" })],
      }),
      // A hook that refuses by the context its caller passed, as a hook
      // trusting a verified request header does.
      defineCollection({
        slug: "contextual",
        hooks: {
          beforeOperation: [
            ({ context }) => {
              if (context?.tenant === "blocked") {
                throw new Error("This tenant may not read here.");
              }
            },
          ],
        },
        fields: [text({ name: "title" })],
      }),
      // A second life no person may read, made by a read of the first: the
      // document is deleted and created again under its id after the read
      // passed its hooks, before its events are read.
      defineCollection({
        slug: "relived",
        db: { allowIdOnCreate: true },
        hooks: {
          afterRead: [
            async ({ data, user }) => {
              const doc = data as { id?: string; title?: string } | undefined;
              if (doc?.title === "second" && user !== undefined) {
                throw new Error("No person may read the second life.");
              }
              if (relive !== undefined && doc?.id === relive.id) {
                const { id, t } = relive;
                relive = undefined;
                await t.nextly.delete({ collection: "relived", id });
                await t.nextly.create({
                  collection: "relived",
                  data: { id, title: "second" },
                });
              }
              return data;
            },
          ],
        },
        fields: [text({ name: "title" })],
      }),
      // A document-level rule: a function, which may read the row.
      defineCollection({
        slug: "secrets",
        access: { read: ({ user }) => user?.id === ruleAllows },
        fields: [text({ name: "title" })],
      }),
    ],
    plugins: [probe],
  });
  await seedPermissionsAndRolePresets();
  founder = await seedLiveAuthor(current);
  return current;
}

let roleSeq = 0;

/** A role holding exactly these permissions, by slug. */
async function roleHolding(t: TestNextly, slugs: string[]): Promise<string> {
  const permissions = await t.adapter.select<{ id: string; slug: string }>(
    "permissions",
    {}
  );
  const ids = slugs.map(slug => {
    const found = permissions.find(p => p.slug === slug);
    // Asserted, so a refusal below cannot be for a permission never seeded.
    expect(found, `${slug} is seeded`).toBeDefined();
    return String(found!.id);
  });
  roleSeq += 1;
  const role = await new ServiceContainer(t.adapter).roles.createRole({
    name: `Events role ${roleSeq}`,
    slug: `events-role-${roleSeq}`,
    permissionIds: ids,
  });
  return role.id;
}

/** An active person whose only role holds exactly these permissions. */
async function personHolding(t: TestNextly, slugs: string[]): Promise<string> {
  const user = await seedLiveAuthor(t);
  const assigned = await new ServiceContainer(
    t.adapter
  ).userRoles.assignRoleToUser(user, await roleHolding(t, slugs));
  expect(assigned.success).toBe(true);
  return user;
}

/** A role-based API key whose role holds exactly these permissions. */
async function keyHolding(t: TestNextly, slugs: string[]): Promise<string> {
  const apiKeys = t.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId: string;
        expiresIn: string;
      }
    ) => Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(founder!, {
    name: `events key ${roleSeq}`,
    tokenType: "role-based",
    roleId: await roleHolding(t, slugs),
    expiresIn: "unlimited",
  });
  return key;
}

/** A REST read, as a key, of a path under the API with its query. */
async function restGet(
  key: string,
  segments: string[],
  query: Record<string, string> = {}
): Promise<Response> {
  const search = new URLSearchParams(query).toString();
  const request = new Request(
    `http://localhost/api/${segments.join("/")}${search ? `?${search}` : ""}`,
    { headers: { authorization: `Bearer ${key}` } }
  );
  return createDynamicHandlers().GET(request, {
    params: Promise.resolve({ params: segments }),
  });
}

async function pageOf(response: Response): Promise<Page> {
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as Page;
}

/** A post saved four times: created, then three saves. */
async function postWithFourEvents(t: TestNextly, id?: string): Promise<string> {
  const created = await t.nextly.create({
    collection: "posts",
    data: { ...(id === undefined ? {} : { id }), title: "one" },
  });
  const postId = (created.item as { id: string }).id;
  for (const title of ["two", "three", "four"]) {
    await t.nextly.update({ collection: "posts", id: postId, data: { title } });
  }
  return postId;
}

/** A document in this collection, with its "created" event. */
async function documentIn(t: TestNextly, collection: string): Promise<string> {
  const created = await t.nextly.create({ collection, data: { title: "x" } });
  return (created.item as { id: string }).id;
}

const asPerson = (userId: string) => ({
  user: { id: userId },
  overrideAccess: false,
});

describe.each(getConfiguredTestDialects())(
  "reading a subject's events (integration, %s)",
  dialect => {
    it("reads a document's events through REST, page by page and by kind, and refuses who may not read it", async () => {
      const t = await boot(dialect);
      const post = await postWithFourEvents(t);
      const reader = await keyHolding(t, ["read-posts"]);
      const outsider = await keyHolding(t, ["read-content-releases"]);
      const path = ["collections", "posts", "entries", post, "events"];

      const first = await pageOf(await restGet(reader, path, { limit: "2" }));
      expect(first.items).toHaveLength(2);
      expect(first.meta.hasNext).toBe(true);
      const second = await pageOf(
        await restGet(reader, path, {
          limit: "2",
          before: first.items.at(-1)!.id,
        })
      );
      expect(second.meta.hasNext).toBe(false);
      // Newest first, every event once, across the two pages.
      expect([...first.items, ...second.items].map(e => e.kind)).toEqual([
        "saved",
        "saved",
        "saved",
        "created",
      ]);

      const created = await pageOf(
        await restGet(reader, path, { kind: "created" })
      );
      expect(created.items.map(e => e.kind)).toEqual(["created"]);

      // Refused at the collection, as its version history is: the route's own
      // gate, before the document is looked at, so it says nothing of whether
      // this document exists. The read by subject answers not found.
      expect((await restGet(outsider, path)).status).toBe(403);
      expect(
        (
          await restGet(outsider, ["content-events"], {
            subject: "collection",
            slug: "posts",
            id: post,
          })
        ).status
      ).toBe(404);
    }, 120_000);

    it("reads a document's events through the Direct API and the plugin service, and refuses who may not read it", async () => {
      const t = await boot(dialect);
      const post = await postWithFourEvents(t);
      const reader = await personHolding(t, ["read-posts"]);
      const outsider = await personHolding(t, ["read-content-releases"]);
      const subject = { kind: "collection" as const, slug: "posts", id: post };

      const direct = await t.nextly.contentEvents.list({
        subject,
        limit: 3,
        ...asPerson(reader),
      });
      expect(direct.items).toHaveLength(3);
      expect(direct.meta.hasNext).toBe(true);
      const directCreated = await t.nextly.contentEvents.list({
        subject,
        kinds: ["created"],
        ...asPerson(reader),
      });
      expect(directCreated.items.map(e => e.kind)).toEqual(["created"]);
      await expect(
        t.nextly.contentEvents.list({ subject, ...asPerson(outsider) })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const as = (id: string) => ({
        as: "user" as const,
        user: { id: id as AuthUserId, email: `${id}@example.com` },
      });
      const plugin = await services!.versions.listEvents(
        subject,
        { limit: 3 },
        as(reader)
      );
      expect(plugin.items).toHaveLength(3);
      expect(plugin.meta.hasNext).toBe(true);
      const pluginRest = await services!.versions.listEvents(
        subject,
        { limit: 3, before: plugin.items.at(-1)!.id },
        as(reader)
      );
      expect(pluginRest.items.map(e => e.kind)).toEqual(["created"]);
      await expect(
        services!.versions.listEvents(subject, {}, as(outsider))
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      // No user: the plugin acting for itself, as the system.
      expect(
        (await services!.versions.listEvents(subject, { limit: 100 })).items
      ).toHaveLength(4);
    }, 120_000);

    it("reads a deleted document with no read rule by who holds its read permission", async () => {
      const t = await boot(dialect);
      const post = await postWithFourEvents(t);
      await t.nextly.delete({ collection: "posts", id: post });
      const reader = await keyHolding(t, ["read-posts"]);
      const outsider = await keyHolding(t, ["read-content-releases"]);
      const query = { subject: "collection", slug: "posts", id: post };

      const page = await pageOf(
        await restGet(reader, ["content-events"], query)
      );
      expect(page.items.map(e => e.kind)).toEqual([
        "deleted",
        "saved",
        "saved",
        "saved",
        "created",
      ]);
      const refusal = await restGet(outsider, ["content-events"], query);
      expect(refusal.status).toBe(404);
      // The refusal is the caller's own: a shared cache must not replay it to
      // someone who may read these events.
      expect(refusal.headers.get("cache-control")).toMatch(/private/);
      expect(refusal.headers.get("cache-control")).toMatch(/no-store/);
    }, 120_000);

    it("reads a deleted document under a document-level rule only as a super-admin", async () => {
      const t = await boot(dialect);
      const allowed = await personHolding(t, ["read-secrets"]);
      const keptOut = await personHolding(t, ["read-secrets"]);
      ruleAllows = allowed;
      const secret = await documentIn(t, "secrets");
      const subject = {
        kind: "collection" as const,
        slug: "secrets",
        id: secret,
      };

      // While it exists, the rule decides: one reader in, one kept out.
      expect(
        (await t.nextly.contentEvents.list({ subject, ...asPerson(allowed) }))
          .items
      ).toHaveLength(1);
      await expect(
        t.nextly.contentEvents.list({ subject, ...asPerson(keptOut) })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await t.nextly.delete({ collection: "secrets", id: secret });

      // Once it is gone the rule cannot be asked: neither reader, nor a key
      // holding the permission, may read its events.
      for (const userId of [allowed, keptOut]) {
        await expect(
          t.nextly.contentEvents.list({ subject, ...asPerson(userId) })
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      const key = await keyHolding(t, ["read-secrets"]);
      expect(
        (
          await restGet(key, ["content-events"], {
            subject: "collection",
            slug: "secrets",
            id: secret,
          })
        ).status
      ).toBe(404);
      // A super-admin, whom the rule never limited, and trusted server code.
      expect(
        (
          await t.nextly.contentEvents.list({ subject, ...asPerson(founder!) })
        ).items.map(e => e.kind)
      ).toEqual(["deleted", "created"]);
      expect(
        (await t.nextly.contentEvents.list({ subject })).items
      ).toHaveLength(2);
    }, 120_000);

    it("reads a deleted document whose reads a hook narrows only as a super-admin", async () => {
      const t = await boot(dialect);
      const holder = await personHolding(t, ["read-guarded"]);
      const doc = await documentIn(t, "guarded");
      const subject = { kind: "collection" as const, slug: "guarded", id: doc };

      // While it exists, the permission and the hook decide: the holder reads.
      expect(
        (await t.nextly.contentEvents.list({ subject, ...asPerson(holder) }))
          .items
      ).toHaveLength(1);

      await t.nextly.delete({ collection: "guarded", id: doc });

      // The hook cannot be asked about a row that is gone: refused, but not
      // to a super-admin.
      await expect(
        t.nextly.contentEvents.list({ subject, ...asPerson(holder) })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        (await t.nextly.contentEvents.list({ subject, ...asPerson(founder!) }))
          .items
      ).toHaveLength(2);
    }, 120_000);

    it("answers a Direct API caller exactly as the document's own read does", async () => {
      const t = await boot(dialect);
      const reader = await personHolding(t, ["read-tenanted"]);
      const outsider = await personHolding(t, ["read-content-releases"]);
      const doc = await documentIn(t, "tenanted");
      const subject = {
        kind: "collection" as const,
        slug: "tenanted",
        id: doc,
      };

      // The same caller, with a custom property a rule may read, through the
      // document's read and through its events: one answer, never two.
      const callers = [
        { id: reader, tenant: "open" },
        { id: reader, tenant: "blocked" },
        { id: outsider, tenant: "open" },
      ];
      for (const user of callers) {
        const documentRead = await t.nextly
          .findByID({
            collection: "tenanted",
            id: doc,
            user,
            overrideAccess: false,
          })
          .then(
            () => "readable",
            () => "refused"
          );
        const eventsRead = await t.nextly.contentEvents
          .list({ subject, user, overrideAccess: false })
          .then(
            () => "readable",
            () => "refused"
          );
        expect(eventsRead, JSON.stringify(user)).toBe(documentRead);
      }
    }, 120_000);

    it("reads a release's events with release read authority, live and deleted", async () => {
      const t = await boot(dialect);
      const release = await t.nextly.releases.create({ title: "Autumn" });
      const releaseId = release.id;
      // Releases record their own events; written here as they would be.
      ensureCoreContentEventKinds();
      await t.adapter.transaction(tx =>
        recordContentEvent(tx, {
          subject: { kind: "release", id: releaseId },
          kind: "created",
          actor: { kind: "system" },
        })
      );
      const reader = await keyHolding(t, ["read-content-releases"]);
      const outsider = await keyHolding(t, ["read-posts"]);
      const query = { subject: "release", id: releaseId };

      const read = async () =>
        (
          await pageOf(await restGet(reader, ["content-events"], query))
        ).items.map(e => e.kind);
      expect(await read()).toEqual(["created"]);
      expect((await restGet(outsider, ["content-events"], query)).status).toBe(
        404
      );

      await t.nextly.releases.delete({ id: releaseId });

      expect(await read()).toEqual(["created"]);
      expect((await restGet(outsider, ["content-events"], query)).status).toBe(
        404
      );
    }, 120_000);

    it("judges a Direct API caller whose call forwards no access override, as the document's read does", async () => {
      const t = await boot(dialect);
      const post = await postWithFourEvents(t);
      const outsider = await personHolding(t, ["read-content-releases"]);
      const subject = { kind: "collection" as const, slug: "posts", id: post };
      // A wrapper spreading its own options forwards the key with no value,
      // which replaces the instance's setting in the merged config.
      const forwarded = { user: { id: outsider }, overrideAccess: undefined };

      const documentRead = await t.nextly
        .findByID({ collection: "posts", id: post, ...forwarded })
        .then(
          () => "readable",
          () => "refused"
        );
      const eventsRead = await t.nextly.contentEvents
        .list({ subject, ...forwarded })
        .then(
          () => "readable",
          () => "refused"
        );
      expect(documentRead).toBe("refused");
      expect(eventsRead).toBe(documentRead);
    }, 120_000);

    it("hands the document's hooks the context a Direct API or plugin caller passed", async () => {
      const t = await boot(dialect);
      const reader = await personHolding(t, ["read-contextual"]);
      const doc = await documentIn(t, "contextual");
      const subject = {
        kind: "collection" as const,
        slug: "contextual",
        id: doc,
      };
      const outcome = (read: Promise<unknown>) =>
        read.then(
          () => "readable",
          () => "refused"
        );

      const answers = [];
      for (const tenant of ["open", "blocked"]) {
        const context = { tenant };
        const documentRead = await outcome(
          t.nextly.findByID({
            collection: "contextual",
            id: doc,
            context,
            ...asPerson(reader),
          })
        );
        const direct = await outcome(
          t.nextly.contentEvents.list({ subject, context, ...asPerson(reader) })
        );
        const plugin = await outcome(
          services!.versions.listEvents(
            subject,
            {},
            {
              as: "user",
              user: {
                id: reader as AuthUserId,
                email: `${reader}@example.com`,
              },
              context,
            }
          )
        );
        expect({ direct, plugin }, tenant).toEqual({
          direct: documentRead,
          plugin: documentRead,
        });
        answers.push(documentRead);
      }
      // The context decided: one tenant reads and the other is refused.
      expect(answers).toEqual(["readable", "refused"]);
    }, 120_000);

    it("never reads a life the caller was not judged against", async () => {
      const t = await boot(dialect);
      const reader = await personHolding(t, ["read-relived"]);
      const id = randomUUID();
      await t.nextly.create({
        collection: "relived",
        data: { id, title: "first" },
      });
      const subject = { kind: "collection" as const, slug: "relived", id };
      const read = () =>
        t.nextly.contentEvents.list({ subject, ...asPerson(reader) }).then(
          page => page.items.map(e => e.kind),
          () => "refused"
        );

      expect(await read()).toEqual(["created"]);
      // Deleted and made again while this read runs: the life now current is
      // one this person may not read, so they get none of it.
      relive = { id, t };
      expect(await read()).toBe("refused");
      // The race ran, and the second life is refused as a document too.
      expect(relive).toBeUndefined();
      await expect(
        t.nextly.findByID({ collection: "relived", id, ...asPerson(reader) })
      ).rejects.toBeDefined();
    }, 120_000);

    it("shows one life of a document id at a time", async () => {
      const t = await boot(dialect);
      const id = randomUUID();
      // First life: four events, then deleted.
      await postWithFourEvents(t, id);
      await t.nextly.delete({ collection: "posts", id });
      // Second life, under the same id.
      await t.nextly.create({
        collection: "posts",
        data: { id, title: "again" },
      });
      const subject = { kind: "collection" as const, slug: "posts", id };

      // While it lives again, only this life.
      expect(
        (await t.nextly.contentEvents.list({ subject })).items.map(e => e.kind)
      ).toEqual(["created"]);

      // Deleted again: the life that deletion ended, not the first one.
      await t.nextly.delete({ collection: "posts", id });
      expect(
        (await t.nextly.contentEvents.list({ subject })).items.map(e => e.kind)
      ).toEqual(["deleted", "created"]);
    }, 120_000);
  }
);
