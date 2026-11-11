"use client";

/**
 * Spam protection's bot check and rate limit in Settings. The bot check is
 * the site default, off, reCAPTCHA or Turnstile; a provider whose keys are
 * not set in the plugin's options cannot be newly chosen, and a form whose
 * check has no secret says that its submissions are accepted unchecked,
 * naming the option to set. The rate limit is the plugin's, shown here so
 * people know it exists.
 *
 * @module admin/components/builder/BotCheckRows
 */
import {
  Alert,
  AlertDescription,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import { DEFAULT_FORM_SETTINGS } from "../../../config/defaults";
import type { BotCheckMode } from "../../../types";
import { useFormBuilder } from "../../context/FormBuilderContext";

import { descriptionIdOf, SettingRow } from "./settings-rows";

type BotProvider = "recaptcha" | "turnstile";

/** What the plugin's options say about bot checks and the rate limit. */
export interface BotCheckSiteDefaults {
  /** The provider "Site default" resolves to, or null for none. */
  botCheckDefault?: BotProvider | null;
  /** Which providers have their keys set. */
  botChecks?: Record<BotProvider, { secret: boolean; siteKey: boolean }>;
  rateLimit?: { maxSubmissions: number; windowMs: number } | null;
}

const NAMES: Record<BotProvider, string> = {
  recaptcha: "reCAPTCHA",
  turnstile: "Turnstile",
};

/** What each choice does, said under the control. */
const DESCRIPTIONS: Record<BotProvider | "none", string> = {
  recaptcha:
    "Google reCAPTCHA scores each visitor in the background; there is no puzzle to solve.",
  turnstile:
    "Cloudflare Turnstile checks each visitor in the background and rarely shows a puzzle.",
  none: "No bot check. reCAPTCHA and Turnstile keys are set in the plugin's options.",
};

/** The provider a choice resolves to, the site default followed. */
function providerOf(
  choice: BotCheckMode,
  defaults: BotCheckSiteDefaults | null
): BotProvider | undefined {
  if (choice === "recaptcha" || choice === "turnstile") return choice;
  if (choice === "default") return defaults?.botCheckDefault ?? undefined;
  return undefined;
}

/** Whether `provider`'s secret is known to be missing, not merely unknown. */
function missingSecret(
  provider: BotProvider,
  defaults: BotCheckSiteDefaults | null
): boolean {
  return defaults?.botChecks?.[provider].secret === false;
}

export function BotCheckRow({
  defaults,
}: {
  /** The plugin's options as Settings is told them; null while loading. */
  defaults: BotCheckSiteDefaults | null;
}): JSX.Element {
  const { settings, updateSettings } = useFormBuilder();
  const choice = settings.botCheck ?? DEFAULT_FORM_SETTINGS.botCheck;
  const provider = providerOf(choice, defaults);
  const siteDefault = defaults?.botCheckDefault;
  return (
    <SettingRow
      label="Bot check"
      htmlFor="settings-bot-check"
      description={DESCRIPTIONS[provider ?? "none"]}
    >
      <div className="flex flex-col items-end gap-3">
        <Select
          value={choice}
          onValueChange={value => {
            const botCheck = CHOICES.find(mode => mode === value);
            if (botCheck) updateSettings({ botCheck });
          }}
        >
          <SelectTrigger
            id="settings-bot-check"
            aria-describedby={descriptionIdOf("settings-bot-check")}
            className="w-56 bg-transparent border-input dark:bg-muted/50"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">
              {siteDefault === undefined
                ? "Site default"
                : `Site default (${siteDefault ? NAMES[siteDefault] : "off"})`}
            </SelectItem>
            <SelectItem value="off">Off</SelectItem>
            {(["recaptcha", "turnstile"] as const).map(option => (
              // A check with no keys cannot be newly chosen: it would accept
              // every submission unchecked. A form that stores it keeps it.
              <SelectItem
                key={option}
                value={option}
                disabled={missingSecret(option, defaults) && choice !== option}
              >
                {missingSecret(option, defaults)
                  ? `${NAMES[option]} (needs keys)`
                  : NAMES[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </SettingRow>
  );
}

/** The bot check's warnings: no secret, and a site key kept on the form. */
export function BotCheckNotices({
  defaults,
}: {
  defaults: BotCheckSiteDefaults | null;
}): JSX.Element | null {
  const { settings } = useFormBuilder();
  const provider = providerOf(
    settings.botCheck ?? DEFAULT_FORM_SETTINGS.botCheck,
    defaults
  );
  if (provider === undefined) return null;
  const unchecked = missingSecret(provider, defaults);
  const ownSiteKey =
    provider === "recaptcha" &&
    Boolean(settings.captchaSiteKey) &&
    defaults?.botChecks?.recaptcha.siteKey === false;
  if (!unchecked && !ownSiteKey) return null;
  return (
    <div className="flex flex-col gap-3">
      {unchecked ? (
        <Alert variant="warning">
          <AlertDescription>
            This form’s bot check is {NAMES[provider]}, but the plugin has no{" "}
            {NAMES[provider]} secret key, so submissions are accepted unchecked.
            Set <code>spamProtection.{provider}.secretKey</code> in the plugin’s
            options.
          </AlertDescription>
        </Alert>
      ) : null}
      {ownSiteKey ? (
        <Alert variant="info">
          <AlertDescription>
            This form keeps its own reCAPTCHA site key, which it goes on using.
            Move it into the plugin’s options as{" "}
            <code>spamProtection.recaptcha.siteKey</code> so every form uses one
            key.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** "10 a minute", from a count and a window in milliseconds. */
function rateOf(limit: { maxSubmissions: number; windowMs: number }): string {
  const { maxSubmissions, windowMs } = limit;
  if (windowMs === 60_000) return `${maxSubmissions} a minute`;
  if (windowMs === 3_600_000) return `${maxSubmissions} an hour`;
  const seconds = Math.round(windowMs / 1000);
  return `${maxSubmissions} every ${seconds} seconds`;
}

export function RateLimitRow({
  defaults,
}: {
  defaults: BotCheckSiteDefaults | null;
}): JSX.Element | null {
  const limit = defaults?.rateLimit;
  if (!limit) return null;
  return (
    <SettingRow
      label="Rate limit"
      description="Submissions from one network, set in the plugin's options (spamProtection.rateLimit)."
    >
      <span className="text-sm text-muted-foreground">{rateOf(limit)}</span>
    </SettingRow>
  );
}

/** Every bot check a form can choose. */
const CHOICES: readonly BotCheckMode[] = [
  "default",
  "off",
  "recaptcha",
  "turnstile",
];
