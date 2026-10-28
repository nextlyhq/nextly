/**
 * The read decision shared by the route middleware and anything deciding after
 * dispatch. Each case here is a way an earlier reimplementation of this rule
 * was more permissive than the original.
 */
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";

const {
  hasSpy,
  checkAccessSpy,
  registeredAccessSpy,
  actorForUserSpy,
  throwingActorSpy,
} = vi.hoisted(() => ({
  hasSpy: vi.fn(),
  checkAccessSpy: vi.fn(),
  registeredAccessSpy: vi.fn(),
  actorForUserSpy: vi.fn(),
  throwingActorSpy: vi.fn(),
}));

// A signed-in user's actor: their roles and grants, each lookup that fails
// counted as holding nothing. Mocked so each case names the grants the
// decision reads. The resolver that throws on a failed lookup answers by
// throwing, so a reader that reached for it fails these cases.
vi.mock("../access/resolve-actor", async importOriginal => ({
  ...(await importOriginal<typeof import("../access/resolve-actor")>()),
  actorForUserFailingClosed: actorForUserSpy,
  actorForUser: throwingActorSpy,
}));

vi.mock("../../di/container", () => ({
  container: {
    has: hasSpy,
    get: () => ({
      checkAccessApplyingFilter: checkAccessSpy,
      getRegisteredAccess: registeredAccessSpy,
      // The registered target, built from what the spy registers, as the
      // service derives one from the other.
      getRegisteredTarget: (slug: string) => {
        const access: unknown = registeredAccessSpy(slug);
        return access ? { kind: "collection", slug, access } : undefined;
      },
    }),
  },
}));

import { userActor } from "../access/actor";
import { clearDeclaredTargets, declareTarget } from "../access/declared-rules";
import {
  JUDGED_OTHERWISE,
  routeVerdictFor,
  runWithAccessMemo,
} from "../access/request-memo";
import { currentRuleLanguage } from "../access/rule-language";
import { apiKeyScope } from "../authenticated-scope";
import {
  authorizationScheduler,
  canReadEntity,
  readAccessCaller,
  readableEntities,
  type ReadAccessCaller,
} from "../entity-read-access";

/**
 * A key caller holding `permissions` in the stored spelling, with the rows
 * behind them the way `readAccessCaller` carries them.
 */
const apiKey = (permissions: string[]): ReadAccessCaller => ({
  userId: "owner-1",
  authMethod: "api-key",
  permissions,
  grants: permissions.map(slug => {
    const [action, ...resource] = slug.split("-");
    return { slug, action, resource: resource.join("-") };
  }),
  roles: ["editor"],
});

const session: ReadAccessCaller = {
  userId: "u1",
  authMethod: "session",
  permissions: [],
  roles: ["editor"],
};

/** The session user's actor, holding `read` on each of `slugs`. */
const readerOf = (...slugs: string[]) =>
  userActor({
    userId: "u1",
    roles: ["editor"],
    permissions: slugs.map(slug => ({
      slug: `read-${slug}`,
      action: "read",
      resource: slug,
    })),
  });

beforeEach(() => {
  throwingActorSpy.mockRejectedValue(new Error("roles unreadable"));
});

afterEach(() => {
  clearDeclaredTargets();
});

