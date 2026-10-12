/**
 * The custom-field claims a session is built from, whatever the user's
 * `user_ext` row holds.
 *
 * A custom field such as a tenant id reaches `custom` access rules as the
 * caller's identity, so the claim carries only what was read: no claim where
 * no value could be — rather than a null, which a rule compares as a value —
 * and never one a plugin's `customizeClaims` hook supplied under the field's
 * name. Each case runs the real read and the registry the bridge builds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserExtSchemaService } from "../../../domains/users/services/user-ext-schema-service";
import type { AuthUser, AuthUserId } from "../../../types/auth";
import type { UserFieldConfig } from "../../../users/config/types";
import { buildClaims } from "../../jwt/claims";
import { buildAuthRouterDeps } from "../deps-bridge";

const config = {
  users: {
    fields: [
      { name: "tenantId", label: "Tenant", type: "text" },
    ] as unknown as UserFieldConfig[],
  },
};

vi.mock("../../../di/container", () => ({
  container: {
    has: (name: string) => name === "config" || name === "userExtSchemaService",
    get: () => config,
  },
}));

// The `user_ext` read, answered per test: no row, a row, or a failure.
const limit = vi.fn<() => Promise<Record<string, unknown>[]>>();
const db = {
  select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
};

const userExtSchemaService = new UserExtSchemaService("sqlite");
vi.spyOn(userExtSchemaService, "hasMergedFields").mockReturnValue(true);

const services: Record<string, unknown> = {
  adapter: { getDrizzle: () => db },
  userExtSchemaService,
  config,
};
// Every other service is an empty stand-in: building the deps constructs a
// plugin context over them, and nothing here calls into it.
const deps = buildAuthRouterDeps(name => services[name] ?? {});
// A plugin claiming a tenant for every session.
deps.authHooks.add({ customizeClaims: c => ({ ...c, tenantId: "t-hook" }) });

const user = {
  id: "u1" as AuthUserId,
  email: "a@example.com",
  name: "A",
  image: null,
} as AuthUser;

/** The claims a session gets, after `hooks` (by default, one claiming a tenant). */
async function sessionClaims(
  hooks = deps.authHooks
): Promise<Record<string, unknown>> {
  const claims = buildClaims({
    userId: user.id,
    email: user.email,
    name: user.name ?? "",
    image: null,
    roleIds: [],
    customFields: await deps.fetchCustomFields(user.id),
  });
  return hooks.runCustomizeClaims(claims, user, {} as never);
}

beforeEach(() => {
  limit.mockReset();
});

describe("a configured custom field the user has no value for", () => {
  it("is absent, not null or the hook's, when the user has no user_ext row", async () => {
    limit.mockResolvedValue([]);

    const claims = await sessionClaims();

    expect(claims).not.toHaveProperty("tenantId");
  });

  it("is absent, not null or the hook's, when the row cannot be read", async () => {
    limit.mockRejectedValue(new Error("no such table: user_ext"));

    const claims = await sessionClaims();

    expect(claims).not.toHaveProperty("tenantId");
  });

  it("is absent, not null or the hook's, before the merged fields have loaded", async () => {
    vi.mocked(userExtSchemaService.hasMergedFields).mockReturnValueOnce(false);

    const claims = await sessionClaims();

    expect(claims).not.toHaveProperty("tenantId");
    expect(limit).not.toHaveBeenCalled();
  });

  it("is null when the row holds no value for it", async () => {
    // A row that exists with the column unset is a value the read did see.
    limit.mockResolvedValue([{ id: "x1", user_id: "u1", tenantId: null }]);

    const claims = await sessionClaims();

    expect(claims).toHaveProperty("tenantId", null);
  });

  it("carries the stored value when the row has one", async () => {
    // The control: dropping the field everywhere would satisfy the cases
    // above while losing the value a real row holds.
    limit.mockResolvedValue([{ id: "x1", user_id: "u1", tenantId: "t-row" }]);

    const claims = await sessionClaims();

    expect(claims).toHaveProperty("tenantId", "t-row");
  });
});

describe("a claim no configured field names", () => {
  it("is still one a hook may add", async () => {
    // Reserving the configured names must not reserve every name.
    limit.mockResolvedValue([]);
    const hooks = buildAuthRouterDeps(name => services[name] ?? {}).authHooks;
    hooks.add({ customizeClaims: c => ({ ...c, plan: "pro" }) });

    const claims = await sessionClaims(hooks);

    expect(claims).toHaveProperty("plan", "pro");
  });
});
