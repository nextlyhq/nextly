/**
 * A release's documents checked before the moment, against a real database.
 *
 * What the unit tests cannot show: that the checks ask what the release's run
 * would actually refuse — the content validation a publish makes, as the
 * member's author, and the access gate that author meets — and that every door
 * refuses a hard problem alike: scheduling, Publish now, adding to a scheduled
 * release and switching a document's action, through the Direct API and REST.
 *
 * A document's stored content is made invalid by writing its row directly, the
 * way a schema made stricter after the content was saved leaves it: the write
 * path would refuse to store it.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { CollectionsHandler } from "../../../services/collections-handler";

import { seedLiveAuthor, seedPlainAuthor } from "./helpers/live-author";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const LATER = new Date("2099-01-01T09:00:00Z");

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "articles",
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title", required: true })],
      }),
      // Its authors may put a notice live and never take one down.
      defineCollection({
        slug: "notices",
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => false,
        },
        fields: [text({ name: "title" })],
      }),
      // Deleted part-way through a case, with a release still naming it.
      defineCollection({
        slug: "scratch",
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title" })],
      }),
      // No rule for taking a memo down: who may is decided by grants alone.
      defineCollection({
        slug: "memos",
        status: true,
        access: { read: () => true, update: () => true, publish: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      // A field only the editor-in-chief may write.
      defineSingle({
        slug: "flags",
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [
          text({ name: "label" }),
          text({
            name: "guarded",
            access: {
              update: ({ req }) => req.user?.email === "chief@example.com",
            },
          }),
        ],
      }),
      defineSingle({
        slug: "banner",
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "headline", required: true })],
      }),
    ],
  });
  return current;
}

/** A document, stored through the ordinary write. */
async function entry(
  t: TestNextly,
  collection: "articles" | "notices" | "memos" | "scratch",
  status: "draft" | "published" = "draft"
): Promise<string> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const created = await handler.createEntry(
    { collectionName: collection, overrideAccess: true },
    { title: "Fine", status }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  return id;
}

/** Empty an article's required title on its stored row. */
async function breakTitle(t: TestNextly, id: string): Promise<void> {
  await t.adapter.update(
    "dc_articles",
    { title: "" },
    { and: [{ column: "id", op: "=", value: id }] }
  );
}

async function storedStatus(t: TestNextly, id: string): Promise<unknown> {
  const row = await t.adapter.selectOne<{ status?: string }>("dc_articles", {
    where: { and: [{ column: "id", op: "=", value: id }] },
  });
  return row?.status;
}

/** A release holding these documents, each added by `author`. */
async function releaseOf(
  t: TestNextly,
  author: string,
  documents: Array<{
    collection: "articles" | "notices" | "memos" | "scratch";
    id: string;
    action?: "publish" | "unpublish";
  }>
): Promise<{ releaseId: string; memberIds: string[] }> {
  const release = await t.nextly.releases.create({ title: "Launch" });
  const memberIds: string[] = [];
  for (const document of documents) {
    const member = await t.nextly.releases.addMember({
      releaseId: release.id,
      scopeKind: "collection",
      scopeSlug: document.collection,
      entryId: document.id,
      locale: null,
      action: document.action ?? "publish",
      userId: author,
    });
    memberIds.push(member.id);
  }
  return { releaseId: release.id, memberIds };
}

/** What a refusal names: each problem's member and code. */
async function problemsOf(
  refused: Promise<unknown>
): Promise<Array<{ memberId: string | null; code: string }>> {
  const error = await refused.then(
    () => {
      throw new Error("expected a refusal");
    },
    (caught: unknown) => caught
  );
  expect(error).toMatchObject({ code: "CONFLICT" });
  return (error as { publicData: { problems: [] } }).publicData.problems;
}