describe("canReadEntity — API key callers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSpy.mockReturnValue(true);
    registeredAccessSpy.mockReturnValue(undefined);
    checkAccessSpy.mockResolvedValue({ allowed: true });
  });

  it("refuses a key whose row holds the read under a slug of its own", async () => {
    // Judged on its stored slug as before: `read-posts` is not in the scope,
    // though the row's action and resource name the read.
    const key: ReadAccessCaller = {
      userId: "owner-1",
      authMethod: "api-key",
      permissions: ["view-posts"],
      grants: [{ slug: "view-posts", action: "read", resource: "posts" }],
      roles: ["editor"],
    };

    await expect(canReadEntity("posts", key)).resolves.toBe(false);
  });

  it("answers from the rule registered now, not one declared before", async () => {
    // A rule an earlier registration declared, which the service in hand no
    // longer holds, must not refuse the key's read.
    declareTarget({
      kind: "collection",
      slug: "posts",
      access: { read: false },
    });

    await expect(canReadEntity("posts", apiKey(["read-posts"]))).resolves.toBe(
      true
    );
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
    checkAccessSpy.mockResolvedValue({ allowed: true });

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
    // The role screen's spelling, the same slug the coarse check compared,
    // and no other.
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: ["read-posts"],
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
  it("carries the key's rows beside the stored slugs they name", () => {
    // One scope: the stored slugs for coarse checks and the rows behind them,
    // from which a rule's list is built. A caller that dropped the rows would
    // hand a rule less than the direct api-key gate does.
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
    expect(caller.grants).toEqual([
      { slug: "read-posts", action: "read", resource: "posts" },
      { slug: "update-posts", action: "update", resource: "posts" },
    ]);
  });

  it("gives a session caller no grants and no rows", () => {
    const caller = readAccessCaller({ user: { id: "u1", roles: ["editor"] } });
    expect(caller.authMethod).toBe("session");
    expect(caller.permissions).toEqual([]);
    expect(caller.grants).toBeUndefined();
  });
});

describe("canReadEntity — session callers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSpy.mockReturnValue(true);
    registeredAccessSpy.mockReturnValue(undefined);
  });

  it("allows a user whose grants hold the read, through the decision", async () => {
    actorForUserSpy.mockResolvedValue(readerOf("posts"));

    await expect(canReadEntity("posts", session)).resolves.toBe(true);
    expect(actorForUserSpy).toHaveBeenCalledWith("u1");
    // With no rule declared there is nothing for the service to judge alone.
    expect(checkAccessSpy).not.toHaveBeenCalled();
  });

  it("denies a user whose grants do not hold the read", async () => {
    actorForUserSpy.mockResolvedValue(readerOf("pages"));

    await expect(canReadEntity("posts", session)).resolves.toBe(false);
  });

  it("answers from the rule registered now, not one declared before", async () => {
    actorForUserSpy.mockResolvedValue(readerOf("posts"));
    declareTarget({
      kind: "collection",
      slug: "posts",
      access: { read: false },
    });

    await expect(canReadEntity("posts", session)).resolves.toBe(true);
  });

  it("hands back a declared rule's answer without reading the user's grants", async () => {
    // The service judges a declared rule, super-admin first, as before; the
    // user's full roles and grants are not needed for that answer, so a
    // lookup that cannot read them does not fail it.
    actorForUserSpy.mockRejectedValue(new Error("grants unreadable"));
    registeredAccessSpy.mockReturnValue({ read: true });
    checkAccessSpy.mockResolvedValue({ allowed: true });

    await expect(canReadEntity("posts", session)).resolves.toBe(true);
    expect(actorForUserSpy).not.toHaveBeenCalled();
  });

  it("lets a declared read rule decide alone", async () => {
    // The service asks the rule once, whatever the grants, and its refusal
    // refuses.
    actorForUserSpy.mockResolvedValue(readerOf());
    registeredAccessSpy.mockReturnValue({ read: () => true });
    checkAccessSpy.mockResolvedValue({ allowed: false });

    await expect(canReadEntity("posts", session)).resolves.toBe(false);
    expect(checkAccessSpy).toHaveBeenCalledWith({
      userId: "u1",
      operation: "read",
      resource: "posts",
    });
  });
});

describe("canReadEntity — a declared read rule that answers a filter", () => {
  const filter = { team: { equals: "public" } };

  beforeEach(() => {
    vi.clearAllMocks();
    hasSpy.mockReturnValue(true);
    registeredAccessSpy.mockReturnValue({ read: () => filter });
    checkAccessSpy.mockResolvedValue({ allowed: false, filter });
  });

  it("answers yes inside a request, keeping the filter for the reads it lets run", async () => {
    const [answer, kept] = await runWithAccessMemo(async () => [
      await canReadEntity("posts", session),
      routeVerdictFor({
        userId: "u1",
        slug: "posts",
        action: "read",
        language: currentRuleLanguage(),
      }),
    ]);
    expect(answer).toBe(true);
    expect(kept).toEqual({ filter });
  });

  it("keeps a key's filter under the key's scope, for the read its request runs", async () => {
    const key = apiKey(["read-posts"]);
    const scopeOf = apiKeyScope(key.grants ?? [], key.roles);
    const asked = (scope?: typeof scopeOf) =>
      routeVerdictFor({
        userId: "owner-1",
        ...(scope ? { scope } : {}),
        slug: "posts",
        action: "read",
        language: currentRuleLanguage(),
      });
    const [answer, asKey, asSession] = await runWithAccessMemo(async () => [
      await canReadEntity("posts", key),
      asked(scopeOf),
      asked(),
    ]);
    expect(answer).toBe(true);
    expect(asKey).toEqual({ filter });
    // The owner's own session is another caller, and is refused the key's.
    expect(asSession).toBe(JUDGED_OTHERWISE);
  });

  it("answers no outside a request, where nothing can carry the filter", async () => {
    await expect(canReadEntity("posts", session)).resolves.toBe(false);
  });
});

