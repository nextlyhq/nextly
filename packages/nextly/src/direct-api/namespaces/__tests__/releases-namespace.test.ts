/**
 * That `nextly.releases.*` honours the INSTANCE's access configuration.
 *
 * An instance built with `getNextly({ overrideAccess: false, user })` is asking
 * for every operation on it to be checked. A namespace that defaulted to `true`
 * on its own bypasses that in silence — which is the one failure where a caller
 * has explicitly asked for enforcement and been given none, and no error appears
 * anywhere to say so.
 *
 * Asserted on what the SERVICE was handed, because that is what decides whether
 * the checks run. A test that only asserted the call succeeded would pass
 * against the bypass.
 *
 * @module direct-api/namespaces/__tests__/releases-namespace.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createReleasesNamespace } from "../releases";
import type { NextlyContext } from "../context";

const service = {
  find: vi.fn(async () => []),
  create: vi.fn(async () => ({ id: "r1" })),
  addMember: vi.fn(async () => ({ id: "m1" })),
};

vi.mock("../../../di/container", () => ({
  container: { has: () => true, get: () => service },
}));

/** An instance configured the way the docblock's example configures one. */
function instance(defaultConfig: Record<string, unknown>): NextlyContext {
  return { defaultConfig } as unknown as NextlyContext;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("releases namespace access defaults", () => {
  it("enforces when the INSTANCE asked for enforcement", async () => {
    const releases = createReleasesNamespace(
      instance({ overrideAccess: false, user: { id: "u1" } })
    );
    await releases.find();
    expect(service.find).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: "u1", overrideAccess: false })
    );
  });

  it("stays trusted when the instance says nothing", async () => {
    // The control on the case above: the default is still trusted, so the fix
    // cannot be "always enforce", which would break every in-process caller.
    const releases = createReleasesNamespace(instance({}));
    await releases.find();
    expect(service.find).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: null, overrideAccess: true })
    );
  });

  it("lets one call override the instance, not the reverse", async () => {
    // Per-call config wins, matching `mergeConfig` and every other namespace, so
    // a single call can act as someone without reconfiguring the instance.
    const releases = createReleasesNamespace(
      instance({ overrideAccess: false, user: { id: "u1" } })
    );
    await releases.create({ title: "Launch", userId: "u2" });
    expect(service.create).toHaveBeenCalledWith(
      { title: "Launch", description: undefined },
      expect.objectContaining({ userId: "u2", overrideAccess: false })
    );
  });

  it("carries the instance identity into a member add", async () => {
    // addMember is the operation where a missing identity is worst: the member
    // records its author, and an authorless one can never materialise.
    const releases = createReleasesNamespace(
      instance({ overrideAccess: false, user: { id: "u1" } })
    );
    await releases.addMember({
      releaseId: "r1",
      scopeKind: "collection",
      scopeSlug: "posts",
      entryId: "e1",
      locale: null,
      action: "publish",
    });
    expect(service.addMember).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ scopeSlug: "posts" }),
      expect.objectContaining({ userId: "u1", overrideAccess: false })
    );
  });
});

describe("releases namespace identity", () => {
  it("keeps an EXPLICIT null as anonymous, rather than falling back to the instance user", async () => {
    // A route that turns an absent session into `userId: null` is saying "act as
    // nobody". Treating that as "not supplied" hands it the instance's
    // configured user and, with it, that person's release permissions — the
    // caller asked to be refused and would be authorized instead.
    const releases = createReleasesNamespace(
      instance({ overrideAccess: false, user: { id: "u1" } })
    );
    await releases.find({ userId: null });
    expect(service.find).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: null, overrideAccess: false })
    );
  });

  it("still falls back to the instance user when userId is OMITTED", async () => {
    // The control: omitted and present-but-null are different questions, and a
    // fix answering both as "anonymous" would break every configured instance
    // while passing the case above.
    const releases = createReleasesNamespace(
      instance({ overrideAccess: false, user: { id: "u1" } })
    );
    await releases.find();
    expect(service.find).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: "u1" })
    );
  });

  it("forwards a scoped API key's own grants", async () => {
    // Release authority must resolve from the KEY, not its owner: otherwise a
    // restricted key inherits authority it was never granted, and a key granted
    // release authority is denied when its owner lacks it.
    const scope = {
      actorType: "apiKey",
      permissions: ["read-content-releases"],
    };
    const releases = createReleasesNamespace(
      instance({ overrideAccess: false, user: { id: "u1" }, actor: scope })
    );
    await releases.find();
    expect(service.find).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ authenticatedScope: scope })
    );
  });
});

describe("releases namespace credential lifetime", () => {
  it("does not carry the instance's key scope onto an overridden identity", async () => {
    // The instance's key authorizes the instance's user. A call that names
    // somebody else — or nobody — must not keep it: `authorize` checks the key
    // scope BEFORE the anonymous guard, so an inherited scope authorizes
    // `userId: null` outright.
    const releases = createReleasesNamespace(
      instance({
        overrideAccess: false,
        user: { id: "u1", roles: ["editor"] },
        actor: { actorType: "apiKey", permissions: ["read-content-releases"] },
      })
    );
    await releases.find({ userId: null });
    expect(service.find).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        userId: null,
        authenticatedScope: undefined,
        userRoles: undefined,
      })
    );
  });

  it("keeps the instance's credentials when the identity is NOT overridden", async () => {
    // The control: clearing them unconditionally would strip the scope from
    // every ordinary call on a key-configured instance and pass the case above.
    const scope = {
      actorType: "apiKey",
      permissions: ["read-content-releases"],
    };
    const releases = createReleasesNamespace(
      instance({
        overrideAccess: false,
        user: { id: "u1", roles: ["editor"] },
        actor: scope,
      })
    );
    await releases.find();
    expect(service.find).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        userId: "u1",
        authenticatedScope: scope,
        userRoles: ["editor"],
      })
    );
  });

  it("lets a transport supply the scope for the identity it is serving", async () => {
    // A REST request resolves the key for the request it is handling; that wins
    // over anything the instance was built with.
    const requestScope = {
      actorType: "apiKey" as const,
      permissions: ["publish-content-releases"],
    };
    const releases = createReleasesNamespace(
      instance({
        overrideAccess: false,
        actor: { actorType: "apiKey", permissions: ["read-content-releases"] },
      })
    );
    await releases.find({ userId: "u2", authenticatedScope: requestScope });
    expect(service.find).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        userId: "u2",
        authenticatedScope: requestScope,
      })
    );
  });
});
