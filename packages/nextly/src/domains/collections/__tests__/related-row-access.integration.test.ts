/**
 * A related row goes only to a caller who could read that row directly.
 *
 * Populating a relationship asked the target's read rule and nothing else, so
 * a caller refused a row by name still read it through a relationship on a
 * parent: a scoped API key outside its scope, a signed-in user without a grant
 * on a collection that declares no rule, and anyone through an upload field
 * or a relationship to `users`, whose rows were never judged at all.
 *
 * Each case reads the row directly first where a direct read exists for it,
 * then the parent that populates it, for the same caller, and pairs every
 * refusal with a caller the same fixture admits, so an expansion that withheld
 * everything, or a direct read that refused everyone, fails a named case.
 * Run on every configured dialect.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiKeyScope,
  narrowScope,
  type AuthenticatedScope,
} from "../../../auth/authenticated-scope";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  relationship,
  repeater,
  text,
  upload,
} from "../../../config";
import { canReadSystemResource } from "../../../auth/resource-readable";
import { getDialectTables } from "../../../database/index";
import { container } from "../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { consoleLogger } from "../../../services/shared";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { TrustBound } from "../../../services/collections/trust-grant";
import { ApiKeyService } from "../../auth/services/api-key-service";
import { CollectionAccessService } from "../services/collection-access-service";

// Watched, not changed: every call is answered by the real reader, so a
// population of `users` can be counted where it is decided.
vi.mock("../../../auth/resource-readable", async importOriginal => {
  const real =
    await importOriginal<typeof import("../../../auth/resource-readable")>();
  return {
    ...real,
    canReadSystemResource: vi.fn(real.canReadSystemResource),
  };
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** What each target's row says, so a populated value is recognisable. */
const TITLE = {
  page: "Target page",
  note: "Target note",
  memo: "Target memo",
  blob: "Target blob",
  chain: "Target chain",
  media: "target-image.png",
  user: "author@example.com",
} as const;

interface Fixture {
  t: TestNextly;
  handler: CollectionsHandler;
  refId: string;
  pageId: string;
  noteId: string;
  /** The rule on `blobs`, which throws: called only if a caller reaches it. */
  blobRule: ReturnType<typeof vi.fn>;
  /**
   * Users by what they hold. Every person but `nobody` holds read on `memos`
   * and `chains`, whose rules admit everyone: a rule only narrows the
   * permission. `nobody` holds no role at all.
   */
  nobody: string;
  stranger: string;
  pageReader: string;
  noteReader: string;
  mediaReader: string;
  userReader: string;
  superAdmin: string;
}

interface Caller {
  user?: { id: string };
  authenticatedScope?: AuthenticatedScope;
  overrideAccess?: boolean;
  trusted?: TrustBound;
}

/**
 * Targets, one per question a direct read can answer:
 * `pages` declares no read rule, `notes` one that refuses, `memos` one that
 * admits, `blobs` one that throws, and `chains` admits and relates on to
 * `pages`. `refs` relates to all of them, to `users` and to media, nested in a
 * group and a repeater too, and to a page that does not exist. `refs` admits
 * every reader itself, since the parent is not what is being judged.
 */