describe("canReadEntity — degenerate input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSpy.mockReturnValue(true);
    checkAccessSpy.mockResolvedValue({ allowed: true });
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
    checkAccessSpy.mockResolvedValue({ allowed: true });
    actorForUserSpy.mockResolvedValue(readerOf("posts", "pages", "broken"));
  });

  it("denies only the slug whose check THREW, not the whole set", async () => {
    // 🔴 A single rejected decision used to reject the whole calculation, so one
    // unreachable RBAC lookup turned every surface built on this -- the
    // dashboard's readable resources, the widget layout, the workspace payload
    // -- into an error rather than a narrower answer. A check that threw has
    // told us nothing, and "nothing" must not read as "allowed" either.
    // `broken` declares a read rule, so the service judges it, and fails.
    registeredAccessSpy.mockImplementation((slug: string) =>
      slug === "broken" ? { read: () => true } : undefined
    );
    checkAccessSpy.mockRejectedValue(new Error("rbac unreachable"));

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

    expect(actorForUserSpy).toHaveBeenCalledTimes(1);
  });

  it("still returns what the caller may read", async () => {
    // The control: without it both assertions above are satisfied by a function
    // that returns the empty set.
    const allowed = await readableEntities(["posts", "pages"], session);
    expect([...allowed].sort()).toEqual(["pages", "posts"]);
  });
});

describe("authorizationScheduler", () => {
  /** A decision held open until the test answers it, counting how many are in flight. */
  function harness() {
    let inFlight = 0;
    let most = 0;
    const answers: Array<() => void> = [];
    const decide =
      (fail = false) =>
      () =>
        new Promise<boolean>((resolve, reject) => {
          inFlight += 1;
          most = Math.max(most, inFlight);
          answers.push(() => {
            inFlight -= 1;
            if (fail) reject(new Error("refused"));
            else resolve(true);
          });
        });
    const answerAll = () => {
      for (const answer of answers.splice(0, answers.length)) answer();
    };
    return { decide, answerAll, inFlight: () => inFlight, most: () => most };
  }

  it("runs the first decision alone, then at most the bound at once", async () => {
    const h = harness();
    const scheduled = authorizationScheduler(3);
    const decisions = Array.from({ length: 8 }, () => scheduled(h.decide()));
    // The warm-up: one decision before anything fans out.
    expect(h.inFlight()).toBe(1);
    h.answerAll();
    await vi.waitFor(() => expect(h.inFlight()).toBe(3));
    while (h.inFlight() > 0) {
      h.answerAll();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await expect(Promise.all(decisions)).resolves.toHaveLength(8);
    // 🔴 Never more than the bound, though all eight were asked at once.
    expect(h.most()).toBe(3);
  });

  it("hands each caller its own decision, a refusal reaching only the one that asked", async () => {
    const h = harness();
    const scheduled = authorizationScheduler(2);
    const refused = scheduled(h.decide(true));
    const allowed = scheduled(h.decide());
    h.answerAll();
    await expect(refused).rejects.toThrow("refused");
    await vi.waitFor(() => expect(h.inFlight()).toBe(1));
    h.answerAll();
    await expect(allowed).resolves.toBe(true);
  });

  it("refuses a bound that would never let a decision start", () => {
    expect(() => authorizationScheduler(0)).toThrow();
  });
});