describe.each(getConfiguredTestDialects())(
  "a release's documents checked before the moment (%s)",
  dialect => {
    it("reports a document going live without a required field, then reads it fixed", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      const id = await entry(t, "articles");
      await breakTitle(t, id);
      const { releaseId, memberIds } = await releaseOf(t, author, [
        { collection: "articles", id },
      ]);

      const broken = await t.nextly.releases.readiness({ releaseId });
      expect(broken.hard).toEqual([
        expect.objectContaining({
          memberId: memberIds[0],
          code: "REQUIRED_FIELD_MISSING",
          source: "core.required-fields",
          detail: { fields: ["title"] },
        }),
      ]);

      // Fixed through the ordinary write, and read as fixed on the next ask.
      await t.nextly.update({
        collection: "articles" as never,
        id,
        data: { title: "Fixed" } as never,
      });
      expect((await t.nextly.releases.readiness({ releaseId })).hard).toEqual(
        []
      );
    });

    it("lets an invalid document be taken down: a document coming down is not judged", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      // Live and invalid: the case the rule exists for.
      const live = await entry(t, "articles", "published");
      await breakTitle(t, live);
      // A draft no publish would accept, so judging a document coming down
      // as if it were going live would report it.
      const draft = await entry(t, "articles");
      await breakTitle(t, draft);
      const { releaseId } = await releaseOf(t, author, [
        { collection: "articles", id: live, action: "unpublish" },
        { collection: "articles", id: draft, action: "unpublish" },
      ]);

      expect((await t.nextly.releases.readiness({ releaseId })).hard).toEqual(
        []
      );
      // And the run agrees: it takes the live document down.
      const after = await t.nextly.releases.publishNow({ id: releaseId });
      expect(after.state).toBe("published");
      expect(await storedStatus(t, live)).toBe("draft");
    });

    it("reports an author who may not perform the action, and a document that is gone", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      const notice = await entry(t, "notices", "published");
      const article = await entry(t, "articles");
      const { releaseId, memberIds } = await releaseOf(t, author, [
        { collection: "notices", id: notice, action: "unpublish" },
        { collection: "articles", id: article },
      ]);
      await t.nextly.delete({ collection: "articles" as never, id: article });

      const found = await t.nextly.releases.readiness({ releaseId });
      expect(found.hard.map(f => [f.memberId, f.code])).toEqual([
        [memberIds[0], "AUTHOR_MAY_NOT_ACT"],
        [memberIds[1], "DOCUMENT_GONE"],
      ]);
    });

    it("notes, softly, a document another scheduled release also holds, and which one wins", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      const id = await entry(t, "articles");
      const first = await releaseOf(t, author, [
        { collection: "articles", id },
      ]);
      const second = await releaseOf(t, author, [
        { collection: "articles", id, action: "unpublish" },
      ]);
      await t.nextly.releases.schedule({
        id: second.releaseId,
        at: new Date("2099-02-01T09:00:00Z"),
        timezone: "UTC",
      });
      await t.nextly.releases.schedule({
        id: first.releaseId,
        at: LATER,
        timezone: "UTC",
      });

      const found = await t.nextly.releases.readiness({
        releaseId: first.releaseId,
      });
      expect(found.hard).toEqual([]);
      expect(found.soft).toEqual([
        expect.objectContaining({
          memberId: first.memberIds[0],
          code: "IN_OTHER_RELEASE",
          detail: {
            releaseId: second.releaseId,
            // The later of the two decides where the document ends up.
            winningReleaseId: second.releaseId,
          },
        }),
      ]);
    });

    it("reports a Single going live without a required field", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      await t.nextly.updateSingle({
        slug: "banner" as never,
        data: { headline: "Fine", status: "draft" } as never,
      });
      const row = await t.adapter.selectOne<{ id: string }>(
        "single_banner",
        {}
      );
      if (row === null || row === undefined) throw new Error("no banner row");
      await t.adapter.update(
        "single_banner",
        { headline: "" },
        { and: [{ column: "id", op: "=", value: row.id }] }
      );
      const release = await t.nextly.releases.create({ title: "Banner" });
      const member = await t.nextly.releases.addMember({
        releaseId: release.id,
        scopeKind: "single",
        scopeSlug: "banner",
        entryId: row.id,
        locale: null,
        action: "publish",
        userId: author,
      });

      expect(
        (await t.nextly.releases.readiness({ releaseId: release.id })).hard
      ).toEqual([
        expect.objectContaining({
          memberId: member.id,
          code: "REQUIRED_FIELD_MISSING",
          detail: { fields: ["headline"] },
        }),
      ]);
    });

    it("reports a pending change to a field the author may not write, and refuses to schedule", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      await t.nextly.updateSingle({
        slug: "flags" as never,
        data: { label: "Live", status: "published" } as never,
      });
      // A trusted edit holds a change to the guarded field as pending work.
      await t.nextly.updateSingle({
        slug: "flags" as never,
        data: { guarded: "secret" } as never,
      });
      const row = await t.adapter.selectOne<{ id: string }>("single_flags", {});
      if (row === null || row === undefined) throw new Error("no flags row");
      const release = await t.nextly.releases.create({ title: "Flags" });
      const member = await t.nextly.releases.addMember({
        releaseId: release.id,
        scopeKind: "single",
        scopeSlug: "flags",
        entryId: row.id,
        locale: null,
        action: "publish",
        userId: author,
      });

      expect(
        (await t.nextly.releases.readiness({ releaseId: release.id })).hard
      ).toEqual([
        expect.objectContaining({
          memberId: member.id,
          code: "FIELD_NOT_PERMITTED",
          detail: { fields: ["guarded"] },
        }),
      ]);
      expect(
        await problemsOf(
          t.nextly.releases.schedule({
            id: release.id,
            at: LATER,
            timezone: "UTC",
          })
        )
      ).toEqual([{ memberId: member.id, code: "FIELD_NOT_PERMITTED" }]);
    });

    it("reports a document whose collection was deleted as gone, without failing the check", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      const id = await entry(t, "scratch");
      const { releaseId, memberIds } = await releaseOf(t, author, [
        { collection: "scratch", id },
      ]);
      await (
        t.getService("collectionRegistryService") as {
          deleteCollection: (
            slug: string,
            options: { force: boolean }
          ) => Promise<unknown>;
        }
      ).deleteCollection("scratch", { force: true });

      const found = await t.nextly.releases.readiness({ releaseId });
      expect(found.hard).toContainEqual(
        expect.objectContaining({
          memberId: memberIds[0],
          code: "DOCUMENT_GONE",
        })
      );
      expect(
        await problemsOf(
          t.nextly.releases.schedule({
            id: releaseId,
            at: LATER,
            timezone: "UTC",
          })
        )
      ).toContainEqual({ memberId: memberIds[0], code: "DOCUMENT_GONE" });
    });

    it("checks every document of a large release, and refuses it for a problem in the last one", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      const ids: string[] = [];
      for (let i = 0; i < 250; i += 1) ids.push(await entry(t, "articles"));
      await breakTitle(t, ids[249]);
      const { releaseId, memberIds } = await releaseOf(
        t,
        author,
        ids.map(id => ({ collection: "articles" as const, id }))
      );

      const found = await t.nextly.releases.readiness({ releaseId });
      expect(found.hard.map(f => [f.memberId, f.code])).toEqual([
        [memberIds[249], "REQUIRED_FIELD_MISSING"],
      ]);
      expect(
        await problemsOf(
          t.nextly.releases.schedule({
            id: releaseId,
            at: LATER,
            timezone: "UTC",
          })
        )
      ).toEqual([{ memberId: memberIds[249], code: "REQUIRED_FIELD_MISSING" }]);
    }, 240_000);

    it("refuses each door over the Direct API, leaving the release as it was", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      const bad = await entry(t, "articles");
      await breakTitle(t, bad);

      // Scheduling and Publish now.
      const broken = await releaseOf(t, author, [
        { collection: "articles", id: bad },
      ]);
      const expected = [
        { memberId: broken.memberIds[0], code: "REQUIRED_FIELD_MISSING" },
      ];
      expect(
        await problemsOf(
          t.nextly.releases.schedule({
            id: broken.releaseId,
            at: LATER,
            timezone: "UTC",
          })
        )
      ).toEqual(expected);
      expect(
        await problemsOf(t.nextly.releases.publishNow({ id: broken.releaseId }))
      ).toEqual(expected);
      const untouched = await t.nextly.releases.findByID({
        id: broken.releaseId,
      });
      expect(untouched).toMatchObject({ state: "draft", scheduledAt: null });

      // Adding to a scheduled release.
      const good = await entry(t, "articles");
      const scheduled = await releaseOf(t, author, [
        { collection: "articles", id: good },
      ]);
      await t.nextly.releases.schedule({
        id: scheduled.releaseId,
        at: LATER,
        timezone: "UTC",
      });
      expect(
        await problemsOf(
          t.nextly.releases.addMember({
            releaseId: scheduled.releaseId,
            scopeKind: "collection",
            scopeSlug: "articles",
            entryId: bad,
            locale: null,
            action: "publish",
            userId: author,
          })
        )
      ).toEqual([{ memberId: null, code: "REQUIRED_FIELD_MISSING" }]);
      expect(
        (
          await t.nextly.releases.listMembers({
            releaseId: scheduled.releaseId,
          })
        ).map(m => m.id)
      ).toEqual(scheduled.memberIds);
      expect(
        await t.nextly.releases.findByID({ id: scheduled.releaseId })
      ).toMatchObject({ state: "scheduled", scheduledAt: LATER });

      // Switching an action in a scheduled release.
      const notice = await entry(t, "notices", "published");
      const takedown = await releaseOf(t, author, [
        { collection: "notices", id: notice, action: "publish" },
      ]);
      await t.nextly.releases.schedule({
        id: takedown.releaseId,
        at: LATER,
        timezone: "UTC",
      });
      expect(
        await problemsOf(
          t.nextly.releases.changeMemberAction({
            releaseId: takedown.releaseId,
            memberId: takedown.memberIds[0],
            action: "unpublish",
          })
        )
      ).toEqual([
        { memberId: takedown.memberIds[0], code: "AUTHOR_MAY_NOT_ACT" },
      ]);
      expect(
        (
          await t.nextly.releases.listMembers({ releaseId: takedown.releaseId })
        ).map(m => m.action)
      ).toEqual(["publish"]);
    });

    it("switches a permitted action, and the release keeps it", async () => {
      const t = await boot(dialect);
      const author = await seedPlainAuthor(t);
      const id = await entry(t, "articles", "published");
      const { releaseId, memberIds } = await releaseOf(t, author, [
        { collection: "articles", id },
      ]);
      await t.nextly.releases.schedule({
        id: releaseId,
        at: LATER,
        timezone: "UTC",
      });

      const switched = await t.nextly.releases.changeMemberAction({
        releaseId,
        memberId: memberIds[0],
        action: "unpublish",
      });
      expect(switched).toMatchObject({ id: memberIds[0], action: "unpublish" });
      expect(
        (await t.nextly.releases.listMembers({ releaseId })).map(m => [
          m.id,
          m.action,
          m.createdBy,
        ])
      ).toEqual([[memberIds[0], "unpublish", author]]);
      expect(await t.nextly.releases.findByID({ id: releaseId })).toMatchObject(
        {
          state: "scheduled",
        }
      );
    });

    it("answers not found for the readiness of a release that is not there", async () => {
      const t = await boot(dialect);
      await expect(
        t.nextly.releases.readiness({
          releaseId: "00000000-0000-4000-8000-00000000dead",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  }
);

/**
 * A key holding exactly the grants named, minted by the instance's first user,
 * who is its super admin. Members added through it are that user's.
 */
async function keyHolding(
  t: TestNextly,
  slugs: string[]
): Promise<{ key: string; ownerId: string }> {
  const nextly = t.nextly as unknown as {
    users: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
    permissions: {
      find: (a: { page: number; limit: number }) => Promise<{
        items: { id: string; slug: string }[];
        meta: { hasNext: boolean };
      }>;
    };
    roles: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
  };
  const owner = await nextly.users.create({
    data: {
      email: "owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });
  // The system grants are seeded at a real boot, not by the test harness.
  await (
    t.getService("permissionSeedService") as {
      seedSystemPermissions: () => Promise<unknown>;
    }
  ).seedSystemPermissions();
  // Every page, so a grant is found wherever the listing puts it.
  const seeded: { id: string; slug: string }[] = [];
  for (let page = 1; ; page += 1) {
    const listed = await nextly.permissions.find({ page, limit: 100 });
    seeded.push(...listed.items);
    if (!listed.meta.hasNext) break;
  }
  const ids = slugs.map(slug => {
    const found = seeded.find(p => p.slug === slug);
    expect(found, `\`${slug}\` must be seeded`).toBeDefined();
    return found!.id;
  });
  const role = await nextly.roles.create({
    data: { name: "Releaser", slug: "releaser", permissionIds: ids },
  });
  const apiKeys = t.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId?: string;
        expiresIn: string;
      }
    ) => Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(owner.item.id, {
    name: "releaser",
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "unlimited",
  });
  return { key, ownerId: owner.item.id };
}

/** One REST call to `/api/<path>`, answered as status and JSON body. */
async function rest(
  key: string,
  method: "GET" | "POST" | "PATCH",
  path: string[],
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const handlers = createDynamicHandlers();
  const res = await handlers[method](
    new Request(`http://localhost/api/${path.join("/")}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

/** The problems a REST refusal names, after checking it is a 409 CONFLICT. */
function restProblems(answer: {
  status: number;
  json: Record<string, unknown>;
}): unknown {
  expect(answer.status).toBe(409);
  const error = answer.json.error as { code: string; data: unknown };
  expect(error.code).toBe("CONFLICT");
  return (error.data as { problems: unknown }).problems;
}

describe.each(getConfiguredTestDialects())(
  "a release's documents checked before the moment, over REST (%s)",
  dialect => {
    it("refuses each door with the same problems the Direct API names", async () => {
      const t = await boot(dialect);
      const { key } = await keyHolding(t, [
        "read-content-releases",
        "create-content-releases",
        "publish-content-releases",
        "read-articles",
        "update-articles",
        "publish-articles",
        "unpublish-articles",
      ]);
      // A draft: a document already live is not judged again when a release
      // republishes it, since the publish puts nothing new live.
      const bad = await entry(t, "articles");
      await breakTitle(t, bad);
      const good = await entry(t, "articles");

      // A release holding the invalid document going live.
      const created = await rest(key, "POST", ["releases"], {
        title: "Launch",
      });
      const releaseId = (created.json.item as { id: string }).id;
      const added = await rest(
        key,
        "POST",
        ["releases", releaseId, "members"],
        {
          scopeKind: "collection",
          scopeSlug: "articles",
          entryId: bad,
          action: "publish",
        }
      );
      expect(added.status).toBe(201);
      const memberId = (added.json.item as { id: string }).id;
      const expected = [{ memberId, code: "REQUIRED_FIELD_MISSING" }];

      // Readiness reports it, read-gated like the blockers.
      const readiness = await rest(key, "GET", [
        "releases",
        releaseId,
        "readiness",
      ]);
      expect(readiness.status).toBe(200);
      expect(
        (readiness.json as { hard: Array<{ code: string }> }).hard.map(
          f => f.code
        )
      ).toEqual(["REQUIRED_FIELD_MISSING"]);

      // Scheduling and Publish now refuse.
      expect(
        restProblems(
          await rest(key, "POST", ["releases", releaseId, "schedule"], {
            at: LATER.toISOString(),
            timezone: "UTC",
          })
        )
      ).toEqual(expected);
      expect(
        restProblems(
          await rest(key, "POST", ["releases", releaseId, "publish"], {})
        )
      ).toEqual(expected);

      // The same document coming down is fine, so that release schedules; and
      // switching it back to going live is refused.
      const switchedDown = await rest(
        key,
        "PATCH",
        ["releases", releaseId, "members", memberId],
        { action: "unpublish" }
      );
      expect(switchedDown.status).toBe(200);
      const scheduled = await rest(
        key,
        "POST",
        ["releases", releaseId, "schedule"],
        { at: LATER.toISOString(), timezone: "UTC" }
      );
      expect(scheduled.status).toBe(200);
      expect(
        restProblems(
          await rest(
            key,
            "PATCH",
            ["releases", releaseId, "members", memberId],
            {
              action: "publish",
            }
          )
        )
      ).toEqual(expected);

      // Adding the invalid document to the scheduled release, going live.
      const other = await rest(key, "POST", ["releases"], { title: "Other" });
      const otherId = (other.json.item as { id: string }).id;
      await rest(key, "POST", ["releases", otherId, "members"], {
        scopeKind: "collection",
        scopeSlug: "articles",
        entryId: good,
        action: "publish",
      });
      expect(
        (
          await rest(key, "POST", ["releases", otherId, "schedule"], {
            at: LATER.toISOString(),
            timezone: "UTC",
          })
        ).status
      ).toBe(200);
      expect(
        restProblems(
          await rest(key, "POST", ["releases", otherId, "members"], {
            scopeKind: "collection",
            scopeSlug: "articles",
            entryId: bad,
            action: "publish",
          })
        )
      ).toEqual([{ memberId: null, code: "REQUIRED_FIELD_MISSING" }]);
    });

    it("judges a document's author, not the API key the request arrived with", async () => {
      // The key may update and take down memos; the author, who holds no
      // grants, may not take one down. The run acts as the author, on nobody's
      // request, so the author is who is judged.
      const t = await boot(dialect);
      const { key } = await keyHolding(t, [
        "read-content-releases",
        "update-memos",
        "unpublish-memos",
      ]);
      const author = await seedLiveAuthor(t);
      const memo = await entry(t, "memos", "published");
      const { releaseId, memberIds } = await releaseOf(t, author, [
        { collection: "memos", id: memo, action: "unpublish" },
      ]);
      const expected = [[memberIds[0], "AUTHOR_MAY_NOT_ACT"]];

      const overRest = await rest(key, "GET", [
        "releases",
        releaseId,
        "readiness",
      ]);
      expect(overRest.status).toBe(200);
      expect(
        (
          overRest.json as { hard: Array<{ memberId: string; code: string }> }
        ).hard.map(f => [f.memberId, f.code])
      ).toEqual(expected);
      expect(
        (await t.nextly.releases.readiness({ releaseId })).hard.map(f => [
          f.memberId,
          f.code,
        ])
      ).toEqual(expected);
    });

    it("still holds an API key to its own grants when it changes a scheduled release", async () => {
      // The key may assemble and run releases, and edit and publish articles,
      // but may not take one down. The release's author may do both. Judging
      // the author is the readiness check's business; the key's own authority
      // for its own change is still the key's.
      const t = await boot(dialect);
      const { key } = await keyHolding(t, [
        "read-content-releases",
        "create-content-releases",
        "publish-content-releases",
        "read-articles",
        "update-articles",
        "publish-articles",
      ]);
      const author = await seedLiveAuthor(t);
      const id = await entry(t, "articles");
      const { releaseId, memberIds } = await releaseOf(t, author, [
        { collection: "articles", id },
      ]);
      await t.nextly.releases.schedule({
        id: releaseId,
        at: LATER,
        timezone: "UTC",
      });

      // Switching to an action the key may not perform.
      const switched = await rest(
        key,
        "PATCH",
        ["releases", releaseId, "members", memberIds[0]],
        { action: "unpublish" }
      );
      expect(switched.status).toBe(403);
      // Adding a document to come down, which the key may not do.
      const other = await entry(t, "articles", "published");
      const added = await rest(
        key,
        "POST",
        ["releases", releaseId, "members"],
        {
          scopeKind: "collection",
          scopeSlug: "articles",
          entryId: other,
          action: "unpublish",
        }
      );
      expect(added.status).toBe(403);
      expect(
        (await t.nextly.releases.listMembers({ releaseId })).map(m => [
          m.id,
          m.action,
        ])
      ).toEqual([[memberIds[0], "publish"]]);

      // The control: what the key may do, it does.
      const permitted = await rest(
        key,
        "POST",
        ["releases", releaseId, "members"],
        {
          scopeKind: "collection",
          scopeSlug: "articles",
          entryId: await entry(t, "articles"),
          action: "publish",
        }
      );
      expect(permitted.status).toBe(201);
    });

    it("runs Publish now's documents as their author, not as the API key that asked", async () => {
      // The key may run releases and may not write articles; the author may
      // publish them. The drain writes each document as its author, as it does
      // at a scheduled time on nobody's request, so the release goes out.
      const t = await boot(dialect);
      const { key } = await keyHolding(t, [
        "read-content-releases",
        "publish-content-releases",
      ]);
      const author = await seedLiveAuthor(t);
      const id = await entry(t, "articles");
      const { releaseId } = await releaseOf(t, author, [
        { collection: "articles", id },
      ]);

      const answer = await rest(
        key,
        "POST",
        ["releases", releaseId, "publish"],
        {}
      );
      expect(answer.status).toBe(200);
      expect((answer.json.item as { state: string }).state).toBe("published");
      expect(await storedStatus(t, id)).toBe("published");
    });

    it("answers not found for the readiness of a release that is not there", async () => {
      const t = await boot(dialect);
      const { key } = await keyHolding(t, ["read-content-releases"]);
      const answer = await rest(key, "GET", [
        "releases",
        "00000000-0000-4000-8000-00000000dead",
        "readiness",
      ]);
      expect(answer.status).toBe(404);
    });
  }
);
