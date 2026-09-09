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
 * ## A route answers with a JSON object, or with `null`
 *
 * Constrained in the TYPE rather than described in prose, because the failure
 * is silent otherwise. The admin's fetcher returns `undefined` for a bare
 * string or number — deliberately, and its comment says why: no endpoint in
 * this admin answers with one, so it declined to invent a meaning for a shape
 * nothing sends. That reasoning holds for the admin's own endpoints and stops
 * holding here, because a plugin may serve whatever it likes. A route replying
 * `Response.json("ready")` would reach a caller as a successful EMPTY answer.
 *
 * So `T` is bounded, and `usePluginRoute<string>` does not compile. A route
 * that wants to answer with a scalar wraps it — `{ status: "ready" }` — which
 * is what the canonical response envelopes do anyway.
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
import { pluginRouteFullPath, type PluginRouteMount } from "nextly/config";

import { protectedApi } from "@admin/lib/api/protectedApi";

/** What one plugin-route read reports. */
export interface PluginRouteRead<T extends object | null> {
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
  /**
   * How long an answer stays fresh, in milliseconds.
   *
   * Worth naming because the admin's default is FIVE MINUTES with no refetch on
   * focus, which suits a list this admin also writes: those writes invalidate
   * their own collection keys. A plugin route is not on that map — nothing in
   * the admin knows which routes a given write affects — so a route serving
   * something the admin edits elsewhere is stale for five minutes and shows an
   * author a list their own save is missing from.
   *
   * `0` with the mount refetch below is the honest setting for such a route:
   * every mount asks again. A route serving something that does not change
   * under it should leave this alone and take the default.
   */
  staleTime?: number;
  /**
   * Where the route the server registered actually answers.
   *
   * Defaults to `"plugin"`, the namespace. A route the plugin declared with
   * `mount: "root"` answers at its own path instead, and asking for it under
   * the namespace requests a path nothing serves. That does not raise: an
   * unserved path answers with nothing and reads as an empty result, which is
   * the mistake this argument exists to make impossible to fall into silently.
   */
  mount?: PluginRouteMount;
}

/**
 * Read a plugin route, cached and deduplicated like every other admin read.
 *
 * Through TanStack Query rather than a bare `fetch`, so two components asking
 * the same question make one request and a re-render makes none — and through
 * `protectedApi`, so the session, its refresh and the typed error envelope are
 * the ones the rest of the admin already uses.
 */
export function usePluginRoute<T extends object | null>({
  plugin,
  path,
  enabled = true,
  staleTime,
  mount,
}: PluginRouteRequest): PluginRouteRead<T> {
  const route = pluginRouteFullPath(plugin, path, mount);
  const query = useQuery<T | typeof NO_BODY>({
    // Keyed by the resolved path, so two plugins with the same route path do
    // not share an entry — and so a caller cannot make the key disagree with
    // the request by passing one of the two.
    queryKey: ["plugin-route", route],
    // A successful EMPTY answer is not an error, and TanStack rejects
    // `undefined` outright — it moves such a query into the error state. A 204,
    // a 205 and a zero-length body all reach here as `undefined` from the
    // fetcher, so a route that legitimately answers with nothing would report a
    // failure to a plugin that had done nothing wrong. The sentinel carries
    // "answered, with nothing" through the cache and is translated back below.
    queryFn: async () => {
      const body = await protectedApi.get<T>(route);
      // `undefined` ALONE, never `??`. `null` is a body a route may
      // legitimately return, and treating it as absent would hand the caller
      // `undefined` for a value the route actually sent.
      return body === undefined ? NO_BODY : body;
    },
    enabled,
    ...(staleTime === undefined ? {} : { staleTime }),
    // Only where the caller asked for freshness. `always` overrides the cache
    // for this query alone, so a route whose subject the admin edits elsewhere
    // is re-read when a surface that needs it mounts — and one that takes the
    // default keeps the admin's ordinary caching.
    ...(staleTime === 0 ? { refetchOnMount: "always" as const } : {}),
  });
  return {
    data: bodyOf<T>(query.data),
    // `isPending` is true for a DISABLED query too — it has no data and never
    // asked — so `enabled` is what separates those, and it is enough on its own.
    //
    // NOT also `isFetching`, which was the over-correction. A read waiting to
    // resume — offline before the first request — is `isPending: true` with
    // `fetchStatus: "paused"`, so `isFetching` is FALSE while nothing has
    // arrived. Requiring it reported such a read as settled, and a surface then
    // draws its empty state over a request that has not happened yet.
    pending: enabled && query.isPending,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

/**
 * What the cache holds for a route that answered with no body.
 *
 * A private symbol rather than `null`, because `null` is a body a route may
 * legitimately return and the two must not collapse. It never leaves this
 * module: `data` is `undefined` for both, which is what the caller's `pending`
 * is there to disambiguate.
 */
const NO_BODY = Symbol("plugin-route.no-body");

/**
 * The cached value as a caller sees it: the body, or nothing.
 *
 * The narrowing is a function rather than a ternary at the return so the
 * sentinel is removed from the type as well as from the value. TypeScript
 * cannot rule `typeof NO_BODY` out of an open `T` by comparison alone.
 */
function bodyOf<T extends object | null>(
  cached: T | typeof NO_BODY | undefined
): T | undefined {
  return cached === NO_BODY ? undefined : cached;
}
