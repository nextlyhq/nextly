/**
 * Bot checks: Google reCAPTCHA v3, which scores each visitor in the
 * background, and Cloudflare Turnstile, which checks them in the background
 * and rarely shows a puzzle. Either gives the visitor's browser a token,
 * which the site's form sends with the submission under the provider's own
 * field name, and which the server verifies with the provider before the
 * submission is accepted.
 *
 * A token that fails, or a submission that brings none, is stored flagged as
 * spam, as a honeypot hit is, so a false positive stays reviewable and
 * recoverable. A provider that cannot be reached leaves the submission
 * unchecked, and says so in the log: an outage must not send every real
 * submission to spam. A form whose check has no secret configured is
 * accepted unchecked, as before bot checks were verified, with a warning at
 * start and in Settings.
 *
 * @module handlers/bot-check
 */
import { z } from "zod";

import type { BotCheckMode, ResolvedFormBuilderConfig } from "../types";
import { normalizeFormSettings } from "../utils/form-settings";

import {
  type BotProvider,
  sendVerification,
  VERIFY_HOSTS,
  type VerifyFetch,
} from "./bot-check-send";

export type { BotProvider } from "./bot-check-send";

/** The field each provider's widget puts its token in, as forms send it. */
const TOKEN_FIELDS: Readonly<Record<BotProvider, string>> = {
  recaptcha: "g-recaptcha-response",
  turnstile: "cf-turnstile-response",
};

/** The score below which reCAPTCHA calls a visitor a bot, unless set. */
const DEFAULT_SCORE_THRESHOLD = 0.5;

type SpamProtection = ResolvedFormBuilderConfig["spamProtection"];

/**
 * The provider a form's bot check names, its site default resolved: the
 * plugin's reCAPTCHA when enabled, else its Turnstile when enabled, else none.
 */
export function botProviderOf(
  botCheck: BotCheckMode | undefined,
  spam: SpamProtection
): BotProvider | undefined {
  if (botCheck === "off") return undefined;
  if (botCheck === "recaptcha" || botCheck === "turnstile") return botCheck;
  if (spam.recaptcha?.enabled === true) return "recaptcha";
  if (spam.turnstile?.enabled === true) return "turnstile";
  return undefined;
}

/** The plugin's secret for `provider`, when one is set. */
function secretOf(
  provider: BotProvider,
  spam: SpamProtection
): string | undefined {
  const secret = spam[provider]?.secretKey;
  return secret ? secret : undefined;
}

/**
 * The site key a visitor's form renders `provider`'s widget with: the
 * plugin's, or, for reCAPTCHA, a key the form stored itself before keys
 * moved into the plugin's options.
 */
function siteKeyOf(
  provider: BotProvider,
  spam: SpamProtection,
  settings: { captchaSiteKey?: string }
): string | undefined {
  const own = spam[provider]?.siteKey;
  if (own) return own;
  return provider === "recaptcha" ? settings.captchaSiteKey : undefined;
}

const RECAPTCHA_ANSWER = z.object({
  success: z.boolean(),
  score: z.number().optional(),
});
const TURNSTILE_ANSWER = z.object({ success: z.boolean() });

/** What a bot check found. */
export type BotVerdict = "pass" | "fail" | "unchecked";

/**
 * Verify `token` with `provider`. A missing token fails: the form's widget
 * never ran. A provider that cannot be reached, or answers something that is
 * not its answer, leaves the submission unchecked.
 */
export async function judgeBotToken(input: {
  provider: BotProvider;
  secret: string;
  token: string | undefined;
  ip?: string;
  scoreThreshold?: number;
  fetch: VerifyFetch | undefined;
}): Promise<BotVerdict> {
  if (!input.token) return "fail";
  if (!input.fetch) return "unchecked";
  let answer: unknown;
  try {
    answer = await sendVerification(input.fetch, input.provider, {
      secret: input.secret,
      token: input.token,
      ...(input.ip ? { ip: input.ip } : {}),
    });
  } catch {
    return "unchecked";
  }
  if (input.provider === "turnstile") {
    const parsed = TURNSTILE_ANSWER.safeParse(answer);
    if (!parsed.success) return "unchecked";
    return parsed.data.success ? "pass" : "fail";
  }
  const parsed = RECAPTCHA_ANSWER.safeParse(answer);
  if (!parsed.success) return "unchecked";
  const threshold = input.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  return parsed.data.success && (parsed.data.score ?? 0) >= threshold
    ? "pass"
    : "fail";
}

const KEY = z.string().trim().min(1).optional();

