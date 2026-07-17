/**
 * The ONE reader for stored form settings. Settings were historically
 * written in two shapes (the builder's old context shape and the collection
 * group's declared shape), so every consumer — the builder UI and the
 * submit handler alike — normalizes through here instead of trusting the
 * stored keys.
 */

import { DEFAULT_FORM_SETTINGS } from "../config/defaults";
import type { FormSettings } from "../types";

export { DEFAULT_FORM_SETTINGS };

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Normalize a stored settings value into the canonical {@link FormSettings}.
 *
 * Legacy keys are migrated on read (no data is lost, nothing is rewritten
 * until the form is next saved):
 * - `confirmationMessage` → `successMessage` + `confirmationType: "message"`
 * - nested `captcha: { enabled, siteKey }` → flat `captchaEnabled`/`captchaSiteKey`
 *
 * Keys with no consumer (`showResetButton`, `resetButtonText`,
 * `storeSubmissions`, `submissionLimit`) are dropped: a setting that does
 * nothing must not survive into the UI.
 */
export function normalizeFormSettings(raw: unknown): FormSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_FORM_SETTINGS };
  }
  const source = raw as Record<string, unknown>;

  const legacyMessage = asOptionalString(source.confirmationMessage);
  const legacyCaptcha =
    source.captcha && typeof source.captcha === "object"
      ? (source.captcha as { enabled?: unknown; siteKey?: unknown })
      : undefined;

  // "relationship" is a real stored value (redirect to a linked document) —
  // coercing it to "message" would disable the form's redirect on the next
  // save. Only genuinely unknown values fall back to "message".
  const confirmationType =
    source.confirmationType === "redirect" ||
    source.confirmationType === "relationship"
      ? source.confirmationType
      : "message";

  return {
    submitButtonText:
      asOptionalString(source.submitButtonText) ??
      DEFAULT_FORM_SETTINGS.submitButtonText,
    confirmationType,
    successMessage:
      asOptionalString(source.successMessage) ??
      legacyMessage ??
      DEFAULT_FORM_SETTINGS.successMessage,
    redirectUrl: asOptionalString(source.redirectUrl),
    redirectPage: source.redirectPage ?? undefined,
    redirectRelation:
      source.redirectRelation && typeof source.redirectRelation === "object"
        ? (source.redirectRelation as FormSettings["redirectRelation"])
        : undefined,
    allowMultipleSubmissions:
      asOptionalBoolean(source.allowMultipleSubmissions) ??
      DEFAULT_FORM_SETTINGS.allowMultipleSubmissions,
    honeypotEnabled: asOptionalBoolean(source.honeypotEnabled),
    captchaEnabled:
      asOptionalBoolean(source.captchaEnabled) ??
      asOptionalBoolean(legacyCaptcha?.enabled),
    captchaSiteKey:
      asOptionalString(source.captchaSiteKey) ??
      asOptionalString(legacyCaptcha?.siteKey),
  };
}
