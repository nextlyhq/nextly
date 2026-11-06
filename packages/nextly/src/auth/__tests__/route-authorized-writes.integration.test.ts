/**
 * Writes that run after a route has already authorized the caller.
 *
 * Several routes check the caller once and then tell the service below that
 * the route already did (`routeAuthorized`), so the service skips its own
 * coarse check. That is only sound when the route asked the SAME question the
 * service skips. Each case here takes a caller REST refuses for one action and
 * sends it through a route that asks a different one first, then checks the
 * route refuses it too, so no route lets a caller do more than REST does.
 *
 * Every caller is real: users and roles in the database, signed session
 * cookies, and API keys minted by the key service. Every request goes through
 * the REST catch-all as a site's request does.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PATCH as patchSingle } from "../../api/singles-detail";
import { defineCollection, defineSingle, text } from "../../config";
import { seedAllPermissions } from "../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { ServiceContainer } from "../../services/index";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";

const ORIGIN = "http://localhost";

/** Every collection and Single refuses an update by rule. */
const REFUSES_UPDATE = "refuses_update";
const S_REFUSES_UPDATE = "s_refuses_update";
/** Readable by nobody but a super-admin: its read rule refuses. */
const HIDDEN_READ = "hidden_read";
/** No rules: the role screen alone decides. */
const PLAIN = "plain";
/** A Single with a status, and no rules. */
const S_STATUS = "s_status";
/** Drafts on, and a read rule that answers a filter: `team` must be `open`. */
const FILTERED_READ = "filtered_read";

function fixtures() {
  return {
    collections: [
      defineCollection({
        slug: REFUSES_UPDATE,
        access: { update: () => false },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: HIDDEN_READ,
        versions: { drafts: true },
        access: { read: () => false },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: FILTERED_READ,
        status: true,
        versions: { drafts: true },
        access: { read: () => ({ team: { equals: "open" } }) },
        fields: [text({ name: "title" }), text({ name: "team" })],
      }),
      defineCollection({
        slug: PLAIN,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          // Readable by a super-admin alone, judged on the user a read is
          // handed, so a caller passed off as one would see it.
          text({
            name: "secret",
            access: {
              read: ({ req }) =>
                req.user?.roles?.includes("super-admin") === true ||
                req.user?.email === "root@writes.test",
            },
          }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: S_REFUSES_UPDATE,
        access: { update: () => false },
        fields: [text({ name: "headline" })],
      }),
      defineSingle({
        slug: S_STATUS,
        status: true,
        fields: [text({ name: "headline" })],
      }),
    ],
  };
}

type Headers = Record<string, string>;

interface Callers {
  /** Holds every permission on every fixture. */
  editor: Headers;
  /** A full-access key the editor made, so it holds the same grants. */
  editorKey: Headers;
  /** Update on `plain` and nothing else: no read. */
  updater: Headers;
  /** Create on `plain` and nothing else: no read. */
  creator: Headers;
  /** Read and update on `plain` and `s_status`, but no publish. */
  noPublisher: Headers;
  /** Read on `plain` and nothing else: no create. */
  reader: Headers;
  /** The editor's and the reader's user ids, for Direct API calls. */
  editorId: string;
  readerId: string;
  /** The install's first user, its super-admin. */
  rootId: string;
}

/** The ids of the permissions whose slug `keep` accepts. */
async function permissionIds(t: TestNextly, keep: (slug: string) => boolean) {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const found = await t.nextly.permissions.find({ limit: 100, page });
    ids.push(...found.items.filter(p => keep(p.slug)).map(p => String(p.id)));
    if (!found.meta.hasNext) return ids;
  }
}

