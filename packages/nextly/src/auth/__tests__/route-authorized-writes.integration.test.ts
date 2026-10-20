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
        slug: PLAIN,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" })],
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
  `-(${[REFUSES_UPDATE, S_REFUSES_UPDATE, HIDDEN_READ, PLAIN, S_STATUS].join("|")})$`
);

async function seedCallers(t: TestNextly): Promise<Callers> {
  const services = new ServiceContainer(t.adapter);
  await seedAllPermissions();
  // The first user an install makes is its super-admin, who passes every
  // rule, so one is made before the callers under test.
  await t.nextly.users.create({
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
  return {
    editor: editor.headers,
    editorKey: { authorization: `Bearer ${key.key}` },
    updater: updater.headers,
    creator: creator.headers,
    noPublisher: noPublisher.headers,
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
  const segments = path.split("/").filter(Boolean);
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
          { title: "changed" }
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
          { headline: "changed" }
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
          { title: "changed" }
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
          ["POST", `versions/1/restore`, undefined],
          ["DELETE", `versions/working-draft`, undefined],
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
          data: { title: "second" },
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
          data: { title: "second" },
        });
        for (const who of [callers.editor, callers.editorKey]) {
          const entry = `collections/${HIDDEN_READ}/entries/${entryId}`;
          // The caller may update the entry through REST, so the route's
          // update gate passes and only the read it asks next can refuse.
          const update = await rest("PATCH", entry, who, { title: "edited" });
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
          data: { title: "second" },
        });
        const entry = `collections/${PLAIN}/entries/${entryId}`;
        // As above: the update passes, the read does not.
        const update = await rest("PATCH", entry, callers.updater, {
          title: "edited",
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
      // Published, since a duplicate reads only what the caller's own read
      // would show, and that is the published row.
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
        rest("POST", `collections/${PLAIN}/entries/${id}/publish-all`, who);

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
        { title: "edited" }
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
            body: JSON.stringify({ headline: "out", status }),
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
  });
}
