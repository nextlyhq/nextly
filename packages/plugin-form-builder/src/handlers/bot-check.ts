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
 * accepted unchecked, as before bot checks were verified, with a warning in
 * the log (see `warnUncheckedSiteDefault`) and in Settings.
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

/**
 * `provider`'s keys for a form, when both are known: the secret to verify
 * with and a site key for the visitor's widget. A check missing either is
 * not run: without a site key no visitor could produce a token, and every
 * real submission would be flagged.
 */
function readyKeys(
  provider: BotProvider,
  spam: SpamProtection,
  settings: { captchaSiteKey?: string }
): { secret: string; siteKey: string } | undefined {
  const secret = secretOf(provider, spam);
  const siteKey = siteKeyOf(provider, spam, settings);
  return secret && siteKey ? { secret, siteKey } : undefined;
}

/**
 * Whether a form's bot check will be run: it names a provider and that
 * provider's keys are both known. The same answer `judgeBotCheck` acts on.
 */
export function botCheckReady(
  settings: { botCheck?: BotCheckMode; captchaSiteKey?: string },
  spam: SpamProtection
): boolean {
  const provider = botProviderOf(settings.botCheck, spam);
  return (
    provider !== undefined && readyKeys(provider, spam, settings) !== undefined
  );
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
 * or names a provider missing its secret or site key (accepted unchecked,
 * and said in the log the first time, see `warnUncheckedSubmission`); a spam
 * verdict when the token fails or is missing.
 */
export async function judgeBotCheck(input: {
  settings: { botCheck?: BotCheckMode; captchaSiteKey?: string };
  spam: SpamProtection;
  tokens: BotTokens;
  ip: string | undefined;
  fetch: VerifyFetch | undefined;
  /** The form's slug, named in the warning when its check cannot run. */
  form?: string;
  warn: (message: string, context: Record<string, unknown>) => void;
}): Promise<{ isSpam: true; reason: BotProvider } | undefined> {
  const provider = botProviderOf(input.settings.botCheck, input.spam);
  if (provider === undefined) return undefined;
  const keys = readyKeys(provider, input.spam, input.settings);
  if (keys === undefined) {
    warnUncheckedSubmission(provider, input.spam, input.form, input.warn);
    return undefined;
  }
  const verdict = await judgeBotToken({
    provider,
    secret: keys.secret,
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

type Warn = (message: string, context: Record<string, unknown>) => void;

/** What the log is told about `provider` missing a key, naming the options. */
function uncheckedMessage(provider: BotProvider): string {
  return `Form Builder: the ${provider === "recaptcha" ? "reCAPTCHA" : "Turnstile"} bot check is in use without both of its keys, so its submissions are accepted unchecked. Set spamProtection.${provider}.secretKey and spamProtection.${provider}.siteKey in the plugin's options.`;
}

/**
 * The providers a submission has already been warned about since the
 * plugin's last start, by the plugin's bot-check options. Keyed by the
 * options object, which each `formBuilder()` call resolves once, so two
 * installs of the plugin in one process keep apart, and an options object
 * no longer used is let go.
 */
const saidForSubmissions = new WeakMap<SpamProtection, Set<BotProvider>>();

/**
 * At start, from the plugin's options alone: the site default's check, when
 * it is in use without both of its keys. Every form left on "Site default"
 * is accepted unchecked until it has them.
 *
 * A form that names a check of its own is not read for here: reading the
 * forms cost every start a round trip to say something that matters only
 * when such a form is saved (`warnUncheckedFormCheck`) or submitted
 * (`judgeBotCheck`), which is where it is said instead. A start also
 * forgets which providers submissions were warned about, so a restart or a
 * reload says it again, as the warning at start always did.
 */
export function warnUncheckedSiteDefault(
  spam: SpamProtection,
  warn: Warn
): void {
  saidForSubmissions.set(spam, new Set());
  const provider = botProviderOf("default", spam);
  if (provider && readyKeys(provider, spam, {}) === undefined) {
    warn(uncheckedMessage(provider), { provider });
  }
}

/**
 * When a form is saved: the check it names itself, when that check has not
 * both of its keys. Said at every such save, since the person saving it is
 * the one who can act; a form on "Site default" or "Off" is not, the site
 * default's having been said at start.
 */
export function warnUncheckedFormCheck(
  settings: { botCheck?: BotCheckMode; captchaSiteKey?: string },
  spam: SpamProtection,
  form: string | undefined,
  warn: Warn
): void {
  const named = settings.botCheck;
  if (named !== "recaptcha" && named !== "turnstile") return;
  if (readyKeys(named, spam, settings) === undefined) {
    warn(uncheckedMessage(named), {
      provider: named,
      ...(form ? { form } : {}),
    });
  }
}

/**
 * `warnUncheckedFormCheck` for a forms save, as its `beforeChange` hook is
 * handed it: only a save that carries settings chose a check, and the form
 * is named by the slug it is saved with, or the one it had.
 */
export function warnSavedFormCheck(
  context: unknown,
  spam: SpamProtection,
  warn: Warn
): void {
  const { data, originalData } = context as {
    data?: Record<string, unknown>;
    originalData?: Record<string, unknown>;
  };
  if (data?.settings === undefined) return;
  const slug = data.slug ?? originalData?.slug;
  warnUncheckedFormCheck(
    normalizeFormSettings(data.settings),
    spam,
    typeof slug === "string" ? slug : undefined,
    warn
  );
}

/**
 * When a submission is accepted unchecked because its check is missing a
 * key: said for the first such submission of each provider since the
 * plugin's start, naming its form, and not again for every one after it.
 */
function warnUncheckedSubmission(
  provider: BotProvider,
  spam: SpamProtection,
  form: string | undefined,
  warn: Warn
): void {
  let said = saidForSubmissions.get(spam);
  if (said === undefined) {
    said = new Set();
    saidForSubmissions.set(spam, said);
  }
  if (said.has(provider)) return;
  said.add(provider);
  warn(uncheckedMessage(provider), {
    provider,
    ...(form ? { form } : {}),
  });
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
  if (provider === undefined) return undefined;
  const keys = readyKeys(provider, spam, settings);
  return keys
    ? { provider, siteKey: keys.siteKey, field: TOKEN_FIELDS[provider] }
    : undefined;
}
