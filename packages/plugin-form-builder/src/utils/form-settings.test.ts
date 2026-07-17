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

  it("migrates the legacy nested captcha object to the flat keys", () => {
    const settings = normalizeFormSettings({
      captcha: { enabled: true, siteKey: "site_123" },
    });
    expect(settings.captchaEnabled).toBe(true);
    expect(settings.captchaSiteKey).toBe("site_123");
  });

  it("drops settings that have no consumer", () => {
    const settings = normalizeFormSettings({
      showResetButton: true,
      resetButtonText: "Reset",
      storeSubmissions: false,
      submissionLimit: 5,
    }) as Record<string, unknown>;
    expect(settings.showResetButton).toBeUndefined();
    expect(settings.resetButtonText).toBeUndefined();
    expect(settings.storeSubmissions).toBeUndefined();
    expect(settings.submissionLimit).toBeUndefined();
  });

  it("keeps spam overrides tri-state: unset means inherit", () => {
    expect(normalizeFormSettings({}).honeypotEnabled).toBeUndefined();
    expect(normalizeFormSettings({}).captchaEnabled).toBeUndefined();
    expect(
      normalizeFormSettings({ honeypotEnabled: false }).honeypotEnabled
    ).toBe(false);
  });

  it("keeps redirect configuration intact", () => {
    const settings = normalizeFormSettings({
      confirmationType: "redirect",
      redirectUrl: "https://example.com/thanks",
    });
    expect(settings.confirmationType).toBe("redirect");
    expect(settings.redirectUrl).toBe("https://example.com/thanks");
  });
});
