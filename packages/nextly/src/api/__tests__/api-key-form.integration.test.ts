/**
 * What the API key form and list are told by the server.
 *
 * The form shows, before a key exists, what it will be able to do. That
 * summary is only worth showing if it is what the key then gets, so each case
 * compares the summary with the grants the created key resolves: a summary
 * computed some other way (from the viewer's own permissions in the browser,
 * say) agrees for an ordinary person and is wrong for a super-admin, whose
 * read-only key reads the whole catalogue.
 *
 * The list shows each key's owner, expiry and last use, and last use has to
 * move: a request with one key advances its last use, and leaves another
 * key's alone.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import { defineCollection, text } from "../../config";
import type { ApiKeyService } from "../../domains/auth/services/api-key-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";

/** The part of the Direct API these tests drive, typed where the shim is not. */
interface Direct {
  users: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
  permissions: {
    find(a: { limit: number }): Promise<{
      items: { id: string; slug: string }[];
    }>;
  };
  roles: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
    setPermissions(a: {
      roleId: string;
      permissionIds: string[];
    }): Promise<unknown>;
  };
}

/** A refusal as the error envelope carries it. */
interface Refusal {
  status: number;
  code: string;
  message: string;
}

/** The sentence a role above its creator is refused with, naming no permission. */
const CANONICAL_FORBIDDEN = "You don't have permission to perform this action.";

interface Grant {
  slug: string;
  action: string;
  resource: string;
}

interface ListedKey {
  id: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  owner: { id: string; name: string | null; email: string } | null;
}

const POSTS = "posts";