async function sessionFor(
  t: TestNextly,
  services: ServiceContainer,
  name: string,
  keep: (slug: string) => boolean
): Promise<{ id: string; headers: Headers }> {
  const role = await t.nextly.roles.create({
    data: {
      name,
      slug: name,
      permissionIds: await permissionIds(t, keep),
    },
  });
  const roleId = String(role.item.id);
  const made = await t.nextly.users.create({
    email: `${name}@writes.test`,
    password: "Password123!",
    data: { name, isActive: true },
  });
  const id = String((made.item as { id: string | number }).id);
  await services.userRoles.assignRoleToUser(id, roleId);
  const token = await signAccessToken(
    buildClaims({
      userId: id,
      email: `${name}@writes.test`,
      name,
      image: null,
      roleIds: [roleId],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return { id, headers: { cookie: `nextly_session=${token}` } };
}

const FIXTURE_SLUG = new RegExp(
  `-(${[REFUSES_UPDATE, S_REFUSES_UPDATE, HIDDEN_READ, PLAIN, S_STATUS, FILTERED_READ].join("|")})$`
);

async function seedCallers(t: TestNextly): Promise<Callers> {
  const services = new ServiceContainer(t.adapter);
  await seedAllPermissions();
  // The first user an install makes is its super-admin, who passes every
  // rule, so one is made before the callers under test.
  const root = await t.nextly.users.create({
    email: "root@writes.test",
    password: "Password123!",
    data: { name: "root", isActive: true },
  });
  const editor = await sessionFor(t, services, "editor", slug =>
    FIXTURE_SLUG.test(slug)
  );
  const key = await t.getService("apiKeyService").createApiKey(editor.id, {
    name: "editor key",
    tokenType: "full-access",
    expiresIn: "unlimited",
  });
  const updater = await sessionFor(
    t,
    services,
    "updater",
    slug => slug === `update-${PLAIN}`
  );
  const creator = await sessionFor(
    t,
    services,
    "creator",
    slug => slug === `create-${PLAIN}`
  );
  const noPublisher = await sessionFor(t, services, "nopublisher", slug =>
    [
      `read-${PLAIN}`,
      `update-${PLAIN}`,
      `read-${S_STATUS}`,
      `update-${S_STATUS}`,
    ].includes(slug)
  );
  const reader = await sessionFor(
    t,
    services,
    "reader",
    slug => slug === `read-${PLAIN}`
  );
  return {
    editor: editor.headers,
    editorKey: { authorization: `Bearer ${key.key}` },
    updater: updater.headers,
    creator: creator.headers,
    noPublisher: noPublisher.headers,
    reader: reader.headers,
    editorId: editor.id,
    readerId: reader.id,
    rootId: String((root.item as { id: string | number }).id),
  };
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** One request through the REST catch-all, as the admin sends it. */
function rest(
  method: Method,
  path: string,
  headers: Headers,
  body?: unknown
): Promise<Response> {
  // The route is the path before any query; the query rides on the URL.
  const segments = (path.split("?")[0] ?? "").split("/").filter(Boolean);
  const handlers = createDynamicHandlers();
  const req = new Request(`${ORIGIN}/api/${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return handlers[method](req, {
    params: Promise.resolve({ params: segments }),
  });
}

async function makeEntry(t: TestNextly, collection: string, data = {}) {
  const made = await t.nextly.create({
    collection,
    data: { title: "original", ...data },
  });
  return String((made.item as { id: string | number }).id);
}

/** The Single's stored document id, materializing it first. */
async function singleId(t: TestNextly, slug: string) {
  const found = await t.nextly.findSingle({ slug });
  return String((found as unknown as { id: string | number }).id);
}

const REFUSED = [401, 403, 404];

for (const dialect of getConfiguredTestDialects()) {
  describe(`a route-authorized write is refused where REST refuses (${dialect})`, () => {
    let t: TestNextly;
    let callers: Callers;

    beforeAll(async () => {
      // A rule that refuses is logged by the gates that ask it.
      vi.spyOn(console, "error").mockImplementation(() => {});
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        ...fixtures(),
      });
      try {
        callers = await seedCallers(t);
      } catch (error) {
        await t.destroy();
        throw error;
      }
    }, 120_000);

    afterAll(async () => {
      vi.restoreAllMocks();
      await t?.destroy();
    });

    describe("a document-lock claim", () => {
      const claim = (headers: Headers, ref: object, takeover = false) =>
        rest("POST", "document-lock", headers, { ...ref, takeover });

      it("is refused to a key whose update rule refuses it on a collection", async () => {
        const entryId = await makeEntry(t, REFUSES_UPDATE);
        // REST refuses the key the update itself.
        const update = await rest(
          "PATCH",
          `collections/${REFUSES_UPDATE}/entries/${entryId}`,
          callers.editorKey,
          { title: "changed", _overwrite: true }
        );
        expect(update.status).toBe(403);

        const ref = { scopeKind: "collection", slug: REFUSES_UPDATE, entryId };
        expect(REFUSED).toContain((await claim(callers.editorKey, ref)).status);
        expect(REFUSED).toContain(
          (await claim(callers.editorKey, ref, true)).status
        );
      });

      it("is refused to a key whose update rule refuses it on a Single", async () => {
        const entryId = await singleId(t, S_REFUSES_UPDATE);
        const update = await rest(
          "PATCH",
          `singles/${S_REFUSES_UPDATE}`,
          callers.editorKey,
          { headline: "changed", _overwrite: true }
        );
        expect(update.status).toBe(403);

        const ref = { scopeKind: "single", slug: S_REFUSES_UPDATE, entryId };
        expect(REFUSED).toContain((await claim(callers.editorKey, ref)).status);
      });

      it("is refused to a session whose update rule refuses it, as REST is", async () => {
        const entryId = await makeEntry(t, REFUSES_UPDATE);
        const update = await rest(
          "PATCH",
          `collections/${REFUSES_UPDATE}/entries/${entryId}`,
          callers.editor,
          { title: "changed", _overwrite: true }
        );
        expect(update.status).toBe(403);

        const ref = { scopeKind: "collection", slug: REFUSES_UPDATE, entryId };
        expect(REFUSED).toContain((await claim(callers.editor, ref)).status);
      });

      it("is granted to a caller REST lets update, so the refusals above are the rule's", async () => {
        const entryId = await makeEntry(t, PLAIN);
        const ref = { scopeKind: "collection", slug: PLAIN, entryId };
        expect((await claim(callers.editorKey, ref)).status).toBe(200);
      });
    });

    describe("a write to a document's history, authorized as an update", () => {
      // The route asks `update`; each write must also ask `read` itself.
      const writes = (slug: string, entryId: string) =>
        [
          ["PATCH", `versions/1`, { label: "named" }],
          ["POST", `versions/1/restore`, { _overwrite: true }],
          ["DELETE", `versions/working-draft?_overwrite=true`, undefined],
          ["PUT", `versions/autosave`, { snapshot: { title: "x" } }],
        ].map(([method, tail, body]) => ({
          method: method as Method,
          path: `collections/${slug}/entries/${entryId}/${String(tail)}`,
          body,
        }));

      /** An entry with a version 1 to name and restore. */
      async function versioned(slug: string) {
        const entryId = await makeEntry(t, slug);
        await t.nextly.update({
          collection: slug,
          id: entryId,
          data: { title: "second", _overwrite: true },
        });
        return entryId;
      }

      it("is made for a caller REST lets read and update, so the refusals below are access", async () => {
        const entryId = await versioned(PLAIN);
        for (const write of writes(PLAIN, entryId)) {
          const res = await rest(
            write.method,
            write.path,
            callers.editor,
            write.body
          );
          expect(res.ok, `${write.method} ${write.path}: ${res.status}`).toBe(
            true
          );
        }
      });

      it("is refused to a caller whose read rule refuses it", async () => {
        const entryId = await makeEntry(t, HIDDEN_READ);
        await t.nextly.update({
          collection: HIDDEN_READ,
          id: entryId,
          data: { title: "second", _overwrite: true },
        });
        for (const who of [callers.editor, callers.editorKey]) {
          const entry = `collections/${HIDDEN_READ}/entries/${entryId}`;
          // The caller may update the entry through REST, so the route's
          // update gate passes and only the read it asks next can refuse.
          const update = await rest("PATCH", entry, who, {
            title: "edited",
            _overwrite: true,
          });
          expect(update.ok, `PATCH ${entry}: ${update.status}`).toBe(true);
          const read = await rest("GET", entry, who);
          expect(REFUSED).toContain(read.status);
          for (const write of writes(HIDDEN_READ, entryId)) {
            const res = await rest(write.method, write.path, who, write.body);
            expect(
              REFUSED,
              `${write.method} ${write.path}: ${res.status}`
            ).toContain(res.status);
          }
        }
      });

      it("is refused to a caller who may update but not read", async () => {
        const entryId = await makeEntry(t, PLAIN);
        await t.nextly.update({
          collection: PLAIN,
          id: entryId,
          data: { title: "second", _overwrite: true },
        });
        const entry = `collections/${PLAIN}/entries/${entryId}`;
        // As above: the update passes, the read does not.
        const update = await rest("PATCH", entry, callers.updater, {
          title: "edited",
          _overwrite: true,
        });
        expect(update.ok, `PATCH ${entry}: ${update.status}`).toBe(true);
        const read = await rest("GET", entry, callers.updater);
        expect(REFUSED).toContain(read.status);
        for (const write of writes(PLAIN, entryId)) {
          const res = await rest(
            write.method,
            write.path,
            callers.updater,
            write.body
          );
          expect(
            REFUSED,
            `${write.method} ${write.path}: ${res.status}`
          ).toContain(res.status);
        }
      });
    });

    it("a duplicate, authorized as a create, is refused to a caller who may not read the source", async () => {
      // Published, so the refusal below can only be the read gate's, never
      // the source's lifecycle state.
      const entryId = await makeEntry(t, PLAIN, { status: "published" });
      const path = `collections/${PLAIN}/entries/${entryId}/duplicate`;
      // A caller who may read and create duplicates it.
      expect((await rest("POST", path, callers.editor)).ok).toBe(true);
      // The caller below may create, so the create gate passes and only the
      // read of the source can refuse the duplicate.
      const create = await rest(
        "POST",
        `collections/${PLAIN}/entries`,
        callers.creator,
        { title: "made", status: "draft" }
      );
      expect(create.ok, `create: ${create.status}`).toBe(true);
      const before = await t.nextly.count({ collection: PLAIN });
      const res = await rest(
        "POST",
        `collections/${PLAIN}/entries/${entryId}/duplicate`,
        callers.creator
      );
      expect(REFUSED).toContain(res.status);
      expect(await t.nextly.count({ collection: PLAIN })).toEqual(before);
    });

    describe("a duplicate of a draft, read as the caller", () => {
      const duplicatePath = (collection: string, id: string) =>
        `collections/${collection}/entries/${id}/duplicate`;
      /** The REST answer's item, or its error code when refused. */
      async function answer(res: Response) {
        const body = (await res.json()) as {
          item?: Record<string, unknown>;
          error?: { code?: unknown };
        };
        return { status: res.status, item: body.item, code: body.error?.code };
      }
      /** A stored row, read trusted and in every lifecycle state. */
      const stored = async (collection: string, id: unknown) =>
        (await t.nextly.findByID({
          collection,
          id: String(id),
          status: "all",
        })) as Record<string, unknown> | null;
      const total = (collection: string) => t.nextly.count({ collection });
      /** An id no row has, for the answer a missing source gets. */
      const MISSING = "00000000-0000-4000-8000-000000000000";

      it("copies a never-published draft the caller may read, as a draft", async () => {
        const draftId = await makeEntry(t, PLAIN, {
          title: "draft body",
          status: "draft",
        });
        // Never published: the caller's own default read does not show it,
        // and its read of every lifecycle state does.
        const entry = `collections/${PLAIN}/entries/${draftId}`;
        expect((await rest("GET", entry, callers.editor)).status).toBe(404);
        expect(
          (await rest("GET", `${entry}?status=all`, callers.editor)).status
        ).toBe(200);

        const viaRest = await answer(
          await rest("POST", duplicatePath(PLAIN, draftId), callers.editor)
        );
        expect(viaRest.status).toBe(201);
        expect(viaRest.item?.id).not.toBe(draftId);
        const restCopy = await stored(PLAIN, viaRest.item?.id);
        expect(restCopy?.title).toBe("draft body (Copy)");
        expect(restCopy?.status).toBe("draft");

        const viaDirect = await t.nextly.duplicate({
          collection: PLAIN,
          id: draftId,
          overrideAccess: false,
          user: { id: callers.editorId },
        });
        const directCopy = await stored(PLAIN, viaDirect.item.id);
        expect(directCopy?.title).toBe("draft body (Copy)");
        expect(directCopy?.status).toBe("draft");
        // The source is untouched.
        expect((await stored(PLAIN, draftId))?.title).toBe("draft body");
      });

      it("answers a draft the caller's read rule excludes as a missing id, and creates nothing", async () => {
        const hidden = await makeEntry(t, FILTERED_READ, {
          team: "closed",
          status: "draft",
        });
        // A draft the rule's filter admits is copied, so the refusal below is
        // the filter's and not the draft's.
        const shown = await makeEntry(t, FILTERED_READ, {
          team: "open",
          status: "draft",
        });
        const allowed = await answer(
          await rest(
            "POST",
            duplicatePath(FILTERED_READ, shown),
            callers.editor
          )
        );
        expect(allowed.status).toBe(201);
        expect((await stored(FILTERED_READ, allowed.item?.id))?.team).toBe(
          "open"
        );

        const before = await total(FILTERED_READ);
        const refused = await answer(
          await rest(
            "POST",
            duplicatePath(FILTERED_READ, hidden),
            callers.editor
          )
        );
        const missing = await answer(
          await rest(
            "POST",
            duplicatePath(FILTERED_READ, MISSING),
            callers.editor
          )
        );
        expect(refused.status).toBe(404);
        expect({ status: refused.status, code: refused.code }).toEqual({
          status: missing.status,
          code: missing.code,
        });
        await expect(
          t.nextly.duplicate({
            collection: FILTERED_READ,
            id: hidden,
            overrideAccess: false,
            user: { id: callers.editorId },
          })
        ).rejects.toMatchObject({ statusCode: 404 });
        expect(await total(FILTERED_READ)).toEqual(before);
      });

      it("refuses a caller who may create but not read the draft, as for a missing id", async () => {
        const draftId = await makeEntry(t, PLAIN, { status: "draft" });
        const before = await total(PLAIN);
        const refused = await answer(
          await rest("POST", duplicatePath(PLAIN, draftId), callers.creator)
        );
        const missing = await answer(
          await rest("POST", duplicatePath(PLAIN, MISSING), callers.creator)
        );
        expect(REFUSED).toContain(refused.status);
        expect({ status: refused.status, code: refused.code }).toEqual({
          status: missing.status,
          code: missing.code,
        });
        expect(await total(PLAIN)).toEqual(before);
      });

      it("refuses a caller who may read the draft but not create, and creates nothing", async () => {
        const draftId = await makeEntry(t, PLAIN, { status: "draft" });
        // The reader sees the draft, so only the create can refuse.
        expect(
          (
            await rest(
              "GET",
              `collections/${PLAIN}/entries/${draftId}?status=all`,
              callers.reader
            )
          ).status
        ).toBe(200);
        const before = await total(PLAIN);
        const viaRest = await rest(
          "POST",
          duplicatePath(PLAIN, draftId),
          callers.reader
        );
        expect(REFUSED).toContain(viaRest.status);
        // The Direct API has no route gate in front, so the service's own
        // create check is what refuses here.
        await expect(
          t.nextly.duplicate({
            collection: PLAIN,
            id: draftId,
            overrideAccess: false,
            user: { id: callers.readerId },
          })
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(await total(PLAIN)).toEqual(before);
      });

      it("copies a published entry's live content, not its pending working draft", async () => {
        const liveId = await makeEntry(t, PLAIN, {
          title: "live",
          status: "published",
        });
        await t.nextly.update({
          collection: PLAIN,
          id: liveId,
          data: { title: "pending", _overwrite: true },
        });
        // A working draft is pending, so copying the live row is a choice.
        const withDraft = (await t.nextly.findByID({
          collection: PLAIN,
          id: liveId,
          draft: true,
        })) as { title?: unknown } | null;
        expect(withDraft?.title).toBe("pending");

        const copy = await answer(
          await rest("POST", duplicatePath(PLAIN, liveId), callers.editor)
        );
        expect(copy.status).toBe(201);
        const row = await stored(PLAIN, copy.item?.id);
        expect(row?.title).toBe("live (Copy)");
        expect(row?.status).toBe("published");
      });

      it("lets a trusted call copy a draft as before", async () => {
        const draftId = await makeEntry(t, PLAIN, {
          title: "trusted draft",
          status: "draft",
        });
        const copy = await t.nextly.duplicate({
          collection: PLAIN,
          id: draftId,
        });
        const row = await stored(PLAIN, copy.item.id);
        expect(row?.title).toBe("trusted draft (Copy)");
        expect(row?.status).toBe("draft");
      });
    });

    it("publishing every language, authorized as an update, is refused without publish", async () => {
      const statusOf = async (id: string) =>
        (
          (await t.nextly.findByID({
            collection: PLAIN,
            id,
            status: "all",
          })) as { status?: unknown } | null
        )?.status;
      const publishAll = (id: string, who: Headers) =>
        rest("POST", `collections/${PLAIN}/entries/${id}/publish-all`, who, {
          _overwrite: true,
        });

      // A caller who may publish publishes it.
      const allowed = await makeEntry(t, PLAIN, { status: "draft" });
      expect((await publishAll(allowed, callers.editor)).ok).toBe(true);
      expect(await statusOf(allowed)).toBe("published");

      const entryId = await makeEntry(t, PLAIN, { status: "draft" });
      // The caller may update the entry, which is what the route asks, so
      // only the publish behind it can refuse.
      const update = await rest(
        "PATCH",
        `collections/${PLAIN}/entries/${entryId}`,
        callers.noPublisher,
        { title: "edited", _overwrite: true }
      );
      expect(update.ok, `update: ${update.status}`).toBe(true);
      expect(REFUSED).toContain(
        (await publishAll(entryId, callers.noPublisher)).status
      );
      expect(await statusOf(entryId)).toBe("draft");
    });

    it("a Single's PATCH route, authorized as an update, is refused a publish without publish", async () => {
      const patch = (who: Headers, status: string) =>
        patchSingle(
          new Request(`${ORIGIN}/api/singles/${S_STATUS}`, {
            method: "PATCH",
            headers: {
              origin: ORIGIN,
              "content-type": "application/json",
              ...who,
            },
            body: JSON.stringify({ headline: "out", status, _overwrite: true }),
          }),
          { params: Promise.resolve({ slug: S_STATUS }) }
        );
      // The caller may change the Single, and a caller who may publish
      // publishes it, so the refusal below is the publish.
      expect((await patch(callers.noPublisher, "draft")).ok).toBe(true);
      expect((await patch(callers.editor, "published")).ok).toBe(true);
      expect((await patch(callers.editor, "draft")).ok).toBe(true);
      expect(REFUSED).toContain(
        (await patch(callers.noPublisher, "published")).status
      );
    });

    it("minting a preview link, authorized as an update, is refused to a caller whose read rule refuses it", async () => {
      // A key is refused every preview link, so only a person shows the read.
      const mint = (collection: string, entryId: string) =>
        rest("POST", "preview-links", callers.editor, { collection, entryId });
      // Past access, a collection with no preview address is refused as
      // unconfigured: the conflict only a caller who passed every gate meets.
      const allowed = await mint(PLAIN, await makeEntry(t, PLAIN));
      expect(allowed.status).toBe(409);
      const body = (await allowed.json()) as { error?: { code?: unknown } };
      expect(body.error?.code).toBe("CONFLICT");
      const res = await mint(HIDDEN_READ, await makeEntry(t, HIDDEN_READ));
      expect(REFUSED).toContain(res.status);
    });

    describe("identity sent in the query string", () => {
      /**
       * Every name identity once travelled under in route params, naming the
       * super-admin and its role. A query string fills route params, so a
       * caller that could set one would be judged as someone else.
       */
      const forged = () =>
        "?" +
        new URLSearchParams({
          _authenticatedUserId: callers.rootId,
          _authenticatedUserName: "root",
          _authenticatedUserEmail: "root@writes.test",
          _authenticatedUserRoles: JSON.stringify(["super-admin"]),
          _authenticatedActorType: "user",
          _authenticatedActorId: callers.rootId,
          _authenticatedPermissions: JSON.stringify([`read-${HIDDEN_READ}`]),
          _authenticatedClaims: JSON.stringify({ tenant: "any" }),
        }).toString();

      it("never reaches the user a field rule is handed", async () => {
        // `noPublisher` may read `plain`, so the read is past every gate and
        // only the field rule, which reads the user, can hide `secret`.
        const entryId = await makeEntry(t, PLAIN, {
          status: "published",
          secret: "classified",
        });
        // Stored, so its absence below is the rule's doing.
        const stored = (await t.nextly.findByID({
          collection: PLAIN,
          id: entryId,
        })) as { secret?: unknown } | null;
        expect(stored?.secret).toBe("classified");
        const entry = `collections/${PLAIN}/entries/${entryId}`;
        for (const path of [entry, entry + forged()]) {
          const res = await rest("GET", path, callers.noPublisher);
          expect(res.status, path).toBe(200);
          const body = (await res.json()) as Record<string, unknown>;
          const item = (body.item ?? body) as Record<string, unknown>;
          expect(item.title, path).toBe("original");
          expect(item.secret, path).toBeUndefined();
        }
      });

      it("never changes who a session is judged as", async () => {
        const entryId = await makeEntry(t, PLAIN);
        const entry = `collections/${PLAIN}/entries/${entryId}`;
        // `updater` may not read `plain`; the forged super-admin may.
        const plainRead = await rest("GET", entry, callers.updater);
        expect(REFUSED).toContain(plainRead.status);
        const forgedRead = await rest("GET", entry + forged(), callers.updater);
        expect(forgedRead.status).toBe(plainRead.status);
        const forgedDelete = await rest(
          "DELETE",
          entry + forged(),
          callers.updater
        );
        expect(REFUSED).toContain(forgedDelete.status);
        expect(
          await t.nextly.findByID({ collection: PLAIN, id: entryId })
        ).not.toBeNull();
      });

      it("never changes who an API key is judged as", async () => {
        // The key holds `read-hidden_read`, and the collection's read rule
        // refuses everyone but a super-admin; a forged super-admin identity
        // or a forged session actor must not lift it.
        const entry = `collections/${HIDDEN_READ}/entries/${await makeEntry(t, HIDDEN_READ)}`;
        const plainRead = await rest("GET", entry, callers.editorKey);
        expect(REFUSED).toContain(plainRead.status);
        const forgedRead = await rest(
          "GET",
          entry + forged(),
          callers.editorKey
        );
        expect(forgedRead.status).toBe(plainRead.status);
      });
    });
  });
}
