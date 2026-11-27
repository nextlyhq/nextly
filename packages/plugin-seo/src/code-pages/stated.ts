/**
 * The pages built in code a site states in the plugin's `codeAddresses`
 * option, by route: the addresses a route serves that no build names, such
 * as a page rendered on demand from a database, and, for any address a
 * route serves, the Markdown its plain-text copy is made of.
 *
 * The site's own function names a route's params, as `generateStaticParams`
 * does, and the plugin fills the route's address with them as
 * `seoStaticParams` does. The plugin can't see whether the route calls
 * `seoMetadata`: stating it says it does.
 *
 * @module code-pages/stated
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import {
  dynamicRouteServing,
  paramsOfAddress,
  type DynamicRoute,
} from "./routes";
import { addressOfParams, type StaticParams } from "./static-params";

/** A route's params, as `generateStaticParams` answers them. */
export type CodeAddressParams = () =>
  | readonly StaticParams[]
  | Promise<readonly StaticParams[]>;

/** A page built in code whose plain-text copy is asked for. */
export interface CodeMarkdownPage {
  /** The page's address, from the site's root. */
  path: string;
  /** The params its route is handed at that address. */
  params: StaticParams;
}

/**
 * The Markdown a page's plain-text copy is made of, without front matter,
 * which the plugin adds; none to make the copy from the rendered page.
 */
export type CodeMarkdown = (
  page: CodeMarkdownPage
) => string | undefined | Promise<string | undefined>;

/** What the site states about one route. */
export interface CodeAddressSource {
  /** The params of each page the route serves, to list them. */
  params?: CodeAddressParams;
  /** The Markdown each page's plain-text copy is made of. */
  markdown?: CodeMarkdown;
}

/**
 * The plugin's `codeAddresses` option: by route, as Next.js names it with
 * route groups left out (`"/docs/[[...slug]]"`), its params function, or
 * what it states.
 */
export type CodeAddressesOption = Record<
  string,
  CodeAddressParams | CodeAddressSource
>;

/** A function, as an option names one. */
const fn = z.custom<(...args: never[]) => unknown>(
  value => typeof value === "function",
  { message: "must be a function" }
);

/**
 * A route as Next.js names it: from the root, each segment a name or a
 * variable part, a catch-all only last.
 */
const ROUTE = z
  .string()
  .regex(
    /^\/[^?#\s]*$/,
    "must be a route from the site's root, such as /docs/[slug]"
  )
  .refine(
    route => {
      const segments = route.split("/").filter(part => part !== "");
      return segments.every(
        (segment, at) =>
          !/^\[{1,2}\.\.\./.test(segment) || at === segments.length - 1
      );
    },
    { message: "may have a catch-all only as its last segment" }
  );

/** What a route states, where it is not its params function alone. */
const SOURCE = z
  .object({ params: fn.optional(), markdown: fn.optional() })
  .strict();

/** One stated route, parsed. */
interface StatedRoute {
  pattern: string;
  params?: CodeAddressParams;
  markdown?: CodeMarkdown;
}

/** An address a stated route lists, and the route. */
export interface StatedAddress {
  path: string;
  pattern: string;
}

/** A stated route's Markdown for one of its pages. */
export interface StatedMarkdown {
  markdown: CodeMarkdown;
  page: CodeMarkdownPage;
}

/** What the plugin reads from `codeAddresses`. */
export interface StatedAddresses {
  /** Every address the stated params name, each once, sorted. */
  addresses: (ctx: PluginContext) => Promise<StatedAddress[]>;
  /** The Markdown source of the page at `path`, where a stated route gives one. */
  markdownAt: (path: string) => StatedMarkdown | undefined;
}

/** How long the addresses a site's params name are kept before asked again. */
const KEPT_MS = 60_000;

/**
 * `option` read and checked, so a mistyped route fails when the site
 * starts.
 *
 * @throws Error naming the route and the problem, where `option` is not one.
 */
export function statedAddressesOf(
  option: CodeAddressesOption | undefined
): StatedAddresses {
  // Each route checked on its own, so the message names it and the problem.
  const issues = Object.entries(option ?? {}).flatMap(([route, value]) => {
    const parsed = ROUTE.safeParse(route);
    if (!parsed.success) {
      return parsed.error.issues.map(issue => ({ ...issue, path: [route] }));
    }
    if (typeof value === "function") return [];
    return (SOURCE.safeParse(value).error?.issues ?? []).map(issue => ({
      ...issue,
      path: [route, ...issue.path],
    }));
  });
  const [issue] = issues;
  if (issue !== undefined) {
    const at = issue.path.map(String).join(".");
    throw new Error(
      `seoPlugin: codeAddresses${at === "" ? "" : ` "${at}"`} ${issue.message}`
    );
  }
  const routes: StatedRoute[] = Object.entries(option ?? {}).map(
    ([pattern, value]) =>
      typeof value === "function"
        ? { pattern, params: value }
        : {
            pattern,
            ...(value.params === undefined ? {} : { params: value.params }),
            ...(value.markdown === undefined
              ? {}
              : { markdown: value.markdown }),
          }
  );
  // Each route as the most specific match of an address picks it.
  const byPattern: DynamicRoute[] = routes.map(route => ({
    address: route.pattern,
    route: route.pattern,
  }));
  let kept: { at: number; addresses: StatedAddress[] } | undefined;
  // The routes warned of, so a site's mistake is said once per process.
  const warned = new Set<string>();

  async function addressesOfRoute(
    ctx: PluginContext,
    route: StatedRoute
  ): Promise<StatedAddress[]> {
    if (route.params === undefined) return [];
    let params: readonly StaticParams[];
    try {
      params = await route.params();
    } catch (error) {
      ctx.logger.warn(
        "The pages codeAddresses names for a route could not be read",
        { route: route.pattern, error }
      );
      return [];
    }
    const found: StatedAddress[] = [];
    let missing = false;
    for (const each of Array.isArray(params) ? params : []) {
      const path = addressOfParams(route.pattern, each);
      if (path === undefined) missing = true;
      else found.push({ path, pattern: route.pattern });
    }
    if (missing && !warned.has(route.pattern)) {
      warned.add(route.pattern);
      ctx.logger.warn(
        "codeAddresses named params without a value for every part of the route, so those pages are not listed",
        { route: route.pattern }
      );
    }
    return found;
  }

  return {
    addresses: async ctx => {
      if (kept !== undefined && Date.now() - kept.at < KEPT_MS) {
        return kept.addresses;
      }
      const all = new Map<string, StatedAddress>();
      for (const route of routes) {
        for (const each of await addressesOfRoute(ctx, route)) {
          if (!all.has(each.path)) all.set(each.path, each);
        }
      }
      const addresses = [...all.values()].sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0
      );
      kept = { at: Date.now(), addresses };
      return addresses;
    },
    markdownAt: path => {
      const serving = dynamicRouteServing(path, byPattern);
      const route = routes.find(each => each.pattern === serving?.address);
      if (route?.markdown === undefined) return undefined;
      const params = paramsOfAddress(route.pattern, path);
      return params === undefined
        ? undefined
        : { markdown: route.markdown, page: { path, params } };
    },
  };
}
