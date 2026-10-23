import { describe, expect, it } from "vitest";

import { acceptedTest, explainSetupFailure, loggedTest } from "../setup-copy";

describe("explainSetupFailure", () => {
  it.each([
    ["credentials", "Resend refused the sign-in.", /app password/],
    ["sender", "Resend won't send from a@b.co.", /domain verified with Resend/],
    ["recipient", "Resend refused c@d.co.", /your own address/],
    ["rate-limited", "Resend is limiting how much is sent right now.", /Wait/],
    ["connect", "Nextly couldn't reach Resend.", /host and port/],
    ["other", "Resend didn't accept the test.", /server log/],
  ] as const)("explains %s, with what to check", (setup, title, check) => {
    const explained = explainSetupFailure(setup, "Resend", {
      from: "a@b.co",
      to: "c@d.co",
    });
    expect(explained.title).toBe(title);
    expect(explained.check).toMatch(check);
  });

  it("explains a failure with no category as other", () => {
    expect(explainSetupFailure(undefined, "SMTP").title).toBe(
      "SMTP didn't accept the test."
    );
  });
});

describe("a test that worked", () => {
  it("says the provider accepted it, not that it arrived", () => {
    const accepted = acceptedTest("Resend", "me@example.com");
    expect(accepted.title).toBe("Resend accepted the test email.");
    expect(accepted.title).not.toMatch(/deliver|arriv/i);
    expect(accepted.check).toMatch(/Check me@example.com/);
  });

  it("says a test through Log was logged, not sent", () => {
    expect(loggedTest().title).toBe("The test email was logged, not sent.");
  });
});
