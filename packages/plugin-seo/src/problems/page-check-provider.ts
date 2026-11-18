/**
 * The SEO plugin's page checks in the page builder: the problems its own
 * check found on the page being edited, listed under Search in the builder's
 * Page checks, each fixed where the problem list fixes it.
 *
 * Nothing new is checked here, and the page the editor posts is not read:
 * the items are the problem list's own, as the person editing may read it,
 * narrowed to the page and language asked about. The list checks each page
 * again once it is saved (`watchSaves`), so the items follow the page's
 * last save. The list is read as the dashboard's SEO card reads it, handed
 * a person rather than a route's caller: the types they may read are core's
 * answer for them, each entry is read as them, and a redirect chain, which
 * the list names only to site-wide SEO, is left out here as it is there. A
 * problem whose fix is in the page's SEO tab opens the builder's SEO tab of
 * Page settings; any other is listed with no fix.
 *
 * Registered through the page builder's `pageChecks` service from this
 * plugin's `init`, so the page builder knows nothing of this plugin.
 *
 * @module problems/page-check-provider
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import type {
  PageCheckFinding,
  PageCheckProvider,
  PageCheckProviderService,
  PageCheckRequest,
} from "@nextlyhq/plugin-sdk/blocks";

import { PAGE_BUILDER_PLUGIN } from "../resolver/design-level";
import { PAGE_BUILDER_TAB } from "../template/contributions";

import { problemList, type ProblemChecks } from "./check";
import { KIND_TEXT, type Problem } from "./contract";
import { readableTypesOf, readerAs, readsAs } from "./reader";

/** Who the page is checked for: the person editing it. */
type CheckAccess = Parameters<PageCheckProvider["check"]>[1]["access"];

/** The provider's id among a site's page check providers. */
const SEO_PAGE_CHECKS_ID = "seo";

/** One problem as a finding under Search, in the problem list's own words. */
export function findingOfProblem(problem: Problem): PageCheckFinding {
  const { fix } = problem;
  return {
    part: problem.kind,
    what: problem.what,
    why: KIND_TEXT[problem.kind].explain,
    todo: problem.action,
    // Fixed in the page's SEO tab: the builder's own SEO tab of Page settings.
    ...(fix.place === "page" && fix.tab === "seo"
      ? { fix: { settingsTab: PAGE_BUILDER_TAB.id } }
      : {}),
  };
}

/**
 * Whether `problem` is about the page asked about, in its language: a
 * problem names a language only where it is not the site's default.
 */
function isAbout(
  problem: Problem,
  page: PageCheckRequest,
  entryId: string,
  defaultLanguage: string
): boolean {
  const { type, id, locale } = problem.subject;
  const asked = page.locale === defaultLanguage ? undefined : page.locale;
  return type === page.collection && id === entryId && locale === asked;
}

/** The page's problems, as the problem list shows them to `access`'s person. */
async function pageFindings(
  ctx: PluginContext,
  checks: ProblemChecks,
  page: PageCheckRequest,
  access: CheckAccess
): Promise<PageCheckFinding[]> {
  const entryId = page.entryId;
  // A page not saved yet has not been checked.
  if (entryId === null) return [];
  const types = await readableTypesOf(access.user, checks);
  if (!types.has(page.collection)) return [];
  const reader = readerAs(
    readsAs(ctx.services.collections, access),
    types,
    false
  );
  const { problems } = await problemList(ctx, checks, reader);
  const defaultLanguage = await ctx.publicAddresses.defaultLanguage();
  return problems
    .filter(problem => isAbout(problem, page, entryId, defaultLanguage))
    .map(findingOfProblem);
}

/** The SEO plugin's page check provider, reading through its own context. */
export function seoPageChecks(
  ctx: PluginContext,
  checks: ProblemChecks
): PageCheckProvider {
  return {
    id: SEO_PAGE_CHECKS_ID,
    group: "search",
    check: (page, { access }) => pageFindings(ctx, checks, page, access),
  };
}

/**
 * Register the provider with the page builder's `pageChecks` service, where
 * the page builder runs: without it there is no Page checks list to add to.
 */
export function registerSeoPageChecks(
  ctx: PluginContext,
  checks: ProblemChecks
): void {
  const service = ctx.services.plugins[PAGE_BUILDER_PLUGIN]?.pageChecks as
    | PageCheckProviderService
    | undefined;
  service?.register(seoPageChecks(ctx, checks));
}
