/**
 * A send that fails because of its template says so, for "Fix template":
 * here, the site's code version of a template throwing as it renders, which
 * happens before any provider is asked.
 */
import { describe, expect, it, vi } from "vitest";

import { thrownAttemptFailure } from "../queued-send";
import { EmailService } from "../services/email-service";
import { isTemplateCaused } from "../template-failure";

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

/** The service with a code version of the password reset, and no stored one. */
function serviceWith(passwordReset: (input: unknown) => unknown) {
  return new EmailService(
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
}

describe("a template's own failure", () => {
  it("is marked as the template's when the site's code version throws", async () => {
    const service = serviceWith(() => {
      throw new Error("the code template broke");
    });

    const thrown = await service
      .sendWithTemplate("password-reset", "ada@example.com", {})
      .then(
        () => undefined,
        (error: unknown) => error
      );

    expect(thrown).toBeInstanceOf(Error);
    expect(isTemplateCaused(thrown)).toBe(true);
    // A queued email's attempt records it as such, with its reason unchanged.
    expect(thrownAttemptFailure(thrown)).toMatchObject({ retryable: true });
  });

  it("is not marked for an error that came from elsewhere", () => {
    expect(isTemplateCaused(new Error("the provider broke"))).toBe(false);
    expect(isTemplateCaused("not an error")).toBe(false);
  });
});
