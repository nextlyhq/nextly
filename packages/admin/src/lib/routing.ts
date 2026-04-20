import React from "react";

import { NotFoundPage } from "@admin/components/shared/not-found-page";

import { ROUTES } from "../constants/routes";
import registry, { routeConfig } from "../pages/registry";

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
  requiredPermission?: string;
}

type Params = Record<string, string | string[]>;
type SearchParams = Record<string, string | string[] | undefined>;

// Parse URL search parameters
export function parseSearchParams(search: string): SearchParams {
  const usp = new URLSearchParams(search);
  const out: SearchParams = {};
  for (const key of Array.from(new Set(Array.from(usp.keys())))) {
    const values = usp.getAll(key);
    out[key] =
      values.length === 0
        ? undefined
        : values.length === 1
          ? values[0]
          : values;
  }
  return out;
}

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
  requiredPermission?: string;
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
        pattern,
      };
    }
  }
  return null;
}

function getDynamicRequiredPermission(
  pattern: string,
  params: Params
): string | undefined {
  const slug = typeof params.slug === "string" ? params.slug : undefined;

  if (pattern === ROUTES.COLLECTION_ENTRIES) {
    return slug ? `read-${slug}` : undefined;
  }
  if (pattern === ROUTES.COLLECTION_ENTRY_CREATE) {
    return slug ? `create-${slug}` : undefined;
  }
  if (pattern === ROUTES.COLLECTION_ENTRY_EDIT) {
    return slug ? `update-${slug}` : undefined;
  }
  if (
    pattern === ROUTES.COLLECTION_ENTRY_API ||
    pattern === ROUTES.COLLECTION_ENTRY_COMPARE
  ) {
    return slug ? `read-${slug}` : undefined;
  }

  if (pattern === ROUTES.SINGLE_EDIT) {
    return slug ? `update-${slug}` : undefined;
  }
  if (pattern === ROUTES.SINGLE_API) {
    return slug ? `read-${slug}` : undefined;
  }

  return undefined;
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
    };
  }

  // Dynamic match
  const dynamic = matchDynamicRoute(pathname);
  if (dynamic) {
    const dynamicPermission = getDynamicRequiredPermission(
      dynamic.pattern,
      dynamic.params
    );
    return {
      Component: dynamic.component,
      params: dynamic.params,
      searchParams: parseSearchParams(rawSearch),
      routeType: dynamic.routeType,
      requiredPermission: dynamicPermission ?? dynamic.requiredPermission,
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
