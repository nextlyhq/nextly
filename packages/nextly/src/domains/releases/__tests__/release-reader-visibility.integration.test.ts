/**
 * A release shows a reader only the documents they may read, against a real
 * database, alike over REST and the Direct API acting for that reader.
 *
 * The reader may read `posts` and not `secrets`. The release holds two of
 * each, and one of each is blocked (its author is no longer active). Every
 * read that names a release's documents must name only the posts and count
 * the secrets by collection, while the counts and the readiness describe all
 * four: the members, the problems, the blockers, a scheduling refusal and the
 * search for the releases holding one document.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { createDynamicHandlers } from "../../../routeHandler";
import { ServiceContainer } from "../../../services/index";
import type { CollectionsHandler } from "../../../services/collections-handler";

import {
  seedLiveAuthor,
  seedPlainAuthor,
  setActive,
} from "./helpers/live-author";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const LATER = "2099-01-01T09:00:00Z";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    // No code-defined rules, so each collection is read by database
    // permission alone: the reader's role holds `read-posts` and not
    // `read-secrets`.
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "secrets",
        labels: { singular: "Secret", plural: "Secrets" },
        status: true,
        fields: [text({ name: "title" })],
      }),
      // Read by a code rule naming a role by its SLUG, beside the grant.
      defineCollection({
        slug: "memos",
        status: true,
        access: {
          read: ({ roles }) => roles.includes("memo-reader"),
        },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

async function entry(
  t: TestNextly,
  collection: "posts" | "secrets" | "memos"
): Promise<string> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const created = await handler.createEntry(
    { collectionName: collection, overrideAccess: true },
    { title: `A ${collection} entry`, status: "draft" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  return id;
}

/** The ids of these seeded grants, seeding the system ones first. */
async function grantIds(t: TestNextly, slugs: string[]): Promise<string[]> {
  const nextly = t.nextly as unknown as {
    permissions: {
      find: (a: { page: number; limit: number }) => Promise<{
        items: { id: string; slug: string }[];
        meta: { hasNext: boolean };
      }>;
    };
  };
  await (
    t.getService("permissionSeedService") as {
      seedSystemPermissions: () => Promise<unknown>;
    }
  ).seedSystemPermissions();
  const seeded: { id: string; slug: string }[] = [];
  for (let page = 1; ; page += 1) {
    const listed = await nextly.permissions.find({ page, limit: 100 });
    seeded.push(...listed.items);
    if (!listed.meta.hasNext) break;
  }
  return slugs.map(slug => {
    const found = seeded.find(p => p.slug === slug);
    expect(found, `\`${slug}\` must be seeded`).toBeDefined();
    return found!.id;
  });
}

/** Give a user a role holding exactly these seeded grants; its id. */
async function grantRole(
  t: TestNextly,
  userId: string,
  slug: string,
  grants: string[]
): Promise<string> {
  const role = await (
    t.nextly as unknown as {
      roles: {
        create: (a: { data: Record<string, unknown> }) => Promise<{
          item: { id: string };
        }>;
      };
    }
  ).roles.create({
    data: { name: slug, slug, permissionIds: await grantIds(t, grants) },
  });
  await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(
    userId,
    role.item.id
  );
  return role.item.id;
}

/**
 * The reader: a user whose one role reads and schedules releases and reads
 * posts, never secrets, and an API key of that same role for REST.
 */
async function reader(t: TestNextly): Promise<{ userId: string; key: string }> {
  const userId = await seedPlainAuthor(t);
  const roleId = await grantRole(t, userId, "post-reader", [
    "read-content-releases",
    "publish-content-releases",
    "read-posts",
  ]);
  return { userId, key: await keyFor(t, userId, roleId) };
}

/** A role-based API key of this role, minted by this user. */
async function keyFor(
  t: TestNextly,
  userId: string,
  roleId: string
): Promise<string> {
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
  const { key } = await apiKeys.createApiKey(userId, {
    name: "reader",
    tokenType: "role-based",
    roleId,
    expiresIn: "unlimited",
  });
  return key;
}

/**
 * A signed-in session's cookie for this user, carrying these role ids, as a
 * sign-in issues one: a session names its roles by id, never by slug.
 */
