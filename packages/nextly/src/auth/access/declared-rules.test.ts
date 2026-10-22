/**
 * The rules apps declare, kept apart from the access-control service, so the
 * decision reads a target's rules whether or not the service is there.
 */
import { afterEach, describe, expect, it } from "vitest";

import { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";

import {
  clearDeclaredTargets,
  declareTarget,
  declaredTarget,
} from "./declared-rules";

afterEach(() => {
  clearDeclaredTargets();
});

describe("the declared rules", () => {
  it("answers a declared target, and nothing for one never declared", () => {
    const access = { read: () => true };
    declareTarget({ kind: "single", slug: "home", access });
    expect(declaredTarget("home")).toEqual({
      kind: "single",
      slug: "home",
      access,
    });
    expect(declaredTarget("posts")).toBeUndefined();
  });

  it("keeps a collection's rules over a Single's under the same slug", () => {
    // As the access-control service resolves a slug: collections first.
    const collection = { read: () => true };
    declareTarget({ kind: "collection", slug: "pages", access: collection });
    declareTarget({ kind: "single", slug: "pages", access: { read: false } });
    expect(declaredTarget("pages")).toEqual({
      kind: "collection",
      slug: "pages",
      access: collection,
    });
  });

  it("is filled by the access-control service, and emptied with it", () => {
    const rbac = new RBACAccessControlService();
    const posts = { read: () => true };
    const home = { update: () => false };
    rbac.registerCollectionAccess("posts", posts);
    rbac.registerSingleAccess("home", home);
    expect(declaredTarget("posts")).toEqual({
      kind: "collection",
      slug: "posts",
      access: posts,
    });
    expect(declaredTarget("home")).toEqual({
      kind: "single",
      slug: "home",
      access: home,
    });
    rbac.clearRegisteredAccess();
    expect(declaredTarget("posts")).toBeUndefined();
    expect(declaredTarget("home")).toBeUndefined();
  });
});
