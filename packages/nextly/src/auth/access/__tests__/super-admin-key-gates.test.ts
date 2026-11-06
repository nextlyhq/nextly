/**
 * A key carrying its maker's super-admin authority holds every permission at
 * both REST permission gates, the one asking a single permission and the one
 * asking any of several, as a super-admin's session does.
 *
 * The key's permission list here omits `update-settings`, as a key's list
 * can lag a permission the install gained. A gate reading only the stored
 * list refuses it, so an allow says the gate asked the authority; the same
 * key without the authority is the control, refused by both.
 */
import { describe, expect, it } from "vitest";

import type { AuthContext } from "../../middleware";
import { anyPermissionVerdict, routeGateVerdict } from "../route-gate-adapters";

/** A key's request context, its list lacking `update-settings`. */
function keyAuth(keyHoldsSuperAdmin: boolean): AuthContext {
  return {
    userId: "maker",
    permissions: ["read-settings"],
    roles: [],
    authMethod: "api-key",
    apiKeyId: "key-1",
    keyHoldsSuperAdmin,
  };
}

const UPDATE_SETTINGS = [{ action: "update", resource: "settings" }];

describe("a super-admin's full-access key at the permission gates", () => {
  it("is let through by both gates for a permission its list lacks", async () => {
    const single = await routeGateVerdict(
      keyAuth(true),
      "update",
      "settings",
      undefined
    );
    const anyOf = await anyPermissionVerdict(
      keyAuth(true),
      UPDATE_SETTINGS,
      undefined
    );
    expect(single.allowed).toBe(true);
    expect(anyOf.allowed).toBe(true);
  });

  it("is refused by both without the authority", async () => {
    const single = await routeGateVerdict(
      keyAuth(false),
      "update",
      "settings",
      undefined
    );
    const anyOf = await anyPermissionVerdict(
      keyAuth(false),
      UPDATE_SETTINGS,
      undefined
    );
    expect(single.allowed).toBe(false);
    expect(anyOf.allowed).toBe(false);
  });
});
