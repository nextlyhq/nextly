// Why: Nextly uses 100% custom auth (email + password, JWT, sessions, API
// keys, RBAC). The runtime env schema must NOT declare OAuth provider
// variables — they were never read by any production code and previously
// misled users into thinking social login was supported. This test locks the
// rule so future edits can't silently re-introduce them.
//
// Approach: rely on Zod's default strip behavior. If a key is declared on the
// schema's inner object, validateEnvObject's output will preserve it; if it
// is not declared, the key is stripped. We also assert error-free parsing of
// the minimum required env so a regression here surfaces clearly.
import { describe, expect, it } from "vitest";

import { validateEnvObject } from "../env";

const OAUTH_KEYS = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
] as const;

describe("env schema OAuth removal", () => {
  it("strips OAuth keys from validateEnvObject output (schema must not declare them)", () => {
    const parsed = validateEnvObject({
      NODE_ENV: "development",
      DB_DIALECT: "sqlite",
      SQLITE_PATH: "./tmp.db",
      AUTH_GOOGLE_ID: "should-be-stripped",
      AUTH_GOOGLE_SECRET: "should-be-stripped",
      AUTH_GITHUB_ID: "should-be-stripped",
      AUTH_GITHUB_SECRET: "should-be-stripped",
    });
    for (const key of OAUTH_KEYS) {
      expect(
        Object.prototype.hasOwnProperty.call(parsed, key),
        `${key} should not be present on the validated env object — Nextly uses 100% custom auth and the schema must not declare OAuth provider keys.`
      ).toBe(false);
    }
  });
});
