/**
 * What a permission list holds in the admin, held to what the server allows.
 *
 * The server counts a permission only as itself: a role an earlier release
 * left holding `manage-<resource>` on media, settings or the Email hub, not
 * yet converted by `nextly upgrade`, is refused each plain action there. The
 * admin must show that role the same, never a control the server refuses.
 */
import { describe, expect, it } from "vitest";

import { holdsPermission } from "./holds-permission";

const RETIRED = [
  "media",
  "settings",
  "email-providers",
  "email-templates",
] as const;
const PLAIN = ["read", "create", "update", "delete"] as const;

describe("holdsPermission", () => {
  it.each(RETIRED)(
    "gives a role holding only manage-%s none of the plain four, as the server refuses them",
    resource => {
      const held = new Set([`manage-${resource}`]);
      for (const action of PLAIN) {
        expect(holdsPermission(held, `${action}-${resource}`), action).toBe(
          false
        );
      }
    }
  );

  it("holds a permission the list names, and a manage- permission as itself", () => {
    const held = new Set(["update-settings", "manage-background-jobs"]);
    expect(holdsPermission(held, "update-settings")).toBe(true);
    expect(holdsPermission(held, "read-settings")).toBe(false);
    expect(holdsPermission(held, "manage-background-jobs")).toBe(true);
  });
});
