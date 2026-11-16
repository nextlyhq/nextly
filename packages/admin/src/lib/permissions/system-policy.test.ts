/**
 * The admin reads core's system policy from its source file, which bundles
 * into the client only while it imports nothing. A runtime import added there
 * would pull server code into the admin's bundle, so this holds the file to
 * plain data, and the slugs read from it to the ones the server asks.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CHANGE_SETTINGS,
  READ_SETTINGS,
  SYSTEM_WRITE_POLICY,
  slugsOf,
} from "./system-policy";

const CORE_POLICY = fileURLToPath(
  new URL(
    "../../../../nextly/src/domains/auth/system-write-policy.ts",
    import.meta.url
  )
);

describe("core's system policy, as the admin reads it", () => {
  it("imports nothing, so it stays plain data in the client bundle", () => {
    const source = readFileSync(CORE_POLICY, "utf8");
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/^\s*export\s[^;]*\bfrom\s/m);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it("names the plain settings permissions", () => {
    expect(READ_SETTINGS).toBe("read-settings");
    expect(CHANGE_SETTINGS).toEqual([
      "create-settings",
      "update-settings",
      "delete-settings",
    ]);
    expect(slugsOf(SYSTEM_WRITE_POLICY.emailProviders.sendTest)).toEqual([
      "create-email-providers",
    ]);
  });
});
