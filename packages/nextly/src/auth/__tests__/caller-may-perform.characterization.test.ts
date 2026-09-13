/**
 * What `callerMayPerform` answers for a READ of an entity, for every kind of
 * caller, as it behaves today.
 *
 * It is one of several functions that each decide "may this caller read this
 * entity", and the only one no test named directly: its read decision was
 * reached only through `PluginRouteCaller.can()`. These cases pin each cell so
 * that folding it into a shared read decision cannot change an answer unseen.
 *
 * The RBAC service is a stub that says yes to everything a session asks. A
 * scoped API key is judged on its own grant and the entity's code rule, never
 * on that service, so an implementation that consulted the owner's authority
 * would answer `true` where these expect `false`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectionAccessControl } from "../../shared/types/access";
import { apiKeyScope } from "../authenticated-scope";

const rbac = vi.hoisted(() => ({
  registered: undefined as { read?: unknown } | undefined,
  available: true,
  checkAccess: vi.fn(async () => true),
}));

vi.mock("../code-access", async importOriginal => {
  const actual = await importOriginal<typeof import("../code-access")>();
  return {
    ...actual,
    getRBACService: () =>
      rbac.available
        ? {
            getRegisteredAccess: () => rbac.registered,
            checkAccess: rbac.checkAccess,
          }
        : undefined,
  };
});

const { callerMayPerform } = await import("../authenticated-scope");

const OWNER = { id: "owner-1", roles: [] as string[] };
const SUPER_ADMIN_OWNER = { id: "root-1", roles: ["super-admin"] };

/** A scoped key holding exactly these grants on `posts`. */
function keyHolding(...actions: string[]) {
  return apiKeyScope(
    actions.map(action => ({
      slug: `${action}-posts`,
      action,
      resource: "posts",
    }))
  );
}

function rule(read: CollectionAccessControl["read"]): void {
  rbac.registered = { read };
}

beforeEach(() => {
  rbac.registered = undefined;
  rbac.available = true;
  rbac.checkAccess.mockClear();
  rbac.checkAccess.mockResolvedValue(true);
});

describe("callerMayPerform(read) — a caller with no identity", () => {
  it("refuses, and asks nothing", async () => {
    expect(await callerMayPerform(undefined, "read", "posts", { id: "" })).toBe(
      false
    );
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });
});

describe("callerMayPerform(read) — a session caller", () => {
  it("answers exactly what the RBAC service answers", async () => {
    expect(await callerMayPerform(undefined, "read", "posts", OWNER)).toBe(
      true
    );
    rbac.checkAccess.mockResolvedValue(false);
    expect(await callerMayPerform(undefined, "read", "posts", OWNER)).toBe(
      false
    );
    expect(rbac.checkAccess).toHaveBeenCalledWith({
      userId: "owner-1",
      operation: "read",
      resource: "posts",
    });
  });
});

describe("callerMayPerform(read) — a scoped API key", () => {
  it("refuses a key without the read grant, however the service answers", async () => {
    rule(true);
    expect(
      await callerMayPerform(keyHolding("create"), "read", "posts", OWNER)
    ).toBe(false);
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("admits a key holding the grant when the entity declares no read rule", async () => {
    expect(
      await callerMayPerform(keyHolding("read"), "read", "posts", OWNER)
    ).toBe(true);
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("holds a key with the grant to the entity's rule in each form", async () => {
    const key = keyHolding("read");

    rule(true);
    expect(await callerMayPerform(key, "read", "posts", OWNER)).toBe(true);
    rule(false);
    expect(await callerMayPerform(key, "read", "posts", OWNER)).toBe(false);
    rule(() => true);
    expect(await callerMayPerform(key, "read", "posts", OWNER)).toBe(true);
    rule(() => false);
    expect(await callerMayPerform(key, "read", "posts", OWNER)).toBe(false);
    rule(() => {
      throw new Error("rule failed");
    });
    expect(await callerMayPerform(key, "read", "posts", OWNER)).toBe(false);
  });

  it("gives a key owned by a super-admin no bypass", async () => {
    // Same answer as any key without the grant: the owner's role is not read.
    expect(
      await callerMayPerform(
        keyHolding("create"),
        "read",
        "posts",
        SUPER_ADMIN_OWNER
      )
    ).toBe(false);
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });
});

describe("callerMayPerform(read) — no RBAC service registered", () => {
  it("refuses a session caller", async () => {
    rbac.available = false;
    expect(await callerMayPerform(undefined, "read", "posts", OWNER)).toBe(
      false
    );
  });

  it("admits a key holding the grant, because no rule can be read", async () => {
    // With no service there is nowhere to look a rule up, so the grant alone
    // decides. Pinned as the current answer so that changing it is a visible
    // decision rather than a side effect.
    rbac.available = false;
    rbac.registered = { read: false };
    expect(
      await callerMayPerform(keyHolding("read"), "read", "posts", OWNER)
    ).toBe(true);
  });
});
