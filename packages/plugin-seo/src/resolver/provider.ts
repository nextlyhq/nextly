/**
 * The SEO plugin's answer to a page's head: what the route helpers ask a
 * page-metadata provider for, worked out by the one order of who wins.
 *
 * `resolveSeo` answers a page with the source of every value, for anything
 * that shows where a value came from; `seoPageMetadata` is the provider core
 * calls, the same answer without its sources.
 *
 * @module resolver/provider
 */
import {
  nextlyTags,
  type PageMetadataAnswer,
  type PageMetadataInput,
  type PageMetadataResolver,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { resolveOrder, type SeoAnswer } from "./order";
import { levelsOf, NO_RULES, type SiteRules } from "./page-levels";

/** Where the resolver reads the site's own rules from. */
export type ReadRules = (
  ctx: PluginContext,
  locale: string | undefined
) => Promise<SiteRules>;

/** No settings yet: the site's rules are empty. */
const noRules: ReadRules = async () => NO_RULES;

/** The page `input` names, every value with its source. */
export async function resolveSeo(
  ctx: PluginContext,
  input: PageMetadataInput,
  readRules: ReadRules = noRules
): Promise<SeoAnswer> {
  const rules = await readRules(ctx, input.locale);
  return resolveOrder(await levelsOf(ctx, input, rules));
}

/** The answer core turns into the page's head, without the sources. */
export function answerOf(
  answer: SeoAnswer,
  rules: Pick<SiteRules, "siteName">
): PageMetadataAnswer {
  const social = {
    ...(answer.socialTitle ? { title: answer.socialTitle.value } : {}),
    ...(answer.socialDescription
      ? { description: answer.socialDescription.value }
      : {}),
    ...(answer.image ? { image: answer.image.value } : {}),
    ...(rules.siteName === undefined ? {} : { siteName: rules.siteName }),
  };
  return {
    ...(answer.title ? { title: answer.title.value } : {}),
    ...(answer.description ? { description: answer.description.value } : {}),
    ...(answer.canonical ? { canonical: answer.canonical.value } : {}),
    robots: answer.robots.value,
    ...(Object.keys(social).length > 0 ? { social } : {}),
  };
}

/** The page-metadata provider the SEO plugin contributes. */
export function seoPageMetadata(
  ctx: PluginContext,
  readRules: ReadRules = noRules
): PageMetadataResolver {
  return {
    // A share image is read from the media library, so any write to it
    // expires the head that shows it, as a write to the page itself does.
    tags: () => nextlyTags("media"),
    async resolve(input) {
      const rules = await readRules(ctx, input.locale);
      return answerOf(resolveOrder(await levelsOf(ctx, input, rules)), rules);
    },
  };
}
