/**
 * What the Sending tab is told about how email goes out when no provider is
 * chosen: the default sender, and the provider set in the site's code by type
 * and label only, never its configuration.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EmailProviderService } from "../email-provider-service";
import { EmailService } from "../email-service";
import type { EmailTemplateService } from "../email-template-service";

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const adapter = {
  getDb: () => ({}),
  getCapabilities: () => ({ dialect: "postgresql" }),
} as unknown as DrizzleAdapter;

function service(emailConfig?: ConstructorParameters<typeof EmailService>[4]) {
  return new EmailService(
    adapter,
    logger,
    {} as EmailProviderService,
    {} as EmailTemplateService,
    emailConfig
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sendingSettings", () => {
  it("names the provider set in code by type and label, with the sender", () => {
    const settings = service({
      providerConfig: {
        provider: "smtp",
        host: "smtp.example.com",
        port: 587,
        auth: { user: "user", pass: "a-secret-password" },
      },
      from: "Northwind <hello@example.com>",
    } as never).sendingSettings();

    expect(settings.from).toBe("Northwind <hello@example.com>");
    expect(settings.codeProvider).toEqual({ type: "smtp", label: "SMTP" });
    // Never its configuration.
    expect(JSON.stringify(settings)).not.toContain("a-secret-password");
    expect(JSON.stringify(settings)).not.toContain("smtp.example.com");
  });

  it("says nothing is set in code when nothing is", () => {
    expect(service().sendingSettings()).toMatchObject({
      from: null,
      codeProvider: null,
    });
  });

  it("says whether the server runs in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(service().sendingSettings().development).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(service().sendingSettings().development).toBe(false);
  });
});
