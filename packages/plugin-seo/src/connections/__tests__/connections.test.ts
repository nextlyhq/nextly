/**
 * The optional connections' pure parts: what each IndexNow answer means,
 * the one request a notice is, the property that is the site, and the state
 * the Connections tab is told, which never carries a credential.
 */
import { describe, expect, it } from "vitest";

import { resultOfStatus } from "../indexnow";
import { INDEXNOW_ENDPOINT, sendIndexNow } from "../indexnow-send";
import { propertyFor, searchConsoleState } from "../search-console";

describe("what IndexNow's answer means", () => {
  it("takes 200 and 202 as sent, 403 and 422 as a refused key, 429 as a rate limit", () => {
    expect(
      [200, 202, 400, 403, 422, 429, 500].map(status => resultOfStatus(status))
    ).toEqual([
      "sent",
      "sent",
      "failed",
      "refused-key",
      "refused-key",
      "rate-limited",
      "failed",
    ]);
  });
});

describe("an IndexNow notice", () => {
  it("is one JSON post to the shared endpoint, following no redirect", async () => {
    const asked: { url: string; init: RequestInit }[] = [];
    const status = await sendIndexNow(
      async (url, init) => {
        asked.push({ url, init });
        return new Response(null, { status: 202 });
      },
      {
        host: "acme.example",
        key: "k".repeat(32),
        urlList: ["https://acme.example/a"],
      }
    );
    expect(status).toBe(202);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.url).toBe(INDEXNOW_ENDPOINT);
    expect(asked[0]?.init.method).toBe("POST");
    expect(asked[0]?.init.redirect).toBe("error");
    expect(asked[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(asked[0]?.init.body))).toEqual({
      host: "acme.example",
      key: "k".repeat(32),
      urlList: ["https://acme.example/a"],
    });
  });
});

describe("the Search Console property that is the site", () => {
  const properties = [
    "https://other.example/",
    "sc-domain:acme.example",
    "https://www.acme.example/",
  ];

  it("is the site's address as a URL-prefix property first", () => {
    expect(propertyFor(properties, ["https://www.acme.example"])).toBe(
      "https://www.acme.example/"
    );
  });

  it("is the domain property where no URL-prefix one is the site", () => {
    expect(propertyFor(properties, ["https://acme.example"])).toBe(
      "sc-domain:acme.example"
    );
  });

  it("is the closest parent domain property for a site on a subdomain", () => {
    expect(
      propertyFor(
        [
          "sc-domain:example.com",
          "sc-domain:blog.example.com.evil",
          "sc-domain:ample.com",
        ],
        ["https://news.blog.example.com"]
      )
    ).toBe("sc-domain:example.com");
    expect(
      propertyFor(
        ["sc-domain:example.com", "sc-domain:blog.example.com"],
        ["https://news.blog.example.com"]
      )
    ).toBe("sc-domain:blog.example.com");
  });

  it("is none where the account has nothing for the site", () => {
    expect(
      propertyFor(properties, ["https://elsewhere.example"])
    ).toBeUndefined();
  });
});

describe("what the Connections tab is told about Search Console", () => {
  it("names who is connected and how the last attempt failed, never the token", () => {
    const state = searchConsoleState(
      {
        searchConsole: {
          refreshToken: "1//refresh-token-value",
          email: "sara@acme.example",
          property: "sc-domain:acme.example",
        },
        searchConsolePending: {
          state: "pending-state",
          verifier: "pending-verifier",
          redirectUri: "https://acme.example/cb",
          expiresAt: "2026-01-01T00:00:00.000Z",
        },
        searchConsoleFailed: {
          at: "2026-01-01T00:00:00.000Z",
          result: "failed",
          message: "Try again later.",
        },
      },
      {
        readRules: async () => ({ patterns: {} }),
        client: { clientId: "id", clientSecret: "client-secret-value" },
      }
    );
    expect(state).toEqual({
      configured: true,
      connected: {
        email: "sara@acme.example",
        property: "sc-domain:acme.example",
      },
      failed: {
        at: "2026-01-01T00:00:00.000Z",
        result: "failed",
        message: "Try again later.",
      },
    });
    const told = JSON.stringify(state);
    for (const secret of [
      "1//refresh-token-value",
      "pending-state",
      "pending-verifier",
      "client-secret-value",
    ]) {
      expect(told).not.toContain(secret);
    }
  });

  it("says Search Console is not set up where the site names no Google sign-in", () => {
    expect(
      searchConsoleState({}, { readRules: async () => ({ patterns: {} }) })
    ).toEqual({ configured: false });
  });
});
