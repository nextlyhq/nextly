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

const checkAccess = vi.fn();

/** A service registering `access` for `posts`, or nothing. */
const service = (access?: Record<string, unknown>): RBACAccessControlService =>
  ({
    getRegisteredTarget: (slug: string) =>
      access && slug === "posts"
        ? { kind: "collection", slug, access }
        : undefined,
    checkAccess,
    checkAnonymousCodeAccess: vi.fn(),
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
    ).resolves.toBe(true);
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
    ).resolves.toBe(false);
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
    ).resolves.toBe(true);
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
    ).resolves.toBe(true);
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
    ).resolves.toBe(true);
  });

  it("is handed a declared rule's answer without their grants being read", async () => {
    // The service judges a declared rule, super-admin first, as before; the
    // user's full roles and grants are not needed for that answer, so a
    // lookup that cannot read them does not fail it.
    failingClosedSpy.mockRejectedValue(new Error("grants unreadable"));
    checkAccess.mockResolvedValue(true);

    await expect(
      relatedRowReads(
        "posts",
        { user: { id: "u1" }, principal: null },
        service({ read: true })
      )
    ).resolves.toBe(true);
    expect(failingClosedSpy).not.toHaveBeenCalled();
  });
});

describe("a plugin's signed-in person", () => {
  it("is judged as the person, not as a user the read also names", async () => {
    // The user's path would hand back the service's answer for the rule,
    // `true` here; the person is judged by the rule itself, which refuses.
    checkAccess.mockResolvedValue(true);

    await expect(
      relatedRowReads(
        "posts",
        {
          user: { id: "u1" },
          principal: makePrincipal("members:member", "m1", {}),
        },
        service({ read: false })
      )
    ).resolves.toBe(false);
    expect(checkAccess).not.toHaveBeenCalled();
  });
});
