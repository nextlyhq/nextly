import React from "react";

import { NotFoundPage } from "@admin/components/shared/not-found-page";
import { PluginPageHost } from "@admin/components/shared/plugin-page-host";

import { ROUTES } from "../constants/routes";
import registry, { routeConfig } from "../pages/registry";
import type { AccessSubject, EntityAccess } from "../types/access-subject";
import type { CarriedRouteSection } from "../types/route-section";

import { routedDocumentView } from "./plugins/document-view-registry";
import { matchPluginPage } from "./plugins/plugin-route-registry";
import { parseSearchParams } from "./search-params";

/**
 * Whether `pathname` is `base` or sits beneath it.
 *
 * Whole segments, so `/admin/plugins` does not claim `/admin/plugins-archive`
 * — the reason this exists rather than each caller writing `includes()`. A
 * substring test is a proxy for "is this route under that one", and the
 * sibling paths that motivate writing the check are exactly the ones the proxy
 * gets wrong.
 *
 * Callers pass `ROUTES.*` rather than a spelling, so a route that moves takes
 * its classification with it.
 */
export function isUnder(pathname: string, base: string): boolean {
  const path = pathname.replace(/\/$/, "");
  const target = base.replace(/\/$/, "");
  return path === target || path.startsWith(`${target}/`);
}

/** Props passed to page components by the router */
export interface PageProps {
  params?: Record<string, string | string[]>;
  searchParams?: Record<string, string | string[] | undefined>;
}

export interface RouteResult {
  Component: React.ComponentType<PageProps>;
  params: Record<string, string | string[]>;
  searchParams: Record<string, string | string[] | undefined>;
  routeType?: "public" | "private";
  requiredPermission?: string | string[];
  /**
   * What the route opens, when it opens a collection or a Single, so a refused
   * visit can name it. Set beside `requiredPermission` from the same table.
   */
  accessSubject?: AccessSubject;
  /**
   * What the route asks of the collection or Single it opens, which the guard
   * decides from the server's answer. Set beside `requiredPermission` from the
   * same table.
   */
  entityAccess?: EntityAccess;
  /** Route is part of the schema builder, which is disabled in production. */
  requiresBuilder?: boolean;
  /** Set when the route resolves to a plugin-contributed page (D21). */
  pluginComponentPath?: string;
  /**
   * The rail section this route declared, carried through so the sidebar reads
   * a declaration instead of matching the pathname. Absent only when no route
   * matched, which is a genuine 404 rather than a route without a section.
   */
  section?: CarriedRouteSection;
}

type Params = Record<string, string | string[]>;

// Query-string parsing lives in `lib/search-params`, which imports nothing:
// this module imports the page registry, and therefore every page, so the
// helpers were unreachable from a hook without closing a cycle. Re-exported
// here so existing callers keep working.
export {
  getSearchParam,
  parseSearchParams,
  type SearchParams,
} from "./search-params";

// Normalize Next.js App Router patterns
function normalizePattern(pattern: string): string {
  return pattern
    .replace(/\([^)]*\)\//g, "") // strip route groups (auth) → ""
    .replace(/\/@[^/]+/g, "") // strip parallel segments @slot → ""
    .replace(/\(\.\)(\w+)/g, "$1"); // intercepting routes (.)edit → edit
}

