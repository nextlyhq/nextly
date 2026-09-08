/**
 * The API-key authorization policy, and that both shapes come from it.
 *
 * The endpoints, the admin's route guards and the admin's controls all ask
 * which grants reach one operation. When that rule was written twice they
 * disagreed: the list route demanded `update-api-keys` while the endpoint
 * accepted `read-api-keys`, so a reader who could fetch keys over the API was
 * turned away from the page that shows them.
 *
 * @module domains/auth/__tests__/api-key-policy.test
 */
import { describe, expect, it } from "vitest";

import { permissionSlug } from "../../../schemas/_zod/rbac";
import {
  API_KEY_ACTION_POLICY,
  API_KEY_RESOURCE,
  apiKeyPermissionSlugsFor,
  apiKeyPermissionsFor,
  type ApiKeyOperation,
} from "../api-key-policy";

const OPERATIONS: ApiKeyOperation[] = ["read", "create", "update", "delete"];

describe("the API-key policy", () => {
  /**
   * The umbrella is the whole reason this cannot be read off the slug names.
   * `update-api-keys` reaches every operation; the others reach only their own.
   */
  it("lets update reach every operation", () => {
    for (const operation of OPERATIONS) {
      expect(API_KEY_ACTION_POLICY[operation], operation).toContain("update");
    }
  });

  it("lets each other action reach only its own operation", () => {
    for (const operation of OPERATIONS) {
      const others = API_KEY_ACTION_POLICY[operation].filter(
        action => action !== "update"
      );
      expect(others, operation).toEqual(
        operation === "update" ? [] : [operation]
      );
    }
  });
});

describe("the two shapes the policy produces", () => {
  it("names one resource in the permission objects", () => {
    for (const operation of OPERATIONS) {
      const permissions = apiKeyPermissionsFor(operation);
      expect(permissions.length, operation).toBeGreaterThan(0);
      expect(
        permissions.every(p => p.resource === API_KEY_RESOURCE),
        operation
      ).toBe(true);
    }
  });

  /**
   * The slugs are the same permissions, composed through `permissionSlug` —
   * which states that the string is built there and nowhere else, so a change
   * to its shape reaches the admin too.
   */
  it("derives the slugs from the same actions", () => {
    for (const operation of OPERATIONS) {
      expect(apiKeyPermissionSlugsFor(operation), operation).toEqual(
        apiKeyPermissionsFor(operation).map(p =>
          permissionSlug(p.action, p.resource)
        )
      );
    }
  });

  /**
   * The property the whole module exists for, stated as an assertion rather
   * than left to the two call sites: reading is authorised by read OR update.
   */
  it("authorises reading by read or update", () => {
    expect(apiKeyPermissionSlugsFor("read").sort()).toEqual([
      "read-api-keys",
      "update-api-keys",
    ]);
  });

  it("authorises editing by update alone", () => {
    expect(apiKeyPermissionSlugsFor("update")).toEqual(["update-api-keys"]);
  });
});
