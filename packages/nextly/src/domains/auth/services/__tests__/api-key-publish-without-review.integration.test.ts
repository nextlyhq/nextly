/**
 * No API key holds `publish-without-review-<slug>`, through any route that can put a permission
 * within a key's reach: a role's permissions set or added, by REST or the Direct API; a role-based
 * key created over such a role; a role given to a person whose full-access key follows them; and a
 * super-admin's full-access key, which copies the whole catalogue. The form's summary says the
 * same. A row whose stored action is `publish-without-review` under a slug of its own is dropped
 * too. The workflow's other permission, `approve-posts`, reaches each key, so the drop is that
 * permission alone.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../../../auth/jwt/claims";
import { signAccessToken } from "../../../../auth/jwt/sign";
import { defineCollection, text } from "../../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../../routeHandler";
import { reviewWorkflow } from "../../../workflows/preset";
import type { ApiKeyService } from "../api-key-service";
import { PermissionService } from "../permission-service";

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

const POSTS = "posts";
const PAGES = "pages";
const WITHOUT_REVIEW = `publish-without-review-${POSTS}`;
/** A row stored with the action under a slug of its own. */
const CUSTOM = "urgent-pages";

describe.each(getConfiguredTestDialects())(
  "no API key holds publish-without-review (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let direct: Direct;
    let keys: ApiKeyService;
    let superAdminId: string;
    let ownerCookie: Record<string, string>;
    const ids = new Map<string, string>();

    async function account(email: string): Promise<string> {
      const created = await direct.users.create({
        data: { email, password: "Password123!", name: email, isActive: true },
      });
      return created.item.id;
    }

    async function session(userId: string): Promise<Record<string, string>> {
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: `${userId}@example.com`,
          name: userId,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return { cookie: `nextly_session=${token}` };
    }

    function send(
      method: "GET" | "POST" | "PATCH",
      path: string[],
      body?: unknown,
      query = ""
    ): Promise<Response> {
      const handlers = createDynamicHandlers();
      const request = new Request(
        `http://localhost/api/${path.join("/")}${query}`,
        {
          method,
          headers: { ...ownerCookie, "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }
      );
      const context = { params: Promise.resolve({ params: path }) };
      return method === "GET"
        ? handlers.GET(request, context)
        : method === "POST"
          ? handlers.POST(request, context)
          : handlers.PATCH(request, context);
    }

    async function role(slug: string, permissionSlugs: string[]) {
      const created = await direct.roles.create({
        data: {
          name: slug,
          slug,
          permissionIds: permissionSlugs.map(s => ids.get(s)!),
        },
      });
      return created.item.id;
    }

    /** What a key created now resolves, as sorted slugs. */
    async function grantsOfNewKey(
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
      return [
        ...(await keys.resolveApiKeyPermissions(
          tokenType,
          roleId ?? null,
          userId,
          meta.id
        )),
      ].sort();
    }

    /** Neither the workflow's permission nor the custom row, while `approve-posts` is there. */
    function expectWithheld(granted: string[]): void {
      expect(granted).toContain(`approve-${POSTS}`);
      expect(granted).not.toContain(WITHOUT_REVIEW);
      expect(granted).not.toContain(CUSTOM);
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: POSTS,
            status: true,
            versions: { drafts: true },
            workflow: reviewWorkflow(),
            fields: [text({ name: "title" })],
          }),
          defineCollection({ slug: PAGES, fields: [text({ name: "title" })] }),
        ],
      });
      direct = t.nextly as unknown as Direct;
      keys = t.getService("apiKeyService") as unknown as ApiKeyService;
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
        seedAllCollectionPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      await seeder.seedAllCollectionPermissions();
      // A row stored with the action under a slug of its own.
      // The permissions service is not a container entry; it is built over
      // the container's adapter, as the Direct API builds its own.
      await new PermissionService(
        t.getService("adapter"),
        t.getService("logger")
      ).ensurePermission(
        "publish-without-review",
        PAGES,
        "Urgent pages",
        CUSTOM
      );
      for (const p of (await direct.permissions.find({ limit: 1000 })).items) {
        ids.set(p.slug, p.id);
      }
      expect(ids.has(WITHOUT_REVIEW), "the workflow seeds it").toBe(true);
      expect(ids.has(`approve-${POSTS}`), "the workflow seeds it").toBe(true);

      // The install's first account holds super-admin.
      superAdminId = await account("owner@example.com");
      ownerCookie = await session(superAdminId);
    });

    it("withholds it from a role-based key whose role was created with it (Direct API)", async () => {
      const roleId = await role("reviewers-created", [
        `approve-${POSTS}`,
        WITHOUT_REVIEW,
        CUSTOM,
      ]);
      expectWithheld(await grantsOfNewKey(superAdminId, "role-based", roleId));
    });

    it("withholds it after the role's permissions are set (Direct API)", async () => {
      const roleId = await role("reviewers-set", [`read-${POSTS}`]);
      await direct.roles.setPermissions({
        roleId,
        permissionIds: [`approve-${POSTS}`, WITHOUT_REVIEW, CUSTOM].map(
          s => ids.get(s)!
        ),
      });
      expectWithheld(await grantsOfNewKey(superAdminId, "role-based", roleId));
    });

    it("withholds it after the role's permissions are set (REST)", async () => {
      const roleId = await role("reviewers-rest-set", [`read-${POSTS}`]);
      const res = await send("PATCH", ["roles", roleId, "permissions"], {
        permissionIds: [`approve-${POSTS}`, WITHOUT_REVIEW, CUSTOM].map(
          s => ids.get(s)!
        ),
      });
      expect(res.status).toBeLessThan(300);
      expectWithheld(await grantsOfNewKey(superAdminId, "role-based", roleId));
    });

    it("withholds it after it is added to the role (REST)", async () => {
      const roleId = await role("reviewers-rest-add", [`approve-${POSTS}`]);
      const res = await send("POST", ["roles", roleId, "permissions"], {
        action: "publish-without-review",
        resource: POSTS,
      });
      expect(res.status).toBeLessThan(300);
      expectWithheld(await grantsOfNewKey(superAdminId, "role-based", roleId));
    });

    it("withholds it from a key created over such a role by REST, and from the form's summary", async () => {
      const roleId = await role("reviewers-rest-key", [
        `approve-${POSTS}`,
        WITHOUT_REVIEW,
      ]);
      const summary = await send(
        "GET",
        ["api-keys", "abilities"],
        undefined,
        `?tokenType=role-based&roleId=${roleId}`
      );
      expect(summary.status).toBe(200);
      expectWithheld(
        ((await summary.json()) as { items: { slug: string }[] }).items.map(
          grant => grant.slug
        )
      );
      const created = await send("POST", ["api-keys"], {
        name: "rest key",
        tokenType: "role-based",
        roleId,
        expiresIn: "unlimited",
      });
      expect(created.status).toBeLessThan(300);
      const { item } = (await created.json()) as { item: { id: string } };
      expectWithheld(
        [
          ...(await keys.resolveApiKeyPermissions(
            "role-based",
            roleId,
            superAdminId,
            item.id
          )),
        ].sort()
      );
    });

    it("withholds it from the full-access key of a person given a role holding it (REST)", async () => {
      const roleId = await role("reviewers-people", [
        `approve-${POSTS}`,
        WITHOUT_REVIEW,
        "create-api-keys",
      ]);
      const reviewerId = await account("reviewer@example.com");
      const res = await send("POST", ["users", reviewerId, "roles"], {
        roleId,
      });
      expect(res.status).toBeLessThan(300);
      expectWithheld(await grantsOfNewKey(reviewerId, "full-access"));
    });

    it("withholds it from a super-admin's full-access key, which copies the catalogue", async () => {
      expectWithheld(await grantsOfNewKey(superAdminId, "full-access"));
    });
  }
);