async function boot(dialect: TestDialect): Promise<Fixture> {
  const blobRule = vi.fn(() => {
    throw new Error("the blobs rule ran");
  });
  const title = text({ name: "title" });
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    // A component that relates to `users`, so a read holding several of its
    // instances asks about that target from inside each one.
    fieldGroups: [
      defineFieldGroup({
        slug: "byline",
        fields: [relationship({ name: "person", relationTo: "users" })],
      }),
    ],
    collections: [
      defineCollection({ slug: "pages", fields: [title] }),
      defineCollection({
        slug: "notes",
        access: { read: () => false },
        fields: [title],
      }),
      defineCollection({
        slug: "memos",
        access: { read: () => true },
        fields: [title],
      }),
      defineCollection({
        slug: "blobs",
        access: { read: blobRule },
        fields: [title],
      }),
      defineCollection({
        slug: "chains",
        access: { read: () => true },
        fields: [title, relationship({ name: "next", relationTo: "pages" })],
      }),
      defineCollection({
        slug: "refs",
        access: { read: () => true },
        fields: [
          text({ name: "name" }),
          relationship({ name: "plain", relationTo: "pages" }),
          relationship({ name: "many", relationTo: "pages", hasMany: true }),
          relationship({ name: "note", relationTo: "notes" }),
          relationship({ name: "memo", relationTo: "memos" }),
          relationship({ name: "blob", relationTo: "blobs" }),
          relationship({
            name: "poly",
            relationTo: ["pages", "memos"],
            hasMany: true,
          }),
          relationship({ name: "chain", relationTo: "chains" }),
          relationship({ name: "author", relationTo: "users" }),
          relationship({ name: "reviewer", relationTo: "users" }),
          fieldGroup({
            name: "bylines",
            component: "byline",
            repeatable: true,
          }),
          upload({ name: "image", relationTo: "media" }),
          group({
            name: "box",
            fields: [relationship({ name: "nested", relationTo: "pages" })],
          }),
          repeater({
            name: "lines",
            fields: [relationship({ name: "item", relationTo: "pages" })],
          }),
          relationship({ name: "gone", relationTo: "pages" }),
          relationship({
            name: "goneMany",
            relationTo: "pages",
            hasMany: true,
          }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "homepage",
        fields: [
          relationship({ name: "featured", relationTo: "pages" }),
          upload({ name: "logo", relationTo: "media" }),
        ],
      }),
    ],
  });
  const t = current;

  // One role per grant, so each caller holds exactly one.
  const roleFor = async (resource: string): Promise<string> => {
    const permission = await t.nextly.permissions.create({
      data: {
        action: "read",
        resource,
        name: `Read ${resource}`,
        slug: `read-${resource}`,
      },
    });
    const role = await t.nextly.roles.create({
      data: {
        name: `${resource} reader`,
        slug: `${resource}-reader`,
        permissionIds: [permission.item.id],
      },
    });
    return String(role.item.id);
  };
  const tables = getDialectTables();
  const db = t.adapter.getDrizzle() as unknown as {
    insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
  };
  await db.insert(tables.roles).values({
    id: "role-super-admin",
    name: "Super Admin",
    slug: "super-admin",
    level: 1000,
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const createUser = async (email: string, roleId?: string) => {
    // An id that does not contain the address, so an unpopulated reference,
    // which is the bare id, can never read as the populated row.
    const userId = `user-${email.split("@")[0]}`;
    await db.insert(tables.users).values({
      id: userId,
      email,
      name: email,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    if (roleId) {
      await db.insert(tables.userRoles).values({
        id: `user-role-${email}`,
        userId,
        roleId,
        createdAt: new Date(),
      });
    }
    return userId;
  };

  // Read on the collections whose rules admit everyone, held by every person
  // but `nobody`, since a rule only narrows the permission.
  const admittedRole = await t.nextly.roles.create({
    data: {
      name: "Admitted reader",
      slug: "admitted-reader",
      permissionIds: await Promise.all(
        ["memos", "chains"].map(async resource => {
          const permission = await t.nextly.permissions.create({
            data: {
              action: "read",
              resource,
              name: `Read ${resource}`,
              slug: `read-${resource}`,
            },
          });
          return permission.item.id;
        })
      ),
    },
  });
  const admitted = async (userId: string): Promise<string> => {
    await db.insert(tables.userRoles).values({
      id: `user-role-admitted-${userId}`,
      userId,
      roleId: String(admittedRole.item.id),
      createdAt: new Date(),
    });
    return userId;
  };

  const fx = {
    t,
    handler: t.getService("collectionsHandler") as CollectionsHandler,
    blobRule,
    nobody: await createUser("nobody@example.com"),
    stranger: await admitted(await createUser("stranger@example.com")),
    pageReader: await admitted(
      await createUser("pages@example.com", await roleFor("pages"))
    ),
    noteReader: await admitted(
      await createUser("notes@example.com", await roleFor("notes"))
    ),
    mediaReader: await admitted(
      await createUser("media@example.com", await roleFor("media"))
    ),
    userReader: await admitted(
      await createUser("users@example.com", await roleFor("users"))
    ),
    superAdmin: await createUser("admin@example.com", "role-super-admin"),
  };
  const author = await createUser(TITLE.user);
  await db.insert(tables.media).values({
    id: "media-1",
    filename: TITLE.media,
    originalFilename: TITLE.media,
    mimeType: "image/png",
    size: 1,
    url: `/uploads/${TITLE.media}`,
    uploadedAt: new Date(),
    updatedAt: new Date(),
  });

  const make = async (collectionName: string, data: Record<string, unknown>) =>
    String(
      (
        (
          await fx.handler.createEntry(
            { collectionName, overrideAccess: true },
            data
          )
        ).data as { id: string }
      ).id
    );
  const pageId = await make("pages", { title: TITLE.page });
  const noteId = await make("notes", { title: TITLE.note });
  const memoId = await make("memos", { title: TITLE.memo });
  const blobId = await make("blobs", { title: TITLE.blob });
  const chainId = await make("chains", { title: TITLE.chain, next: pageId });
  const refId = await make("refs", {
    name: "parent",
    plain: pageId,
    many: [pageId],
    note: noteId,
    memo: memoId,
    blob: blobId,
    poly: [
      { relationTo: "pages", value: pageId },
      { relationTo: "memos", value: memoId },
    ],
    chain: chainId,
    author,
    reviewer: author,
    bylines: [{ person: author }, { person: author }],
    image: "media-1",
    box: { nested: pageId },
    lines: [{ item: pageId }],
    gone: "no-such-page",
    goneMany: ["no-such-page"],
  });
  await t
    .getService("singleEntryService")
    .update(
      "homepage",
      { featured: pageId, logo: "media-1" },
      { overrideAccess: true }
    );

  return { ...fx, refId, pageId, noteId };
}

/** A user caller, as the route that served the parent authorized them. */
const as = (id: string): Caller => ({ user: { id } });

/** A scoped key that may read whatever `resources` names. */
function keyOf(...resources: string[]): Caller {
  return {
    user: { id: "key-owner" },
    authenticatedScope: apiKeyScope(
      resources.map(resource => ({
        slug: `read-${resource}`,
        action: "read",
        resource,
      }))
    ),
  };
}

const VISITOR: Caller = {};

/** The populated parent, read on the single-entry path. */
async function readRef(
  fx: Fixture,
  caller: Caller,
  depth = 1
): Promise<Record<string, unknown>> {
  const result = await fx.handler.getEntry({
    collectionName: "refs",
    entryId: fx.refId,
    depth,
    // The route authorized a person or a key for the parent; a visitor's read
    // is not routed that way.
    routeAuthorized: caller.user !== undefined && !caller.overrideAccess,
    ...caller,
  });
  // The parent is served in every case: only its related rows vary.
  expect(result.success).toBe(true);
  return result.data as Record<string, unknown>;
}

/** The populated parent, read on the list path. */
async function listRef(
  fx: Fixture,
  caller: Caller,
  depth = 1
): Promise<Record<string, unknown>> {
  const result = await fx.handler.listEntries({
    collectionName: "refs",
    depth,
    routeAuthorized: caller.user !== undefined,
    ...caller,
  });
  expect(result.success).toBe(true);
  const docs = (result.data as { docs: Record<string, unknown>[] }).docs;
  expect(docs).toHaveLength(1);
  return docs[0];
}

/** Whether a direct read of one target row is served to the caller. */
async function readsDirectly(
  fx: Fixture,
  caller: Caller,
  collectionName: string,
  entryId: string
): Promise<boolean> {
  const direct = await fx.handler.getEntry({
    collectionName,
    entryId,
    ...caller,
  });
  return direct.success;
}

/** Whether `value` carries the populated row titled `title`. */
const shows = (value: unknown, title: string): boolean =>
  JSON.stringify(value ?? null).includes(title);

describe.each(getConfiguredTestDialects())(
  "a related row goes only to a caller who could read it directly (%s)",
  (dialect: TestDialect) => {
    describe("R-1: every path that populates a row judges it the same way", () => {
      it("answers a relationship as the direct read does, on the single-entry and list paths", async () => {
        const fx = await boot(dialect);
        for (const [caller, readable] of [
          [as(fx.stranger), false],
          [as(fx.pageReader), true],
        ] as const) {
          expect(await readsDirectly(fx, caller, "pages", fx.pageId)).toBe(
            readable
          );
          expect(shows((await readRef(fx, caller)).plain, TITLE.page)).toBe(
            readable
          );
          expect(shows((await listRef(fx, caller)).plain, TITLE.page)).toBe(
            readable
          );
        }
      });

      it("judges every row at every depth, so a readable row carries no unreadable one", async () => {
        const fx = await boot(dialect);
        const chain = (await readRef(fx, as(fx.stranger), 2)).chain;
        // The chain admits everyone; the page it relates on to does not admit
        // this caller.
        expect(shows(chain, TITLE.chain)).toBe(true);
        expect(shows(chain, TITLE.page)).toBe(false);
        // The control: a caller who may read the page sees it at depth 2.
        expect(
          shows((await readRef(fx, as(fx.pageReader), 2)).chain, TITLE.page)
        ).toBe(true);
      });

      it("represents a withheld row exactly as a missing one, to-one and to-many", async () => {
        const fx = await boot(dialect);
        const data = await readRef(fx, as(fx.stranger));
        // `gone` and `goneMany` point at a page that does not exist.
        expect(typeof data.plain).toBe(typeof data.gone);
        expect(data.plain).not.toBeNull();
        expect(typeof data.plain).not.toBe("object");
        expect(data.many).toEqual(data.goneMany);
      });

      it("withholds rows nested in a group and in a repeater", async () => {
        const fx = await boot(dialect);
        const refused = await readRef(fx, as(fx.stranger));
        expect(shows(refused.box, TITLE.page)).toBe(false);
        expect(shows(refused.lines, TITLE.page)).toBe(false);
        const admitted = await readRef(fx, as(fx.pageReader));
        expect(shows(admitted.box, TITLE.page)).toBe(true);
        expect(shows(admitted.lines, TITLE.page)).toBe(true);
      });

      it("withholds a many-to-many relationship's rows", async () => {
        const fx = await boot(dialect);
        expect(
          shows((await readRef(fx, as(fx.stranger))).many, TITLE.page)
        ).toBe(false);
        expect(
          shows((await readRef(fx, as(fx.pageReader))).many, TITLE.page)
        ).toBe(true);
      });

      it("withholds an upload's media row from a caller without read-media", async () => {
        const fx = await boot(dialect);
        expect(
          shows((await readRef(fx, as(fx.stranger))).image, TITLE.media)
        ).toBe(false);
        expect(
          shows((await readRef(fx, keyOf("refs"))).image, TITLE.media)
        ).toBe(false);
        expect(
          shows((await readRef(fx, as(fx.mediaReader))).image, TITLE.media)
        ).toBe(true);
        expect(
          shows((await readRef(fx, keyOf("refs", "media"))).image, TITLE.media)
        ).toBe(true);
      });

      it("withholds a related user from a caller without read-users", async () => {
        const fx = await boot(dialect);
        expect(
          shows((await readRef(fx, as(fx.stranger))).author, TITLE.user)
        ).toBe(false);
        expect(
          shows((await readRef(fx, keyOf("refs"))).author, TITLE.user)
        ).toBe(false);
        expect(
          shows((await readRef(fx, as(fx.userReader))).author, TITLE.user)
        ).toBe(true);
        expect(
          shows((await readRef(fx, keyOf("refs", "users"))).author, TITLE.user)
        ).toBe(true);
      });

      it("asks once per expansion whether the caller may read users, however many fields relate to them", async () => {
        const fx = await boot(dialect);
        // A related `users` row is decided by the system-resource reader, the
        // question a direct read of users asks, kept for the expansion.
        const checks = vi.mocked(canReadSystemResource);
        try {
          // Depth 2: a component is a level of its own, so a relationship
          // inside one is populated from the second level.
          for (const read of [readRef, listRef]) {
            checks.mockClear();
            const data = await read(fx, as(fx.userReader), 2);
            // Both fields relate to the same user, and both carry it, as do
            // both component instances that relate to it.
            expect(shows(data.author, TITLE.user)).toBe(true);
            expect(shows(data.reviewer, TITLE.user)).toBe(true);
            const bylines = data.bylines as unknown[];
            expect(bylines).toHaveLength(2);
            for (const byline of bylines) {
              expect(shows(byline, TITLE.user)).toBe(true);
            }
            const usersReads = checks.mock.calls.filter(
              ([resource]) => resource === "users"
            );
            expect(usersReads).toHaveLength(1);
          }
        } finally {
          checks.mockClear();
        }
      });

      it("reads the Direct API gate's fallback grants on its own database, whatever dialect the process names", async () => {
        // An embedder's gate, built on its adapter with no access-control
        // service, in a process whose configured dialect names another
        // database: the real grant lookup runs on the gate's own tables.
        const fx = await boot(dialect);
        const gate = new CollectionAccessService(fx.t.adapter, consoleLogger);
        const configured = {
          dialect: process.env.DB_DIALECT,
          url: process.env.DATABASE_URL,
        };
        process.env.DB_DIALECT = dialect === "sqlite" ? "postgresql" : "sqlite";
        // PostgreSQL's settings need a URL to validate; nothing connects to it.
        if (dialect === "sqlite") {
          process.env.DATABASE_URL = "postgres://unused@localhost:1/unused";
        }
        _resetEnvCache();
        try {
          // The instrument: the process now names another dialect's tables.
          expect(getDialectTables()).not.toBe(getDialectTables(dialect));
          const ask = (id: string) =>
            gate.checkCollectionAccess({
              collectionName: "pages",
              operation: "read",
              user: { id },
              overrideAccess: false,
            });
          // The caller holding `read-pages` is served...
          expect(await ask(fx.pageReader)).toBeNull();
          // ...and the control, a caller without it, is refused.
          expect((await ask(fx.stranger))?.statusCode).toBe(403);
        } finally {
          for (const [name, value] of [
            ["DB_DIALECT", configured.dialect],
            ["DATABASE_URL", configured.url],
          ] as const) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
          }
          _resetEnvCache();
        }
      });

      it("answers as the direct read's gate does when no access-control service is registered", async () => {
        // That gate falls back to the caller's database grants; a
        // relationship that admitted the person instead served rows the same
        // caller was refused by name.
        const fx = await boot(dialect);
        const realHas = container.has.bind(container);
        const has = vi
          .spyOn(container, "has")
          .mockImplementation(
            name => name !== "rbacAccessControlService" && realHas(name)
          );
        try {
          expect(
            shows((await readRef(fx, as(fx.stranger))).plain, TITLE.page)
          ).toBe(false);
          // The control: a person holding the grant still reads it.
          expect(
            shows((await readRef(fx, as(fx.pageReader))).plain, TITLE.page)
          ).toBe(true);
        } finally {
          has.mockRestore();
        }
      });

      it("judges a Single's relationship and upload the same way", async () => {
        const fx = await boot(dialect);
        const single = async (caller: Caller) => {
          const result = await fx.t
            .getService("singleEntryService")
            .get("homepage", { depth: 1, routeAuthorized: true, ...caller });
          expect(result.success).toBe(true);
          return result.data as Record<string, unknown>;
        };
        const stranger = await single(as(fx.stranger));
        expect(shows(stranger.featured, TITLE.page)).toBe(false);
        expect(shows(stranger.logo, TITLE.media)).toBe(false);
        expect(
          shows((await single(as(fx.pageReader))).featured, TITLE.page)
        ).toBe(true);
        expect(
          shows((await single(as(fx.mediaReader))).logo, TITLE.media)
        ).toBe(true);
      });

      it("judges the entry a create and an update return", async () => {
        const fx = await boot(dialect);
        const write = async (caller: Caller) => {
          const created = await fx.handler.createEntry(
            {
              collectionName: "refs",
              depth: 1,
              routeAuthorized: true,
              ...caller,
            },
            { name: "written", plain: fx.pageId }
          );
          expect(created.success).toBe(true);
          const id = String((created.data as { id: string }).id);
          const updated = await fx.handler.updateEntry(
            {
              collectionName: "refs",
              entryId: id,
              depth: 1,
              routeAuthorized: true,
              ...caller,
            },
            { name: "rewritten" }
          );
          expect(updated.success).toBe(true);
          return [
            (created.data as Record<string, unknown>).plain,
            (updated.data as Record<string, unknown>).plain,
          ];
        };
        for (const plain of await write(as(fx.stranger))) {
          expect(shows(plain, TITLE.page)).toBe(false);
        }
        for (const plain of await write(as(fx.pageReader))) {
          expect(shows(plain, TITLE.page)).toBe(true);
        }
      });
    });

    describe("R-2: an API key reads related rows only from collections its own grants allow", () => {
      it("withholds a target without read-C, with or without a rule that admits, and never asks a rule", async () => {
        const fx = await boot(dialect);
        const key = keyOf("refs");
        expect(await readsDirectly(fx, key, "pages", fx.pageId)).toBe(false);
        const data = await readRef(fx, key);
        expect(shows(data.plain, TITLE.page)).toBe(false);
        expect(shows(data.memo, TITLE.memo)).toBe(false);
        // The throwing rule was never reached: the grant refused first.
        expect(shows(data.blob, TITLE.blob)).toBe(false);
        expect(fx.blobRule).not.toHaveBeenCalled();
      });

      it("withholds a row once a route narrows the key's scope below read-C", async () => {
        const fx = await boot(dialect);
        const key = keyOf("refs", "pages");
        expect(shows((await readRef(fx, key)).plain, TITLE.page)).toBe(true);
        const narrowed: Caller = {
          ...key,
          authenticatedScope: narrowScope(
            key.authenticatedScope as AuthenticatedScope,
            grant => grant.slug !== "read-pages"
          ),
        };
        expect(shows((await readRef(fx, narrowed)).plain, TITLE.page)).toBe(
          false
        );
      });

      it("holds a key with read-C to C's rule: refused where it refuses, populated where it admits or is absent", async () => {
        const fx = await boot(dialect);
        const data = await readRef(
          fx,
          keyOf("refs", "pages", "notes", "memos")
        );
        expect(shows(data.note, TITLE.note)).toBe(false);
        expect(shows(data.memo, TITLE.memo)).toBe(true);
        expect(shows(data.plain, TITLE.page)).toBe(true);
      });
    });

    describe("R-3: for people, a collection with no read rule falls back to grants", () => {
      it("populates a rule-less target for a grant or super-admin authority, and for no one else", async () => {
        const fx = await boot(dialect);
        expect(
          shows((await readRef(fx, as(fx.stranger))).plain, TITLE.page)
        ).toBe(false);
        expect(
          shows((await readRef(fx, as(fx.pageReader))).plain, TITLE.page)
        ).toBe(true);
        expect(
          shows((await readRef(fx, as(fx.superAdmin))).plain, TITLE.page)
        ).toBe(true);
      });

      it("needs the read permission and a rule that admits, and lets a super-admin past one that refuses", async () => {
        const fx = await boot(dialect);
        // A rule that admits populates for a person holding the grant.
        expect(
          shows((await readRef(fx, as(fx.stranger))).memo, TITLE.memo)
        ).toBe(true);
        // Not for one without it: the rule only narrows the permission.
        expect(shows((await readRef(fx, as(fx.nobody))).memo, TITLE.memo)).toBe(
          false
        );
        // A rule that refuses withholds from a person holding read-notes.
        expect(
          await readsDirectly(fx, as(fx.noteReader), "notes", fx.noteId)
        ).toBe(false);
        expect(
          shows((await readRef(fx, as(fx.noteReader))).note, TITLE.note)
        ).toBe(false);
        // A super-admin passes it, as on a direct read.
        expect(
          shows((await readRef(fx, as(fx.superAdmin))).note, TITLE.note)
        ).toBe(true);
      });

      it("gives a visitor what their direct read gives, and keeps trusted reads trusted", async () => {
        const fx = await boot(dialect);
        const visitor = await readRef(fx, VISITOR);
        // A collection with no rule is public to a visitor's direct read.
        expect(await readsDirectly(fx, VISITOR, "pages", fx.pageId)).toBe(true);
        expect(shows(visitor.plain, TITLE.page)).toBe(true);
        // One whose rule refuses is not.
        expect(await readsDirectly(fx, VISITOR, "notes", fx.noteId)).toBe(
          false
        );
        expect(shows(visitor.note, TITLE.note)).toBe(false);
        // A refusing collection a route names as trusted stays populated.
        const routed = await readRef(fx, {
          overrideAccess: true,
          trusted: collection =>
            collection === "refs" || collection === "notes",
        });
        expect(shows(routed.note, TITLE.note)).toBe(true);
        // As does every row of a read made with overrideAccess.
        expect(
          shows((await readRef(fx, { overrideAccess: true })).note, TITLE.note)
        ).toBe(true);
      });
    });

    describe("the cases a narrower implementation could miss", () => {
      it("keeps populating every related row for a read made as the system", async () => {
        const fx = await boot(dialect);
        // The Direct API with no caller runs as the system, as `as: "system"`
        // does through the plugin services.
        const data = (await fx.t.nextly.findByID({
          collection: "refs",
          id: fx.refId,
          depth: 1,
        })) as unknown as Record<string, unknown>;
        expect(shows(data.note, TITLE.note)).toBe(true);
        expect(shows(data.plain, TITLE.page)).toBe(true);
        expect(shows(data.author, TITLE.user)).toBe(true);
        expect(shows(data.image, TITLE.media)).toBe(true);
      });

      it("judges a super-admin's key by the scope resolved for this request", async () => {
        const fx = await boot(dialect);
        const keys = new ApiKeyService(fx.t.adapter as never, {
          debug() {},
          info() {},
          warn() {},
          error() {},
        });
        // A full-access key of a super-admin copies the catalogue as it is
        // when the request is served, not as it was when the key was made.
        // `chains` stands for a collection added after the key: its grant,
        // which boot seeds, is taken out of the catalogue first.
        const tables = getDialectTables();
        const db = fx.t.adapter.getDrizzle() as unknown as {
          select: (fields: unknown) => {
            from: (table: unknown) => {
              where: (cond: unknown) => Promise<Array<{ id: string }>>;
            };
          };
          delete: (table: unknown) => {
            where: (cond: unknown) => Promise<unknown>;
          };
        };
        const seeded = await db
          .select({ id: tables.permissions.id })
          .from(tables.permissions)
          .where(eq(tables.permissions.slug, "read-chains"));
        for (const { id } of seeded) {
          await db
            .delete(tables.rolePermissions)
            .where(eq(tables.rolePermissions.permissionId, id));
          await db
            .delete(tables.permissions)
            .where(eq(tables.permissions.id, id));
        }
        const before = apiKeyScope(
          await keys.resolveApiKeyGrants(
            "full-access",
            null,
            fx.superAdmin,
            "admin-key-before"
          )
        );
        expect(
          shows(
            (
              await readRef(fx, {
                user: { id: fx.superAdmin },
                authenticatedScope: before,
              })
            ).chain,
            TITLE.chain
          )
        ).toBe(false);
        // A collection's grant created after the key: the next request's
        // scope holds it.
        await fx.t.nextly.permissions.create({
          data: {
            action: "read",
            resource: "chains",
            name: "Read chains",
            slug: "read-chains",
          },
        });
        const after = apiKeyScope(
          await keys.resolveApiKeyGrants(
            "full-access",
            null,
            fx.superAdmin,
            "admin-key-after"
          )
        );
        expect(
          shows(
            (
              await readRef(fx, {
                user: { id: fx.superAdmin },
                authenticatedScope: after,
              })
            ).chain,
            TITLE.chain
          )
        ).toBe(true);
      });

      it("populates a target for a visitor where its rule admits visitors", async () => {
        const fx = await boot(dialect);
        expect(shows((await readRef(fx, VISITOR)).memo, TITLE.memo)).toBe(true);
      });

      it("judges each row of a mixed polymorphic relationship by its own collection", async () => {
        const fx = await boot(dialect);
        const poly = (await readRef(fx, as(fx.stranger))).poly;
        // The memo's rule admits everyone; the page needs a grant this caller
        // does not hold. One answer never decides the other.
        expect(shows(poly, TITLE.memo)).toBe(true);
        expect(shows(poly, TITLE.page)).toBe(false);
        const both = (await readRef(fx, as(fx.pageReader))).poly;
        expect(shows(both, TITLE.memo)).toBe(true);
        expect(shows(both, TITLE.page)).toBe(true);
      });

      it("leaves a visitor the related media, and withholds a related user", async () => {
        // Pages served to the public embed the images they reference, so a
        // visitor keeps media. No visitor reads a user row directly, and a
        // user row carries a person's address, so it is withheld.
        const fx = await boot(dialect);
        const visitor = await readRef(fx, VISITOR);
        expect(shows(visitor.image, TITLE.media)).toBe(true);
        expect(shows(visitor.author, TITLE.user)).toBe(false);
        // The control: a read holding a bypass still populates the user, as a
        // server-rendered page's read does.
        expect(
          shows(
            (await readRef(fx, { ...VISITOR, overrideAccess: true })).author,
            TITLE.user
          )
        ).toBe(true);
      });
    });
  }
);
