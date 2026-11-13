/**
 * The route behind "Block these N pages anyway": which pages the sitemap
 * lists that the box's rules, as typed, would keep search engines from,
 * judged over the file as it would be served, by the same reading the
 * problem list uses. For someone holding `manage-seo`, who edits the rules.
 *
 * @module settings/robots-rules-route
 */
import {
  NextlyError,
  type PluginContext,
  type PluginRoute,
} from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import { addressRecordReady } from "../address-record/catch-up";
import { productionAddressesOf } from "../canonical";
import { originOf } from "../origin";
import { MANAGE_SEO_PERMISSION } from "../permissions";
import type { ReadRules } from "../resolver/provider";

import type { AiCrawlerChoice } from "./contract";
import {
  blockedByOwnRules,
  crawledPathOf,
  servedGroups,
} from "./robots-blocks";
import {
  MAX_OWN_RULE_LINES,
  readOwnRules,
  ROBOTS_RULES_CHECK_ROUTE_PATH,
  type RobotsRulesCheckBody,
} from "./robots-rules";
import { blockedPagesKey } from "./robots-rules-stored";

/** What the check reads the site with. */
export interface RobotsRulesCheckSetup {
  readRules: ReadRules;
  /** What robots.txt asks AI crawlers until the settings choose. */
  aiCrawlers?: AiCrawlerChoice | undefined;
  /** The paths of every page the sitemap lists, read with `readRules`. */
  listPaths: (ctx: PluginContext, readRules: ReadRules) => Promise<string[]>;
  /**
   * Whether the plugin serves both robots.txt and the sitemap: where it
   * serves either not, its rules cannot block a page its sitemap lists.
   */
  servesBoth: boolean;
  /**
   * Whether the record of each page's address has caught up, so the
   * sitemap lists every page; the plugin's own unless a test says else.
   */
  recordReady?: () => boolean;
  /**
   * Whether the site serves a robots.txt of its own, which wins over the
   * plugin's, so the rules typed here are not what crawlers read.
   */
  siteServesOwnRobots?: (ctx: PluginContext) => Promise<boolean>;
}

/**
 * The paths crawlers ask for the sitemap's pages at: each page's listed
 * address, in its language at the address that language is served at.
 */
export function sitemapPaths(
  pages: readonly { loc: string; path: string }[]
): string[] {
  return pages.map(page => crawledPathOf(page.loc));
}

/**
 * The origins the sitemap is read at: every production address, so each
 * language on its own domain is listed as its sitemap lists it; else the
 * plugin's configured origin; else this host, as a request without either
 * would name it.
 */
export async function listingOrigins(
  ctx: PluginContext,
  readRules: ReadRules,
  baseUrl: string | undefined
): Promise<string[]> {
  const rules = await readRules(ctx, undefined);
  const production = productionAddressesOf(rules.productionAddresses);
  if (production.length > 0) return production;
  return [originOf(baseUrl) ?? "http://localhost"];
}

/** What the screen asks the check about: the rules, and the types the draft hides. */
interface RobotsRulesAsk {
  text: string;
  hiddenTypes?: string[] | undefined;
}

const CHECK_BODY: z.ZodType<RobotsRulesAsk> = z
  .object({
    text: z.string().max(MAX_OWN_RULE_LINES * 501),
    // The content types the draft being saved hides from search, which
    // decide what the sitemap will list once it is saved.
    hiddenTypes: z.array(z.string().max(200)).max(1000).optional(),
  })
  .strict();

/** The request's body, parsed, or a refusal. */
async function bodyOf(req: Request): Promise<RobotsRulesAsk> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = undefined;
  }
  const parsed = CHECK_BODY.safeParse(raw);
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "The request body is not one this route accepts.",
      logContext: { reason: "seo-robots-rules-check-body" },
    });
  }
  return parsed.data;
}

/**
 * Which sitemap pages the rules in `asked` block, by line, and their key:
 * the sitemap listed as the draft being saved would have it, with the
 * content types it hides.
 */
export async function checkRobotsRules(
  ctx: PluginContext,
  asked: RobotsRulesAsk,
  setup: RobotsRulesCheckSetup
): Promise<RobotsRulesCheckBody> {
  // Rules the screen refuses are never served, so they block nothing; and
  // where the plugin serves no robots.txt or no sitemap, none of its rules
  // blocks a page its sitemap lists.
  if (!setup.servesBoth || readOwnRules(asked.text).refused) {
    return { lines: [], pagesKey: blockedPagesKey([]) };
  }
  // Until the address record catches up, the listing may leave pages out,
  // and an answer then would let a rule through that blocks them: the
  // screen is told to try again, as the sitemap answers 503 meanwhile.
  if (!(setup.recordReady ?? addressRecordReady)()) {
    throw NextlyError.serviceUnavailable({
      publicMessage:
        "The site's pages are still being recorded. Try again in a minute.",
      logContext: { reason: "seo-robots-rules-check-record-behind" },
    });
  }
  // A site serving its own robots.txt serves none of these rules, so they
  // block nothing its sitemap lists.
  if ((await setup.siteServesOwnRobots?.(ctx)) === true) {
    return { lines: [], pagesKey: blockedPagesKey([]) };
  }
  const rules = await setup.readRules(ctx, undefined);
  const groups = servedGroups({
    aiCrawlers: rules.aiCrawlers ?? setup.aiCrawlers ?? "all",
    ownRules: asked.text,
  });
  const drafted: ReadRules = async (context, locale) => ({
    ...(await setup.readRules(context, locale)),
    ...(asked.hiddenTypes === undefined
      ? {}
      : { hiddenTypes: asked.hiddenTypes }),
  });
  const { lines, paths } = blockedByOwnRules(
    groups,
    await setup.listPaths(ctx, drafted)
  );
  return { lines, pagesKey: blockedPagesKey(paths) };
}

/** The check's route. */
export function robotsRulesCheckRoute(
  setup: RobotsRulesCheckSetup
): PluginRoute {
  return {
    method: "POST",
    path: ROBOTS_RULES_CHECK_ROUTE_PATH,
    requiredPermission: MANAGE_SEO_PERMISSION,
    handler: async (req, ctx) => {
      return Response.json(
        await checkRobotsRules(ctx, await bodyOf(req), setup)
      );
    },
  };
}
