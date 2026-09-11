/**
 * The read decision shared by the route middleware and anything deciding after
 * dispatch. Each case here is a way an earlier reimplementation of this rule
 * was more permissive than the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { hasSpy, checkAccessSpy, registeredAccessSpy } = vi.hoisted(() => ({
  hasSpy: vi.fn(),
  checkAccessSpy: vi.fn(),
  registeredAccessSpy: vi.fn(),
}));

vi.mock("../../di/container", () => ({
  container: {
    has: hasSpy,
    get: () => ({
      checkAccess: checkAccessSpy,
      getRegisteredAccess: registeredAccessSpy,
    }),
  },
}));

import { apiKeyScope } from "../authenticated-scope";
import {
  canReadEntity,
  readAccessCaller,
  readableEntities,
  type ReadAccessCaller,
} from "../entity-read-access";

/**
 * A key caller holding `permissions` in the stored spelling, with the rule
 * spelling derived beside it the way `readAccessCaller` derives it.
 */
const apiKey = (permissions: string[]): ReadAccessCaller => ({
  userId: "owner-1",
  authMethod: "api-key",
  permissions,
  rulePermissions: permissions.map(slug => {
    const [action, ...resource] = slug.split("-");
    return `${resource.join("-")}:${action}`;
  }),
  roles: ["editor"],
});

const session: ReadAccessCaller = {
  userId: "u1",
  authMethod: "session",
  permissions: [],
  rulePermissions: [],
  roles: ["editor"],
};

describe("canReadEntity — API key callers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSpy.mockReturnValue(true);
    registeredAccessSpy.mockReturnValue(undefined);
    checkAccessSpy.mockResolvedValue(true);
  });

  it("allows a key scoped to read the entity", async () => {
    await expect(canReadEntity("posts", apiKey(["read-posts"]))).resolves.toBe(
      true
    );
  });

  it("denies a key not scoped to read it", async () => {
    await expect(
      canReadEntity("posts", apiKey(["update-posts"]))
    ).resolves.toBe(false);
  });

  it("judges the key, not the account that issued it", async () => {
    // The owner's stored grants are irrelevant on this path. Resolving them
    // instead is what let a write-only key inherit its owner's read access.
    await expect(canReadEntity("posts", apiKey([]))).resolves.toBe(false);
    expect(checkAccessSpy).not.toHaveBeenCalled();
  });

  it("does not let a super-admin owner widen a key's scope", async () => {
    // `checkAccess` bypasses everything for a super admin, which is correct for
    // a session and wrong for a key: a read-only key issued by an administrator
    // would otherwise carry their whole account.
    checkAccessSpy.mockResolvedValue(true);

    await expect(
      canReadEntity("posts", apiKey(["update-posts"]))
    ).resolves.toBe(false);
    expect(checkAccessSpy).not.toHaveBeenCalled();
  });

  it("does not accept another entity's scope", async () => {
    await expect(canReadEntity("posts", apiKey(["read-pages"]))).resolves.toBe(
      false
    );
  });

  it("honours a code-defined rule that denies", async () => {
    registeredAccessSpy.mockReturnValue({ read: false });

    await expect(canReadEntity("posts", apiKey(["read-posts"]))).resolves.toBe(
      false
    );
  });

  it("evaluates a code-defined function against the key's own scope", async () => {
    const read = vi.fn().mockResolvedValue(true);
    registeredAccessSpy.mockReturnValue({ read });

    await expect(canReadEntity("posts", apiKey(["read-posts"]))).resolves.toBe(
      true
    );
    // The RULE spelling, not the stored slug the coarse check compared. A rule
    // written `permissions.includes("posts:read")` — the documented form — was
    // handed `read-posts` here and denied every key.
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: ["posts:read"],
        roles: ["editor"],
        operation: "read",
        collection: "posts",
      })
    );
  });

  it("denies when a code-defined rule throws", async () => {
    // A broken rule must not read as permission.
    registeredAccessSpy.mockReturnValue({
      read: () => {
        throw new Error("boom");
      },
    });

    await expect(canReadEntity("posts", apiKey(["read-posts"]))).resolves.toBe(
      false
    );
  });

  it("allows when the rule says nothing about reading", async () => {
    // An absent rule does not revoke what the scope already granted.
    registeredAccessSpy.mockReturnValue({ update: false });

    await expect(canReadEntity("posts", apiKey(["read-posts"]))).resolves.toBe(
      true
    );
  });
});

