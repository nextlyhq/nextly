/**
 * The Overview's setup checklist: each item worked out from what the plugin
 * has stored, never ticked by hand, and the route that reads it and keeps it
 * hidden or shown.
 *
 * What makes each item done:
 *
 * - `site`: the site has a name and at least one production address, as the
 *   canonical rule and the staging guard read them;
 * - `patterns`: every content type SEO is added to has a title pattern of
 *   its own in the settings;
 * - `shareImage`: the settings hold a default share image;
 * - `brand`: the brand facts name the organization and hold its logo, the
 *   two details its structured data needs;
 * - `import`: listed only where the site holds old SEO values to bring in, a
 *   field group other than the plugin's own with a value one of its fields
 *   maps to, or where an import has been applied; done once one has;
 * - `searchConsole`: Search Console is connected to the site's property,
 *   with no failure since;
 * - `proxy`: the site's Proxy has handled a request within the week, as its
 *   own note says: redirects, plain-text copies and the staging guard are
 *   answered from it;
 * - `codePages`: listed only where the build has routes with a variable
 *   part, whose addresses only the build names; done where the running
 *   site can list them: the build being served recorded its pages, or its
 *   prerender manifest is read.
 *
 * @module overview/checklist
 */
import {
  NextlyError,
  respondAction,
  respondDoc,
  type PluginContext,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { productionAddressesOf } from "../canonical";
import type { CodeListing } from "../code-pages/code-listing";
import {
  readConnections,
  writeConnections,
  type ConnectionSettings,
} from "../connections/store";
import { callerActor } from "../import/actor";
import type { ImportGroup } from "../import/contract";
import {
  declaresOldGroups,
  importGroups,
  type ImportSetup,
} from "../import/plan";
import { MANAGE_SEO_PERMISSION, siteWide } from "../permissions";
import { readProxyStatus } from "../redirects/proxy-seen";
import type { SiteRules } from "../resolver/page-levels";
import type { BrandFacts } from "../settings/rules";

import {
  CHECKLIST_ROUTE_PATH,
  type ChecklistBody,
  type ChecklistItemState,
} from "./contract";

/** What the checklist is worked out from. */
export interface ChecklistFacts {
  rules: SiteRules;
  /** The production addresses the site is served from, as the guard reads them. */
  productionAddresses: readonly string[];
  brand: Pick<BrandFacts, "name" | "logo">;
  /** Every content type SEO is added to, by the key patterns are kept under. */
  types: readonly string[];
  /** Whether Search Console is connected. */
  searchConsole: boolean;
  /** Whether the site's Proxy runs, as its last note says. */
  proxy: boolean;
  /**
   * Old SEO values to bring in: `none` where the site holds none, `waiting`
   * where it does and nothing has been imported, `imported` once an import
   * was applied.
   */
  imports: "none" | "waiting" | "imported";
  /**
   * The site's pages built in code, where its build has routes with a
   * variable part: whether the running site can list their addresses, and
   * how many pages built in code it lists.
   */
  codePages?: { listed: boolean; pages: number };
}

/** Text with something in it. */
const filled = (value: string | undefined): boolean =>
  value !== undefined && value.trim() !== "";

/** Each item that applies to the site, and whether it is done. */
export function checklistItems(facts: ChecklistFacts): ChecklistItemState[] {
  const { rules } = facts;
  const items: ChecklistItemState[] = [
    {
      id: "site",
      done: filled(rules.siteName) && facts.productionAddresses.length > 0,
    },
    {
      id: "patterns",
      done: facts.types.every(type => filled(rules.patterns[type]?.title)),
      types: facts.types.length,
    },
    { id: "shareImage", done: rules.image !== undefined },
    {
      id: "brand",
      done: filled(facts.brand.name) && facts.brand.logo !== undefined,
    },
  ];
  if (facts.imports !== "none") {
    items.push({ id: "import", done: facts.imports === "imported" });
  }
  items.push({ id: "searchConsole", done: facts.searchConsole });
  items.push({ id: "proxy", done: facts.proxy });
  if (facts.codePages !== undefined) {
    items.push({
      id: "codePages",
      done: facts.codePages.listed,
      pages: facts.codePages.pages,
    });
  }
  return items;
}

/**
 * Whether `groups` hold old SEO values to bring in: a group other than the
 * plugin's own, with a value in a field the import maps somewhere.
 */
export function holdsOldValues(groups: readonly ImportGroup[]): boolean {
  return groups.some(
    group =>
      !group.own &&
      group.fields.some(field => field.filled > 0 && field.suggested !== "skip")
  );
}

/**
 * Whether Search Console is connected to the site's property, with no
 * failure since: a sign-in that found no property for the site is not.
 */
export function searchConsoleConnected(
  stored: Pick<ConnectionSettings, "searchConsole" | "searchConsoleFailed">
): boolean {
  return (
    stored.searchConsole?.property !== undefined &&
    stored.searchConsoleFailed === undefined
  );
}

/** What the checklist route reads with. */
export interface ChecklistSetup {
  /** The content types SEO is added to, by key. */
  types: readonly string[];
  readRules: (
    ctx: PluginContext,
    locale: string | undefined
  ) => Promise<SiteRules>;
  readBrand: (ctx: PluginContext) => Promise<BrandFacts>;
  /** Whether first-time setup still waits to be asked. */
  readSetupWaiting: (ctx: PluginContext) => Promise<boolean>;
  /** What the import reads the site's field groups with. */
  importSetup: ImportSetup;
  /** Every page built in code the running site has, and how it knows. */
  codeListing?: (ctx: PluginContext) => Promise<CodeListing>;
}

/** How the site's pages built in code stand, where its build has routes with a variable part. */
async function codePagesOf(
  ctx: PluginContext,
  setup: ChecklistSetup
): Promise<ChecklistFacts["codePages"]> {
  const listing = await setup.codeListing?.(ctx);
  if (listing === undefined || listing.dynamic.length === 0) return undefined;
  return {
    listed:
      listing.unreadable === undefined || (listing.recorded?.pages ?? 0) > 0,
    pages: listing.routes.length,
  };
}

/** Whether old values wait to be imported, as the person asking may read the pages. */
async function importsOf(
  ctx: PluginRouteContext,
  setup: ChecklistSetup,
  importedAt: string | undefined
): Promise<ChecklistFacts["imports"]> {
  // Once one is applied the item is done, with no need to read every page.
  if (importedAt !== undefined) return "imported";
  const engine = {
    ctx,
    actor: await callerActor(ctx, {
      pagePermissions: setup.importSetup.pagePermissions,
    }),
    setup: setup.importSetup,
  };
  // Pages are read only where a type declares a group other than the
  // plugin's own, the one place old values can be.
  if (!(await declaresOldGroups(engine))) return "none";
  return holdsOldValues(await importGroups(engine, undefined))
    ? "waiting"
    : "none";
}

/** The checklist as stored state gives it. */
async function readChecklist(
  ctx: PluginRouteContext,
  setup: ChecklistSetup
): Promise<ChecklistBody> {
  const [rules, brand, stored, waiting, codePages, proxy] = await Promise.all([
    setup.readRules(ctx, undefined),
    setup.readBrand(ctx),
    readConnections(ctx),
    setup.readSetupWaiting(ctx),
    codePagesOf(ctx, setup),
    readProxyStatus(ctx),
  ]);
  return {
    setupWaiting: waiting,
    hidden: stored.checklistHidden === true,
    items: checklistItems({
      rules,
      productionAddresses: productionAddressesOf(rules.productionAddresses),
      brand,
      types: setup.types,
      searchConsole: searchConsoleConnected(stored),
      proxy: proxy.state === "running",
      imports: await importsOf(ctx, setup, stored.importedAt),
      ...(codePages === undefined ? {} : { codePages }),
    }),
  };
}

const VISIBILITY = z.object({ hidden: z.boolean() });

/** The body of a hide or show, or a refusal naming what is wrong. */
async function visibilityOf(req: Request): Promise<boolean> {
  const parsed = VISIBILITY.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "Send whether the checklist is hidden.",
      logContext: { reason: "seo-checklist-body-invalid" },
    });
  }
  return parsed.data.hidden;
}

/**
 * The checklist's routes: one reads it, one hides or shows it for everyone
 * who opens the Overview. Both are site-wide SEO's, as the Overview is.
 */
export function checklistRoutes(setup: ChecklistSetup): PluginRoute[] {
  const routes: PluginRoute[] = [
    {
      method: "GET",
      path: CHECKLIST_ROUTE_PATH,
      noStore: true,
      requiredPermission: MANAGE_SEO_PERMISSION,
      handler: async (_req, ctx) => respondDoc(await readChecklist(ctx, setup)),
    },
    {
      method: "POST",
      path: CHECKLIST_ROUTE_PATH,
      requiredPermission: MANAGE_SEO_PERMISSION,
      handler: async (req, ctx) => {
        const hidden = await visibilityOf(req);
        await writeConnections(ctx, { checklistHidden: hidden });
        return respondAction(
          hidden ? "Setup checklist hidden" : "Setup checklist shown",
          { hidden }
        );
      },
    },
  ];
  return routes.map(siteWide);
}
