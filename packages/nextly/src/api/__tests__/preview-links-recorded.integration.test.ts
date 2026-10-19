/**
 * Preview links recorded one by one: shared for a set time, listed, counted
 * and revoked singly, on every configured dialect.
 *
 * Everything runs through the real pieces a link passes through: the mint and
 * the list and revoke endpoints through the catch-all handler with a real
 * session cookie, the link being OPENED through the preview route, and a page
 * RENDERED afterwards through the session reader, which re-reads the cookie
 * the route set. A link revoked after it was opened has to stop at the render
 * as well as at the next open, since the reviewer already holds the cookie.
 *
 * Links minted before links were recorded carry no id. They are built here
 * with the real signer and no record, as an upgraded install still holds
 * them, and must keep working until they expire, be left out of the list, and
 * end with either revoke-all.
 */

// Sessions and preview links sign with keys derived from this; set before any
// module reads env.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import {
  prunePreviewLinks,
  recordPreviewLink,
  revokeDocumentLinks,
} from "../../auth/preview/preview-link-records";
import { signPreviewToken } from "../../auth/preview/preview-token";
import { defineCollection, defineSingle, text } from "../../config";
import { getDialectTables } from "../../database/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import {
  createPreviewRoute,
  PREVIEW_SCOPE_COOKIE,
  readPreviewSession,
} from "../../runtime/preview/preview-route";
import type { HookContext } from "../../hooks/types";
import { previewLinksTables } from "../../schemas/preview-links";

const SECRET = process.env.NEXTLY_SECRET;
const HOUR = 60 * 60;
const DAY = 24 * HOUR;

type Doc = { collection: string; entryId: string } | { single: string };

interface Minted {
  id: string;
  token: string;
  expiresAt: string;
}

interface ListedLink {
  kind: "link";
  id: string;
  createdBy: { id: string; name: string | null } | null;
  createdAt: string;
  expiresAt: string;
  openCount: number;
  lastOpenedAt: string | null;
}

interface OlderLinks {
  kind: "older";
  latestEnd: string;
}

type ListItem = ListedLink | OlderLinks;

const posts = () =>
  defineCollection({
    slug: "posts",
    status: true,
    versions: { drafts: true },
    fields: [text({ name: "slug" }), text({ name: "title" })],
    admin: { preview: { url: entry => `/posts/${String(entry.slug)}` } },
  });

const home = () =>
  defineSingle({
    slug: "home",
    status: true,
    versions: { drafts: true },
    fields: [text({ name: "title" })],
    admin: { preview: { url: () => "/" } },
  });

/** Read hooks of a Single nothing ever creates, recording whether they ran. */
const emptyReads = {
  beforeRead: vi.fn(async () => undefined),
  afterRead: vi.fn(async (ctx: HookContext) => ctx.data),
};

const emptyPage = () =>
  defineSingle({
    slug: "empty-page",
    status: true,
    versions: { drafts: true },
    hooks: {
      beforeRead: [emptyReads.beforeRead],
      afterRead: [emptyReads.afterRead],
    },
    fields: [text({ name: "title" })],
    admin: { preview: { url: () => "/empty" } },
  });

let current: TestNextly | undefined;
afterEach(async () => {
  vi.useRealTimers();
  emptyReads.beforeRead.mockClear();
  emptyReads.afterRead.mockClear();
  await current?.destroy();
  current = undefined;
});

interface Install {
  t: TestNextly;
  dialect: TestDialect;
  /** May share both documents: reads and updates posts and the Single. */
  editor: string;
  /** A second sharer, so a list can show more than one maker. */
  colleague: string;
  /** Reads posts and the Single, and may change neither. */
  reader: string;
  post: Doc;
  otherPost: Doc;
  single: Doc;
}

async function boot(dialect: TestDialect): Promise<Install> {
  const t = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    collections: [posts()],
    singles: [home(), emptyPage()],
  });
  current = t;

  // A preview link is built under the site's address.
  const settings = t.getService("generalSettingsService") as unknown as {
    updateSettings: (data: Record<string, unknown>) => Promise<unknown>;
  };
  await settings.updateSettings({ siteUrl: "https://site.example" });

  // The install's first account is made its administrator, whom no rule
  // binds. Made first so that none of the accounts below is.
  await account(t, "founder@example.com");
  const editor = await account(t, "editor@example.com");
  const colleague = await account(t, "colleague@example.com");
  const reader = await account(t, "reader@example.com");
  await grant(t, editor, "sharer", [
    "read-posts",
    "update-posts",
    "read-home",
    "update-home",
    "read-empty-page",
    "update-empty-page",
  ]);
  const sharerRole = await roleId(t, "sharer");
  await assign(t, colleague, sharerRole);
  await grant(t, reader, "viewer", ["read-posts", "read-home"]);

  const first = await t.nextly.create({
    collection: "posts",
    data: { slug: "first", title: "First" },
  });
  const second = await t.nextly.create({
    collection: "posts",
    data: { slug: "second", title: "Second" },
  });
  // The Single's row, so there is a document to preview.
  await t.nextly.updateSingle({ slug: "home", data: { title: "Home" } });

  return {
    t,
    dialect,
    editor,
    colleague,
    reader,
    post: { collection: "posts", entryId: String(first.item.id) },
    otherPost: { collection: "posts", entryId: String(second.item.id) },
    single: { single: "home" },
  };
}

