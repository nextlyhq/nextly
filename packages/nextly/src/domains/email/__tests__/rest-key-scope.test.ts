/**
 * A REST caller's key scope, and what a claim row stores of it.
 *
 * Each REST caller has a scope of its own, apart from the site's, core's and
 * every plugin's. A row stores only `rest` for it, so the person or API key it
 * belongs to reaches nothing but the key digest.
 */
import { describe, expect, it } from "vitest";

import {
  CORE_KEY_SCOPE,
  pluginKeyScope,
  restKeyScope,
  SITE_KEY_SCOPE,
  storedScope,
} from "../send-claims";

describe("a REST caller's key scope", () => {
  it("is the signed-in person's own", () => {
    expect(restKeyScope({ authMethod: "session", userId: "u1" })).toBe(
      "rest:user:u1"
    );
  });

  it("is the API key's own, never its owner's", () => {
    const key = restKeyScope({
      authMethod: "api-key",
      userId: "u1",
      apiKeyId: "k1",
    });

    expect(key).toBe("rest:api-key:k1");
    expect(key).not.toBe(restKeyScope({ authMethod: "session", userId: "u1" }));
  });

  it("refuses an API-key caller that carries no key id", () => {
    expect(() => restKeyScope({ authMethod: "api-key", userId: "u1" })).toThrow(
      expect.objectContaining({ code: "INTERNAL_ERROR" })
    );
  });

  it("never equals a site, core or plugin scope", () => {
    const rest = restKeyScope({ authMethod: "session", userId: "site" });

    expect([
      SITE_KEY_SCOPE,
      CORE_KEY_SCOPE,
      pluginKeyScope("site"),
    ]).not.toContain(rest);
  });
});

describe("the scope a claim row stores", () => {
  it("is the label alone for a REST caller, naming nobody", () => {
    for (const caller of [
      { authMethod: "session" as const, userId: "u1" },
      { authMethod: "api-key" as const, userId: "u1", apiKeyId: "k1" },
    ]) {
      expect(storedScope(restKeyScope(caller))).toBe("rest");
    }
  });

  it("is every other scope as it is", () => {
    for (const scope of [
      SITE_KEY_SCOPE,
      CORE_KEY_SCOPE,
      pluginKeyScope("mailer"),
    ]) {
      expect(storedScope(scope)).toBe(scope);
    }
  });
});
