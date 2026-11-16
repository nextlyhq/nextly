/**
 * A retired `manage-` permission asked through the any-of gate is held as the
 * single gate holds it: by the four plain permissions it stood for, never by
 * a stored `manage-` row of its own.
 *
 * A key is the caller, so the stored list alone decides. One holding only the
 * retired row is refused by both gates; one holding the plain four is let
 * through by both, alone or beside an alternative it does not hold.
 */
import { describe, expect, it } from "vitest";

import type { AuthContext } from "../../middleware";
import { anyPermissionVerdict, routeGateVerdict } from "../route-gate-adapters";

/** A key's request context, holding exactly `permissions`. */
function keyAuth(permissions: string[]): AuthContext {
  return {
    userId: "maker",
    permissions,
    roles: [],
    authMethod: "api-key",
    apiKeyId: "key-1",
    keyHoldsSuperAdmin: false,
  };
}

const PLAIN_FOUR = [
  "read-settings",
  "create-settings",
  "update-settings",
  "delete-settings",
];
const MANAGE_SETTINGS = { action: "manage", resource: "settings" };

describe("a retired manage- permission at the any-of gate", () => {
  it("refuses a key holding only the retired row, as the single gate does", async () => {
    const auth = keyAuth(["manage-settings"]);
    expect(
      (await routeGateVerdict(auth, "manage", "settings", undefined)).allowed
    ).toBe(false);
    expect(
      (await anyPermissionVerdict(auth, [MANAGE_SETTINGS], undefined)).allowed
    ).toBe(false);
  });

  it("lets through a key holding the plain four, as the single gate does", async () => {
    const auth = keyAuth(PLAIN_FOUR);
    expect(
      (await routeGateVerdict(auth, "manage", "settings", undefined)).allowed
    ).toBe(true);
    expect(
      (await anyPermissionVerdict(auth, [MANAGE_SETTINGS], undefined)).allowed
    ).toBe(true);
  });

  it("keeps either-one-will-do beside an alternative the key lacks", async () => {
    const alternatives = [
      { action: "update", resource: "roles" },
      MANAGE_SETTINGS,
    ];
    expect(
      (await anyPermissionVerdict(keyAuth(PLAIN_FOUR), alternatives, undefined))
        .allowed
    ).toBe(true);
    expect(
      (
        await anyPermissionVerdict(
          keyAuth(["update-roles"]),
          alternatives,
          undefined
        )
      ).allowed
    ).toBe(true);
    expect(
      (
        await anyPermissionVerdict(
          keyAuth(["manage-settings"]),
          alternatives,
          undefined
        )
      ).allowed
    ).toBe(false);
  });
});