describe.each(getConfiguredTestDialects())(
  "the API key form and list (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let direct: Direct;
    let keys: ApiKeyService;
    let superAdminId: string;
    let editorId: string;
    let editorRoleId: string;
    let readerRoleId: string;
    let widerRoleId: string;

    async function account(email: string, roles: string[] = []) {
      const created = await direct.users.create({
        data: {
          email,
          password: "Password123!",
          name: email,
          isActive: true,
          ...(roles.length > 0 ? { roles } : {}),
        },
      });
      return created.item.id;
    }

    /** A role holding exactly the named, seeded permissions. */
    async function role(slug: string, permissionSlugs: string[]) {
      const seeded = await direct.permissions.find({ limit: 1000 });
      const ids = permissionSlugs.map(wanted => {
        const found = seeded.items.find(p => p.slug === wanted);
        expect(found, `\`${wanted}\` must be seeded`).toBeDefined();
        return found!.id;
      });
      const created = await direct.roles.create({
        data: { name: slug, slug, permissionIds: ids },
      });
      return created.item.id;
    }

    async function session(userId: string, roleIds: string[]) {
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: `${userId}@example.com`,
          name: userId,
          image: null,
          roleIds,
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return { cookie: `nextly_session=${token}` };
    }

    function get(path: string[], headers: Record<string, string>, query = "") {
      return createDynamicHandlers().GET(
        new Request(`http://localhost/api/${path.join("/")}${query}`, {
          headers,
        }),
        { params: Promise.resolve({ params: path }) }
      );
    }

    function post(
      path: string[],
      headers: Record<string, string>,
      body: unknown
    ) {
      return createDynamicHandlers().POST(
        new Request(`http://localhost/api/${path.join("/")}`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ params: path }) }
      );
    }

    /** A write to a key route, as the admin sends one with the session cookie. */
    function write(
      method: "PATCH" | "DELETE",
      path: string[],
      headers: Record<string, string>,
      body?: unknown
    ) {
      const handlers = createDynamicHandlers();
      const request = new Request(`http://localhost/api/${path.join("/")}`, {
        method,
        headers: { ...headers, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const context = { params: Promise.resolve({ params: path }) };
      return method === "PATCH"
        ? handlers.PATCH(request, context)
        : handlers.DELETE(request, context);
    }

    async function refusal(res: Response): Promise<Refusal> {
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      return {
        status: res.status,
        code: body.error.code,
        message: body.error.message,
      };
    }

    /** The summary the form asks for, as sorted slugs. */
    async function abilities(
      headers: Record<string, string>,
      query: string
    ): Promise<{ status: number; slugs: string[] }> {
      const res = await get(["api-keys", "abilities"], headers, query);
      if (res.status !== 200) return { status: res.status, slugs: [] };
      const body = (await res.json()) as { items: Grant[] };
      return {
        status: res.status,
        slugs: body.items.map(grant => grant.slug).sort(),
      };
    }

    /** What a key created with these settings then resolves, as sorted slugs. */
    async function grantsOfCreated(
      userId: string,
      tokenType: "read-only" | "full-access" | "role-based",
      roleId?: string
    ): Promise<string[]> {
      const { meta } = await keys.createApiKey(userId, {
        name: `${tokenType} key`,
        tokenType,
        ...(roleId ? { roleId } : {}),
        expiresIn: "unlimited",
      });
      const grants = await keys.resolveApiKeyPermissions(
        tokenType,
        roleId ?? null,
        userId,
        meta.id
      );
      return [...grants].sort();
    }

    async function listed(headers: Record<string, string>) {
      const res = await get(["api-keys"], headers);
      expect(res.status).toBe(200);
      return ((await res.json()) as { items: ListedKey[] }).items;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({ slug: POSTS, fields: [text({ name: "title" })] }),
        ],
      });
      direct = t.nextly as unknown as Direct;
      keys = t.getService("apiKeyService") as unknown as ApiKeyService;
      // What a real boot does before serving anything: the harness boots
      // without it, and the roles below are made of these permissions.
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
        seedAllCollectionPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      await seeder.seedAllCollectionPermissions();

      // The install's first account holds super-admin.
      superAdminId = await account("owner@example.com");
      editorRoleId = await role("key-editors", [
        `read-${POSTS}`,
        `create-${POSTS}`,
        "create-api-keys",
        "read-api-keys",
      ]);
      editorId = await account("editor@example.com", [editorRoleId]);
      readerRoleId = await role("post-readers", [`read-${POSTS}`]);
      widerRoleId = await role("post-deleters", [
        `read-${POSTS}`,
        `delete-${POSTS}`,
      ]);
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    describe("the summary before creation", () => {
      it("answers a read-only key's grants for an ordinary person", async () => {
        const headers = await session(editorId, [editorRoleId]);
        const summary = await abilities(headers, "?tokenType=read-only");

        expect(summary.status).toBe(200);
        expect(summary.slugs).toEqual(
          await grantsOfCreated(editorId, "read-only")
        );
        expect(summary.slugs.every(slug => slug.startsWith("read-"))).toBe(
          true
        );
      });

      it("answers a super-admin's read-only key as the whole readable catalogue", async () => {
        const headers = await session(superAdminId, []);
        const summary = await abilities(headers, "?tokenType=read-only");

        expect(summary.status).toBe(200);
        // A super-admin holds no role rows here, so a summary built from
        // the viewer's own permissions would be empty.
        expect(summary.slugs).toContain(`read-${POSTS}`);
        expect(summary.slugs).toEqual(
          await grantsOfCreated(superAdminId, "read-only")
        );
      });

      it("answers a full-access key's grants as its creator's", async () => {
        const headers = await session(editorId, [editorRoleId]);
        const summary = await abilities(headers, "?tokenType=full-access");

        expect(summary.status).toBe(200);
        expect(summary.slugs).toContain(`create-${POSTS}`);
        expect(summary.slugs).toEqual(
          await grantsOfCreated(editorId, "full-access")
        );
      });

      it("answers a role-based key's grants as the role's", async () => {
        const headers = await session(editorId, [editorRoleId]);
        const summary = await abilities(
          headers,
          `?tokenType=role-based&roleId=${readerRoleId}`
        );

        expect(summary.status).toBe(200);
        expect(summary.slugs).toEqual([`read-${POSTS}`]);
        expect(summary.slugs).toEqual(
          await grantsOfCreated(editorId, "role-based", readerRoleId)
        );
      });

      it("refuses a role above its creator with a code of its own, as creating the key would", async () => {
        const headers = await session(editorId, [editorRoleId]);
        // The code says which refusal this is, so the form can tell it from
        // a person who may not create keys at all; the sentence names no
        // permission.
        const aboveCreator: Refusal = {
          status: 403,
          code: "API_KEY_ROLE_ABOVE_CREATOR",
          message: CANONICAL_FORBIDDEN,
        };

        expect(
          await refusal(
            await get(
              ["api-keys", "abilities"],
              headers,
              `?tokenType=role-based&roleId=${widerRoleId}`
            )
          )
        ).toEqual(aboveCreator);
        expect(
          await refusal(
            await post(["api-keys"], headers, {
              name: "too wide",
              tokenType: "role-based",
              roleId: widerRoleId,
              expiresIn: "unlimited",
            })
          )
        ).toEqual(aboveCreator);
        await expect(
          keys.createApiKey(editorId, {
            name: "too wide",
            tokenType: "role-based",
            roleId: widerRoleId,
            expiresIn: "unlimited",
          })
        ).rejects.toMatchObject({
          statusCode: 403,
          code: "API_KEY_ROLE_ABOVE_CREATOR",
        });
      });

      it("refuses a person who loses the permission to create keys while the form is open, as plainly FORBIDDEN", async () => {
        const makersRoleId = await role("key-makers", [
          `read-${POSTS}`,
          "create-api-keys",
        ]);
        const makerId = await account("maker@example.com", [makersRoleId]);
        const headers = await session(makerId, [makersRoleId]);
        expect((await abilities(headers, "?tokenType=read-only")).status).toBe(
          200
        );

        // Taken away while the form is open: the same session asks again.
        const seeded = await direct.permissions.find({ limit: 1000 });
        await direct.roles.setPermissions({
          roleId: makersRoleId,
          permissionIds: seeded.items
            .filter(p => p.slug === `read-${POSTS}`)
            .map(p => p.id),
        });

        // Told in words what they may not do, naming no permission.
        const lost: Refusal = {
          status: 403,
          code: "FORBIDDEN",
          message: "You can't create API keys.",
        };
        expect(
          await refusal(
            await get(
              ["api-keys", "abilities"],
              headers,
              "?tokenType=read-only"
            )
          )
        ).toEqual(lost);
        // Asked about a role above them too, they are told they may not
        // create keys: that is checked first, so the ceiling never answers.
        expect(
          await refusal(
            await get(
              ["api-keys", "abilities"],
              headers,
              `?tokenType=role-based&roleId=${widerRoleId}`
            )
          )
        ).toEqual(lost);
      });

      it("refuses a role-based summary without a role, and a role for another type", async () => {
        const headers = await session(editorId, [editorRoleId]);

        expect((await abilities(headers, "?tokenType=role-based")).status).toBe(
          400
        );
        expect(
          (
            await abilities(
              headers,
              `?tokenType=read-only&roleId=${readerRoleId}`
            )
          ).status
        ).toBe(400);
        expect((await abilities(headers, "?tokenType=admin")).status).toBe(400);
      });

      it("refuses a role that does not exist, as creating the key would", async () => {
        const headers = await session(editorId, [editorRoleId]);
        const missing = "00000000-0000-4000-8000-000000000000";

        expect(
          (await abilities(headers, `?tokenType=role-based&roleId=${missing}`))
            .status
        ).toBe(400);
        await expect(
          keys.createApiKey(editorId, {
            name: "no such role",
            tokenType: "role-based",
            roleId: missing,
            expiresIn: "unlimited",
          })
        ).rejects.toMatchObject({ statusCode: 400 });
      });

      it("is private to the session that asked, refusals included", async () => {
        const headers = await session(editorId, [editorRoleId]);
        for (const query of [
          "?tokenType=read-only",
          `?tokenType=role-based&roleId=${widerRoleId}`,
        ]) {
          const res = await get(["api-keys", "abilities"], headers, query);
          expect(res.headers.get("cache-control")).toContain("private");
          expect(res.headers.get("cache-control")).toContain("no-store");
          expect(res.headers.get("vary")).toMatch(/cookie/i);
          expect(res.headers.get("vary")).toMatch(/authorization/i);
        }
      });

      it("answers only its own path", async () => {
        const headers = await session(editorId, [editorRoleId]);
        const res = await get(
          ["api-keys", "abilities", "anything"],
          headers,
          "?tokenType=read-only"
        );
        expect(res.status).toBe(404);
      });

      it("refuses an API key, and a person who may not create keys", async () => {
        const { key } = await keys.createApiKey(superAdminId, {
          name: "a key asking",
          tokenType: "full-access",
          expiresIn: "unlimited",
        });
        expect(
          (
            await abilities(
              { authorization: `Bearer ${key}` },
              "?tokenType=read-only"
            )
          ).status
        ).toBe(403);

        const readerId = await account("reader@example.com", [readerRoleId]);
        expect(
          (
            await abilities(
              await session(readerId, [readerRoleId]),
              "?tokenType=read-only"
            )
          ).status
        ).toBe(403);
      });
    });

    describe("the list", () => {
      it("names each key's owner", async () => {
        const { meta } = await keys.createApiKey(editorId, {
          name: "owned",
          tokenType: "read-only",
          expiresIn: "30d",
        });
        const items = await listed(await session(superAdminId, []));
        const row = items.find(item => item.id === meta.id);

        expect(row?.owner).toEqual({
          id: editorId,
          name: "editor@example.com",
          email: "editor@example.com",
        });
        expect(row?.expiresAt).not.toBeNull();
      });

      it("names no owner to a key that may not read users", async () => {
        // A super-admin's key lists every key; one whose role can read keys
        // but not people learns no person's name or address from the list.
        await keys.createApiKey(editorId, {
          name: "someone's key",
          tokenType: "read-only",
          expiresIn: "unlimited",
        });
        const keyReader = await keys.createApiKey(superAdminId, {
          name: "reads keys only",
          tokenType: "role-based",
          roleId: await role("key-readers", ["read-api-keys"]),
          expiresIn: "unlimited",
        });
        const peopleReader = await keys.createApiKey(superAdminId, {
          name: "reads keys and people",
          tokenType: "role-based",
          roleId: await role("key-and-user-readers", [
            "read-api-keys",
            "read-users",
          ]),
          expiresIn: "unlimited",
        });

        const withoutUsers = await listed({
          authorization: `Bearer ${keyReader.key}`,
        });
        expect(withoutUsers.length).toBeGreaterThan(1);
        expect(withoutUsers.every(item => item.owner === null)).toBe(true);
        const single = await get(["api-keys", peopleReader.meta.id], {
          authorization: `Bearer ${keyReader.key}`,
        });
        expect(single.status).toBe(200);
        expect(((await single.json()) as ListedKey).owner).toBeNull();

        const withUsers = await listed({
          authorization: `Bearer ${peopleReader.key}`,
        });
        expect(withUsers.some(item => item.owner?.id === editorId)).toBe(true);
      });

      it("lists every key to a person who may read keys, naming owners only if they may read users", async () => {
        const theirs = await keys.createApiKey(superAdminId, {
          name: "someone else's",
          tokenType: "read-only",
          expiresIn: "unlimited",
        });
        const mine = await keys.createApiKey(editorId, {
          name: "the editor's own",
          tokenType: "read-only",
          expiresIn: "unlimited",
        });
        // The editor may read keys but not users.
        const editor = await session(editorId, [editorRoleId]);
        const items = await listed(editor);
        const row = (id: string) => items.find(item => item.id === id);

        expect(row(theirs.meta.id)).toBeDefined();
        expect(row(theirs.meta.id)?.owner).toBeNull();
        expect(row(mine.meta.id)?.owner?.id).toBe(editorId);
        const single = await get(["api-keys", theirs.meta.id], editor);
        expect(single.status).toBe(200);
        expect(((await single.json()) as ListedKey).owner).toBeNull();

        const auditorRoleId = await role("key-and-people-auditors", [
          "read-api-keys",
          "read-users",
        ]);
        const auditorId = await account("auditor@example.com", [auditorRoleId]);
        const seen = await listed(await session(auditorId, [auditorRoleId]));
        expect(seen.find(item => item.id === theirs.meta.id)?.owner?.id).toBe(
          superAdminId
        );
      });

      it("lets the holder of the permission edit or revoke anyone's key, and a reader neither", async () => {
        const target = await keys.createApiKey(superAdminId, {
          name: "anyone's key",
          tokenType: "read-only",
          expiresIn: "unlimited",
        });
        const stored = () =>
          keys.getApiKeyById(target.meta.id, "", { allUsers: true });

        // May read keys, not change them.
        const editor = await session(editorId, [editorRoleId]);
        expect(
          (
            await write("PATCH", ["api-keys", target.meta.id], editor, {
              name: "by a reader",
            })
          ).status
        ).toBe(403);
        expect(
          (await write("DELETE", ["api-keys", target.meta.id], editor)).status
        ).toBe(403);
        expect(await stored()).toMatchObject({
          name: "anyone's key",
          isActive: true,
        });

        const updaterRoleId = await role("key-updaters", ["update-api-keys"]);
        const updaterId = await account("updater@example.com", [updaterRoleId]);
        const renamed = await write(
          "PATCH",
          ["api-keys", target.meta.id],
          await session(updaterId, [updaterRoleId]),
          { name: "renamed by a key updater" }
        );
        expect(renamed.status).toBe(200);
        expect((await stored())?.name).toBe("renamed by a key updater");

        const revokerRoleId = await role("key-revokers", ["delete-api-keys"]);
        const revokerId = await account("revoker@example.com", [revokerRoleId]);
        const revoked = await write(
          "DELETE",
          ["api-keys", target.meta.id],
          await session(revokerId, [revokerRoleId])
        );
        expect(revoked.status).toBe(200);
        expect((await stored())?.isActive).toBe(false);
      });

      it("keeps the list private to the session that asked", async () => {
        const res = await get(["api-keys"], await session(superAdminId, []));
        expect(res.headers.get("cache-control")).toContain("no-store");
        expect(res.headers.get("vary")).toMatch(/authorization/i);
      });

      it("advances the last use of the key a request used, and no other", async () => {
        const used = await keys.createApiKey(editorId, {
          name: "used",
          tokenType: "read-only",
          expiresIn: "unlimited",
        });
        const unused = await keys.createApiKey(editorId, {
          name: "unused",
          tokenType: "read-only",
          expiresIn: "unlimited",
        });
        const headers = await session(editorId, [editorRoleId]);
        const before = Date.now();

        const res = await get(["collections", POSTS, "entries"], {
          authorization: `Bearer ${used.key}`,
        });
        expect(res.status).toBe(200);

        // The write is not awaited by the request, so it is waited for here.
        await vi.waitFor(
          async () => {
            const row = (await listed(headers)).find(
              item => item.id === used.meta.id
            );
            expect(row?.lastUsedAt).not.toBeNull();
          },
          { timeout: 5_000, interval: 100 }
        );
        const items = await listed(headers);
        const usedRow = items.find(item => item.id === used.meta.id);
        const unusedRow = items.find(item => item.id === unused.meta.id);

        // Whole seconds on MySQL and SQLite, so compared to the second.
        expect(new Date(usedRow!.lastUsedAt!).getTime()).toBeGreaterThanOrEqual(
          Math.floor(before / 1000) * 1000
        );
        expect(unusedRow?.lastUsedAt).toBeNull();
      });
    });
  }
);
