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

// A production server refuses a secret it cannot sign with. The example env
// files a new project gets carry an EMPTY NEXTLY_SECRET as their placeholder,
// so a copied example file cannot start a deployment; an earlier placeholder
// was 34 characters long and passed this check.
describe("the production NEXTLY_SECRET check", () => {
  const production = {
    NODE_ENV: "production",
    DB_DIALECT: "sqlite",
    SQLITE_PATH: "./tmp.db",
    NEXT_PUBLIC_APP_URL: "https://example.com",
  };

  it.each([
    ["the empty placeholder of a new project's example env file", ""],
    ["a secret shorter than 32 characters", "short-secret"],
  ])("refuses %s", (_label, secret) => {
    expect(() =>
      validateEnvObject({ ...production, NEXTLY_SECRET: secret })
    ).toThrow(/NEXTLY_SECRET of at least 32 characters/);
  });

  it("accepts a secret of 32 characters", () => {
    // The control: the same environment with a usable secret parses, so the
    // refusals above are about the secret and nothing else.
    expect(() =>
      validateEnvObject({ ...production, NEXTLY_SECRET: "s".repeat(32) })
    ).not.toThrow();
  });
});
