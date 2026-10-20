/**
 * An API key holding exactly the grants a case names, and one REST call made
 * with it, for the release suites that judge what a narrow caller is told.
 *
 * A key's own scope is authoritative for what it may read and do, whoever
 * minted it, so a key is the plainest way to stand up a caller who may read
 * one collection and not another.
 *
 * @module domains/releases/__tests__/helpers/rest-key
 */
import { expect } from "vitest";

import type { TestNextly } from "../../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../../routeHandler";
import { ServiceContainer } from "../../../../services/index";

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
  // The system grants are seeded at a real boot, not by the test harness.
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
    return (found as { id: string }).id;
  });
}

/**
 * A key holding exactly the grants named, minted by a new active user, who
 * is the instance's super admin when it is the first. Members added through
 * the key are that user's.
 */
export async function keyHolding(
  t: TestNextly,
  slugs: string[],
  /** Who mints it, so two keys in one case are two people. */
  minter: { email: string; name: string } = {
    email: "key-owner@example.com",
    name: "Key owner",
  }
): Promise<{ key: string; ownerId: string }> {
  const nextly = t.nextly as unknown as {
    users: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
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
      email: minter.email,
      password: "Password123!",
      name: minter.name,
      isActive: true,
    },
  });
  const role = await nextly.roles.create({
    data: {
      name: `Key role ${minter.name}`,
      slug: `key-role-${minter.email.split("@")[0]}`,
      permissionIds: await grantIds(t, slugs),
    },
  });
  // The minter holds the grants too: a key may carry no more than whoever
  // mints it.
  await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(
    owner.item.id,
    role.item.id
  );
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
    name: "narrow",
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "unlimited",
  });
  return { key, ownerId: owner.item.id };
}

/** One REST call to `/api/<path>` with the key, as status and JSON body. */
export async function rest(
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