async function sessionCookie(
  userId: string,
  roleIds: string[]
): Promise<string> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.com`,
      name: "Reader",
      image: null,
      roleIds,
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  return `nextly_session=${token}`;
}

/** One GET to `/api/<path>` as a signed-in session, as status and JSON body. */
async function restAsSession(
  cookie: string,
  path: string[]
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await createDynamicHandlers().GET(
    new Request(`http://localhost/api/${path.join("/")}`, {
      headers: { cookie },
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

/** One REST call to `/api/<path>`, answered as status and JSON body. */
async function rest(
  key: string,
  method: "GET" | "POST",
  path: string[],
  options: { query?: string; body?: unknown } = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const handlers = createDynamicHandlers();
  const res = await handlers[method](
    new Request(
      `http://localhost/api/${path.join("/")}${options.query ?? ""}`,
      {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      }
    ),
    { params: Promise.resolve({ params: path }) }
  );
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

/** What a refusal carries: its problems and its hidden counts. */
async function refusalOf(
  refused: Promise<unknown>
): Promise<{ problems: unknown; hidden?: unknown }> {
  const error = await refused.then(
    () => {
      throw new Error("expected a refusal");
    },
    (caught: unknown) => caught
  );
  expect(error).toMatchObject({ code: "CONFLICT" });
  return (error as { publicData: { problems: unknown; hidden?: unknown } })
    .publicData;
}

/**
 * Two posts and two secrets in one release, one of each blocked by an author
 * who is no longer active. The other two are added by the instance's super
 * admin, whom every check admits, so the only problems are the departed
 * author's.
 */
async function mixedRelease(
  t: TestNextly,
  admin: string
): Promise<{
  releaseId: string;
  posts: { open: string; blocked: string };
  secrets: { open: string; blocked: string };
  members: Record<string, string>;
}> {
  const active = admin;
  // May publish both, so it is blocked only by being no longer active.
  const leaving = await seedPlainAuthor(t);
  await grantRole(t, leaving, "publisher", [
    "read-posts",
    "publish-posts",
    "read-secrets",
    "publish-secrets",
  ]);
  const posts = {
    open: await entry(t, "posts"),
    blocked: await entry(t, "posts"),
  };
  const secrets = {
    open: await entry(t, "secrets"),
    blocked: await entry(t, "secrets"),
  };
  const release = await t.nextly.releases.create({ title: "Launch" });
  const members: Record<string, string> = {};
  for (const [collection, entryId, author] of [
    ["posts", posts.open, active],
    ["posts", posts.blocked, leaving],
    ["secrets", secrets.open, active],
    ["secrets", secrets.blocked, leaving],
  ] as const) {
    const member = await t.nextly.releases.addMember({
      releaseId: release.id,
      scopeKind: "collection",
      scopeSlug: collection,
      entryId,
      locale: null,
      action: "publish",
      userId: author,
    });
    members[entryId] = member.id;
  }
  await setActive(t, leaving, false);
  return { releaseId: release.id, posts, secrets, members };
}

describe.each(getConfiguredTestDialects())(
  "a release shows a reader only the documents they may read (%s)",
  dialect => {
    it("names only readable documents and counts the rest, alike over REST and the Direct API", async () => {
      const t = await boot(dialect);
      // The instance's first user is its super admin, whom every rule admits.
      const admin = await seedLiveAuthor(t);
      const { releaseId, posts, secrets, members } = await mixedRelease(
        t,
        admin
      );
      const { userId, key } = await reader(t);
      const asReader = { releaseId, userId, overrideAccess: false } as const;
      const hiddenIds = [
        secrets.open,
        secrets.blocked,
        members[secrets.open],
        members[secrets.blocked],
      ];
      // Counted by collection, with the collection's display names, which
      // the reader cannot look up for a collection they may not read.
      const SECRETS_LABELS = { singular: "Secret", plural: "Secrets" };
      const secretsCounted = (count: number) => [
        {
          scopeKind: "collection",
          scopeSlug: "secrets",
          count,
          labels: SECRETS_LABELS,
        },
      ];

      // The members: the two posts, and the two secrets as a count.
      const direct = await t.nextly.releases.membersOf(asReader);
      expect(direct.items.map(member => member.entryId).sort()).toEqual(
        [posts.open, posts.blocked].sort()
      );
      expect(direct.hidden).toEqual(secretsCounted(2));
      expect(
        (await t.nextly.releases.listMembers(asReader)).map(m => m.entryId)
      ).toEqual(direct.items.map(m => m.entryId));
      const overRest = await rest(key, "GET", [
        "releases",
        releaseId,
        "members",
      ]);
      expect(overRest.status).toBe(200);
      expect(
        (overRest.json.items as { entryId: string }[]).map(m => m.entryId)
      ).toEqual(direct.items.map(m => m.entryId));
      expect((overRest.json.meta as { hidden?: unknown }).hidden).toEqual(
        secretsCounted(2)
      );

      // The problems: the blocked post named, the blocked secret counted, so
      // the release still reads as not ready.
      const readiness = await t.nextly.releases.readiness(asReader);
      expect(readiness.hard.map(finding => finding.memberId)).toEqual([
        members[posts.blocked],
      ]);
      expect(readiness.hidden).toEqual([
        expect.objectContaining({
          scopeKind: "collection",
          scopeSlug: "secrets",
          count: 2,
          hard: 1,
          labels: SECRETS_LABELS,
        }),
      ]);
      const readinessOverRest = await rest(key, "GET", [
        "releases",
        releaseId,
        "readiness",
      ]);
      expect(readinessOverRest.json).toEqual(
        JSON.parse(JSON.stringify(readiness))
      );
      const [batched] = await t.nextly.releases.readinessOf({
        releaseIds: [releaseId],
        userId,
        overrideAccess: false,
      });
      expect(batched).toEqual({ ...readiness, checked: true });

      // The blockers, as the schedule dialog asks for them.
      const blockers = await t.nextly.releases.blockersOf(asReader);
      expect(blockers.items.map(blocker => blocker.memberId)).toEqual([
        members[posts.blocked],
      ]);
      expect(blockers.hidden).toEqual(secretsCounted(1));
      const blockersOverRest = await rest(key, "GET", [
        "releases",
        releaseId,
        "blockers",
      ]);
      expect(blockersOverRest.json.items).toEqual(
        JSON.parse(JSON.stringify(blockers.items))
      );
      expect(
        (blockersOverRest.json.meta as { hidden?: unknown }).hidden
      ).toEqual(secretsCounted(1));

      // Scheduling is refused over every document, naming only the post.
      const refused = await refusalOf(
        t.nextly.releases.schedule({
          id: releaseId,
          at: new Date(LATER),
          timezone: "UTC",
          userId,
          overrideAccess: false,
        })
      );
      expect(refused.problems).toEqual([
        { memberId: members[posts.blocked], code: "AUTHOR_GONE" },
      ]);
      expect(refused.hidden).toEqual(secretsCounted(1));
      const refusedOverRest = await rest(
        key,
        "POST",
        ["releases", releaseId, "schedule"],
        { body: { at: LATER, timezone: "UTC" } }
      );
      expect(refusedOverRest.status).toBe(409);
      expect((refusedOverRest.json.error as { data: unknown }).data).toEqual(
        JSON.parse(JSON.stringify(refused))
      );

      // The releases holding a document, asked of a scheduled release (the
      // states a document's banner shows): a post's is listed, and a
      // secret's is answered as being in none.
      const scheduled = await t.nextly.releases.create({ title: "Clean" });
      for (const [collection, entryId] of [
        ["posts", posts.open],
        ["secrets", secrets.open],
      ] as const) {
        await t.nextly.releases.addMember({
          releaseId: scheduled.id,
          scopeKind: "collection",
          scopeSlug: collection,
          entryId,
          locale: null,
          action: "publish",
          userId: admin,
        });
      }
      await t.nextly.releases.schedule({
        id: scheduled.id,
        at: new Date(LATER),
        timezone: "UTC",
      });
      const holding = (
        collection: "posts" | "secrets",
        entryId: string,
        caller: { userId?: string; overrideAccess?: false } = {
          userId,
          overrideAccess: false,
        }
      ) =>
        t.nextly.releases.find({
          containing: {
            scopeKind: "collection",
            scopeSlug: collection,
            entryId,
            locale: null,
          },
          ...caller,
        });
      expect((await holding("posts", posts.open)).items.map(r => r.id)).toEqual(
        [scheduled.id]
      );
      expect((await holding("secrets", secrets.open)).items).toEqual([]);
      // The control: the secret is in that release, for a caller who may see.
      expect(
        (await holding("secrets", secrets.open, {})).items.map(r => r.id)
      ).toEqual([scheduled.id]);
      const secretOverRest = await rest(key, "GET", ["releases"], {
        query: `?containingScopeKind=collection&containingScopeSlug=secrets&containingEntryId=${secrets.open}`,
      });
      expect(secretOverRest.json.items).toEqual([]);

      // The counts stay whole.
      const counts = await t.nextly.releases.memberCounts({
        releaseIds: [releaseId],
        userId,
        overrideAccess: false,
      });
      expect(counts[releaseId]).toMatchObject({ total: 4 });

      // Nothing the reader was given names a secret.
      const given = JSON.stringify([
        direct,
        overRest.json,
        readiness,
        readinessOverRest.json,
        blockers,
        blockersOverRest.json,
        refused,
        refusedOverRest.json,
      ]);
      for (const id of hiddenIds) expect(given).not.toContain(id);
    });

    it("judges a signed-in reader by role slug, as the collection's own read rule does", async () => {
      const t = await boot(dialect);
      const admin = await seedLiveAuthor(t);
      const memo = await entry(t, "memos");
      const release = await t.nextly.releases.create({ title: "Memos" });
      await t.nextly.releases.addMember({
        releaseId: release.id,
        scopeKind: "collection",
        scopeSlug: "memos",
        entryId: memo,
        locale: null,
        action: "publish",
        userId: admin,
      });

      // Over REST as a signed-in session, by role: the rule names the role's
      // SLUG, while a session carries its roles by id. The collection's own
      // list judges by slug, and so must the release.
      const byRole = await seedPlainAuthor(t);
      const memoReader = await grantRole(t, byRole, "memo-reader", [
        "read-content-releases",
        "read-memos",
      ]);
      const cookie = await sessionCookie(byRole, [memoReader]);
      const list = await restAsSession(cookie, [
        "collections",
        "memos",
        "entries",
      ]);
      expect(list.status).toBe(200);
      const overRest = await restAsSession(cookie, [
        "releases",
        release.id,
        "members",
      ]);
      expect(overRest.status).toBe(200);
      expect(
        (overRest.json.items as { entryId: string }[]).map(m => m.entryId)
      ).toEqual([memo]);

      // The control: a session that may read memos by grant but holds no
      // role the rule names is refused by the collection's own list, and is
      // told only a count by the release.
      const noRole = await seedPlainAuthor(t);
      const plainReader = await grantRole(t, noRole, "plain-reader", [
        "read-content-releases",
        "read-memos",
      ]);
      const plainCookie = await sessionCookie(noRole, [plainReader]);
      expect(
        (await restAsSession(plainCookie, ["collections", "memos", "entries"]))
          .status
      ).toBe(403);
      const counted = await restAsSession(plainCookie, [
        "releases",
        release.id,
        "members",
      ]);
      expect(counted.json.items).toEqual([]);
      expect((counted.json.meta as { hidden?: unknown }).hidden).toEqual([
        expect.objectContaining({ scopeSlug: "memos", count: 1 }),
      ]);
    });

    it("shows a trusted caller every document", async () => {
      const t = await boot(dialect);
      const admin = await seedLiveAuthor(t);
      const { releaseId, secrets } = await mixedRelease(t, admin);
      const all = await t.nextly.releases.membersOf({ releaseId });
      expect(all.items).toHaveLength(4);
      expect(all.hidden).toEqual([]);
      expect(all.items.map(member => member.entryId)).toEqual(
        expect.arrayContaining([secrets.open, secrets.blocked])
      );
    });
  }
);
