/**
 * What population shows a key or a signed-in user, through the one decision.
 *
 * The properties that separate the reader from a plausible broken one: a key
 * is judged on its stored slug wherever that and its rows answer differently,
 * the answer reads the rules the access-control service holds now rather than
 * ones an earlier registration declared, and a declared read rule is answered
 * by the service without resolving the user's grants.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import { apiKeyScope } from "../authenticated-scope";

const { failingClosedSpy, throwingSpy } = vi.hoisted(() => ({
  failingClosedSpy: vi.fn(),
  throwingSpy: vi.fn(),
}));

// The user's actor, each lookup that fails counted as holding nothing. The
// resolver that throws on a failed lookup throws here, so a reader that
// reached for it fails these cases.
vi.mock("./resolve-actor", async importOriginal => ({
  ...(await importOriginal<typeof import("./resolve-actor")>()),
  actorForUserFailingClosed: failingClosedSpy,
  actorForUser: throwingSpy,
}));

import { makePrincipal } from "../../plugins/principals/principal";

import { userActor } from "./actor";
import { clearDeclaredTargets, declareTarget } from "./declared-rules";
import { relatedRowReads } from "./population-read";

const checkAccessApplyingFilter = vi.fn();

/** A service registering `access` for `posts`, or nothing. */
const service = (access?: Record<string, unknown>): RBACAccessControlService =>
  ({
    getRegisteredTarget: (slug: string) =>
      access && slug === "posts"
        ? { kind: "collection", slug, access }
        : undefined,
    checkAccessApplyingFilter,
    checkAnonymousCodeAccessApplyingFilter: vi.fn(),
  }) as unknown as RBACAccessControlService;

const owner = { id: "owner-1", roles: ["editor"] };

const reader = userActor({
  userId: "u1",
  roles: ["editor"],
  permissions: [{ slug: "read-posts", action: "read", resource: "posts" }],
});

beforeEach(() => {
  vi.clearAllMocks();
  throwingSpy.mockRejectedValue(new Error("roles unreadable"));
  failingClosedSpy.mockResolvedValue(reader);
});

afterEach(() => {
  clearDeclaredTargets();
});

describe("an API key", () => {
  it("is shown the rows its stored slug reads", async () => {
    const scope = apiKeyScope(
      [{ slug: "read-posts", action: "read", resource: "posts" }],
      ["editor"]
    );

    await expect(
      relatedRowReads(
        "posts",
        { user: owner, scope, principal: null },
        service()
      )
    ).resolves.toEqual({ allowed: true });
  });

  it("is refused where its row holds the read under a slug of its own", async () => {
    // Judged on its stored slug as before: `read-posts` is not in the scope,
    // though the row's action and resource name the read.
    const scope = apiKeyScope(
      [{ slug: "view-posts", action: "read", resource: "posts" }],
      ["editor"]
    );

    await expect(
      relatedRowReads(
        "posts",
        { user: owner, scope, principal: null },
        service()
      )
    ).resolves.toEqual({ allowed: false });
  });

  it("is judged by the rules registered now, not ones declared before", async () => {
    declareTarget({
      kind: "collection",
      slug: "posts",
      access: { read: false },
    });
    const scope = apiKeyScope(
      [{ slug: "read-posts", action: "read", resource: "posts" }],
      ["editor"]
    );

    await expect(
      relatedRowReads(
        "posts",
        { user: owner, scope, principal: null },
        service()
      )
    ).resolves.toEqual({ allowed: true });
  });
});

describe("a signed-in user", () => {
  it("is shown the rows their grants read, refusing rather than failing a lookup", async () => {
    await expect(
      relatedRowReads(
        "posts",
        { user: { id: "u1" }, principal: null },
        service()
      )
    ).resolves.toEqual({ allowed: true });
    expect(failingClosedSpy).toHaveBeenCalledWith("u1");
  });

  it("is judged by the rules registered now, not ones declared before", async () => {
    declareTarget({
      kind: "collection",
      slug: "posts",
      access: { read: false },
    });

    await expect(
      relatedRowReads(
        "posts",
        { user: { id: "u1" }, principal: null },
        service()
      )
    ).resolves.toEqual({ allowed: true });
  });

  it("is handed a declared rule's answer without their grants being read", async () => {
    // The service judges a declared rule, super-admin first, as before; the
    // user's full roles and grants are not needed for that answer, so a
    // lookup that cannot read them does not fail it.
    failingClosedSpy.mockRejectedValue(new Error("grants unreadable"));
    checkAccessApplyingFilter.mockResolvedValue({ allowed: true });

    await expect(
      relatedRowReads(
        "posts",
        { user: { id: "u1" }, principal: null },
        service({ read: true })
      )
    ).resolves.toEqual({ allowed: true });
    expect(failingClosedSpy).not.toHaveBeenCalled();
  });

  it("is handed the filter a declared read rule answers, to apply", async () => {
    // Population applies a read rule's filter, so the service's filter comes
    // back as the answer rather than as a refusal.
    const filter = { team: { equals: "public" } };
    checkAccessApplyingFilter.mockResolvedValue({ allowed: false, filter });

    await expect(
      relatedRowReads(
        "posts",
        { user: { id: "u1" }, principal: null },
        service({ read: () => filter })
      )
    ).resolves.toEqual({ allowed: false, filter });
  });
});

describe("a plugin's signed-in person", () => {
  it("is judged as the person, not as a user the read also names", async () => {
    // The user's path would hand back the service's answer for the rule,
    // `true` here; the person is judged by the rule itself, which refuses.
    checkAccessApplyingFilter.mockResolvedValue({ allowed: true });

    await expect(
      relatedRowReads(
        "posts",
        {
          user: { id: "u1" },
          principal: makePrincipal("members:member", "m1", {}),
        },
        service({ read: false })
      )
    ).resolves.toEqual({ allowed: false });
    expect(checkAccessApplyingFilter).not.toHaveBeenCalled();
  });

  it("is judged as the person even where the user the read names is called super-admin", async () => {
    checkAccess.mockResolvedValue(true);

    await expect(
      relatedRowReads(
        "posts",
        {
          user: { id: "u1", roles: ["super-admin"] },
          principal: makePrincipal("members:member", "m1", {}),
        },
        service({ read: false })
      )
    ).resolves.toBe(false);
  });
});

describe("a user handed in naming the super-admin role", () => {
  const named = { id: "u1", role: "super-admin", roles: ["super-admin"] };

  it("is refused where they hold neither the role nor the read", async () => {
    failingClosedSpy.mockResolvedValue(
      userActor({ userId: "u1", roles: ["editor"], permissions: [] })
    );

    await expect(
      relatedRowReads("posts", { user: named, principal: null }, service())
    ).resolves.toBe(false);
  });

  it("is shown the rows once they hold the role", async () => {
    // The control: the same caller, holding super-admin by lookup, reads, so
    // the refusal above is the lookup's answer to the name they carry.
    failingClosedSpy.mockResolvedValue(
      userActor({ userId: "u1", roles: ["super-admin"], permissions: [] })
    );

    await expect(
      relatedRowReads("posts", { user: named, principal: null }, service())
    ).resolves.toBe(true);
  });
});
