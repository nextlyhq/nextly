/**
 * The Pages and addresses screen's routes: every public address the site
 * knows of, and the save of a page with no entry's SEO, both site-wide SEO
 * for whoever holds `manage-seo`.
 *
 * @module code-pages/route
 */
import {
  NextlyError,
  respondList,
  respondMutation,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import { MANAGE_SEO_PERMISSION, siteWide } from "../permissions";
import type { ReadRules } from "../resolver/provider";

import { siteAddresses } from "./addresses";
import { heldByDocuments } from "./answers";
import {
  ADDRESSES_ROUTE_PATH,
  CODE_PAGE_SEO_ROUTE_PATH,
  LONGEST_SEO_TEXT,
  type CodePageSeoInput,
} from "./contract";
import type { CodeRoute } from "./routes";
import { codeAddressOf, readCodePage, saveTypedValues } from "./store";

/** What the routes read with. */
export interface CodePageRoutesConfig {
  readRules: ReadRules;
  routes: () => readonly CodeRoute[];
  /** The site's production origin, where the plugin was given one. */
  origin: () => string | undefined;
}

/** A save, parsed at the boundary. */
const SAVE = z.object({
  path: z.string().min(1).max(2048),
  title: z.string().max(LONGEST_SEO_TEXT),
  description: z.string().max(LONGEST_SEO_TEXT),
  hidden: z.boolean(),
  image: z.string().max(200).nullable().optional(),
});

/** The site's origin for a request: the configured one, or its own. */
function originFor(req: Request, config: CodePageRoutesConfig): string {
  return config.origin() ?? new URL(req.url).origin;
}

/** The route that lists every public address the site knows of. */
function addressesRoute(config: CodePageRoutesConfig): PluginRoute {
  // Site-wide SEO, which the plugin keeps itself: `manage-seo` alone.
  return siteWide({
    method: "GET",
    path: ADDRESSES_ROUTE_PATH,
    requiredPermission: MANAGE_SEO_PERMISSION,
    handler: async (req, ctx) => {
      const items = await siteAddresses(ctx, {
        origin: originFor(req, config),
        routes: config.routes(),
        readRules: config.readRules,
      });
      return respondList(items, {
        total: items.length,
        page: 1,
        limit: Math.max(items.length, 1),
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
    },
  });
}

/** The save the request asks for, refused where it is not one. */
async function requested(req: Request): Promise<CodePageSeoInput> {
  const body: unknown = await req.json().catch(() => undefined);
  const parsed = SAVE.safeParse(body);
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "Send the address and its title, description and visibility.",
    });
  }
  return parsed.data;
}

/**
 * Whether `path` is a page with no entry the site knows of: one its routes
 * render from their own code, or one already holding SEO. An address an
 * entry is served at keeps its SEO in the entry.
 */
async function isCodePage(
  ctx: PluginRouteContext,
  path: string,
  config: CodePageRoutesConfig,
  origin: string
): Promise<boolean> {
  // Who holds it is read in the address's own language, as the list reads
  // it, so the screen offers only what a save takes.
  if ((await heldByDocuments(ctx, [path], origin)).has(path)) return false;
  if (config.routes().some(route => route.path === path)) return true;
  return (await readCodePage(ctx, path)) !== undefined;
}

/** The route that saves the SEO of a page with no entry. */
function saveRoute(config: CodePageRoutesConfig): PluginRoute {
  // The SEO of an address with no entry is site-wide SEO, kept by the
  // plugin itself: `manage-seo` alone, asked before anything is read.
  return siteWide({
    method: "POST",
    path: CODE_PAGE_SEO_ROUTE_PATH,
    requiredPermission: MANAGE_SEO_PERMISSION,
    handler: async (req, ctx) => {
      const input = await requested(req);
      const path = codeAddressOf(input.path);
      // Checked before anything is written: only a page with no entry that
      // the site knows of has its SEO kept here.
      if (
        path === undefined ||
        !(await isCodePage(ctx, path, config, originFor(req, config)))
      ) {
        throw NextlyError.invalidInput({
          message:
            "That address is not a page built in code. An entry's SEO is set on the entry.",
        });
      }
      await saveTypedValues(ctx, path, {
        title: input.title,
        description: input.description,
        hidden: input.hidden,
        ...(input.image === undefined ? {} : { image: input.image }),
      });
      return respondMutation(`Saved the SEO for ${path}.`, { path });
    },
  });
}

/** The routes the Pages and addresses screen reads and saves through. */
export function codePageRoutes(config: CodePageRoutesConfig): PluginRoute[] {
  return [addressesRoute(config), saveRoute(config)];
}