async function account(t: TestNextly, email: string): Promise<string> {
  const created = await (
    t.nextly as unknown as {
      users: {
        create: (a: {
          data: Record<string, unknown>;
        }) => Promise<{ item: { id: string } }>;
      };
    }
  ).users.create({
    data: { email, password: "Password123!", name: email, isActive: true },
  });
  return String(created.item.id);
}

interface DirectRbac {
  permissions: {
    find: (a: {
      limit: number;
    }) => Promise<{ items: { id: string; slug: string }[] }>;
  };
  roles: {
    create: (a: {
      data: Record<string, unknown>;
    }) => Promise<{ item: { id: string } }>;
    find: (a: {
      limit: number;
    }) => Promise<{ items: { id: string; slug: string }[] }>;
  };
}

async function grant(
  t: TestNextly,
  userId: string,
  slug: string,
  permissionSlugs: string[]
): Promise<void> {
  const nextly = t.nextly as unknown as DirectRbac;
  const permissions = await nextly.permissions.find({ limit: 500 });
  const ids = permissionSlugs.map(wanted => {
    const found = permissions.items.find(p => p.slug === wanted);
    expect(
      found,
      `\`${wanted}\` must be seeded, or the role grants nothing and a refusal is for the wrong reason`
    ).toBeDefined();
    return found!.id;
  });
  const role = await nextly.roles.create({
    data: { name: slug, slug, permissionIds: ids },
  });
  await assign(t, userId, String(role.item.id));
}

async function roleId(t: TestNextly, slug: string): Promise<string> {
  const roles = await (t.nextly as unknown as DirectRbac).roles.find({
    limit: 100,
  });
  const found = roles.items.find(r => r.slug === slug);
  expect(found).toBeDefined();
  return String(found!.id);
}

async function assign(
  t: TestNextly,
  userId: string,
  role: string
): Promise<void> {
  await (
    t.adapter.getDrizzle() as unknown as {
      insert: (table: unknown) => {
        values: (row: unknown) => Promise<unknown>;
      };
    }
  )
    .insert(getDialectTables().userRoles)
    .values({
      id: `${userId}-${role}`,
      userId,
      roleId: role,
      expiresAt: null,
      createdAt: new Date(),
    });
}

async function sessionCookie(userId: string): Promise<string> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.com`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    SECRET!
  );
  return `nextly_session=${token}`;
}

type Caller = { session: string } | { key: string };

async function call(
  caller: Caller,
  method: "GET" | "POST",
  segments: string[],
  options: { body?: unknown; query?: Record<string, string> } = {}
): Promise<Response> {
  const query = options.query
    ? `?${new URLSearchParams(options.query).toString()}`
    : "";
  const headers: Record<string, string> =
    "session" in caller
      ? { cookie: await sessionCookie(caller.session) }
      : { authorization: `Bearer ${caller.key}` };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const request = new Request(
    `http://localhost/api/${segments.join("/")}${query}`,
    {
      method,
      headers,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    }
  );
  const context = { params: Promise.resolve({ params: segments }) };
  const handlers = createDynamicHandlers();
  return method === "GET"
    ? handlers.GET(request, context)
    : handlers.POST(request, context);
}

async function mint(
  userId: string,
  doc: Doc,
  ttlSeconds?: number
): Promise<Minted> {
  const res = await call({ session: userId }, "POST", ["preview-links"], {
    body: { ...doc, ...(ttlSeconds === undefined ? {} : { ttlSeconds }) },
  });
  const text = await res.text();
  expect(res.status, text).toBe(200);
  const { item } = JSON.parse(text) as { item: Minted };
  expect(item.id, "the mint names the recorded link").toEqual(
    expect.any(String)
  );
  return item;
}

function documentQuery(doc: Doc): Record<string, string> {
  return "single" in doc
    ? { single: doc.single }
    : { collection: doc.collection, entryId: doc.entryId };
}

