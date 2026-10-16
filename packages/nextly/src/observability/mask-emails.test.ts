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
  ])("masks %s", (input, expected) => {
    expect(maskEmailsInText(input)).toBe(expected);
  });

  it.each([
    "import from @scope/pkg",
    "http://user@localhost:3000/admin",
    "price @ 3 for 2",
    "no addresses here",
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
