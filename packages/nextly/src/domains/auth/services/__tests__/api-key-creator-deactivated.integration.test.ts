/**
 * An API key stops working while the person who created it is deactivated,
 * and works again once they are reactivated.
 *
 * A key is a credential of its own, but it acts with its creator's authority:
 * a read-only or full-access key carries the creator's live permissions, and a
 * role-based key a role the creator holds. A deactivated person's sessions end
 * at once, and a key they made must not go on acting for them.
 *
 * Every key is used once before the change, so the grants it resolved are
 * cached for it. That cache is what a refusal has to get past: a check placed
 * after it would never run for a key already in use.
 *
 * The bound is the one core auth states for a deactivated account's sessions:
 * the instance that makes the change refuses at once, and another instance,
 * which learns of it only through the database, within
 * `SESSION_CUTOFF_SECONDS`.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  SESSION_CUTOFF_SECONDS,
  resetSessionStandingForTests,
} from "../../../../auth/session/session-standing";
import { defineCollection, text } from "../../../../config";
import { getDialectTables } from "../../../../database/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../../routeHandler";
import type { ApiKeyService, ApiKeyTokenType } from "../api-key-service";

let current: TestNextly | undefined;
afterEach(async () => {
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
});

/** A clock the account check reads, moved by the test rather than by waiting. */
function testClock() {
  let offset = 0;
  return {
    now: () => Date.now() + offset,
    passTheBound: () => {
      offset += SESSION_CUTOFF_SECONDS * 1000;
    },
  };
}

/** The part of the Direct API these tests drive, typed where the shim is not. */
interface Direct {
  users: {
    create(a: {
      email: string;
      password: string;
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
    update(a: { id: string; data: Record<string, unknown> }): Promise<unknown>;
  };
  permissions: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
  roles: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
  access: {
    checkApiKey(a: { rawKey: string }): Promise<{ valid: boolean }>;
  };
}

const KEY_TYPES: ApiKeyTokenType[] = ["read-only", "full-access", "role-based"];

interface Booted {
  t: TestNextly;
  direct: Direct;
  creatorId: string;
  keys: Record<ApiKeyTokenType, string>;
}

/** A GET of the posts' entries through the REST dispatcher, with `key`. */
function readPosts(key: string): Promise<Response> {
  const handlers = createDynamicHandlers();
  return handlers.GET(
    new Request("http://localhost/api/collections/posts/entries", {
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ params: ["collections", "posts", "entries"] }) }
  );
}

/** The status each key gets reading posts, by key type. */
async function statuses(keys: Record<ApiKeyTokenType, string>) {
  const out: Record<string, number> = {};
  for (const type of KEY_TYPES)
    out[type] = (await readPosts(keys[type])).status;
  return out;
}

const every = (status: number) =>
  Object.fromEntries(KEY_TYPES.map(type => [type, status]));

describe.each(getConfiguredTestDialects())(
  "an API key whose creator is deactivated (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<Booted> {
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: "posts",
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const t = current;
      const direct = t.nextly as unknown as Direct;

      // The install's first account holds super-admin and may not be
      // deactivated while it is the only one, so the creator is another.
      await direct.users.create({
        email: "owner@example.com",
        password: "Str0ng-P@ssw0rd!",
        data: { name: "Owner", isActive: true },
      });
      // The harness runs none of boot's seeding, so the permission the keys
      // read with is written here, under the slug the seeder composes.
      const readPostsPermission = await direct.permissions.create({
        data: {
          name: "read-posts",
          slug: "read-posts",
          action: "read",
          resource: "posts",
        },
      });
      const role = await direct.roles.create({
        data: {
          name: "Readers",
          slug: "readers",
          permissionIds: [readPostsPermission.item.id],
        },
      });
      const creator = await direct.users.create({
        email: "creator@example.com",
        password: "Str0ng-P@ssw0rd!",
        data: { name: "Creator", isActive: true, roles: [role.item.id] },
      });
      const creatorId = creator.item.id;

      const apiKeys = t.getService("apiKeyService") as unknown as ApiKeyService;
      const keys = {} as Record<ApiKeyTokenType, string>;
      for (const tokenType of KEY_TYPES) {
        const { key } = await apiKeys.createApiKey(creatorId, {
          name: `${tokenType} key`,
          tokenType,
          ...(tokenType === "role-based" ? { roleId: role.item.id } : {}),
          expiresIn: "unlimited",
        });
        keys[tokenType] = key;
      }
      return { t, direct, creatorId, keys };
    }

    const deactivate = ({ direct, creatorId }: Booted) =>
      direct.users.update({ id: creatorId, data: { isActive: false } });
    const reactivate = ({ direct, creatorId }: Booted) =>
      direct.users.update({ id: creatorId, data: { isActive: true } });

    it("refuses every key type at once on the instance that deactivated the creator", async () => {
      const b = await boot();
      // The control, and the use that caches each key's grants.
      expect(await statuses(b.keys)).toEqual(every(200));

      await deactivate(b);

      expect(await statuses(b.keys)).toEqual(every(401));
    });

    it("accepts every key again once the creator is reactivated", async () => {
      const b = await boot();
      expect(await statuses(b.keys)).toEqual(every(200));

      await deactivate(b);
      expect(await statuses(b.keys)).toEqual(every(401));
      await reactivate(b);

      expect(await statuses(b.keys)).toEqual(every(200));
    });

    it("refuses a key once the bound has passed after another instance deactivated its creator", async () => {
      // Another instance's write reaches this one only through the database,
      // so it is made here as a plain row update, without the local eviction
      // this process does for a change of its own.
      const b = await boot();
      const clock = testClock();
      resetSessionStandingForTests({ now: clock.now });
      expect(await statuses(b.keys)).toEqual(every(200));

      const { users } = getDialectTables(dialect);
      const db = b.t.adapter.getDrizzle() as unknown as {
        update(table: unknown): {
          set(values: Record<string, unknown>): {
            where(condition: unknown): Promise<unknown>;
          };
        };
      };
      await db
        .update(users)
        .set({ isActive: false })
        .where(eq(users.id, b.creatorId));
      clock.passTheBound();

      expect(await statuses(b.keys)).toEqual(every(401));
    });

    it("refuses the key through the Direct API's check as well", async () => {
      const b = await boot();
      const key = b.keys["role-based"];
      expect((await b.direct.access.checkApiKey({ rawKey: key })).valid).toBe(
        true
      );

      await deactivate(b);
      expect((await b.direct.access.checkApiKey({ rawKey: key })).valid).toBe(
        false
      );

      await reactivate(b);
      expect((await b.direct.access.checkApiKey({ rawKey: key })).valid).toBe(
        true
      );
    });

    it("keeps the keys working when an administrator sets the creator's password", async () => {
      // A key is a separate credential: only a deactivation stops it. The
      // control for the cases above, which a check refusing after any change
      // to the account would also pass.
      const b = await boot();
      expect(await statuses(b.keys)).toEqual(every(200));

      await b.direct.users.update({
        id: b.creatorId,
        data: { password: "N3w-Str0ng-P@ss!" },
      });

      expect(await statuses(b.keys)).toEqual(every(200));
    });
  }
);
