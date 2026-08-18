import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogProvider } from "../services/providers/log-provider";

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
    const adapter = createLogProvider({ includeBody: true });

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
    const adapter = createLogProvider({ includeBody: true });

    await adapter.send({
      to: "person@example.com",
      from: "app@example.com",
      subject: "Reset your password",
      html: "<p>token=abc123</p>",
    });

    expect(lines.join("\n")).toContain("token=abc123");
  });

  it("omits the body when bodies are excluded, keeping recipient and subject", async () => {
    const adapter = createLogProvider({ includeBody: false });

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
