/**
 * `nextly.versions.*`: a document's history from server code, answering as
 * REST's history routes answer.
 *
 * Each operation runs the function its REST route runs, so each is checked
 * here against REST's own answer for the same document: the list, one
 * version, a comparison, naming a version, and a restore, which writes the
 * working draft and never what is published. Marking a version seen is for
 * people only, as on REST.
 *
 * Trusted by default, as the rest of the Direct API is. Called with
 * `overrideAccess: false` and a user, each operation is judged as REST judges
 * that person: a document they may not read is not found.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, defineSingle, text } from "../../../config";
import { registerHook, unregisterHook } from "../../../hooks";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { ServiceContainer } from "../../../services/index";
import type { AuthUserId } from "../../../types/auth";
import {
  account,
  role,
  seedPermissions,
} from "../../__tests__/checked-access-fixtures";

const ORIGIN = "http://localhost";
// The snapshot redaction a checked read of a version makes, made to fail by the
// one test that needs it to: every other test runs the real one.
const redactionFails = vi.hoisted(() => ({ on: false }));
vi.mock("../../../api/versions-access", async importOriginal => {
  const real =
    await importOriginal<typeof import("../../../api/versions-access")>();
  return {
    ...real,
    redactSnapshotForUser: (
      ...args: Parameters<typeof real.redactSnapshotForUser>
    ) => {
      if (redactionFails.on) {
        return Promise.reject(new Error("the read rule could not run"));
      }
      return real.redactSnapshotForUser(...args);
    },
  };
});

const POSTS = "dav_posts";
const ADMIN = "dav-admin";
/** A collection everyone may read, whose documents only the admin may. */
const PRIVATE = "dav_private";
/** A Single nothing has written yet, so no row backs it. */
const NOTICE = "dav_notice";
/** A collection with a field only the admin may read. */
const RULED = "dav_ruled";

/** The namespace as these tests call it. */
interface VersionsNamespace {
  list(args: Record<string, unknown>): Promise<{
    items: { versionNo: number; label?: string | null }[];
  }>;
  get(args: Record<string, unknown>): Promise<{
    versionNo: number;
    snapshot: Record<string, unknown>;
  }>;
  compare(args: Record<string, unknown>): Promise<unknown>;
  name(
    args: Record<string, unknown>
  ): Promise<{ item: { label: string | null; snapshot?: unknown } }>;
  restore(
    args: Record<string, unknown>
  ): Promise<{ item: { restoredFrom: number } }>;
  markSeen(args: Record<string, unknown>): Promise<unknown>;
}

