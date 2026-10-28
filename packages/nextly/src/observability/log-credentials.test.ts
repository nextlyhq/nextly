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
    // A quoted JSON name is whatever sits between its quotes, as JSON reads
    // it, not only an identifier.
    [
      'upstream said {"access token":"json-secret-7","page":2}',
      "json-secret-7",
    ],
    ['upstream said {"2fa_token":"json-secret-8","page":2}', "json-secret-8"],
    [
      'upstream said {\\"access token\\":\\"escaped-secret-9\\",\\"page\\":2}',
      "escaped-secret-9",
    ],
    [
      'upstream said {"\\u0074oken":"unicode-secret-10","page":2}',
      "unicode-secret-10",
    ],
    // An escaped JSON name (a body quoted inside a message) is decoded as a
    // plain one is, a level of quoting at a time, as are the simple escapes.
    [
      'upstream said {\\"\\\\u0074oken\\":\\"escaped-unicode-secret-12\\",\\"page\\":2}',
      "escaped-unicode-secret-12",
    ],
    [
      'upstream said {"pass\\tword":"simple-escape-secret-13","page":2}',
      "simple-escape-secret-13",
    ],
    [
      'upstream said {\\"pass\\\\tword\\":\\"escaped-simple-secret-14\\",\\"page\\":2}',
      "escaped-simple-secret-14",
    ],
    // GitLab's session cookie, the one entry in its token list with no
    // shape: a session named as one.
    [
      "sent _gitlab_session=gl-session-secret-15 page=2",
      "gl-session-secret-15",
    ],
    // A quoted name holding a parameter of its own (a map keyed by URL) is
    // still searched as text, so the token in it is found.
    [
      'upstream said {"https://cb.example/x?token=url-secret-11":"v","page":2}',
      "url-secret-11",
    ],
  ])("takes the value out of %s", (text, secret) => {
    const out = receivedBy({ note: text, error: new Error(text) });
    // POPULATION CONTROL: the parameter beside it remains.
    expect(out).toMatch(/page\W*[=:]\W*2/);
    expect(out).not.toContain(secret);
  });

  it("reads an escaped JSON name whole when it holds an escaped quote", () => {
    // `{"password\"hint":"…"}` quoted inside a message: the name's own quote
    // is `\\\"` there, and the name runs on past it to its closing `\"`.
    const received: unknown[] = [];
    maskingServiceLogger({
      debug: (_: string, m?: unknown) => received.push(m),
      info: () => {},
      warn: () => {},
      error: () => {},
    }).debug("line", {
      note: 'upstream said {\\"password\\\\\\"hint\\":\\"opaque-secret\\",\\"page\\":2}',
      // A name ending in an escaped backslash still ends at its own quote.
      kept: 'upstream said {\\"name\\\\\\\\\\":\\"Ada Lovelace\\",\\"page\\":2}',
    });
    expect(received[0]).toEqual({
      note: 'upstream said {\\"password\\\\\\"hint\\":\\"[redacted]\\",\\"page\\":2}',
      kept: 'upstream said {\\"name\\\\\\\\\\":\\"Ada Lovelace\\",\\"page\\":2}',
    });
  });

  it("keeps the value of a quoted name that says nothing, and quoted prose", () => {
    const out = receivedBy({
      note: 'upstream said {"display name":"Ada Lovelace","2nd line":"Flat 4","page":2}',
      prose: 'the "session" ended: "kept-after-prose" and "token" was fine',
      // Names that decode to something ordinary, plain and escaped.
      decoded: 'upstream said {"\\u006eame":"Grace Hopper","page":2}',
      escapedDecoded:
        'upstream said {\\"\\\\u006eame\\":\\"Alan Turing\\",\\"page\\":2}',
    });
    expect(out).toContain("Ada Lovelace");
    expect(out).toContain("Flat 4");
    expect(out).toContain("kept-after-prose");
    expect(out).toContain("Grace Hopper");
    expect(out).toContain("Alan Turing");
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

  it("reads a credential's name longer than 256 characters by its last words", () => {
    const name = `${"settings.".repeat(40)}token`;
    const out = receivedBy({ note: `${name}=long-name-secret kept` });
    expect(out).not.toContain("long-name-secret");
    // The control: the words after the value, and the name, remain.
    expect(out).toContain("kept");
    expect(out).toContain("settings.settings.token=");
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

  it("redacts alike through a logger wrapped twice, keeping the rest of the line", () => {
    const received: unknown[] = [];
    const sink = {
      debug: (_: string, m?: unknown) => received.push(m),
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    maskingServiceLogger(maskingServiceLogger(sink)).debug("line", {
      note: "token=twice-wrapped-secret&page=2",
    });
    const out = inspect(received, { depth: Infinity });
    expect(out).not.toContain("twice-wrapped-secret");
    expect(out).toContain("page=2");
  });

  it("takes them out of an error class's display tag", () => {
    const captured = "display-tag-secret";
    class TaggedError extends Error {
      get [Symbol.toStringTag](): string {
        return `Bearer ${captured}`;
      }
    }
    const out = receivedBy({ error: new TaggedError("upload failed") });
    expect(out).not.toContain("display-tag-secret");
    expect(out).toContain("upload failed");
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

describe("credentials known by their shape, under any name", () => {
  // Built by joining, so no credential-shaped literal sits in the source for
  // a secret scanner to report; each is a documented shape and nothing more.
  const shaped = (...parts: string[]) => parts.join("");
  const JWT = shaped(
    "eyJhbGciOiJIUzI1NiJ9",
    ".",
    "eyJzdWIiOiJ1c2VyLTEifQ",
    ".",
    "c2lnbmF0dXJlLXZhbHVl"
  );
  const GITHUB = shaped("gh", "p_", "a".repeat(36));
  const NPM = shaped("np", "m_", "b".repeat(36));
  const AWS = shaped("AK", "IA", "ABCDEFGHIJKLMNOP");
  const PEM = shaped(
    "-----BEGIN ",
    "PRIVATE KEY-----\n",
    "MIIB",
    "x".repeat(40),
    "\n-----END ",
    "PRIVATE KEY-----"
  );
  /** A JWT whose header is `header`, written as JSON allows, encoded. */
  const jwtWithHeader = (header: string) =>
    shaped(
      Buffer.from(header).toString("base64url"),
      ".",
      "eyJzdWIiOiJ1c2VyLTEifQ",
      ".",
      "c2lnbmF0dXJlLXZhbHVl"
    );

  /**
   * What an app's service logger receives for `message` and `meta`: as Node
   * prints them, and as a JSON writer serialises them, which is where a
   * `toJSON` runs.
   */
  function logged(message: string, meta: Record<string, unknown>) {
    const received: unknown[] = [];
    maskingServiceLogger({
      debug: (m: string, fields?: unknown) => received.push(m, fields),
      info: () => {},
      warn: () => {},
      error: () => {},
    }).debug(message, meta);
    return {
      printed: inspect(received, { depth: Infinity }),
      json: JSON.stringify(received),
    };
  }

  /** The message and fields an app's service logger receives, as values. */
  function receivedAs(message: string, meta: Record<string, unknown>) {
    const received: unknown[] = [];
    maskingServiceLogger({
      debug: (m: string, fields?: unknown) => received.push(m, fields),
      info: () => {},
      warn: () => {},
      error: () => {},
    }).debug(message, meta);
    const [text, fields] = received as [string, Record<string, unknown>];
    return { text, fields };
  }

  it.each([
    ["a JWT", JWT],
    // A JOSE header is any JSON object, so whitespace may follow its brace:
    // `{ "` encodes to `eyAi` and `{` then a line break to `ewo`, not `eyJ`.
    [
      "a JWT whose header has a space after its brace",
      jwtWithHeader('{ "alg":"HS256"}'),
    ],
    [
      "a JWT whose header is laid out on lines",
      jwtWithHeader('{\n  "alg": "HS256",\n  "typ": "JWT"\n}'),
    ],
    // A claims set may be the empty object, `{}` (`e30`), and an unsecured
    // JWT (`alg` "none") has an empty signature, so it ends at its last dot.
    [
      "a JWT with an empty claims set",
      shaped(
        Buffer.from('{"alg":"HS256"}').toString("base64url"),
        ".e30.",
        "c2lnbmF0dXJlLXZhbHVl"
      ),
    ],
    [
      "an unsecured JWT, its signature empty",
      shaped(
        Buffer.from('{"alg":"none"}').toString("base64url"),
        ".",
        "eyJzdWIiOiJ1c2VyLTEifQ",
        "."
      ),
    ],
    ["a GitHub personal token", GITHUB],
    ["a GitHub OAuth token", shaped("gh", "o_", "c".repeat(36))],
    ["a GitHub user-to-server token", shaped("gh", "u_", "d".repeat(36))],
    ["a GitHub server-to-server token", shaped("gh", "s_", "e".repeat(36))],
    ["a GitHub refresh token", shaped("gh", "r_", "f".repeat(36))],
    ["a GitHub fine-grained token", shaped("github_", "pat_", "g".repeat(40))],
    ["an npm token", NPM],
    ["an AWS access key id", AWS],
    ["an AWS temporary key id", shaped("AS", "IA", "QRSTUVWXYZ234567")],
    ["a Stripe secret key", shaped("sk_", "live_", "h".repeat(24))],
    ["a Stripe restricted key", shaped("rk_", "test_", "i".repeat(24))],
    ["a webhook signing secret", shaped("whsec_", "j".repeat(32))],
    // The webhook signer takes any `whsec_` whose rest decodes to one byte.
    ["a one-byte webhook signing secret", shaped("whsec_", "YQ==")],
    ["a one-byte webhook signing secret, unpadded", shaped("whsec_", "YQ")],
    // Every prefix GitLab's token overview lists.
    ...[
      "glpat-",
      "gloas-",
      "gldt-",
      "glrt-",
      "glrtr-",
      "glcbt-",
      "glptt-",
      "glft-",
      "glimt-",
      "glagent-",
      "glwt-",
      "glsoat-",
      "glffct-",
    ].map((prefix): [string, string] => [
      `a GitLab ${prefix} token`,
      shaped(prefix.slice(0, 2), prefix.slice(2), "k1_-".repeat(5), "z9"),
    ]),
    // Every prefix Slack's token documentation lists: bot, user, app-level
    // and workflow tokens, the rotating access tokens behind `xoxe.`, and the
    // refresh token.
    ["a Slack bot token", shaped("xo", "xb-", "1234567890-", "l".repeat(24))],
    [
      "a Slack user token",
      shaped("xo", "xp-", "111-222-333-", "d6bc".repeat(8)),
    ],
    [
      "a Slack app-level token",
      shaped("xa", "pp-", "1-A0123-4567-", "a1".repeat(16)),
    ],
    [
      "a Slack workflow token",
      shaped("xw", "fp-", "1-A0123-4567-", "b2".repeat(16)),
    ],
    [
      "a rotating Slack bot token",
      shaped("xoxe.", "xo", "xb-", "1-", "c3".repeat(16)),
    ],
    [
      "a rotating Slack user token",
      shaped("xoxe.", "xo", "xp-", "1-1234-", "d4".repeat(16)),
    ],
    [
      "a rotating Slack app-level token",
      shaped("xoxe.", "xa", "pp-", "1-", "e5".repeat(16)),
    ],
    ["a Slack refresh token", shaped("xo", "xe-", "1-", "f6".repeat(16))],
    ["a Google OAuth token", shaped("ya", "29.", "m".repeat(40))],
  ])("takes %s out of a neutral field and out of text", (_, credential) => {
    const { text, fields } = receivedAs(
      `upstream rejected ${credential} today`,
      {
        value: credential,
        note: `retrying after ${credential} was refused`,
      }
    );
    // Exactly one marker where the token was, and every other character as
    // it was: a match that left a prefix, a suffix or one character of the
    // token behind would no longer read like this.
    expect(text).toBe("upstream rejected [redacted] today");
    expect(fields).toEqual({
      value: "[redacted]",
      note: "retrying after [redacted] was refused",
    });
  });

  it("takes a stateless GitHub installation token out whole: prefix, app id and JWT", () => {
    // GitHub's stateless installation token, `ghs_<APPID>_<JWT>`.
    const stateless = shaped("gh", "s_", "123456", "_", JWT);
    const { text, fields } = receivedAs(
      `upstream rejected ${stateless} today`,
      {
        value: stateless,
      }
    );
    expect(text).toBe("upstream rejected [redacted] today");
    expect(fields).toEqual({ value: "[redacted]" });
  });

  it("finds a credential where a JWT-shaped run around it is refused", () => {
    // `accounts.<header>.<payload>` has a JWT's shape but no JOSE header, and
    // the real JWT starts at its second part; an npm token followed by two
    // dotted parts has a JWT's shape too, and is still an npm token.
    const { text, fields } = receivedAs(`sent accounts.${JWT} upstream`, {
      value: `${NPM}.segment2.segment3`,
    });
    expect(text).toBe("sent accounts.[redacted] upstream");
    expect(fields).toEqual({ value: "[redacted].segment2.segment3" });
  });

  it("takes a PEM block out whole, its body as well as its header", () => {
    // Read from what the logger received rather than from a printed form,
    // which escapes the block's line breaks and so could never contain it.
    const received: unknown[] = [];
    maskingServiceLogger({
      debug: (m: string, fields?: unknown) => received.push(m, fields),
      info: () => {},
      warn: () => {},
      error: () => {},
    }).debug(`key was ${PEM} and more`, { value: PEM });
    const [message, fields] = received as [string, { value: string }];
    for (const text of [message, fields.value]) {
      expect(text).not.toContain("MIIB" + "x".repeat(40));
      expect(text).not.toContain("PRIVATE KEY");
    }
    // POPULATION CONTROL: the words around it remain.
    expect(message).toContain("key was");
    expect(message).toContain("and more");
  });

  it("takes a shaped credential out of what a toJSON writes under a neutral key", () => {
    const { json } = logged("line", {
      slug: "home",
      detail: { toJSON: () => ({ value: GITHUB, label: "kept-label" }) },
    });
    expect(json).not.toContain(GITHUB);
    expect(json).toContain("kept-label");
  });

  it("takes shaped credentials out of bare header pairs", () => {
    const { printed } = logged("line", {
      pairs: [
        ["cookie", `sid=${JWT}`],
        ["authorization", NPM],
      ],
      flat: ["X-Api-Key", AWS],
    });
    expect(printed).not.toContain(JWT);
    expect(printed).not.toContain(NPM);
    expect(printed).not.toContain(AWS);
    // POPULATION CONTROL: the header names, which are not credentials, remain.
    expect(printed).toContain("cookie");
    expect(printed).toContain("sid=");
    expect(printed).toContain("X-Api-Key");
  });

  it("keeps ordinary ids, hashes, versions and prose that only resemble a credential", () => {
    const ordinary = {
      id: "user_01HZX3K9Q2",
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      sha1: "3f786850e387550fdab836ed7e6dc881de23001b",
      sha256:
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      base64: "dGhpcyBpcyBvcmRpbmFyeSBiYXNlNjQgdGV4dA==",
      version: "1.2.3",
      longVersion: "16.2.0-canary.12",
      kind: "plugin-accounts.identity.unlinked",
      modulePath: "observability.instrumentation.register",
      // Three dotted parts whose first is base64url JSON, as a pagination
      // cursor is, but not a JOSE header: an object with no `alg`.
      cursor: shaped(
        Buffer.from('{"page":2}').toString("base64url"),
        ".",
        "sortedby.createdat"
      ),
      prose: "the token expired, so a new token was requested",
      mention: "signing secrets start with whsec_ and keys with sk_live_",
      mentionMore:
        "runner tokens start with glrt-, deploy tokens with gldt- and app tokens with xapp-",
      slackWord: "xwfp-step-two",
      // A JWT's later parts may be short or empty, so dotted runs whose
      // first part is no JOSE header stay too: short parts, and an ellipsis.
      shortParts: "plugin-accounts.id.x",
      ellipsis: "loading configuration... done",
      word: "xoxo-gossip",
      shortKey: "AKIA-short",
      opaque: "order-42",
      // A run with a credential's shape inside a longer word is part of that
      // word, not a token: one with more after it, one with more before.
      longerRun: shaped("AK", "IA", "ABCDEFGHIJKLMNOP", "QRS"),
      snakeId: shaped("job_", "gh", "p_", "a".repeat(30)),
      snakeStateless: shaped("job_", "gh", "s_", "123456_", JWT),
    };
    const { printed, json } = logged(
      "the token expired at version 1.2.3 for plugin-accounts.identity.unlinked",
      { ...ordinary, detail: { toJSON: () => ({ value: "opaque-kept" }) } }
    );
    expect(printed).toContain(
      "the token expired at version 1.2.3 for plugin-accounts.identity.unlinked"
    );
    for (const value of Object.values(ordinary)) {
      expect(printed).toContain(value);
    }
    // A value with no credential's shape, under a name that says nothing, is
    // ordinary data as far as any log can tell, and stays.
    expect(json).toContain("opaque-kept");
  });
});
