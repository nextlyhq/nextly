/**
 * What a permission list holds in the admin, held to what the server allows.
 *
 * The server counts a permission only as itself: a role an earlier release
 * left holding `manage-<resource>` on media, settings or the Email hub, not
 * yet converted by `nextly upgrade`, is refused each plain action there. The
 * admin must show that role the same, never a control the server refuses.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

  it.each(RETIRED)(
    "holds manage-%s, asked of it, only by holding all four plain permissions, as the server does",
    resource => {
      const plain = PLAIN.map(action => `${action}-${resource}`);
      expect(holdsPermission(new Set(plain), `manage-${resource}`)).toBe(true);
      expect(
        holdsPermission(new Set(plain.slice(0, 3)), `manage-${resource}`)
      ).toBe(false);
      expect(
        holdsPermission(new Set([`manage-${resource}`]), `manage-${resource}`)
      ).toBe(false);
    }
  );

  it("reads core's rule from a module whose imports are types alone, so it stays plain code in the client", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL(
          "../../../../nextly/src/auth/access/retired-manage-permissions.ts",
          import.meta.url
        )
      ),
      "utf8"
    );
    const imports = source.match(/^\s*import\b.*$/gm) ?? [];
    expect(imports.every(line => /^\s*import type\b/.test(line))).toBe(true);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });
});
