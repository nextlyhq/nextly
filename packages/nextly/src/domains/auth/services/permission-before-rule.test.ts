/**
 * A signed-in user needs the permission first; a code rule can only narrow it.
 *
 * The access-control service's check for a signed-in user is what the entity
 * readers, relationship population, release checks and `nextly.access.check`
 * ask. Where a target declares a rule for the action, that rule used to decide
 * alone, whatever the user's permissions: a rule of `true` let in a user the
 * role screen kept out. Now the permission is asked first and a rule that
 * answers `true` only lets through a user who holds it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ holds: true }));

vi.mock("../../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../services/lib/permissions")
  >()),
  isSuperAdmin: vi.fn(async () => false),
  hasPermission: vi.fn(async () => access.holds),
  listRoleSlugsForUser: vi.fn(async () => ["editor"]),
  listEffectiveGrants: vi.fn(async () => []),
  listEffectivePermissions: vi.fn(async () => []),
}));

import { clearRuleAnswerNotices } from "../../../auth/access/rule-answer-log";
import { consoleLogger } from "../../../shared/types";

import { RBACAccessControlService } from "./rbac-access-control-service";

function serviceWith(read: boolean | (() => boolean)) {
  const rbac = new RBACAccessControlService();
  rbac.registerCollectionAccess("posts", { read });
  return rbac;
}

const read = (rbac: RBACAccessControlService) =>
  rbac.checkAccess({ userId: "u1", operation: "read", resource: "posts" });

beforeEach(() => {
  access.holds = true;
  clearRuleAnswerNotices();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a signed-in user's check where the target declares a rule", () => {
  it("refuses a user without the permission, even where the rule says true", async () => {
    access.holds = false;
    const rule = vi.fn(() => true);
    await expect(read(serviceWith(rule))).resolves.toBe(false);
    // Refused before the rule is asked, as the decision refuses.
    expect(rule).not.toHaveBeenCalled();
    await expect(read(serviceWith(true))).resolves.toBe(false);
  });

  it("lets the rule narrow a user who holds the permission", async () => {
    // The controls: with the permission, the rule decides.
    await expect(read(serviceWith(() => true))).resolves.toBe(true);
    await expect(read(serviceWith(() => false))).resolves.toBe(false);
    await expect(read(serviceWith(true))).resolves.toBe(true);
  });

  it("names, once, a rule that no longer lets in a user without the permission", async () => {
    const warn = vi.spyOn(consoleLogger, "warn").mockImplementation(() => {});
    access.holds = false;
    const rbac = serviceWith(() => true);
    await read(rbac);
    await read(rbac);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("read-posts");
    // A target with no rule refused such a user before too: nothing named.
    await new RBACAccessControlService().checkAccess({
      userId: "u1",
      operation: "read",
      resource: "pages",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("names nothing where the rule is a plain false, which refused before too", async () => {
    const warn = vi.spyOn(consoleLogger, "warn").mockImplementation(() => {});
    access.holds = false;
    await expect(read(serviceWith(false))).resolves.toBe(false);
    expect(warn).not.toHaveBeenCalled();
    // The control: a rule of `true` let this caller in before, and is named.
    await read(serviceWith(true));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
