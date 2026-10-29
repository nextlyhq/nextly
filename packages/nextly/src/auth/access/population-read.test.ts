/**
 * What population shows a key or a signed-in user, through the one decision.
 *
 * The properties that separate the reader from a plausible broken one: a key
 * is judged on its stored slug wherever that and its rows answer differently,
 * the answer reads the rules the access-control service holds now rather than
 * ones an earlier registration declared, a declared read rule is answered
 * by the service without resolving the user's grants, and a visitor is
 * refused a read rule's filter that population cannot apply and, without the
 * service, is judged by the Public role alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import { apiKeyScope } from "../authenticated-scope";

const { failingClosedSpy, throwingSpy, visitorSpy } = vi.hoisted(() => ({
  failingClosedSpy: vi.fn(),
  throwingSpy: vi.fn(),
  visitorSpy: vi.fn(),
}));

// The user's actor, each lookup that fails counted as holding nothing. The
// resolver that throws on a failed lookup throws here, so a reader that
// reached for it fails these cases.
vi.mock("./resolve-actor", async importOriginal => ({
  ...(await importOriginal<typeof import("./resolve-actor")>()),
  actorForUserFailingClosed: failingClosedSpy,
  actorForUser: throwingSpy,
  // The visitor's actor, its Public grants as each case sets them: a failed
  // read of them is a visitor holding nothing.
  actorForVisitorFailingClosed: visitorSpy,
}));

import { makePrincipal } from "../../plugins/principals/principal";

import { userActor, visitorActor } from "./actor";
import { clearDeclaredTargets, declareTarget } from "./declared-rules";
import { recordingDeviations } from "./deviations";
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

describe("a visitor, with the access-control service", () => {
  const publicReadsPosts = () =>
    visitorSpy.mockResolvedValue(
      visitorActor([{ slug: "read-posts", action: "read", resource: "posts" }])
    );

  it("is handed back a read rule's filter, which population applies to the rows", async () => {
    // Population reads only the related rows a filter matches, so the
    // visitor's answer is the filter, as a user's or a key's is: not an
    // allow of every row, and not a refusal of all of them.
    publicReadsPosts();
    const { result, deviations } = await recordingDeviations(() =>
      relatedRowReads(
        "posts",
        { principal: null },
        service({ read: () => ({ author: { equals: "u1" } }) })
      )
    );
    expect(result).toEqual({
      allowed: false,
      filter: { author: { equals: "u1" } },
    });
    expect(deviations).toEqual([]);
  });

  it("is shown the rows where the read rule answers true", async () => {
    // The control: the same Public role and rule slot, answering every entry.
    publicReadsPosts();
    await expect(
      relatedRowReads(
        "posts",
        { principal: null },
        service({ read: () => true })
      )
    ).resolves.toEqual({ allowed: true });
  });
});

describe("a visitor, without the access-control service", () => {
  it("is refused where the Public role does not hold the read, as a failed lookup leaves it", async () => {
    // Without the service no rule is read, but the Public role still decides:
    // a visitor holding nothing, which is also what a failed read of its
    // grants leaves, is not shown the rows.
    visitorSpy.mockResolvedValue(visitorActor([]));
    await expect(
      relatedRowReads("posts", { principal: null }, undefined)
    ).resolves.toEqual({ allowed: false });
  });

  it("is judged by the Public role its own database records, not the process's", async () => {
    // The process's Public role reads the posts; the database the reading
    // service holds grants nothing. The visitor is judged by the latter.
    visitorSpy.mockResolvedValue(
      visitorActor([{ slug: "read-posts", action: "read", resource: "posts" }])
    );
    const own = vi.fn(async () => visitorActor([]));
    await expect(
      relatedRowReads(
        "posts",
        { principal: null, visitorWithoutService: own },
        undefined
      )
    ).resolves.toEqual({ allowed: false });
    expect(own).toHaveBeenCalledTimes(1);
    expect(visitorSpy).not.toHaveBeenCalled();
  });

  it("is shown the rows where the Public role holds the read", async () => {
    // The control: only what Public holds differs.
    visitorSpy.mockResolvedValue(
      visitorActor([{ slug: "read-posts", action: "read", resource: "posts" }])
    );
    await expect(
      relatedRowReads("posts", { principal: null }, undefined)
    ).resolves.toEqual({ allowed: true });
  });

  it("is judged by the Public role alone, running no rule declared in the process", async () => {
    // Its direct read without the service reads no rule, so a rule the
    // process declared for the slug, perhaps for another instance, neither
    // refuses the populated row nor runs.
    const rule = vi.fn(() => false);
    declareTarget({
      kind: "collection",
      slug: "posts",
      access: { read: rule },
    });
    visitorSpy.mockResolvedValue(
      visitorActor([{ slug: "read-posts", action: "read", resource: "posts" }])
    );
    await expect(
      relatedRowReads("posts", { principal: null }, undefined)
    ).resolves.toEqual({ allowed: true });
    expect(rule).not.toHaveBeenCalled();
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
    checkAccessApplyingFilter.mockResolvedValue({ allowed: true });

    await expect(
      relatedRowReads(
        "posts",
        {
          user: { id: "u1", roles: ["super-admin"] },
          principal: makePrincipal("members:member", "m1", {}),
        },
        service({ read: false })
      )
    ).resolves.toEqual({ allowed: false });
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
    ).resolves.toEqual({ allowed: false });
  });

  it("is shown the rows once they hold the role", async () => {
    // The control: the same caller, holding super-admin by lookup, reads, so
    // the refusal above is the lookup's answer to the name they carry.
    failingClosedSpy.mockResolvedValue(
      userActor({ userId: "u1", roles: ["super-admin"], permissions: [] })
    );

    await expect(
      relatedRowReads("posts", { user: named, principal: null }, service())
    ).resolves.toEqual({ allowed: true });
  });
});
