/**
 * No credential reaches a log line, in any environment.
 *
 * A service that logs its options logs the request they carry, and Node's
 * console prints a Fetch `Request` with its headers: a Single update wrote the
 * caller's `Authorization: Bearer` API key and session cookie into a
 * production log that way. These hand the loggers exactly that payload and
 * read what reaches the console as Node would print it, so a request, header
 * or field that slips through in any form fails here, while the method and
 * path an operator needs still arrive.
 */
import { inspect } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { consoleLogger } from "../shared/types";

import { getNextlyLogger, setNextlyLogger } from "./logger";
import { maskingServiceLogger } from "./mask-emails";

// Plainly synthetic, so no scanner reads them as real credentials; the shapes
// are what matter: an API key behind `Bearer`, a cookie behind its name.
const KEY = `nx_live_${"testkey".repeat(6)}t`;
const SESSION_VALUE = "test-session-cookie-value";
const SESSION = `nextly_session=${SESSION_VALUE}`;

/** A Single update's options as a route hands them to the service. */
function updateOptions() {
  return {
    locale: "en",
    overrideAccess: false,
    request: new Request("https://example.com/admin/api/singles/home?x=1", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${KEY}`,
        cookie: SESSION,
        "x-csrf-token": "test-csrf-token-value",
      },
    }),
  };
}

/** Everything a console spy received, as Node's console would print it. */
function printed(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls
    .flat()
    .map(arg =>
      typeof arg === "string" ? arg : inspect(arg, { depth: Infinity })
    )
    .join("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.each(["production", "development", "test"])(
  "the service console logger with NODE_ENV=%s",
  nodeEnv => {
    it("prints no key, cookie or token from a request in its fields", () => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

      consoleLogger.debug("Updating Single document", {
        slug: "home",
        options: updateOptions(),
      });

      const out = printed(debug);
      // POPULATION CONTROL: the line was written, with what an operator needs.
      expect(out).toContain("Updating Single document");
      expect(out).toContain("home");
      expect(out).toContain("PATCH");
      expect(out).toContain("/admin/api/singles/home");
      expect(out).not.toContain(KEY);
      expect(out).not.toContain(SESSION_VALUE);
      expect(out).not.toContain("test-csrf-token-value");
    });
  }
);

describe("an app's own service logger", () => {
  it("receives fields with the credentials taken out", () => {
    const received: unknown[] = [];
    const appLogger = {
      debug: (_: string, meta?: unknown) => received.push(meta),
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    maskingServiceLogger(appLogger).debug("Updating Single document", {
      options: updateOptions(),
      headers: { Authorization: `Bearer ${KEY}`, "Set-Cookie": SESSION },
      password: "hunter2-secret",
      apiKey: KEY,
    });

    const out = inspect(received, { depth: Infinity });
    expect(out).toContain("PATCH");
    expect(out).not.toContain(KEY);
    expect(out).not.toContain(SESSION_VALUE);
    expect(out).not.toContain("hunter2-secret");
  });

  it("takes a bearer credential out of the message text too", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    consoleLogger.debug(`Rejected Authorization: Bearer ${KEY}`);

    const out = printed(debug);
    expect(out).toContain("Rejected Authorization: Bearer");
    expect(out).not.toContain(KEY);
  });
});

describe("the structured logger", () => {
  it("writes no credential from a payload", () => {
    const original = getNextlyLogger();
    const lines: unknown[] = [];
    setNextlyLogger({
      error: p => lines.push(p),
      warn: p => lines.push(p),
      info: p => lines.push(p),
      debug: p => lines.push(p),
    });
    try {
      getNextlyLogger().info({
        kind: "request",
        options: updateOptions(),
        token: "refresh-abc-123",
      });
    } finally {
      setNextlyLogger(original);
    }

    const out = inspect(lines, { depth: Infinity });
    expect(out).toContain("request");
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("refresh-abc-123");
  });
});

describe("credentials anywhere in a log value", () => {
  /** What an app's service logger receives for `meta`, as Node prints it. */
  function receivedBy(meta: Record<string, unknown>): string {
    const received: unknown[] = [];
    maskingServiceLogger({
      debug: (_: string, m?: unknown) => received.push(m),
      info: () => {},
      warn: () => {},
      error: () => {},
    }).debug("line", meta);
    return inspect(received, { depth: Infinity });
  }

  it("takes them out of an error's message, stack, cause and fields", () => {
    const cause = new Error(`upstream said Bearer ${KEY}`);
    const error = new Error(`Rejected Authorization: Bearer ${KEY}`, {
      cause,
    });
    Object.assign(error, { apiKey: KEY, request: updateOptions().request });

    const out = receivedBy({ error });

    // POPULATION CONTROL: the error still arrives, as an error, with its words.
    expect(out).toContain("Rejected Authorization: Bearer");
    expect(out).toContain("upstream said");
    expect(out).not.toContain(KEY);
    expect(out).not.toContain(SESSION_VALUE);
  });

  it.each([
    "rawToken",
    "pendingToken",
    "setupToken",
    "serverToken",
    "rawKey",
    "fullKey",
    "secrets",
    "signingSecret",
    "sessionCookie",
  ])("takes out a field named %s", field => {
    expect(receivedBy({ [field]: "opaque-credential-value" })).not.toContain(
      "opaque-credential-value"
    );
  });

  it("keeps fields that only look like credentials", () => {
    const out = receivedBy({
      idempotencyKey: "order-42",
      cacheKey: "posts:list",
      maxTokens: 51234,
      tokenCount: 61234,
      hasPassword: true,
    });
    expect(out).toContain("order-42");
    expect(out).toContain("posts:list");
    expect(out).toContain("51234");
    expect(out).toContain("61234");
    expect(out).toContain("hasPassword: true");
  });

  it.each(["password", "pin", "otp", "passcode", "sessionCode", "secret"])(
    "takes out a number under %s",
    field => {
      expect(receivedBy({ [field]: 482913 })).not.toContain("482913");
    }
  );

  it("takes them out of a field's name, keeping fields apart", () => {
    // Keyed by a credential, as a token-indexed record is: the names lose the
    // credential, and the two fields stay two.
    const out = receivedBy({
      [`Bearer ${KEY}`]: "first",
      [`Bearer ${KEY}x`]: "second",
    });
    expect(out).not.toContain(KEY);
    expect(out).toContain("first");
    expect(out).toContain("second");
  });

  it("hides the value of a field whose name says it's an authorization", () => {
    const out = receivedBy({ [`Authorization: Bearer ${KEY}`]: KEY });
    expect(out).not.toContain(KEY);
  });

  it("takes them out of URLs in text: userinfo and credential parameters", () => {
    const error = new Error(
      "GET https://store-user:store-pass-123@bucket.example.com/a.png?X-Amz-Signature=sig-value-456&size=2 failed with token=tok-value-789"
    );

    const out = receivedBy({ error });

    // POPULATION CONTROL: the host, path and harmless parameter remain.
    expect(out).toContain("bucket.example.com/a.png");
    expect(out).toContain("size=2");
    expect(out).not.toContain("store-pass-123");
    expect(out).not.toContain("sig-value-456");
    expect(out).not.toContain("tok-value-789");
  });

  it("takes them out of a Map, URLSearchParams and a URL", () => {
    const out = receivedBy({
      headers: new Map([["authorization", `Bearer ${KEY}`]]),
      seen: new Set([`Bearer ${KEY}`]),
      query: new URLSearchParams("token=query-secret-1&page=3"),
      link: new URL("https://u:url-secret-2@example.com/p?sig=url-secret-3"),
    });

    expect(out).toContain("page=3");
    expect(out).toContain("example.com/p");
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("query-secret-1");
    expect(out).not.toContain("url-secret-2");
    expect(out).not.toContain("url-secret-3");
  });

  it("summarises a response, a headers object and any other request", () => {
    class IncomingRequest {
      headers = { authorization: `Bearer ${KEY}` };
    }
    const out = receivedBy({
      response: new Response("body", {
        status: 418,
        headers: { "set-cookie": SESSION },
      }),
      sent: new Headers({ authorization: `Bearer ${KEY}` }),
      incoming: new IncomingRequest(),
    });

    expect(out).toContain("418");
    expect(out).toContain("IncomingRequest");
    expect(out).not.toContain(KEY);
    expect(out).not.toContain(SESSION_VALUE);
  });

  it("logs the line even when a field can't be read", () => {
    const out = receivedBy({
      slug: "home",
      get detail(): string {
        throw new Error("unreadable on purpose");
      },
    });

    expect(out).toContain("home");
  });

  it("takes cookies and session values out of text", () => {
    const out = receivedBy({
      error: new Error(
        "Rejected Cookie: theme=dark; nextly_session=session-secret-value"
      ),
      note: "upstream sent Set-Cookie: sid=set-cookie-secret; Path=/",
      query: "retry with session_id=sid-secret-value&page=2",
    });

    // POPULATION CONTROL: the words around them remain.
    expect(out).toContain("Rejected Cookie:");
    expect(out).toContain("page=2");
    expect(out).not.toContain("session-secret-value");
    expect(out).not.toContain("set-cookie-secret");
    expect(out).not.toContain("sid-secret-value");
  });
});
