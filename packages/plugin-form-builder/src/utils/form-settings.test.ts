import { describe, expect, it } from "vitest";

import { normalizeFormSettings } from "./form-settings";

describe("normalizeFormSettings", () => {
  it("returns the canonical defaults for empty or non-object input", () => {
    for (const raw of [undefined, null, "x", 42, []]) {
      expect(normalizeFormSettings(raw)).toMatchObject({
        submitButtonText: "Submit",
        confirmationType: "message",
        successMessage: "Thank you for your submission!",
        allowMultipleSubmissions: true,
      });
    }
  });

  it("migrates the legacy confirmationMessage key on read", () => {
    const settings = normalizeFormSettings({
      confirmationMessage: "Thanks, we got it!",
    });
    expect(settings.confirmationType).toBe("message");
    expect(settings.successMessage).toBe("Thanks, we got it!");
  });

  it("prefers the declared successMessage over the legacy key", () => {
    const settings = normalizeFormSettings({
      successMessage: "New copy",
      confirmationMessage: "Old copy",
    });
    expect(settings.successMessage).toBe("New copy");
  });

  it("reads the legacy nested captcha object as the bot check and site key", () => {
    const settings = normalizeFormSettings({
      captcha: { enabled: true, siteKey: "site_123" },
    });
    expect(settings.botCheck).toBe("recaptcha");
    expect(settings.captchaSiteKey).toBe("site_123");
  });

  it("drops settings that have no consumer", () => {
    const settings = normalizeFormSettings({
      showResetButton: true,
      resetButtonText: "Reset",
      storeSubmissions: false,
    }) as Record<string, unknown>;
    expect(settings.showResetButton).toBeUndefined();
    expect(settings.resetButtonText).toBeUndefined();
    expect(settings.storeSubmissions).toBeUndefined();
  });

  it("keeps spam overrides tri-state: unset means inherit", () => {
    expect(normalizeFormSettings({}).honeypotEnabled).toBeUndefined();
    expect(normalizeFormSettings({}).botCheck).toBe("default");
    expect(
      normalizeFormSettings({ honeypotEnabled: false }).honeypotEnabled
    ).toBe(false);
  });

  it("preserves relationship-based redirects verbatim", () => {
    // Relationship references may be plain IDs or structured values — both
    // must survive normalization byte-for-byte, never coerced.
    const structuredRef = { relationTo: "pages", value: "page_123" };
    const settings = normalizeFormSettings({
      confirmationType: "relationship",
      redirectPage: structuredRef,
    });
    expect(settings.confirmationType).toBe("relationship");
    expect(settings.redirectPage).toBe(structuredRef);

    expect(
      normalizeFormSettings({
        confirmationType: "relationship",
        redirectPage: "page_123",
      }).redirectPage
    ).toBe("page_123");
  });

  it("keeps redirect configuration intact", () => {
    const settings = normalizeFormSettings({
      confirmationType: "redirect",
      redirectUrl: "https://example.com/thanks",
    });
    expect(settings.confirmationType).toBe("redirect");
    expect(settings.redirectUrl).toBe("https://example.com/thanks");
  });

  // The settings that replace two of today's read today's values, so no
  // form's behaviour changes until someone edits it.
  it.each([
    [{}, "off"],
    [{ allowMultipleSubmissions: true }, "off"],
    [{ allowMultipleSubmissions: false }, "ip"],
    [{ allowMultipleSubmissions: false, oneResponse: "email" }, "email"],
    [{ oneResponse: "nonsense" }, "off"],
  ])("reads one response per person from %j as %s", (stored, expected) => {
    expect(normalizeFormSettings(stored).oneResponse).toBe(expected);
  });

  it.each([
    [{}, "default"],
    [{ captchaEnabled: true }, "recaptcha"],
    [{ captchaEnabled: false }, "off"],
    [{ captchaEnabled: true, botCheck: "turnstile" }, "turnstile"],
    [{ botCheck: "nonsense" }, "default"],
  ])("reads the bot check from %j as %s", (stored, expected) => {
    expect(normalizeFormSettings(stored).botCheck).toBe(expected);
  });

  it("writes neither replaced setting back", () => {
    const settings = normalizeFormSettings({
      allowMultipleSubmissions: false,
      captchaEnabled: true,
    }) as Record<string, unknown>;
    expect(settings.allowMultipleSubmissions).toBeUndefined();
    expect(settings.captchaEnabled).toBeUndefined();
  });

  it("starts a form that never set them on today's behaviour", () => {
    expect(normalizeFormSettings({})).toMatchObject({
      oneResponse: "off",
      oneResponseVersion: 0,
      botCheck: "default",
      storeIpAndBrowser: true,
    });
    const settings = normalizeFormSettings({});
    expect(settings.closesAt).toBeUndefined();
    expect(settings.submissionLimit).toBeUndefined();
    expect(settings.keepDays).toBeUndefined();
  });

  it("keeps whole, positive limits and drops anything else", () => {
    expect(
      normalizeFormSettings({ submissionLimit: 120 }).submissionLimit
    ).toBe(120);
    expect(
      normalizeFormSettings({ submissionLimit: 0 }).submissionLimit
    ).toBeUndefined();
    expect(normalizeFormSettings({ keepDays: 2.5 }).keepDays).toBeUndefined();
    expect(
      normalizeFormSettings({ oneResponseVersion: 3 }).oneResponseVersion
    ).toBe(3);
  });
});
