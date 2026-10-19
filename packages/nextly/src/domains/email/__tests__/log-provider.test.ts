import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLogProvider,
  logProviderConfigFor,
} from "../services/providers/log-provider";

describe("the log provider", () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the send as successful with a message id", async () => {
    const adapter = createLogProvider({
      includeBody: true,
      maskAddresses: false,
    });

    const result = await adapter.send({
      to: "person@example.com",
      from: "app@example.com",
      subject: "Reset your password",
      html: "<p>token=abc123</p>",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^log-/);
  });

  it("writes the body when bodies are included", async () => {
    const adapter = createLogProvider({
      includeBody: true,
      maskAddresses: false,
    });

    await adapter.send({
      to: "person@example.com",
      from: "app@example.com",
      subject: "Reset your password",
      html: "<p>token=abc123</p>",
    });

    expect(lines.join("\n")).toContain("token=abc123");
  });

  it("omits the body when bodies are excluded, keeping recipient and subject", async () => {
    const adapter = createLogProvider({
      includeBody: false,
      maskAddresses: false,
    });

    await adapter.send({
      to: "person@example.com",
      from: "app@example.com",
      subject: "Reset your password",
      html: "<p>token=abc123</p>",
    });

    const output = lines.join("\n");
    expect(output).not.toContain("token=abc123");
    expect(output).toContain("person@example.com");
    expect(output).toContain("Reset your password");
  });
});

describe("the log provider in each environment", () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Send one message through the provider configured for this NODE_ENV. */
  async function sendIn(nodeEnv: string | undefined): Promise<string> {
    const adapter = createLogProvider(logProviderConfigFor(nodeEnv));
    await adapter.send({
      to: "john@example.com, jane@example.com",
      from: "Shop <orders@shop.example>",
      cc: ["carol@example.com"],
      bcc: ["dave@example.com"],
      replyTo: "support@shop.example",
      subject: "Your reset link, john@example.com",
      html: "<p>token=abc123</p>",
    });
    return lines.join("\n");
  }

  const ADDRESSES = [
    "john@example.com",
    "jane@example.com",
    "orders@shop.example",
    "carol@example.com",
    "dave@example.com",
    "support@shop.example",
  ];

  it.each(["production", undefined, "staging"])(
    "masks every address and leaves the body out when NODE_ENV=%s",
    async nodeEnv => {
      const output = await sendIn(nodeEnv);
      for (const address of ADDRESSES) expect(output).not.toContain(address);
      // Each position, a caller-supplied `from` and the subject included,
      // still says who the message was for.
      for (const masked of [
        "j***@example.com",
        "o***@shop.example",
        "c***@example.com",
        "d***@example.com",
        "s***@shop.example",
        "Your reset link, j***@example.com",
      ]) {
        expect(output).toContain(masked);
      }
      expect(output).not.toContain("token=abc123");
    }
  );

  it.each(["development", "test"])(
    "writes full addresses and the body when NODE_ENV=%s",
    async nodeEnv => {
      const output = await sendIn(nodeEnv);
      for (const address of ADDRESSES) expect(output).toContain(address);
      expect(output).toContain("token=abc123");
    }
  );
});