async function list(caller: Caller, doc: Doc): Promise<Response> {
  return call(caller, "GET", ["preview-links"], {
    query: documentQuery(doc),
  });
}

async function listed(userId: string, doc: Doc): Promise<ListItem[]> {
  const res = await list({ session: userId }, doc);
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return (JSON.parse(text) as { items: ListItem[] }).items;
}

function links(items: ListItem[]): ListedLink[] {
  return items.filter((i): i is ListedLink => i.kind === "link");
}

async function revokeOne(
  caller: Caller,
  id: string,
  doc: Doc
): Promise<Response> {
  return call(caller, "POST", ["preview-links", id, "revoke"], { body: doc });
}

async function revokeDocument(caller: Caller, doc: Doc): Promise<Response> {
  return call(caller, "POST", ["preview-links", "revoke"], { body: doc });
}

/** The link being OPENED: the preview route, as a reviewer's click reaches it. */
async function opens(token: string): Promise<boolean> {
  const res = await createPreviewRoute({
    redirectTo: () => "/preview-landing",
    draftMode: () => ({ enable: () => {} }),
  }).GET(
    new Request(
      `https://site.example/api/preview?token=${encodeURIComponent(token)}`
    )
  );
  // Every refusal is the same 404; a granted link redirects.
  expect([307, 404]).toContain(res.status);
  return res.status === 307;
}

/** A page RENDERED in a session the link already opened. */
async function renders(token: string): Promise<boolean> {
  const session = await readPreviewSession({
    cookies: () => ({
      get: (name: string) =>
        name === PREVIEW_SCOPE_COOKIE
          ? { value: encodeURIComponent(token) }
          : undefined,
    }),
  });
  return session !== null;
}

/** A link from before links were recorded: the real signer, no record. */
async function olderLink(
  install: Install,
  doc: Doc,
  ttlSeconds = DAY
): Promise<string> {
  const settings = install.t.getService(
    "generalSettingsService"
  ) as unknown as {
    getPreviewTokenGeneration: () => Promise<number>;
  };
  const { token } = await signPreviewToken(
    "single" in doc
      ? { kind: "single", single: doc.single }
      : { collection: doc.collection, entryId: doc.entryId },
    SECRET!,
    {
      minter: install.editor,
      generation: await settings.getPreviewTokenGeneration(),
      ttlSeconds,
    }
  );
  return token;
}

interface StoredRow {
  id: string;
  createdBy: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  openCount: number;
}

async function storedRows(install: Install): Promise<StoredRow[]> {
  const { nextlyPreviewLinks } = previewLinksTables(
    install.dialect === "sqlite"
      ? "sqlite"
      : install.dialect === "mysql"
        ? "mysql"
        : "postgresql"
  );
  return (await (
    install.t.adapter.getDrizzle() as unknown as {
      select: () => { from: (table: unknown) => Promise<StoredRow[]> };
    }
  )
    .select()
    .from(nextlyPreviewLinks)) as StoredRow[];
}

async function auditRows(
  install: Install,
  kind: string
): Promise<
  Array<{ actorUserId: string | null; metadata: Record<string, unknown> }>
> {
  const { auditLog } = getDialectTables();
  const rows = (await (
    install.t.adapter.getDrizzle() as unknown as {
      select: () => {
        from: (table: unknown) => {
          where: (w: unknown) => Promise<Array<Record<string, unknown>>>;
        };
      };
    }
  )
    .select()
    .from(auditLog)
    .where(eq(auditLog.kind, kind))) as Array<Record<string, unknown>>;
  return rows.map(row => ({
    actorUserId: (row.actorUserId as string | null) ?? null,
    metadata:
      typeof row.metadata === "string"
        ? (JSON.parse(row.metadata) as Record<string, unknown>)
        : ((row.metadata as Record<string, unknown>) ?? {}),
  }));
}

