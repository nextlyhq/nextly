"use client";

/**
 * A plugin's own admin UI reading a route that plugin contributed.
 *
 * A plugin can serve an HTTP route and can render admin components, and until
 * this there was no way for the second to call the first. Measured before
 * writing it: `@nextlyhq/plugin-sdk/admin` exported no route client, and the
 * one first-party plugin with a UI that needed one contained no `fetch` at all
 * — so the choice a plugin author faced was to hand-roll auth, token refresh
 * and error parsing, or to give up and read something else.
 *
 * ## Why the plugin names itself
 *
 * There is no ambient plugin identity in the admin — `usePluginClientConfig`
 * takes the name too, for the same reason: a component is rendered through a
 * registry by string path, and nothing in its React context says which plugin
 * contributed it. Passing the name is what makes the request addressable.
 *
 * ## Why the path is built here rather than by the caller
 *
 * `pluginRouteFullPath` is the dispatcher's own answer to where a route
 * answers, shared through `nextly/config` because it is import-free. A caller
 * spelling `/plugins/${name}${path}` itself would agree until the namespace
 * moved, and the failure is silent: a request to a path nothing serves reads as
 * an empty answer rather than as an error.
 *
 * @module hooks/queries/usePluginRoute
 */

import { useQuery } from "@tanstack/react-query";
import { pluginRouteFullPath } from "nextly/config";

import { protectedApi } from "@admin/lib/api/protectedApi";

/** What one plugin-route read reports. */
export interface PluginRouteRead<T> {
  /** The parsed body, or `undefined` until one arrives. */
  data: T | undefined;
  /**
   * Whether the answer is still coming.
   *
   * A REAL third state beside the data, not a detail of it. `undefined` is
   * both "the route answered nothing" and "the route has not answered", and a
   * surface that cannot tell them apart draws its empty state over a read in
   * flight — which is the flash every list in this admin exists without.
   */
  pending: boolean;
  /** Why the read failed, or `null`. */
  error: Error | null;
  /** Ask again, ignoring anything cached. */
  refetch: () => void;
}

/** What to read. */
export interface PluginRouteRequest {
  /** The contributing plugin's package name, as it declared it. */
  plugin: string;
  /** The route's path within that plugin's namespace, starting with `/`. */
  path: string;
  /**
   * Whether to read at all. `false` holds the request without unmounting the
   * hook, for a surface that knows it will need the answer later — a panel that
   * has not been opened yet, say.
   */
  enabled?: boolean;
}

/**
 * Read a plugin route, cached and deduplicated like every other admin read.
 *
 * Through TanStack Query rather than a bare `fetch`, so two components asking
 * the same question make one request and a re-render makes none — and through
 * `protectedApi`, so the session, its refresh and the typed error envelope are
 * the ones the rest of the admin already uses.
 */
export function usePluginRoute<T>({
  plugin,
  path,
  enabled = true,
}: PluginRouteRequest): PluginRouteRead<T> {
  const route = pluginRouteFullPath(plugin, path);
  const query = useQuery<T>({
    // Keyed by the resolved path, so two plugins with the same route path do
    // not share an entry — and so a caller cannot make the key disagree with
    // the request by passing one of the two.
    queryKey: ["plugin-route", route],
    queryFn: () => protectedApi.get<T>(route),
    enabled,
  });
  return {
    data: query.data,
    // `isPending` is true for a DISABLED query too — it has no data and never
    // asked — so a surface reading it alone would show a spinner forever for a
    // panel that has not been opened. Held together with `isFetching`, which is
    // what "a request is in flight" actually means.
    pending: enabled && query.isPending && query.isFetching,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
