/**
 * The page builder's custom CSS for a pages route.
 *
 * A route draws author-written CSS only through a host's checker (see
 * `CustomCssSource` in `@nextlyhq/blocks-react/next`). This is the page
 * builder's: its one checker, which the CSS boxes and the server also use,
 * and the read of the site's own CSS, for the page builder the route names.
 *
 * ```ts
 * createBlocksPage({
 *   collections: ["pages"],
 *   field: "content",
 *   customCss: pageBuilderCustomCss({ plugin: builder }),
 * });
 * ```
 *
 * A route without it draws no custom CSS at any level, so a site adds this
 * line to its pages route to show the CSS its authors write.
 *
 * @module custom-css
 * @experimental
 */
import type { CustomCssSource } from "@nextlyhq/blocks-react/next";
import { pluginCacheTag, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";

import { PAGE_BUILDER_PLUGIN_NAME } from "./library-contract";
import { checkCustomCss, CUSTOM_CSS_CHECKER_ID } from "./site-code/css-check";
import {
  readStoredSiteCss,
  SITE_CSS_CACHE_PART,
} from "./site-code/site-css-store";

/** The database surface the site's CSS is read through. */
type SiteCssReadDatabase = Pick<PluginDatabase, "select" | "table">;

/**
 * Where a started page builder offers its site's CSS on the instance, for a
 * route whose copy of the page builder never started.
 */
export const SITE_CSS_SERVICE = "site-css";

/** What a started page builder offers under {@link SITE_CSS_SERVICE}. */
interface SiteCssService {
  read(): Promise<string>;
}

/** The `site-css` service over the plugin's database. */
export function siteCssService(db: SiteCssReadDatabase): SiteCssService {
  return { read: async () => (await readStoredSiteCss(db)).css };
}

/** One page builder's read of its site's CSS, which its boot starts. */
export interface SiteCssReader {
  /** Start reading through the booted database. */
  start(db: SiteCssReadDatabase): void;
  /** Whether this copy of the page builder started. */
  started(): boolean;
  /** The site's CSS; empty before the start. */
  read(): Promise<string>;
}

/** A reader that reads nothing until its page builder's boot starts it. */
export function siteCssReader(): SiteCssReader {
  let db: SiteCssReadDatabase | undefined;
  return {
    start: booted => {
      db = booted;
    },
    started: () => db !== undefined,
    read: async () =>
      db === undefined ? "" : (await readStoredSiteCss(db)).css,
  };
}

/**
 * The reader of each page builder this process made, so a route serving one
 * site never reads another's CSS.
 */
export const sitesCss: WeakMap<PluginDefinition, SiteCssReader> = new WeakMap<
  PluginDefinition,
  SiteCssReader
>();

/** The service a started site offers, or `undefined` where it offers none. */
function offeredService(
  plugins: Readonly<Record<string, Readonly<Record<string, unknown>>>>
): SiteCssService | undefined {
  const offered: unknown = plugins[PAGE_BUILDER_PLUGIN_NAME]?.[SITE_CSS_SERVICE];
  return typeof offered === "object" &&
    offered !== null &&
    typeof (offered as { read?: unknown }).read === "function"
    ? (offered as SiteCssService)
    : undefined;
}

/**
 * The site's CSS for `plugin`: through its own copy where it started here,
 * else through the started site, as `namedQueriesOf` reads its queries. A
 * production build bundles the plugin into each route, and the route's copy
 * never starts. Nothing for a plugin that is not a page builder.
 */
async function siteCssOf(plugin: PluginDefinition): Promise<string> {
  const own = sitesCss.get(plugin);
  if (own === undefined) return "";
  if (own.started()) return own.read();
  const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
  const service = offeredService((await getCachedNextly()).plugins);
  return service === undefined ? "" : service.read();
}

/** Stored CSS with something in it, or `undefined`. */
function drawn(css: string): string | undefined {
  return css.trim() === "" ? undefined : css;
}

/** What {@link pageBuilderCustomCss} is told. */
export interface PageBuilderCustomCssOptions {
  /**
   * The page builder whose site's CSS the route draws, made with
   * `pageBuilder()`. Without it the route draws the page's and each block's
   * CSS, and none for the whole site.
   */
  readonly plugin?: PluginDefinition;
}

/**
 * The custom CSS source a pages route takes as `customCss`: the site's CSS
 * (drawn first), the page's and each block's, judged by the page builder's
 * one checker.
 *
 * @experimental
 */
export function pageBuilderCustomCss(
  options: PageBuilderCustomCssOptions = {}
): CustomCssSource {
  const { plugin } = options;
  return {
    id: CUSTOM_CSS_CHECKER_ID,
    accepts: (css, level) => checkCustomCss(css, level).length === 0,
    readSite:
      plugin === undefined
        ? () => undefined
        : async () => drawn(await siteCssOf(plugin)),
    // The CSS is the plugin's own data, not a Single's: a save expires this
    // tag (`ctx.cache.expire`), so a cached page carries it.
    singles: [],
    tags: [pluginCacheTag(PAGE_BUILDER_PLUGIN_NAME, SITE_CSS_CACHE_PART)],
  };
}