interface Handler {
  createEntry(
    params: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<{ data: { id: string } | null }>;
  updateEntry(
    params: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<{ success: boolean }>;
  getEntry(
    params: Record<string, unknown>
  ): Promise<{ data: Record<string, unknown> | null }>;
}

describe.each(getConfiguredTestDialects())(
  "nextly.versions (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let cookie: Record<string, string> = {};
    let editorId: string;
    let blindId: string;

    const versions = () =>
      (t.nextly as unknown as { versions: VersionsNamespace }).versions;
    const handler = () =>
      t.getService("collectionsHandler") as unknown as Handler;
    const asUser = (id: string) => ({
      overrideAccess: false,
      user: { id: id as AuthUserId, email: `${id}@example.com` },
    });

    /** One REST call as the signed-in admin; the answer's JSON body. */
    async function rest(
      method: "GET" | "POST" | "PATCH",
      path: string,
      body?: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
      const url = new URL(`${ORIGIN}/api/${path}`);
      const req = new Request(url, {
        method,
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          ...cookie,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const segments = url.pathname.replace(/^\/api\//, "").split("/");
      const handlers = createDynamicHandlers();
      const res = await handlers[method](req, {
        params: Promise.resolve({ params: segments }),
      });
      expect(res.status, await res.clone().text()).toBe(200);
      return (await res.json()) as Record<string, unknown>;
    }

    /** A document published as "one", then as "two": versions 1 and 2. */
    async function publishedTwice(): Promise<string> {
      const created = await handler().createEntry(
        { collectionName: POSTS, overrideAccess: true },
        { title: "one", status: "published" }
      );
      const id = created.data!.id;
      const saved = await handler().updateEntry(
        { collectionName: POSTS, entryId: id, overrideAccess: true },
        { title: "two", status: "published", _overwrite: true }
      );
      expect(saved.success).toBe(true);
      return id;
    }

    /** The document's working draft as stored, or undefined for none. */
    async function draftOf(
      entryId: string
    ): Promise<Record<string, unknown> | undefined> {
      const rows = await t.adapter.select<{ snapshot: unknown }>(
        "nextly_versions",
        {
          where: {
            and: [
              { column: "entryId", op: "=", value: entryId },
              { column: "isAutosave", op: "=", value: false },
              { column: "versionNo", op: "IS NULL" },
              { column: "status", op: "=", value: "draft" },
            ],
          },
        }
      );
      const stored = rows[0]?.snapshot;
      return typeof stored === "string"
        ? (JSON.parse(stored) as Record<string, unknown>)
        : (stored as Record<string, unknown> | undefined);
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: POSTS,
            status: true,
            versions: { drafts: true },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: PRIVATE,
            status: true,
            versions: { drafts: true },
            access: {
              // A filter no document matches, for anyone but the admin: the
              // collection is readable, each document is not.
              read: ({ req }) =>
                req.user?.id === ADMIN
                  ? true
                  : ({
                      title: { equals: "no document is called this" },
                    } as unknown as boolean),
              update: () => true,
              create: () => true,
            },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: RULED,
            status: true,
            versions: { drafts: true },
            fields: [
              text({ name: "title" }),
              text({
                name: "secret",
                access: { read: ({ req }) => req.user?.id === ADMIN },
              }),
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: NOTICE,
            status: true,
            versions: true,
            fields: [text({ name: "heading" })],
          }),
        ],
      });
      await seedPermissions(t);
      await superAdminUser(t, ADMIN);
      const superRole = await new ServiceContainer(
        t.adapter
      ).roles.ensureSuperAdminRole();
      const token = await signAccessToken(
        buildClaims({
          userId: ADMIN,
          email: `${ADMIN}@example.test`,
          name: ADMIN,
          image: null,
          roleIds: [String(superRole.id)],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      cookie = { cookie: `nextly_session=${token}` };
      editorId = await account(t, "dav-editor@example.com", [
        await role(t, "dav-editors", [
          `read-${POSTS}`,
          `update-${POSTS}`,
          `read-${RULED}`,
          `update-${RULED}`,
        ]),
      ]);
      blindId = await account(t, "dav-blind@example.com", [
        await role(t, "dav-blind-updaters", [`update-${POSTS}`]),
      ]);
    }, 180_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    const history = (id: string) =>
      `collections/${POSTS}/entries/${id}/versions`;

    it("lists the versions REST lists", async () => {
      const id = await publishedTwice();
      const viaRest = (await rest("GET", history(id))) as {
        items: { versionNo: number }[];
      };

      const viaDirect = await versions().list({ collection: POSTS, id });

      expect(viaDirect.items.map(v => v.versionNo)).toEqual(
        viaRest.items.map(v => v.versionNo)
      );
      expect(viaDirect.items.length).toBeGreaterThan(1);
    }, 120_000);

    it("reads one version as REST reads it", async () => {
      const id = await publishedTwice();
      const viaRest = (await rest("GET", `${history(id)}/1`)) as {
        item?: { snapshot: Record<string, unknown> };
        snapshot?: Record<string, unknown>;
      };

      const viaDirect = await versions().get({
        collection: POSTS,
        id,
        versionNo: 1,
      });

      expect(viaDirect.snapshot.title).toBe("one");
      expect(viaDirect.snapshot).toEqual((viaRest.item ?? viaRest).snapshot);
    }, 120_000);

    it("compares two versions as REST compares them", async () => {
      const id = await publishedTwice();
      const viaRest = await rest("GET", `${history(id)}/diff?from=1&to=2`);

      const viaDirect = await versions().compare({
        collection: POSTS,
        id,
        from: 1,
        to: 2,
      });

      expect(viaDirect).toEqual(
        (viaRest as { item?: unknown }).item ?? viaRest
      );
    }, 120_000);

    it("names a version, and REST reads the name", async () => {
      const id = await publishedTwice();

      const named = await versions().name({
        collection: POSTS,
        id,
        versionNo: 1,
        label: "Kept",
      });

      expect(named.item.label).toBe("Kept");
      // Answered as the version, snapshot and all, as before the name.
      expect(named.item.snapshot).toBeDefined();
      const viaRest = (await rest("GET", history(id))) as {
        items: { versionNo: number; label: string | null }[];
      };
      expect(viaRest.items.find(v => v.versionNo === 1)?.label).toBe("Kept");
    }, 120_000);

    it("restores into the working draft, leaving what is published", async () => {
      const id = await publishedTwice();

      const restored = await versions().restore({
        collection: POSTS,
        id,
        versionNo: 1,
        // Made over whatever is stored now, as REST's restore says it.
        _overwrite: true,
      });

      expect(restored.item.restoredFrom).toBe(1);
      const live = await handler().getEntry({
        collectionName: POSTS,
        entryId: id,
        overrideAccess: true,
      });
      expect(live.data).toMatchObject({ title: "two" });
      expect(await draftOf(id)).toMatchObject({ title: "one" });
    }, 120_000);

    it("restores as a person who may read and update the document", async () => {
      const id = await publishedTwice();

      const restored = await versions().restore({
        collection: POSTS,
        id,
        versionNo: 1,
        _overwrite: true,
        ...asUser(editorId),
      });

      expect(restored.item.restoredFrom).toBe(1);
    }, 120_000);

    it("refuses a person who may not read the document, as REST's routes do", async () => {
      const id = await publishedTwice();

      // The history read asks `read-<collection>` first, as its route does.
      await expect(
        versions().list({ collection: POSTS, id, ...asUser(blindId) })
      ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
      // The restore's route asks `update-<collection>`, which they hold; the
      // document they may not read is then not found.
      await expect(
        versions().restore({
          collection: POSTS,
          id,
          versionNo: 1,
          _overwrite: true,
          ...asUser(blindId),
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
      expect(await draftOf(id)).toBeUndefined();
    }, 120_000);

    it("marks a version seen for a person, and refuses a call that names none", async () => {
      const id = await publishedTwice();

      await expect(
        versions().markSeen({ collection: POSTS, id, versionNo: 1 })
      ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
      await expect(
        versions().markSeen({
          collection: POSTS,
          id,
          versionNo: 1,
          ...asUser(editorId),
        })
      ).resolves.toMatchObject({ item: { versionNo: 1 } });
    }, 120_000);

    it("refuses a malformed page size on a trusted list, and pages as REST pages", async () => {
      const id = await publishedTwice();

      await expect(
        versions().list({ collection: POSTS, id, limit: -2 })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      const page = (await versions().list({
        collection: POSTS,
        id,
      })) as unknown as {
        meta: { limit: number };
      };
      const viaRest = (await rest("GET", history(id))) as {
        meta: { limit: number };
      };
      expect(page.meta.limit).toBe(viaRest.meta.limit);
    }, 120_000);

    it("records who named a version on a trusted call made for a person, and returns the version", async () => {
      const id = await publishedTwice();

      const named = await versions().name({
        collection: POSTS,
        id,
        versionNo: 1,
        label: "Kept for later",
        user: { id: ADMIN as AuthUserId, email: `${ADMIN}@example.test` },
      });

      // The version as `get` answers a trusted call: its snapshot whole.
      expect(named.item.snapshot).toEqual(
        (await versions().get({ collection: POSTS, id, versionNo: 1 })).snapshot
      );
      const events = await t.nextly.contentEvents.list({
        subject: { kind: "collection", slug: POSTS, id },
      });
      expect(
        events.items
          .filter(e => e.kind === "named")
          .map(e => [e.payload?.label, e.actorId])
      ).toContainEqual(["Kept for later", ADMIN]);
    }, 120_000);

    it("hands no person's name with a version named on a trusted call made as an API key", async () => {
      const id = await publishedTwice();
      // What the trusted call hands the history: the actor, and the name kept
      // with it.
      const setLabel = vi
        .spyOn(t.getService("versionsService"), "setLabel")
        .mockResolvedValue({
          versionNo: 1,
          label: "By the key",
          snapshot: {},
        } as never);

      await versions().name({
        collection: POSTS,
        id,
        versionNo: 1,
        label: "By the key",
        overrideAccess: true,
        // The key's owner, named on the call beside the key it is made as.
        user: {
          id: ADMIN as AuthUserId,
          email: `${ADMIN}@example.test`,
          name: "The key's owner",
        },
        actor: { actorType: "apiKey", permissions: [] },
      });
      const record = setLabel.mock.calls[0]?.[3] as
        | { actor: { type: string }; personName: string | null }
        | undefined;
      setLabel.mockRestore();

      expect(record?.actor.type).toBe("apiKey");
      expect(record?.personName).toBeNull();
    }, 120_000);

    it("hands a trusted restore's request and person to the update it makes", async () => {
      const id = await publishedTwice();
      let sawRequest = false;
      const watch = (ctx: { req?: { http?: unknown }; data?: unknown }) => {
        sawRequest = sawRequest || ctx.req?.http !== undefined;
        return ctx.data;
      };
      registerHook("beforeUpdate", POSTS, watch as never);
      try {
        await versions().restore({
          collection: POSTS,
          id,
          versionNo: 1,
          _overwrite: true,
          request: new Request(`${ORIGIN}/api/restore`, { method: "POST" }),
          user: { id: ADMIN as AuthUserId, email: `${ADMIN}@example.test` },
        });
      } finally {
        unregisterHook("beforeUpdate", POSTS, watch as never);
      }

      expect(sawRequest).toBe(true);
      const events = await t.nextly.contentEvents.list({
        subject: { kind: "collection", slug: POSTS, id },
      });
      expect(
        events.items.filter(e => e.kind === "restored").map(e => e.actorId)
      ).toContain(ADMIN);
    }, 120_000);

    /** A document of `slug` saved twice: versions 1 and 2, each holding `extra`. */
    async function savedTwice(
      slug: string,
      extra: Record<string, unknown>
    ): Promise<string> {
      const created = await handler().createEntry(
        { collectionName: slug, overrideAccess: true },
        { title: "one", status: "published", ...extra }
      );
      const id = created.data!.id;
      await handler().updateEntry(
        { collectionName: slug, entryId: id, overrideAccess: true },
        { title: "two", status: "published", ...extra, _overwrite: true }
      );
      return id;
    }

    it("answers a checked name with the version as the caller reads it, a field they may not read withheld", async () => {
      const id = await savedTwice(RULED, { secret: "kept from editors" });

      const named = await versions().name({
        collection: RULED,
        id,
        versionNo: 1,
        label: "Checked",
        ...asUser(editorId),
      });

      expect(named.item.label).toBe("Checked");
      const snapshot = named.item.snapshot as Record<string, unknown>;
      expect(snapshot.title).toBe("one");
      expect(snapshot).not.toHaveProperty("secret");
    }, 120_000);

    it("writes no name when the version cannot be read for a checked caller", async () => {
      const id = await publishedTwice();

      // The read of the version for the caller fails, as a rule that could
      // not run fails it.
      redactionFails.on = true;
      try {
        await expect(
          versions().name({
            collection: POSTS,
            id,
            versionNo: 1,
            label: "Never written",
            ...asUser(editorId),
          })
        ).rejects.toBeDefined();
      } finally {
        redactionFails.on = false;
      }

      // Nothing written: the version keeps no name, and no event names it.
      const stored = await versions().get({
        collection: POSTS,
        id,
        versionNo: 1,
      });
      expect((stored as { label?: string | null }).label ?? null).toBeNull();
      const events = await t.nextly.contentEvents.list({
        subject: { kind: "collection", slug: POSTS, id },
      });
      expect(events.items.some(e => e.kind === "named")).toBe(false);
    }, 120_000);

    it("hands a restore's hook context to the update it makes, checked or trusted", async () => {
      const id = await publishedTwice();
      const seen: unknown[] = [];
      const watch = (ctx: {
        context?: { marker?: unknown };
        data?: unknown;
      }) => {
        seen.push(ctx.context?.marker);
        return ctx.data;
      };
      registerHook("beforeUpdate", POSTS, watch as never);
      try {
        for (const overrideAccess of [true, false]) {
          await versions().restore({
            collection: POSTS,
            id,
            versionNo: 1,
            _overwrite: true,
            overrideAccess,
            user: { id: ADMIN as AuthUserId, email: `${ADMIN}@example.test` },
            context: { marker: `restored-${String(overrideAccess)}` },
          });
        }
      } finally {
        unregisterHook("beforeUpdate", POSTS, watch as never);
      }

      expect(seen).toContain("restored-true");
      expect(seen).toContain("restored-false");
    }, 120_000);

    it("marks a version seen on a trusted call, for a person the read rules would refuse", async () => {
      const created = await handler().createEntry(
        { collectionName: PRIVATE, overrideAccess: true },
        { title: "one", status: "published" }
      );
      const id = created.data!.id;
      // May read the collection, but its read rule refuses them each document.
      const readerId = await account(t, "dav-private-reader@example.com", [
        await role(t, "dav-private-readers", [`read-${PRIVATE}`]),
      ]);

      // The server showed this version under its own bypass; the person's
      // marker is recorded as shown, whatever their own rules would say.
      await expect(
        versions().markSeen({
          collection: PRIVATE,
          id,
          versionNo: 1,
          user: {
            id: readerId as AuthUserId,
            email: `${readerId}@example.com`,
          },
        })
      ).resolves.toMatchObject({ item: { versionNo: 1 } });
    }, 120_000);

    it("refuses a person who may not read a Single before looking for its row", async () => {
      // The same answer whether or not the Single has a row yet, so a refused
      // caller cannot tell which.
      await expect(
        versions().list({ single: NOTICE, ...asUser(blindId) })
      ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    }, 120_000);
  }
);
