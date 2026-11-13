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

import { MANAGE_SEO_PERMISSION } from "../permissions";
import type { ReadRules } from "../resolver/provider";

import type { AiCrawlerChoice } from "./contract";
import { blockedByOwnRules, servedGroups } from "./robots-blocks";
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
  /** The paths of every page the sitemap lists. */
  listPaths: (ctx: PluginContext) => Promise<string[]>;
}

const CHECK_BODY = z
  .object({ text: z.string().max(MAX_OWN_RULE_LINES * 501) })
  .strict();

/** The request's body, parsed, or a refusal. */
async function bodyOf(req: Request): Promise<z.infer<typeof CHECK_BODY>> {
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

/** Which sitemap pages `text` blocks, by line, and their key. */
async function checkRobotsRules(
  ctx: PluginContext,
  text: string,
  setup: RobotsRulesCheckSetup
): Promise<RobotsRulesCheckBody> {
  // Rules the screen refuses are never served, so they block nothing.
  if (readOwnRules(text).refused) {
    return { lines: [], pagesKey: blockedPagesKey([]) };
  }
  const rules = await setup.readRules(ctx, undefined);
  const groups = servedGroups({
    aiCrawlers: rules.aiCrawlers ?? setup.aiCrawlers ?? "all",
    ownRules: text,
  });
  const { lines, paths } = blockedByOwnRules(
    groups,
    await setup.listPaths(ctx)
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
      const { text } = await bodyOf(req);
      return Response.json(await checkRobotsRules(ctx, text, setup));
    },
  };
}