// Convert route pattern to regex and extract parameter keys
function patternToRegex(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  pattern = normalizePattern(pattern);

  const regexStr = pattern
    .replace(/\//g, "\\/") // escape slashes
    .replace(/\[\.\.\.(\w+)\]/g, (_, key) => {
      keys.push(key);
      return "(.*)"; // catch-all
    })
    .replace(/\[\[\.\.\.(\w+)\]\]/g, (_, key) => {
      keys.push(key);
      return "(.*)?"; // optional catch-all
    })
    .replace(/\[(\w+)\]/g, (_, key) => {
      keys.push(key);
      return "([^\\/]+)"; // single param
    });

  return { regex: new RegExp("^" + regexStr + "$"), keys };
}

// Match dynamic routes
function matchDynamicRoute(pathname: string): {
  component: React.ComponentType<PageProps>;
  params: Params;
  routeType?: "public" | "private";
  requiredPermission?: string | string[];
  requiresBuilder?: boolean;
  section?: CarriedRouteSection;
  pattern: string;
} | null {
  for (const [pattern, Component] of Object.entries(registry)) {
    const { regex, keys } = patternToRegex(pattern);
    const match = pathname.match(regex);
    if (match) {
      const params: Params = {};
      keys.forEach((k, i) => {
        const value = match[i + 1];
        if (pattern.includes("[[...")) {
          params[k] = value ? value.split("/") : [];
        } else if (pattern.includes("[...")) {
          params[k] = value.split("/");
        } else {
          params[k] = value;
        }
      });

      const config = routeConfig[pattern];

      return {
        component: Component,
        params,
        routeType: config?.type,
        requiredPermission: config?.requiredPermission,
        requiresBuilder: config?.requiresBuilder,
        section: config?.type === "private" ? config.section : undefined,
        pattern,
      };
    }
  }
  return null;
}

/**
 * The action each slug-scoped route asks of its collection or Single, and which
 * of the two it is. One row answers both the permission the route needs and
 * what a refusal names, so the two cannot disagree about a route.
 */
const SLUG_ROUTE_ACCESS: Record<
  string,
  { action: "read" | "create" | "update"; subject: AccessSubject }
> = {
  [ROUTES.COLLECTION_ENTRIES]: { action: "read", subject: "collection" },
  [ROUTES.COLLECTION_ENTRY_CREATE]: { action: "create", subject: "collection" },
  // An entry opens for a user who may read it, and is editable only for one
  // who may change it: the editor shows a reader the same page, read-only.
  [ROUTES.COLLECTION_ENTRY_EDIT]: { action: "read", subject: "collection" },
  // A document view is an editor of the document, so it asks what editing
  // it asks.
  [ROUTES.COLLECTION_ENTRY_VIEW]: { action: "read", subject: "collection" },
  [ROUTES.COLLECTION_ENTRY_API]: { action: "read", subject: "collection" },
  // Reading a document's history is a read of that document, and restoring
  // from it goes through the ordinary update path with its own check.
  [ROUTES.COLLECTION_ENTRY_VERSIONS]: { action: "read", subject: "collection" },
  [ROUTES.SINGLE_EDIT]: { action: "read", subject: "single" },
  [ROUTES.SINGLE_VIEW]: { action: "read", subject: "single" },
  [ROUTES.SINGLE_API]: { action: "read", subject: "single" },
  [ROUTES.SINGLE_VERSIONS]: { action: "read", subject: "single" },
};

function getSlugRouteAccess(
  pattern: string,
  params: Params
):
  | {
      requiredPermission: string;
      accessSubject: AccessSubject;
      entityAccess: EntityAccess;
    }
  | undefined {
  const slug = typeof params.slug === "string" ? params.slug : undefined;
  const access = Object.hasOwn(SLUG_ROUTE_ACCESS, pattern)
    ? SLUG_ROUTE_ACCESS[pattern]
    : undefined;
  if (!access || !slug) return undefined;
  return {
    requiredPermission: `${access.action}-${slug}`,
    accessSubject: access.subject,
    entityAccess: { slug, action: access.action },
  };
}

/**
 * Whether a document-view address names a view nobody declared.
 *
 * The view patterns match ANY last segment, because which segments are views
 * is only known once admin-meta has loaded. An address whose segment no plugin
 * declared for this slug is therefore a matched pattern with nothing to draw,
 * and it is answered as not found rather than as an editor showing nothing.
 */
function isUndeclaredDocumentView(pattern: string, params: Params): boolean {
  if (
    pattern !== ROUTES.COLLECTION_ENTRY_VIEW &&
    pattern !== ROUTES.SINGLE_VIEW
  ) {
    return false;
  }
  const kind = pattern === ROUTES.SINGLE_VIEW ? "single" : "collection";
  return routedDocumentView(kind, params.slug, params.view) === undefined;
}

// Main route resolution function
export function resolveRoute(pathname: string, rawSearch: string): RouteResult {
  // Exact match
  if (registry[pathname]) {
    const config = routeConfig[pathname];
    return {
      Component: registry[pathname],
      params: {},
      searchParams: parseSearchParams(rawSearch),
      routeType: config?.type,
      requiredPermission: config?.requiredPermission,
      requiresBuilder: config?.requiresBuilder,
      section: config?.type === "private" ? config.section : undefined,
    };
  }

  // Plugin-contributed page (D21) — exact namespaced match, before dynamic
  // routes so a catch-all can never shadow it. Rendered via PluginSlot inside
  // the host; RBAC + layout applied by RootLayout from routeType/permission.
  const pluginPage = matchPluginPage(pathname);
  if (pluginPage) {
    return {
      Component: (props: PageProps) =>
        React.createElement(PluginPageHost, {
          ...props,
          componentPath: pluginPage.component,
        }),
      params: {},
      searchParams: parseSearchParams(rawSearch),
      routeType: "private",
      requiredPermission: pluginPage.requiredPermission,
      pluginComponentPath: pluginPage.component,
      section: pluginPage.section ?? "plugins",
    };
  }

  // Dynamic match
  const dynamic = matchDynamicRoute(pathname);
  if (dynamic && !isUndeclaredDocumentView(dynamic.pattern, dynamic.params)) {
    const slugAccess = getSlugRouteAccess(dynamic.pattern, dynamic.params);
    return {
      Component: dynamic.component,
      params: dynamic.params,
      searchParams: parseSearchParams(rawSearch),
      routeType: dynamic.routeType,
      requiredPermission:
        slugAccess?.requiredPermission ?? dynamic.requiredPermission,
      accessSubject: slugAccess?.accessSubject,
      entityAccess: slugAccess?.entityAccess,
      requiresBuilder: dynamic.requiresBuilder,
      section: dynamic.section,
    };
  }

  // Not found
  return {
    Component: () => React.createElement(NotFoundPage, { path: pathname }),
    params: {},
    searchParams: {},
    routeType: "private",
  };
}
