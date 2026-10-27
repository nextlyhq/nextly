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

  it.each([
    "otp=482913",
    "pin=482913",
    "passcode=482913",
    "passwd=hunter2-pw",
    "authorization=opaque-auth-value",
    "key=AIzaSyKeyValue",
    "X-Amz-Credential=AKIDvalue",
  ])("takes the value of %s out of text", parameter => {
    const [name, value] = parameter.split("=");
    const out = receivedBy({ note: `retrying with ${parameter}&page=2` });
    expect(out).toContain(`${name}=`);
    expect(out).toContain("page=2");
    expect(out).not.toContain(value);
  });

  it.each([
    [
      'upstream said {"refreshToken":"json-secret-1","page":2}',
      "json-secret-1",
    ],
    ['upstream said {"otp": 482913, "page": 2}', "482913"],
    [
      "upstream said {'apiKey': 'single-secret-2', 'page': 2}",
      "single-secret-2",
    ],
    [
      'upstream said {\\"token\\":\\"escaped-secret-3\\",\\"page\\":2}',
      "escaped-secret-3",
    ],
    ["Rejected with X-Api-Key: header-secret-4, page=2", "header-secret-4"],
    ['retrying with token="quoted-secret-5" page=2', "quoted-secret-5"],
    ["retrying with password = 'spaced-secret-6' page=2", "spaced-secret-6"],
  ])("takes the value out of %s", (text, secret) => {
    const out = receivedBy({ note: text, error: new Error(text) });
    // POPULATION CONTROL: the parameter beside it remains.
    expect(out).toMatch(/page\W*[=:]\W*2/);
    expect(out).not.toContain(secret);
  });

  it("takes them out of what a toJSON method would write", () => {
    const meta = {
      slug: "home",
      detail: {
        token: "visible-field-secret",
        toJSON: () => ({ leaked: "serialised-secret", password: "pw-secret" }),
      },
    };
    const received: unknown[] = [];
    maskingServiceLogger({
      debug: (_: string, m?: unknown) => received.push(m),
      info: () => {},
      warn: () => {},
      error: () => {},
    }).debug("line", meta);

    // As a JSON writer would serialise it, which is where `toJSON` runs.
    const out = JSON.stringify(received);
    expect(out).toContain("home");
    expect(out).not.toContain("visible-field-secret");
    expect(out).not.toContain("pw-secret");
  });

  it("reads a long chain of names without running out of stack", () => {
    const received: unknown[] = [];
    maskingServiceLogger({
      debug: (_: string, m?: unknown) => received.push(m),
      info: () => {},
      warn: () => {},
      error: () => {},
    }).debug("line", {
      note: `${"a:".repeat(20_000)}z then token=chain-secret`,
    });

    // Read as the value itself: printing would cut a string this long short.
    const { note } = received[0] as { note: string };
    expect(note).toMatch(/z then token=\S+$/);
    expect(note).not.toContain("chain-secret");
  });

  it.each([
    ['retrying with token="unterminated-secret-1', "unterminated-secret-1"],
    ["retrying with password='unterminated-secret-2", "unterminated-secret-2"],
    [
      'upstream said {\\"apiKey\\":\\"unterminated-secret-3',
      "unterminated-secret-3",
    ],
  ])(
    "takes the rest of the line after an unclosed quote: %s",
    (text, secret) => {
      const out = receivedBy({ note: text });
      // The control: the words before it remain.
      expect(out).toContain(text.split(" ")[0]);
      expect(out).not.toContain(secret);
    }
  );

  it("takes them out of a request's path", () => {
    const out = receivedBy({
      request: new Request("https://example.test/reset/token=path-secret-1"),
    });
    // The control: the method and the rest of the path remain.
    expect(out).toContain("GET");
    expect(out).toContain("/reset/");
    expect(out).not.toContain("path-secret-1");
  });

  it("takes them out of what an error's toJSON would write", () => {
    const error = Object.assign(new Error("upload failed"), {
      toJSON: () => ({ token: "error-json-secret" }),
    });
    const received: unknown[] = [];
    maskingServiceLogger({
      debug: (_: string, m?: unknown) => received.push(m),
      info: () => {},
      warn: () => {},
      error: () => {},
    }).debug("line", { error });

    // As a JSON writer would serialise it, which is where `toJSON` runs.
    expect(JSON.stringify(received)).not.toContain("error-json-secret");
  });

  it("takes them out of what an error's own inspection hook would print", () => {
    const captured = "inspect-hook-secret";
    class HookedError extends Error {
      [Symbol.for("nodejs.util.inspect.custom")](): string {
        return `HookedError token=${captured}`;
      }
    }
    const out = receivedBy({ error: new HookedError("upload failed") });
    // A console logger calls the hook the error's class defines.
    expect(out).not.toContain("inspect-hook-secret");
    // The control: the error's own message remains.
    expect(out).toContain("upload failed");
  });

  it("takes them out of what a function's inspection hook would print", () => {
    const captured = "function-hook-secret";
    const callback = Object.defineProperty(
      () => undefined,
      Symbol.for("nodejs.util.inspect.custom"),
      { value: () => `callback key=${captured}` }
    );
    const out = receivedBy({ callback, step: "upload" });
    // A console logger calls a function's hook as it calls an object's.
    expect(out).not.toContain("function-hook-secret");
    // The control: the rest of the line remains.
    expect(out).toContain("upload");
  });

  it("takes them out of an object of any other class: its fields and its hook", () => {
    const captured = "class-hook-secret";
    class Client {
      token = "class-field-secret";
      host = "db.example.test";
    }
    class Hooked {
      [Symbol.for("nodejs.util.inspect.custom")](): string {
        return `Hooked key=${captured}`;
      }
    }
    const when = new Date("2026-10-27T00:00:00.000Z");
    const out = receivedBy({
      client: new Client(),
      hooked: new Hooked(),
      when,
    });
    expect(out).not.toContain("class-field-secret");
    expect(out).not.toContain("class-hook-secret");
    // The controls: the object's other fields remain, and a date still
    // prints as its time.
    expect(out).toContain("db.example.test");
    expect(out).toContain("2026-10-27T00:00:00.000Z");
  });

  it("logs no built-in as itself: a promise, a symbol, bytes or a date with fields", async () => {
    const settled = Promise.resolve({ token: "promise-value-secret" });
    await settled;
    const when = Object.assign(new Date("2026-10-27T00:00:00.000Z"), {
      token: "date-field-secret",
    });
    const out = receivedBy({
      settled,
      marker: Symbol("Bearer symbol-value-secret"),
      byKey: new Map([[Symbol("Bearer symbol-key-secret"), "kept"]]),
      bytes: new TextEncoder().encode("bytes-value-secret"),
      when,
    });
    for (const secret of [
      "promise-value-secret",
      "symbol-value-secret",
      "symbol-key-secret",
      "date-field-secret",
    ]) {
      expect(out).not.toContain(secret);
    }
    // Bytes are logged as their kind and length, never their contents.
    expect(out).not.toMatch(/62 79 74 65 73/);
    // The controls: a date still prints as its time, and a map's value stays.
    expect(out).toContain("2026-10-27T00:00:00.000Z");
    expect(out).toContain("kept");
  });

  it.each([
    [
      "a header value of several words",
      {
        note: "Rejected Password: correct-horse battery-staple\nnext line kept",
      },
      ["correct-horse", "battery-staple"],
    ],
    [
      "a JSON array or object after a credential's name",
      {
        note: 'upstream said {"tokens":["first-secret","second-secret"]}',
        other: 'upstream said {"token":{"value":"nested-secret"}}',
      },
      ["first-secret", "second-secret", "nested-secret"],
    ],
    [
      "an address without a scheme",
      { note: "fetch //user:relative-secret@storage.example/file" },
      ["relative-secret"],
    ],
    [
      "a bracketed parameter name",
      { note: "posted user[password]=bracket-secret&tokens[]=list-secret" },
      ["bracket-secret", "list-secret"],
    ],
  ])("takes them out of %s", (_, meta, secrets) => {
    const out = receivedBy(meta);
    for (const secret of secrets) expect(out).not.toContain(secret);
  });

  it("reads a boxed string whole, so its credential is found", () => {
    const out = receivedBy({ note: new String("Bearer boxed-string-secret") });
    // Copied character by character, no credential would ever be seen whole,
    // and the characters would still spell it: the string is redacted as one.
    expect(out).toContain("note: 'Bearer [redacted]'");
  });

  it("keeps the line after a header value it redacts", () => {
    const out = receivedBy({
      note: "Rejected Password: correct-horse\nnext line kept",
    });
    expect(out).toContain("next line kept");
  });

  it("takes them out of a function's own fields", () => {
    const out = receivedBy({
      callback: Object.assign(() => undefined, {
        token: "function-field-secret",
        step: "upload",
      }),
    });
    // A console logger prints a function's own fields beside its name.
    expect(out).not.toContain("function-field-secret");
    // The control: the rest of its fields remain.
    expect(out).toContain("upload");
  });

  it("takes them out of what a function's toJSON would write", () => {
    const callback = Object.assign(() => undefined, {
      toJSON: () => ({ token: "function-json-secret", step: "upload" }),
    });
    const received: unknown[] = [];
    maskingServiceLogger({
      debug: (_: string, m?: unknown) => received.push(m),
      info: () => {},
      warn: () => {},
      error: () => {},
    }).debug("line", { callback });

    // A JSON writer calls `toJSON` on a function too.
    const written = JSON.stringify(received);
    expect(written).not.toContain("function-json-secret");
    // The control: the rest of what it writes remains.
    expect(written).toContain("upload");
  });

  it("takes a whole authorization header value out of text, any scheme", () => {
    const out = receivedBy({
      note: "Rejected Authorization: Token opaque-token-secret extra-part-secret",
    });
    expect(out).not.toContain("opaque-token-secret");
    expect(out).not.toContain("extra-part-secret");
    // The control: the header's name and scheme remain.
    expect(out).toContain("Authorization: Token");
  });

  it("keeps a map's entries apart when their keys redact alike", () => {
    const received: unknown[] = [];
    maskingServiceLogger({
      debug: (_: string, m?: unknown) => received.push(m),
      info: () => {},
      warn: () => {},
      error: () => {},
    }).debug("line", {
      byCaller: new Map([
        [`Bearer ${KEY}`, "first"],
        [`Bearer ${KEY}x`, "second"],
      ]),
    });

    const copied = (received[0] as { byCaller: Map<unknown, unknown> })
      .byCaller;
    expect(copied.size).toBe(2);
    expect([...copied.values()]).toEqual(["first", "second"]);
  });
});
