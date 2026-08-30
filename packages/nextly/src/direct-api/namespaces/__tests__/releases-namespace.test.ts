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
      { userId: "u1", overrideAccess: false }
    );
  });

  it("stays trusted when the instance says nothing", async () => {
    // The control on the case above: the default is still trusted, so the fix
    // cannot be "always enforce", which would break every in-process caller.
    const releases = createReleasesNamespace(instance({}));
    await releases.find();
    expect(service.find).toHaveBeenCalledWith(
      {},
      { userId: null, overrideAccess: true }
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
      { userId: "u2", overrideAccess: false }
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
      { userId: "u1", overrideAccess: false }
    );
  });
});
