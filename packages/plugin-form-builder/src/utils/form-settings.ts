/**
 * The ONE reader for stored form settings. Settings were historically
 * written in two shapes (the builder's old context shape and the collection
 * group's declared shape), so every consumer — the builder UI and the
 * submit handler alike — normalizes through here instead of trusting the
 * stored keys.
 */

import { DEFAULT_FORM_SETTINGS } from "../config/defaults";
import type { BotCheckMode, FormSettings, OneResponseMode } from "../types";

export { DEFAULT_FORM_SETTINGS };

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A whole number of zero or more, or `undefined`. */
function asWholeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/** A whole number above zero, or `undefined`. */
function asPositiveWholeNumber(value: unknown): number | undefined {
  const whole = asWholeNumber(value);
  return whole === undefined || whole === 0 ? undefined : whole;
}

const ONE_RESPONSE_MODES: readonly OneResponseMode[] = [
  "off",
  "email",
  "browser",
  "ip",
];

const BOT_CHECK_MODES: readonly BotCheckMode[] = [
  "default",
  "off",
  "recaptcha",
  "turnstile",
];

/**
 * The form's one-response mode: as stored, or read from the setting it
 * replaced, so no form's behaviour changes. Several responses allowed reads
 * as `"off"`; one per network address as `"ip"`, the only check it had.
 */
function oneResponseOf(source: Record<string, unknown>): OneResponseMode {
  const stored = ONE_RESPONSE_MODES.find(mode => mode === source.oneResponse);
  if (stored !== undefined) return stored;
  const allowMultiple = asOptionalBoolean(source.allowMultipleSubmissions);
  if (allowMultiple === false) return "ip";
  return DEFAULT_FORM_SETTINGS.oneResponse;
}

/**
 * The form's bot check: as stored, or read from the per-form reCAPTCHA
 * switch it replaced: unset follows the plugin, on is reCAPTCHA, off is off,
 * so no form's protection changes.
 */
function botCheckOf(
  source: Record<string, unknown>,
  captchaEnabled: boolean | undefined
): BotCheckMode {
  const stored = BOT_CHECK_MODES.find(mode => mode === source.botCheck);
  if (stored !== undefined) return stored;
  if (captchaEnabled === true) return "recaptcha";
  if (captchaEnabled === false) return "off";
  return DEFAULT_FORM_SETTINGS.botCheck;
}

/**
 * Normalize a stored settings value into the canonical {@link FormSettings}.
 *
 * Legacy keys are migrated on read (no data is lost, nothing is rewritten
 * until the form is next saved):
 * - `confirmationMessage` → `successMessage` + `confirmationType: "message"`
 * - nested `captcha: { enabled, siteKey }` → flat `captchaSiteKey`, and its
 *   `enabled` read as `botCheck`
 * - `allowMultipleSubmissions` → `oneResponse`; `captchaEnabled` → `botCheck`
 *
 * Keys with no consumer (`showResetButton`, `resetButtonText`,
 * `storeSubmissions`) are dropped: a setting that does nothing must not
 * survive into the UI.
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
    oneResponse: oneResponseOf(source),
    oneResponseField: asOptionalString(source.oneResponseField),
    oneResponseVersion:
      asWholeNumber(source.oneResponseVersion) ??
      DEFAULT_FORM_SETTINGS.oneResponseVersion,
    honeypotEnabled: asOptionalBoolean(source.honeypotEnabled),
    botCheck: botCheckOf(
      source,
      asOptionalBoolean(source.captchaEnabled) ??
        asOptionalBoolean(legacyCaptcha?.enabled)
    ),
    closesAt: asOptionalString(source.closesAt),
    submissionLimit: asPositiveWholeNumber(source.submissionLimit),
    storeIpAndBrowser:
      asOptionalBoolean(source.storeIpAndBrowser) ??
      DEFAULT_FORM_SETTINGS.storeIpAndBrowser,
    keepDays: asPositiveWholeNumber(source.keepDays),
    internalNote: asOptionalString(source.internalNote),
    captchaSiteKey:
      asOptionalString(source.captchaSiteKey) ??
      asOptionalString(legacyCaptcha?.siteKey),
  };
}
