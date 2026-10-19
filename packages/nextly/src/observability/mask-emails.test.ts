/**
 * Email addresses are masked to their first character and their domain in
 * what Nextly logs outside development and test.
 *
 * The property under test is that no full address survives, wherever it sits
 * in a value — a string, a nested field, a list, an error's message or cause —
 * while text that is not an address is left exactly as it was. A masker that
 * missed one position, or that rewrote look-alikes, fails a case here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { consoleLogger } from "../shared/types";

import {
  emailMaskingEnabled,
  maskEmailAddress,
  maskEmails,
  maskEmailsInText,
} from "./mask-emails";

describe("when addresses are masked", () => {
  it.each([
    ["production", true],
    [undefined, true],
    ["staging", true],
    ["", true],
    ["development", false],
    ["test", false],
  ])("NODE_ENV=%s masks: %s", (nodeEnv, masked) => {
    expect(emailMaskingEnabled(nodeEnv)).toBe(masked);
  });
});

describe("masking one address", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmailAddress("john@example.com")).toBe("j***@example.com");
    expect(maskEmailAddress('"john@doe"@example.com')).toBe("j***@example.com");
  });
});

describe("masking addresses in text", () => {
  it.each([
    ["john@example.com", "j***@example.com"],
    [
      "550 5.1.1 <john@example.com>: user unknown",
      "550 5.1.1 <j***@example.com>: user unknown",
    ],
    ["John.Smith@Example.COM", "J***@Example.COM"],
    ["jane+orders@shop.example.co.uk", "j***@shop.example.co.uk"],
    ["to a@b.io and c_d@mail.b.io", "to a***@b.io and c***@mail.b.io"],
    // A punycode top-level label, and an internationalized domain and local
    // part, each masked whole.
    ["john@example.xn--p1ai", "j***@example.xn--p1ai"],
    // A punycode label in any letter case: DNS labels are case-insensitive.
    ["john@example.XN--P1AI", "j***@example.XN--P1AI"],
    ["john@example.Xn--p1ai", "j***@example.Xn--p1ai"],
    // Scripts that write with combining marks (a Devanagari vowel sign or
    // virama), in the local part and in the domain, masked whole.
    ["जॉन@example.com", "ज***@example.com"],
    ["जो@example.com", "ज***@example.com"],
    ["john@उदाहरण.भारत", "j***@उदाहरण.भारत"],
    ["john@bücher.de", "j***@bücher.de"],
    ["jöhn@example.com", "j***@example.com"],
    ["ölaf@example.com", "ö***@example.com"],
    ["𝒥ane@example.com", "𝒥***@example.com"],
    // A quoted local part, and the punctuation an unquoted one may hold:
    // masked whole, with no prefix left before the match.
    ['"john.doe"@example.com', "j***@example.com"],
    ['<"john doe"@example.com>', "<j***@example.com>"],
    ["customer/department=shipping@example.com", "c***@example.com"],
    ["o'brien@example.com", "o***@example.com"],
    ["a!b#c$d%e&f*g?h^i`j{k|l}m~n@example.com", "a***@example.com"],
    // Domain literals, an address and a tagged one.
    ["john@[192.0.2.1]", "j***@[192.0.2.1]"],
    ["<john@[IPv6:2001:db8::1]>", "<j***@[IPv6:2001:db8::1]>"],
  ])("masks %s", (input, expected) => {
    expect(maskEmailsInText(input)).toBe(expected);
  });

  it.each([
    "import from @scope/pkg",
    "http://user@localhost:3000/admin",
    "price @ 3 for 2",
    "no addresses here",
    "http://user@intranet:3000/admin",
    "read arr@[0] first",
  ])("leaves %s unchanged", text => {
    expect(maskEmailsInText(text)).toBe(text);
  });
});

describe("the services' fallback console logger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("masks its message and fields outside development and test", () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogger.error("send to john@example.com failed", {
      cause: new Error("550 <jane@example.com>: user unknown"),
      to: ["carol@example.com"],
    });
    const written = JSON.stringify(
      error.mock.calls.map(args =>
        args.map(a => (a instanceof Error ? a.message : a))
      )
    );
    for (const address of ["john@example.com", "carol@example.com"]) {
      expect(written).not.toContain(address);
    }
    expect(written).toContain("j***@example.com");
    expect(written).toContain("c***@example.com");
    const meta = error.mock.calls[0][1] as { cause: Error };
    expect(meta.cause.message).toBe("550 <j***@example.com>: user unknown");
  });

  it("writes them whole in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    consoleLogger.info("sent to john@example.com");
    expect(String(info.mock.calls[0][0])).toContain("john@example.com");
  });
});

describe("masking addresses in a value", () => {
  it("masks nested fields and lists, and keeps everything else", () => {
    const masked = maskEmails({
      event: "email.failed",
      count: 2,
      ok: false,
      to: ["a@example.com", "b@example.com"],
      detail: { cause: { message: "rejected c@example.com" } },
    });
    expect(masked).toEqual({
      event: "email.failed",
      count: 2,
      ok: false,
      to: ["a***@example.com", "b***@example.com"],
      detail: { cause: { message: "rejected c***@example.com" } },
    });
  });

  it("masks an error's message, stack and cause", () => {
    const error = new Error("send to john@example.com failed", {
      cause: new Error("550 <jane@example.com>: user unknown"),
    });
    const masked = maskEmails(error);
    const text = JSON.stringify({
      message: masked.message,
      stack: masked.stack,
      cause: (masked.cause as Error).message,
    });
    expect(text).not.toContain("john@example.com");
    expect(text).not.toContain("jane@example.com");
    expect(masked.message).toBe("send to j***@example.com failed");
    expect((masked.cause as Error).message).toBe(
      "550 <j***@example.com>: user unknown"
    );
    expect(masked).toBeInstanceOf(Error);
  });

  it("keeps an aggregate error's failures, each masked", () => {
    // `errors` is an own property that is not enumerable, so a copy that
    // only walks enumerable fields loses every failure the aggregate holds.
    const aggregate = new AggregateError(
      [
        new Error("550 <john@example.com>: user unknown"),
        "421 <jane@example.com>: try later",
      ],
      "every provider refused"
    );
    const masked = maskEmails(aggregate);
    expect(masked).toBeInstanceOf(AggregateError);
    expect(Object.keys(masked)).not.toContain("errors");
    const [first, second] = (masked as AggregateError).errors as [
      Error,
      string,
    ];
    expect(first).toBeInstanceOf(Error);
    expect(first.message).toBe("550 <j***@example.com>: user unknown");
    expect(second).toBe("421 <j***@example.com>: try later");
  });

  it("copies a DOMException without throwing, still one", () => {
    // Its name, message and code read slots only its own constructor
    // creates, so a copy that borrows its prototype throws on the first.
    const aborted = new DOMException(
      "request for john@example.com aborted",
      "AbortError"
    );
    const masked = maskEmails({ error: aborted }).error;
    expect(masked).toBeInstanceOf(DOMException);
    expect(masked.name).toBe("AbortError");
    expect(masked.code).toBe(aborted.code);
    expect(masked.message).toBe("request for j***@example.com aborted");
  });

  it("never throws on an error whose fields cannot be read", () => {
    // Masking runs inside log calls, often inside a catch that absorbs a
    // failure; an error that refuses to be walked is logged by its message.
    const unreadable = new Proxy(new Error("send to john@example.com failed"), {
      ownKeys() {
        throw new Error("no keys");
      },
    });
    const masked = maskEmails({ error: unreadable }).error;
    expect(masked).toBeInstanceOf(Error);
    expect(masked.message).toBe("send to j***@example.com failed");
  });

  it("masks addresses in keys, keeping two that mask alike apart", () => {
    const masked = maskEmails({
      "john@example.com": "rejected",
      "jane@example.com": "deferred",
    });
    expect(masked).toEqual({
      "j***@example.com": "rejected",
      "j***@example.com (2)": "deferred",
    });
  });

  it("keeps a __proto__ key a field of the copy", () => {
    const parsed = JSON.parse('{"__proto__": "john@example.com"}') as object;
    const masked = maskEmails(parsed) as Record<string, unknown>;
    expect(Object.getPrototypeOf(masked)).toBe(Object.prototype);
    expect(Object.hasOwn(masked, "__proto__")).toBe(true);
    expect(masked["__proto__"]).toBe("j***@example.com");
  });

  it("masks an address in an error's name", () => {
    // Not enumerable, as a class or the constructor sets it: assigning it
    // would make an own enumerable field, which is masked by another path.
    const error = new Error("refused");
    Object.defineProperty(error, "name", {
      value: "RecipientError john@example.com",
      enumerable: false,
    });
    expect(maskEmails(error).name).toBe("RecipientError j***@example.com");
  });

  it("never throws on an error whose message cannot be read", () => {
    const unreadable = new Proxy(new Error("send to john@example.com failed"), {
      get(target, key) {
        if (key === "message") throw new Error("no message");
        return Reflect.get(target, key) as unknown;
      },
    });
    const masked = maskEmails({ error: unreadable }).error;
    expect(masked).toBeInstanceOf(Error);
    expect(masked.message).toBe("(unreadable error)");
  });

  it("does not loop on a value that refers to itself", () => {
    const loop: Record<string, unknown> = { to: "a@example.com" };
    loop.self = loop;
    const masked = maskEmails(loop) as Record<string, unknown>;
    expect(masked.to).toBe("a***@example.com");
  });

  it("leaves the original value untouched", () => {
    const original = { to: "a@example.com" };
    maskEmails(original);
    expect(original.to).toBe("a@example.com");
  });
});
