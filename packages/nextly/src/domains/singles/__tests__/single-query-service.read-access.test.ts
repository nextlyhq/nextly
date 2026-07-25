/**
 * A Single's stored read rule has to hold on the read path, not just on writes.
 *
 * The rule was previously never evaluated on reads: the read gate was called
 * without the Single's `accessRules`, so a `read: role-based` rule an admin
 * configured did nothing over HTTP while the same rule was enforced on every
 * update. These tests drive `get()` so they cover the whole gate — the rules
 * being handed over AND something being present to evaluate them with, which
 * are two separate arguments that both have to arrive for enforcement to run.
 */

import { describe, it, expect, vi } from "vitest";

import { SingleQueryService } from "../services/single-query-service";

import {
  createMockAdapter,
  createSilentLogger,
  createMockSingleRegistry,
  createMockHookRegistry,
  createMockRBACService,
  siteSettingsMeta,
  textField,
} from "./single-test-helpers";

type Ctor = ConstructorParameters<typeof SingleQueryService>;

/** Read restricted to the `admin` role. */
const ROLE_BASED_READ = {
  read: { type: "role-based" as const, allowedRoles: ["admin"] },
};

const editor = { id: "user-1", roles: ["editor"] };
const admin = { id: "user-2", roles: ["admin"] };

function createService(evaluateAllowed: boolean) {
  const registry = createMockSingleRegistry();
  registry.registerSingle("site-settings", {
    ...siteSettingsMeta({ accessRules: ROLE_BASED_READ }),
    fields: [textField("siteName")],
  });

  const accessControlService = {
    evaluateAccess: vi
      .fn()
      .mockResolvedValue(
        evaluateAllowed
          ? { allowed: true }
          : { allowed: false, reason: "denied" }
      ),
  };

  const service = new SingleQueryService(
    createMockAdapter({
      selectOne: vi
        .fn()
        .mockResolvedValue({ id: "doc1", siteName: "Nextly", status: null }),
    }) as unknown as Ctor[0],
    createSilentLogger() as unknown as Ctor[1],
    registry as unknown as Ctor[2],
    createMockHookRegistry() as unknown as Ctor[3],
    undefined,
    createMockRBACService(true) as unknown as Ctor[5],
    undefined,
    accessControlService as unknown as Ctor[7]
  );

  return { service, accessControlService };
}

describe("SingleQueryService.get — stored read rules", () => {
  it("denies a caller the stored read rule rejects", async () => {
    const { service, accessControlService } = createService(false);

    const result = await service.get("site-settings", {
      user: editor,
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
    // The rule was actually consulted, rather than the read failing for some
    // unrelated reason.
    expect(accessControlService.evaluateAccess).toHaveBeenCalled();
  });

  it("allows a caller the stored read rule admits", async () => {
    const { service } = createService(true);

    const result = await service.get("site-settings", {
      user: admin,
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
  });

  it("evaluates the rule for the read operation, against the caller", async () => {
    const { service, accessControlService } = createService(true);

    await service.get("site-settings", { user: editor, routeAuthorized: true });

    // Guards the two arguments that each silently disable enforcement when
    // missing: the rules themselves, and the operation they are read under.
    const [rules, operation, context] =
      accessControlService.evaluateAccess.mock.calls[0];
    expect(rules).toMatchObject(ROLE_BASED_READ);
    expect(operation).toBe("read");
    expect(context.user).toMatchObject({ id: "user-1", roles: ["editor"] });
  });

  it("lets a trusted read bypass the stored rule", async () => {
    const { service, accessControlService } = createService(false);

    const result = await service.get("site-settings", {
      overrideAccess: true,
    });

    expect(result.success).toBe(true);
    expect(accessControlService.evaluateAccess).not.toHaveBeenCalled();
  });
});