/** The bot-check options, as the plugin's options give them. */
const BOT_CHECK_OPTIONS = z.object({
  recaptcha: z
    .object({
      enabled: z.boolean(),
      siteKey: KEY,
      secretKey: KEY,
      scoreThreshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
  turnstile: z
    .object({ enabled: z.boolean(), siteKey: KEY, secretKey: KEY })
    .optional(),
});

/**
 * The bot-check part of the plugin's options, parsed at start: a key that is
 * not a string, or a score threshold outside 0 to 1, fails the start with
 * the option named, rather than every submission later.
 */
export function botCheckOptions(
  spamProtection: unknown
): Pick<SpamProtection, "recaptcha" | "turnstile"> {
  const source =
    spamProtection !== null && typeof spamProtection === "object"
      ? (spamProtection as Record<string, unknown>)
      : {};
  const parsed = BOT_CHECK_OPTIONS.safeParse({
    recaptcha: source.recaptcha,
    turnstile: source.turnstile,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `formBuilder: spamProtection.${issue?.path.join(".") ?? ""} is not valid: ${issue?.message ?? "invalid"}`
    );
  }
  return {
    recaptcha: parsed.data.recaptcha ?? { enabled: false },
    turnstile: parsed.data.turnstile ?? { enabled: false },
  };
}

/**
 * The hosts the plugin's bot checks call, for its outbound allowlist: a
 * provider's only when its secret is set, so a site using neither declares
 * no network access at all.
 */
export function botCheckHosts(spam: SpamProtection): string[] {
  return (["recaptcha", "turnstile"] as const)
    .filter(provider => secretOf(provider, spam) !== undefined)
    .map(provider => VERIFY_HOSTS[provider]);
}

/** Each provider's token a submission brought, by the providers' field names. */
export type BotTokens = Partial<Record<BotProvider, string>>;

/** The tokens in a submission's payload, before its own fields are kept. */
export function botTokensOf(payload: Record<string, unknown>): BotTokens {
  const tokens: BotTokens = {};
  for (const provider of ["recaptcha", "turnstile"] as const) {
    const value = payload[TOKEN_FIELDS[provider]];
    if (typeof value === "string" && value.trim() !== "") {
      tokens[provider] = value.trim();
    }
  }
  return tokens;
}

/**
 * A request-made submission's bot check: none when its form's check is off,
 * or names a provider with no secret (accepted unchecked, as warned at start
 * and in Settings); a spam verdict when the token fails or is missing.
 */
export async function judgeBotCheck(input: {
  botCheck: BotCheckMode | undefined;
  spam: SpamProtection;
  tokens: BotTokens;
  ip: string | undefined;
  fetch: VerifyFetch | undefined;
  warn: (message: string, context: Record<string, unknown>) => void;
}): Promise<{ isSpam: true; reason: BotProvider } | undefined> {
  const provider = botProviderOf(input.botCheck, input.spam);
  if (provider === undefined) return undefined;
  const secret = secretOf(provider, input.spam);
  if (secret === undefined) return undefined;
  const verdict = await judgeBotToken({
    provider,
    secret,
    token: input.tokens[provider],
    ...(input.ip ? { ip: input.ip } : {}),
    scoreThreshold: input.spam.recaptcha?.scoreThreshold,
    fetch: input.fetch,
  });
  if (verdict === "unchecked") {
    input.warn(
      "Form Builder: the bot check could not be completed, so the submission was accepted unchecked",
      { provider }
    );
  }
  return verdict === "fail" ? { isSpam: true, reason: provider } : undefined;
}

/**
 * Warn, once at start, for each bot check that is in use (the site default,
 * or named by a form) but has no secret, naming the option to set: those
 * forms' submissions are accepted unchecked until it is. Reads at most the
 * first 500 forms; a failure to read them is not a reason to stop the start.
 */
export async function warnUncheckedBotChecks(input: {
  spam: SpamProtection;
  forms: () => Promise<readonly object[]>;
  readSettings: (stored: unknown) => { botCheck?: BotCheckMode };
  warn: (message: string, context: Record<string, unknown>) => void;
}): Promise<void> {
  let forms: readonly object[] = [];
  try {
    forms = await input.forms();
  } catch {
    forms = [];
  }
  const counts = new Map<BotProvider, number>();
  for (const form of forms) {
    const provider = botProviderOf(
      input.readSettings((form as { settings?: unknown }).settings).botCheck,
      input.spam
    );
    if (provider && secretOf(provider, input.spam) === undefined) {
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
  }
  const siteDefault = botProviderOf("default", input.spam);
  if (siteDefault && secretOf(siteDefault, input.spam) === undefined) {
    counts.set(siteDefault, counts.get(siteDefault) ?? 0);
  }
  for (const [provider, forms] of counts) {
    input.warn(
      `Form Builder: the ${provider === "recaptcha" ? "reCAPTCHA" : "Turnstile"} bot check is in use but has no secret key, so its submissions are accepted unchecked. Set spamProtection.${provider}.secretKey in the plugin's options.`,
      { provider, forms }
    );
  }
}

/** What Settings is told about the site's bot checks and rate limit. */
export interface BotCheckDefaults {
  /** The provider "Site default" resolves to, or null for none. */
  botCheckDefault: BotProvider | null;
  /** Which providers have their keys set, and so may be chosen. */
  botChecks: Record<BotProvider, { secret: boolean; siteKey: boolean }>;
  /** The plugin's rate limit, shown read-only. */
  rateLimit: { maxSubmissions: number; windowMs: number } | null;
}

/** {@link BotCheckDefaults} for the admin: whether keys are set, never the keys. */
export function botCheckDefaults(spam: SpamProtection): BotCheckDefaults {
  const keys = (provider: BotProvider) => ({
    secret: secretOf(provider, spam) !== undefined,
    siteKey: Boolean(spam[provider]?.siteKey),
  });
  return {
    botCheckDefault: botProviderOf("default", spam) ?? null,
    botChecks: { recaptcha: keys("recaptcha"), turnstile: keys("turnstile") },
    rateLimit: spam.rateLimit ?? null,
  };
}

/**
 * The bot check a visitor's form renders, as the public read of a form gives
 * it: the provider and its site key, or none when the form's check is off,
 * names a provider with no secret (not verified, so not shown), or has no
 * site key to render with.
 */
export function publicBotCheck(
  storedSettings: unknown,
  spam: SpamProtection
): { provider: BotProvider; siteKey: string; field: string } | undefined {
  const settings = normalizeFormSettings(storedSettings);
  const provider = botProviderOf(settings.botCheck, spam);
  if (provider === undefined || secretOf(provider, spam) === undefined) {
    return undefined;
  }
  const siteKey = siteKeyOf(provider, spam, settings);
  return siteKey
    ? { provider, siteKey, field: TOKEN_FIELDS[provider] }
    : undefined;
}
