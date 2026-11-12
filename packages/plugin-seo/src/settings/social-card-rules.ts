/**
 * The social card's rules from the SEO settings: the saved site name and the
 * production address the page's language is served from, so the card, the
 * title pattern and structured data all name the site the same way. The
 * plugin's options stay the answer for what the settings leave empty, and
 * the page's language is always the options' reading.
 *
 * @module settings/social-card-rules
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import type { ReadSocialCardRules, SocialCardRules } from "../social/card";

import { readSiteIdentity, type SiteIdentity } from "./rules";

/** `base`, the plugin's options, with the site's name and address the settings hold. */
export function socialCardRulesOf(
  base: SocialCardRules,
  settings: SiteIdentity
): SocialCardRules {
  const origin = settings.origin ?? base.origin;
  const siteName = settings.siteName ?? base.siteName;
  return {
    ...(origin === undefined ? {} : { origin }),
    ...(siteName === undefined ? {} : { siteName }),
    ...(base.language === undefined ? {} : { language: base.language }),
  };
}

/** The social card's reader: the SEO settings, then the plugin's options. */
export function socialCardFromSettings(
  fromOptions: ReadSocialCardRules
): ReadSocialCardRules {
  return async (ctx: PluginContext, locale: string | undefined) => {
    const [base, settings] = await Promise.all([
      fromOptions(ctx, locale),
      readSiteIdentity(ctx, locale),
    ]);
    return socialCardRulesOf(base, settings);
  };
}
