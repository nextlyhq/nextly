/**
 * Template data may hold any value, but a site's code version
 * (`email.templates` in `defineConfig()`) is promised strings: only a string
 * reaches it, and anything else arrives as missing.
 */
import { describe, expect, it, vi } from "vitest";

import { EmailService } from "../services/email-service";

vi.mock("../../../shared/lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-32chars-long!!",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function serviceWith(passwordReset: (input: unknown) => unknown) {
  const service = new EmailService(
    {} as never,
    logger as never,
    {
      getProviderDecrypted: vi.fn(),
      getDefaultProviderDecrypted: vi.fn().mockResolvedValue(null),
    } as never,
    {
      getTemplateBySlug: vi.fn().mockResolvedValue(null),
      getLayoutFor: vi.fn().mockResolvedValue(null),
    } as never,
    { templates: { passwordReset } } as never
  );
  vi.spyOn(
    service as unknown as { send: () => Promise<unknown> },
    "send"
  ).mockResolvedValue({ success: true, messageId: "m" });
  return service;
}

describe("the site's code version gets strings only", () => {
  it("passes strings through, and anything else as missing", async () => {
    const seen: unknown[] = [];
    const service = serviceWith(input => {
      seen.push(input);
      return { subject: "Reset", html: "<p>reset</p>" };
    });

    await service.sendWithTemplate("password-reset", "ada@example.com", {
      userName: "Ada",
      token: "t1",
      resetLink: "https://example.com/r",
    });
    await service.sendWithTemplate("password-reset", "ada@example.com", {
      userName: { first: "Ada" },
      token: 42,
      resetLink: ["https://example.com/r"],
    });

    expect(seen[0]).toMatchObject({
      user: { name: "Ada" },
      token: "t1",
      url: "https://example.com/r",
    });
    expect(seen[1]).toMatchObject({
      user: { name: null },
      token: undefined,
      url: undefined,
    });
  });
});