describe("readAccessCaller", () => {
  it("derives the rule spelling from the key's grants by the canonical conversion", () => {
    // One scope, both spellings: the stored slugs for coarse checks and the
    // `resource:action` form for rules, from the same rows. A caller that
    // copied the stored list into both would answer a rule's predicate
    // differently here than the direct api-key gate does.
    const scope = apiKeyScope(
      [
        { slug: "read-posts", action: "read", resource: "posts" },
        { slug: "update-posts", action: "update", resource: "posts" },
      ],
      ["editor"]
    );
    const caller = readAccessCaller({
      user: { id: "owner-1", roles: ["editor"] },
      authenticatedScope: scope,
    });

    expect(caller.authMethod).toBe("api-key");
    expect(caller.permissions).toEqual(["read-posts", "update-posts"]);
    expect(caller.rulePermissions).toEqual(["posts:read", "posts:update"]);
  });

  it("gives a session caller no grants in either spelling", () => {
    const caller = readAccessCaller({ user: { id: "u1", roles: ["editor"] } });
    expect(caller.authMethod).toBe("session");
    expect(caller.permissions).toEqual([]);
    expect(caller.rulePermissions).toBeUndefined();
  });
});

describe("canReadEntity — session callers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSpy.mockReturnValue(true);
    registeredAccessSpy.mockReturnValue(undefined);
  });

  it("defers to the RBAC decision", async () => {
    checkAccessSpy.mockResolvedValue(true);

    await expect(canReadEntity("posts", session)).resolves.toBe(true);
    expect(checkAccessSpy).toHaveBeenCalledWith({
      userId: "u1",
      operation: "read",
      resource: "posts",
    });
  });

  it("denies when RBAC denies", async () => {
    checkAccessSpy.mockResolvedValue(false);

    await expect(canReadEntity("posts", session)).resolves.toBe(false);
  });
});

describe("canReadEntity — degenerate input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSpy.mockReturnValue(true);
    checkAccessSpy.mockResolvedValue(true);
    registeredAccessSpy.mockReturnValue(undefined);
  });

  it("denies a caller with no id", async () => {
    await expect(
      canReadEntity("posts", { ...session, userId: "" })
    ).resolves.toBe(false);
  });

  it("denies an empty slug", async () => {
    await expect(canReadEntity("", session)).resolves.toBe(false);
  });

  it("denies when the container is not initialized", async () => {
    // Nothing to decide against yet, so the safe direction is refusal.
    hasSpy.mockReturnValue(false);

    await expect(canReadEntity("posts", session)).resolves.toBe(false);
  });
});

describe("readableEntities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSpy.mockReturnValue(true);
    registeredAccessSpy.mockReturnValue(undefined);
    checkAccessSpy.mockResolvedValue(true);
  });

  it("denies only the slug whose check THREW, not the whole set", async () => {
    // 🔴 A single rejected decision used to reject the whole calculation, so one
    // unreachable RBAC lookup turned every surface built on this -- the
    // dashboard's readable resources, the widget layout, the workspace payload
    // -- into an error rather than a narrower answer. A check that threw has
    // told us nothing, and "nothing" must not read as "allowed" either.
    checkAccessSpy.mockImplementation(({ resource }: { resource: string }) =>
      resource === "broken"
        ? Promise.reject(new Error("rbac unreachable"))
        : Promise.resolve(true)
    );

    const allowed = await readableEntities(
      ["posts", "broken", "pages"],
      session
    );

    expect([...allowed].sort()).toEqual(["pages", "posts"]);
  });

  it("asks about each slug ONCE however often it is named", async () => {
    // A permission decision resolves a session caller through a per-user TTL
    // cache, so a repeat is a second database read for an answer in hand -- and
    // a dashboard offering two cards per collection names each one twice.
    await readableEntities(["posts", "posts", "posts"], session);

    expect(checkAccessSpy).toHaveBeenCalledTimes(1);
  });

  it("still returns what the caller may read", async () => {
    // The control: without it both assertions above are satisfied by a function
    // that returns the empty set.
    const allowed = await readableEntities(["posts", "pages"], session);
    expect([...allowed].sort()).toEqual(["pages", "posts"]);
  });
});