/** Whether every row and count is still as it was. */
async function snapshot(install: Install): Promise<string> {
  const rows = await storedRows(install);
  return JSON.stringify(
    rows
      .map(r => ({
        id: r.id,
        revoked: r.revokedAt !== null,
        opens: Number(r.openCount),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

describe.each(getConfiguredTestDialects())(
  "preview links recorded one by one (%s)",
  dialect => {
    describe("a link shared for a set time", () => {
      it("works until its lifetime ends, and is refused after", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const start = new Date("2030-01-01T09:00:00Z");
        vi.setSystemTime(start);
        const install = await boot(dialect);
        const link = await mint(install.editor, install.post, DAY);

        vi.setSystemTime(new Date(start.getTime() + 23 * HOUR * 1000));
        expect(await opens(link.token)).toBe(true);
        expect(await renders(link.token)).toBe(true);

        vi.setSystemTime(new Date(start.getTime() + 25 * HOUR * 1000));
        expect(await opens(link.token)).toBe(false);
        expect(await renders(link.token)).toBe(false);
      });

      it("refuses a lifetime over seven days", async () => {
        const install = await boot(dialect);
        const res = await call(
          { session: install.editor },
          "POST",
          ["preview-links"],
          { body: { ...install.post, ttlSeconds: 7 * DAY + 1 } }
        );
        expect(res.status).toBe(400);
        expect(await storedRows(install)).toHaveLength(0);
      });

      it("records the link with the end its token carries", async () => {
        const install = await boot(dialect);
        const link = await mint(install.editor, install.post, 3 * DAY);
        const [row] = await storedRows(install);
        const exp = decodeJwt(link.token).exp!;
        expect(row.id).toBe(link.id);
        expect(row.id).toBe(decodeJwt(link.token).jti);
        expect(row.createdBy).toBe(install.editor);
        expect(new Date(row.expiresAt).getTime()).toBe(exp * 1000);
        expect(new Date(link.expiresAt).getTime()).toBe(exp * 1000);
      });
    });

    describe.each(["entry", "single"] as const)(
      "revoking one link of a %s",
      which => {
        it("stops only that link, on open and on render", async () => {
          const install = await boot(dialect);
          const doc = which === "entry" ? install.post : install.single;
          const kept = await mint(install.editor, doc);
          const revoked = await mint(install.editor, doc);
          // Both opened first, so each reviewer already holds the cookie.
          expect(await opens(kept.token)).toBe(true);
          expect(await opens(revoked.token)).toBe(true);

          const res = await revokeOne(
            { session: install.colleague },
            revoked.id,
            doc
          );
          expect(res.status, await res.clone().text()).toBe(200);

          expect(await opens(revoked.token)).toBe(false);
          expect(await renders(revoked.token)).toBe(false);
          expect(await opens(kept.token)).toBe(true);
          expect(await renders(kept.token)).toBe(true);

          const live = links(await listed(install.editor, doc));
          expect(live.map(l => l.id)).toEqual([kept.id]);
        });
      }
    );

    describe("the live list", () => {
      it("counts each opening of a link, and only that link's", async () => {
        const install = await boot(dialect);
        const opened = await mint(install.editor, install.post);
        const untouched = await mint(install.colleague, install.post);
        for (let i = 0; i < 3; i += 1) {
          expect(await opens(opened.token)).toBe(true);
        }
        // Rendering pages in the session is not opening the link.
        expect(await renders(opened.token)).toBe(true);

        const live = links(await listed(install.editor, install.post));
        const byId = new Map(live.map(l => [l.id, l]));
        expect(byId.get(opened.id)?.openCount).toBe(3);
        expect(byId.get(opened.id)?.lastOpenedAt).not.toBeNull();
        expect(byId.get(untouched.id)?.openCount).toBe(0);
        expect(byId.get(opened.id)?.createdBy?.id).toBe(install.editor);
        expect(byId.get(untouched.id)?.createdBy?.id).toBe(install.colleague);
        expect(byId.get(untouched.id)?.createdBy?.name).toBe(
          "colleague@example.com"
        );
      });

      it("names a maker by name only, never by address", async () => {
        const install = await boot(dialect);
        const link = await mint(install.colleague, install.post);
        // A maker with no name: the list must not fall back to their address,
        // which a sharer without user access may not read.
        const { users } = getDialectTables();
        await (
          install.t.adapter.getDrizzle() as unknown as {
            update: (t: unknown) => {
              set: (v: unknown) => { where: (w: unknown) => Promise<unknown> };
            };
          }
        )
          .update(users)
          .set({ name: null })
          .where(eq(users.id, install.colleague));

        const [listedLink] = links(await listed(install.editor, install.post));
        expect(listedLink.id).toBe(link.id);
        expect(listedLink.createdBy?.id).toBe(install.colleague);
        expect(listedLink.createdBy?.name ?? null).toBeNull();
        expect(JSON.stringify(listedLink)).not.toContain("@example.com");
      });

      it("does not count an opening of a revoked link", async () => {
        const install = await boot(dialect);
        const link = await mint(install.editor, install.post);
        expect(await opens(link.token)).toBe(true);
        await revokeOne({ session: install.editor }, link.id, install.post);
        expect(await opens(link.token)).toBe(false);
        const [row] = await storedRows(install);
        expect(Number(row.openCount)).toBe(1);
      });

      it("is private to the session that asked for it", async () => {
        const install = await boot(dialect);
        await mint(install.editor, install.post);
        const res = await list({ session: install.editor }, install.post);
        expect(res.status).toBe(200);
        // A list of who shared which credentials, never kept by a shared
        // cache and replayed to another caller.
        expect(res.headers.get("cache-control") ?? "").toMatch(/private/);
        expect(res.headers.get("cache-control") ?? "").toMatch(/no-store/);
        // A refusal is just as private.
        const refused = await list({ session: install.reader }, install.post);
        expect(refused.status).toBe(403);
        expect(refused.headers.get("cache-control") ?? "").toMatch(/no-store/);
      });

      it("lists one document's links only", async () => {
        const install = await boot(dialect);
        const mine = await mint(install.editor, install.post);
        await mint(install.editor, install.otherPost);
        await mint(install.editor, install.single);
        const live = links(await listed(install.editor, install.post));
        expect(live.map(l => l.id)).toEqual([mine.id]);
      });
    });

    describe("who may list and revoke", () => {
      it("refuses a reader and a key, and changes nothing", async () => {
        const install = await boot(dialect);
        const link = await mint(install.editor, install.post);
        await opens(link.token);
        const keys = install.t.getService("apiKeyService") as unknown as {
          createApiKey: (
            userId: string,
            input: { name: string; tokenType: string; expiresIn: string }
          ) => Promise<{ key: string }>;
        };
        const { key } = await keys.createApiKey(install.editor, {
          name: "automation",
          tokenType: "full-access",
          expiresIn: "never",
        });
        const before = await snapshot(install);

        for (const caller of [
          { session: install.reader },
          { key },
        ] as Caller[]) {
          expect((await list(caller, install.post)).status).toBe(403);
          expect((await revokeOne(caller, link.id, install.post)).status).toBe(
            403
          );
          expect((await revokeDocument(caller, install.post)).status).toBe(403);
        }

        expect(await snapshot(install)).toBe(before);
        expect(await opens(link.token)).toBe(true);
      });

      it("answers a link of another document as not found", async () => {
        const install = await boot(dialect);
        const elsewhere = await mint(install.editor, install.otherPost);
        const res = await revokeOne(
          { session: install.editor },
          elsewhere.id,
          install.post
        );
        expect(res.status).toBe(404);
        expect(await opens(elsewhere.token)).toBe(true);
      });
    });

    describe.each(["entry", "single"] as const)(
      "revoking all of a %s's links",
      which => {
        it("ends its recorded and older links, and no other document's", async () => {
          const install = await boot(dialect);
          const doc = which === "entry" ? install.post : install.single;
          const older = await olderLink(install, doc);
          const recorded = await mint(install.editor, doc);
          const other = await mint(install.editor, install.otherPost);
          expect(await opens(older)).toBe(true);
          expect(await opens(recorded.token)).toBe(true);

          const res = await revokeDocument({ session: install.editor }, doc);
          expect(res.status, await res.clone().text()).toBe(200);

          for (const token of [older, recorded.token]) {
            expect(await opens(token)).toBe(false);
            expect(await renders(token)).toBe(false);
          }
          expect(await opens(other.token)).toBe(true);
          expect(links(await listed(install.editor, doc))).toHaveLength(0);
        });
      }
    );

    describe("revoking every link on the site", () => {
      it("still ends every link, recorded and older", async () => {
        const install = await boot(dialect);
        const older = await olderLink(install, install.post);
        const recorded = await mint(install.editor, install.single);
        // The administrator: site-wide revocation is a settings action.
        const res = await call({ session: await adminId(install) }, "POST", [
          "preview-links",
          "revoke",
        ]);
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await opens(older)).toBe(false);
        expect(await opens(recorded.token)).toBe(false);
        expect(await renders(recorded.token)).toBe(false);
        expect(
          links(await listed(install.editor, install.single))
        ).toHaveLength(0);
      });
    });

    describe("links made before links were recorded", () => {
      it("keep working until they expire, and are not listed", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const start = new Date("2030-02-01T09:00:00Z");
        vi.setSystemTime(start);
        const install = await boot(dialect);
        const older = await olderLink(install, install.post, DAY);
        await mint(install.editor, install.post);

        expect(await opens(older)).toBe(true);
        expect(await renders(older)).toBe(true);
        expect(links(await listed(install.editor, install.post))).toHaveLength(
          1
        );

        vi.setSystemTime(new Date(start.getTime() + 25 * HOUR * 1000));
        expect(await opens(older)).toBe(false);
        expect(await renders(older)).toBe(false);
      });

      it("show as one row until seven days after links began to be recorded", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const start = new Date("2030-03-01T09:00:00Z");
        vi.setSystemTime(start);
        const install = await boot(dialect);
        await mint(install.editor, install.post);

        const older = (await listed(install.editor, install.post)).filter(
          (i): i is OlderLinks => i.kind === "older"
        );
        expect(older).toHaveLength(1);
        expect(new Date(older[0].latestEnd).getTime()).toBe(
          start.getTime() + 7 * DAY * 1000
        );

        vi.setSystemTime(new Date(start.getTime() + 7 * DAY * 1000 + 1000));
        expect(
          (await listed(install.editor, install.post)).filter(
            i => i.kind === "older"
          )
        ).toHaveLength(0);
      });
    });

    describe("listing changes nothing", () => {
      it("creates no Single and runs no hook to answer a list", async () => {
        const install = await boot(dialect);
        const registry = install.t.getService(
          "singleRegistryService"
        ) as unknown as {
          getSingleBySlug: (slug: string) => Promise<{ tableName?: string }>;
        };
        const { tableName } = await registry.getSingleBySlug("empty-page");
        expect(await install.t.adapter.selectOne(tableName!, {})).toBeNull();
        const versionsBefore = (
          await install.t.adapter.select("nextly_versions", {})
        ).length;

        // A Single with no row has no link to manage.
        const res = await list(
          { session: install.editor },
          { single: "empty-page" }
        );
        expect(res.status).toBe(403);

        expect(await install.t.adapter.selectOne(tableName!, {})).toBeNull();
        expect(
          (await install.t.adapter.select("nextly_versions", {})).length
        ).toBe(versionsBefore);
        expect(emptyReads.beforeRead).not.toHaveBeenCalled();
        expect(emptyReads.afterRead).not.toHaveBeenCalled();
      });
    });

    describe("a link made while its document's links are revoked", () => {
      it("is not recorded, so it never opens, when the revoke-all lands mid-mint", async () => {
        const install = await boot(dialect);
        // The mint began, and signed, just before the revoke-all; its row
        // would land just after the revoke-all had already revoked the rest.
        const mintStartedAt = new Date(Date.now() - 1000);
        await revokeDocumentLinks(
          {
            kind: "entry",
            ...(install.post as { collection: string; entryId: string }),
          },
          install.editor,
          new Date()
        );

        await expect(
          recordPreviewLink({
            id: "0123456789abcdef0123456789abcdef",
            scope: install.post as { collection: string; entryId: string },
            createdBy: install.editor,
            createdAt: new Date(
              Math.floor(mintStartedAt.getTime() / 1000) * 1000
            ),
            expiresAt: new Date(Date.now() + DAY * 1000),
            generation: 0,
            mintStartedAt,
          })
        ).rejects.toMatchObject({ statusCode: 409 });
        expect(await storedRows(install)).toHaveLength(0);
      });

      it("is recorded when the mint began after the revoke-all", async () => {
        const install = await boot(dialect);
        await revokeDocument({ session: install.editor }, install.post);
        const link = await mint(install.editor, install.post);
        expect(await opens(link.token)).toBe(true);
      });
    });

    describe("revoking a link twice", () => {
      it("records one revocation, and tells the second when it happened", async () => {
        const install = await boot(dialect);
        const link = await mint(install.editor, install.post);

        const first = await revokeOne(
          { session: install.editor },
          link.id,
          install.post
        );
        const second = await revokeOne(
          { session: install.colleague },
          link.id,
          install.post
        );
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        const at = (r: unknown) =>
          (r as { item: { revokedAt: string } }).item.revokedAt;
        expect(at(await second.json())).toBe(at(await first.json()));

        const revoked = await auditRows(install, "preview-link-revoked");
        expect(revoked).toHaveLength(1);
        expect(revoked[0].actorUserId).toBe(install.editor);
      });
    });

    describe("the live list, a page at a time", () => {
      it("pages the links in the database, and counts them all", async () => {
        const install = await boot(dialect);
        const made: string[] = [];
        for (let i = 0; i < 3; i += 1) {
          made.push((await mint(install.editor, install.post)).id);
        }

        const page = async (n: number) => {
          const res = await call(
            { session: install.editor },
            "GET",
            ["preview-links"],
            {
              query: {
                ...documentQuery(install.post),
                limit: "2",
                page: String(n),
              },
            }
          );
          expect(res.status).toBe(200);
          return (await res.json()) as {
            items: ListItem[];
            meta: { total: number; hasNext: boolean; hasPrev: boolean };
          };
        };

        const first = await page(1);
        const second = await page(2);
        expect(links(first.items)).toHaveLength(2);
        expect(links(second.items)).toHaveLength(1);
        expect(first.meta).toMatchObject({
          total: 3,
          hasNext: true,
          hasPrev: false,
        });
        expect(second.meta).toMatchObject({ hasNext: false, hasPrev: true });
        // Every link once, across the pages.
        expect(
          [...links(first.items), ...links(second.items)].map(l => l.id).sort()
        ).toEqual([...made].sort());
        // The earlier-links row is on the first page only.
        expect(second.items.some(i => i.kind === "older")).toBe(false);
      });
    });

    describe("a document whose links were all revoked", () => {
      it("no longer shows the earlier-links row, since none of them can open", async () => {
        const install = await boot(dialect);
        const older = await olderLink(install, install.post);
        await mint(install.editor, install.post);
        // The control: the row is there while earlier links may still work,
        // on this document and on another.
        const olderRows = (items: ListItem[]) =>
          items.filter(i => i.kind === "older");
        expect(
          olderRows(await listed(install.editor, install.post))
        ).toHaveLength(1);

        await revokeDocument({ session: install.editor }, install.post);

        expect(await opens(older)).toBe(false);
        expect(
          olderRows(await listed(install.editor, install.post))
        ).toHaveLength(0);
        // Another document's earlier links are untouched, so its row stays.
        expect(
          olderRows(await listed(install.editor, install.otherPost))
        ).toHaveLength(1);
      });

      it("still ends a link without a record minted long after recording began", async () => {
        // A rolling upgrade: an instance still on the earlier version mints
        // links without a record after another has begun recording, and such
        // a link works for days after its own mint.
        vi.useFakeTimers({ toFake: ["Date"] });
        const start = new Date("2030-05-01T09:00:00Z");
        vi.setSystemTime(start);
        const install = await boot(dialect);
        await mint(install.editor, install.post);

        vi.setSystemTime(new Date(start.getTime() + 8 * DAY * 1000));
        const late = await olderLink(install, install.post, DAY);
        expect(await opens(late)).toBe(true);

        vi.setSystemTime(new Date(start.getTime() + (8 * DAY + HOUR) * 1000));
        await revokeDocument({ session: install.editor }, install.post);

        expect(await opens(late)).toBe(false);
        expect(await renders(late)).toBe(false);
      });

      it("marks every recorded link revoked at the moment of a site-wide revoke", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const start = new Date("2030-07-01T09:00:00Z");
        vi.setSystemTime(start);
        const install = await boot(dialect);
        await mint(install.editor, install.post, 7 * DAY);
        await call({ session: await adminId(install) }, "POST", [
          "preview-links",
          "revoke",
        ]);
        const [row] = await storedRows(install);
        expect(row.revokedAt).not.toBeNull();

        // So its thirty days run from the revoke, not its scheduled end.
        const { removed } = await prunePreviewLinks(
          install.t.adapter,
          new Date(start.getTime() + 31 * DAY * 1000)
        );
        expect(removed).toBe(1);
      });

      it("shows no earlier-links row on any document after a site-wide revoke", async () => {
        const install = await boot(dialect);
        await mint(install.editor, install.post);
        const olderRows = (items: ListItem[]) =>
          items.filter(i => i.kind === "older");
        expect(
          olderRows(await listed(install.editor, install.post))
        ).toHaveLength(1);

        await call({ session: await adminId(install) }, "POST", [
          "preview-links",
          "revoke",
        ]);

        expect(
          olderRows(await listed(install.editor, install.post))
        ).toHaveLength(0);
        expect(
          olderRows(await listed(install.editor, install.otherPost))
        ).toHaveLength(0);
      });
    });

    describe("an install whose database has not been updated", () => {
      it("refuses a new link with the remedy, and still opens an older one", async () => {
        const install = await boot(dialect);
        const older = await olderLink(install, install.post);
        await install.t.adapter.executeQuery("DROP TABLE nextly_preview_links");

        const res = await call(
          { session: install.editor },
          "POST",
          ["preview-links"],
          { body: install.post }
        );
        const text = await res.text();
        expect(res.status, text).toBe(503);
        expect(text).toContain("nextly migrate");
        expect(await opens(older)).toBe(true);
        expect(await renders(older)).toBe(true);
      });
    });

    describe("revoking all of a document's links before the database is updated", () => {
      it("still ends its earlier links, says so, and records it", async () => {
        const install = await boot(dialect);
        const older = await olderLink(install, install.post);
        await install.t.adapter.executeQuery("DROP TABLE nextly_preview_links");

        const res = await revokeDocument(
          { session: install.editor },
          install.post
        );
        const text = await res.text();
        expect(res.status, text).toBe(200);
        // No recorded link can exist without the table.
        expect(JSON.parse(text)).toMatchObject({ item: { revoked: 0 } });
        expect(await opens(older)).toBe(false);
        expect(
          (await auditRows(install, "preview-links-revoked")).filter(
            r => r.metadata.scope !== undefined
          )
        ).toHaveLength(1);
      });
    });

    describe("the audit trail", () => {
      it("records the mint, revoking one, and revoking all, by whom", async () => {
        const install = await boot(dialect);
        const link = await mint(install.editor, install.post);
        await revokeOne({ session: install.colleague }, link.id, install.post);
        await revokeDocument({ session: install.editor }, install.single);
        await call({ session: await adminId(install) }, "POST", [
          "preview-links",
          "revoke",
        ]);

        const minted = await auditRows(install, "preview-link-minted");
        expect(minted).toHaveLength(1);
        expect(minted[0].actorUserId).toBe(install.editor);
        expect(minted[0].metadata.linkId).toBe(link.id);

        const one = await auditRows(install, "preview-link-revoked");
        expect(one).toHaveLength(1);
        expect(one[0].actorUserId).toBe(install.colleague);
        expect(one[0].metadata.linkId).toBe(link.id);
        expect(one[0].metadata.entryId).toBe(
          (install.post as { entryId: string }).entryId
        );

        const all = await auditRows(install, "preview-links-revoked");
        const documentWide = all.filter(r => r.metadata.scope !== undefined);
        const siteWide = all.filter(r => r.metadata.scope === undefined);
        expect(documentWide).toHaveLength(1);
        expect(documentWide[0].actorUserId).toBe(install.editor);
        expect(documentWide[0].metadata).toMatchObject({
          scope: "single",
          single: "home",
        });
        expect(siteWide).toHaveLength(1);
        expect(siteWide[0].actorUserId).toBe(await adminId(install));
      });
    });

    describe("retention", () => {
      it("measures a revoked link's thirty days from its revocation", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const start = new Date("2030-06-01T09:00:00Z");
        vi.setSystemTime(start);
        const install = await boot(dialect);
        // Made for seven days and revoked at once: its end is the revocation.
        const revoked = await mint(install.editor, install.post, 7 * DAY);
        await revokeOne({ session: install.editor }, revoked.id, install.post);
        const kept = await mint(install.editor, install.post, 7 * DAY);

        // Thirty-one days on: past thirty from the revocation, not yet thirty
        // from either link's scheduled end.
        const now = new Date(start.getTime() + 31 * DAY * 1000);
        const { removed } = await prunePreviewLinks(install.t.adapter, now);

        expect(removed).toBe(1);
        expect((await storedRows(install)).map(r => r.id)).toEqual([kept.id]);
      });

      it("removes a link ended over thirty days ago and keeps a recent one", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const start = new Date("2030-04-01T09:00:00Z");
        vi.setSystemTime(start);
        const install = await boot(dialect);
        const old = await mint(install.editor, install.post, HOUR);
        vi.setSystemTime(new Date(start.getTime() + 25 * DAY * 1000));
        const recent = await mint(install.editor, install.post, HOUR);

        // Thirty days and a minute after the old link ended; the recent one
        // ended five days ago.
        const now = new Date(start.getTime() + (30 * DAY + HOUR + 60) * 1000);
        const { removed } = await prunePreviewLinks(install.t.adapter, now);

        expect(removed).toBe(1);
        expect((await storedRows(install)).map(r => r.id)).toEqual([recent.id]);
        expect(old.id).not.toBe(recent.id);
      });
    });

    describe("a maker who is deleted", () => {
      it("takes their links with them", async () => {
        const install = await boot(dialect);
        const link = await mint(install.colleague, install.post);
        const kept = await mint(install.editor, install.post);
        await (
          install.t.nextly as unknown as {
            users: { delete: (a: { id: string }) => Promise<unknown> };
          }
        ).users.delete({ id: install.colleague });

        expect((await storedRows(install)).map(r => r.id)).toEqual([kept.id]);
        expect(await opens(link.token)).toBe(false);
        const live = links(await listed(install.editor, install.post));
        expect(live.map(l => l.id)).toEqual([kept.id]);
      });
    });
  }
);

/** The install's administrator, the first account. */
async function adminId(install: Install): Promise<string> {
  const { users } = getDialectTables();
  const rows = (await (
    install.t.adapter.getDrizzle() as unknown as {
      select: (f: unknown) => {
        from: (table: unknown) => {
          where: (w: unknown) => Promise<Array<{ id: string }>>;
        };
      };
    }
  )
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "founder@example.com"))) as Array<{ id: string }>;
  return String(rows[0].id);
}
