/**
 * The write a plugin makes to its own contributed route.
 *
 * The counterpart to `usePluginRoute`, and it exists for the same reason: the
 * two halves of a plugin could not reach each other. A plugin may serve an HTTP
 * route and may render admin components, and the component had a client for
 * READING that route and none for writing to it — so an author's choice was to
 * hand-roll the session, its refresh and the error envelope, or to not offer
 * the write at all.
 *
 * It goes through the same authenticated client and the same query cache the
 * admin's own writes use, so a plugin inherits session refresh, the typed error
 * envelope, and cache invalidation without implementing any of them.
 *
 * @module hooks/queries/usePluginRouteMutation
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pluginRouteFullPath, type RouteMethod } from "nextly/config";

import { protectedApi } from "@admin/lib/api/protectedApi";

/**
 * The verbs a contributed route may be written to with.
 *
 * DERIVED from the route contract rather than listed again. Spelled out, this
 * was a second statement of which methods exist: a method added to
 * `RouteMethod` would be declarable by a plugin and uncallable from here, and
 * nothing would fail — the narrower view would simply stop covering the wider
 * one. Subtracting the read verb keeps the two in step by construction, and the
 * exhaustive record below then refuses to compile until the new verb has a
 * sender.
 */
export type PluginRouteMethod = Exclude<RouteMethod, "GET">;

/** What a plugin needs to say to write to one of its routes. */
export interface PluginRouteWrite {
  /**
   * The plugin's own package name.
   *
   * The plugin names ITSELF, exactly as the read hook requires: nothing in a
   * plugin component's React context says which plugin contributed it, because
   * it is rendered through a registry by string path.
   */
  readonly plugin: string;
  /** The route's path, as the plugin declared it. */
  readonly path: string;
  /** Defaults to `POST`, which is what creating something is. */
  readonly method?: PluginRouteMethod;
  /**
   * Paths under the SAME plugin whose reads this write makes stale.
   *
   * Named rather than inferred, because nothing here knows which reads a write
   * affects — that is the plugin's own knowledge, and the admin's cache has no
   * map of it. A pattern save names the library path, so an author who saves a
   * pattern and opens the insert panel is not shown a library their own save is
   * missing from.
   *
   * Scoped by CONSTRUCTION: each entry is resolved through
   * `pluginRouteFullPath` with this plugin's own name, so a plugin cannot
   * invalidate another plugin's cached reads however it spells the path.
   */
  readonly invalidates?: readonly string[];
}

/** What a write reports back while and after it runs. */
export interface PluginRouteWriter<TBody, TResult extends object | null> {
  /**
   * Send the body, and resolve with what the route answered.
   *
   * RESOLVES rather than rejects on failure, and answers `undefined` there —
   * the same shape the read hook has, so a plugin author learns one thing. A
   * rejecting promise is the idiomatic TanStack shape and it is a footgun on a
   * surface handed to third parties: a caller who does not wrap the await gets
   * an unhandled rejection, and the failure is already reported on `error`.
   *
   * `undefined` also means "answered with no body", which a 204 legitimately
   * does. `error` is what separates the two.
   */
  readonly write: (body: TBody) => Promise<TResult | undefined>;
  /** Whether a write is in flight. */
  readonly pending: boolean;
  /** The failure of the last write, or `null`. */
  readonly error: Error | null;
}

/**
 * Write to a route this plugin contributed.
 *
 * The result type is bounded to an object or `null` for the reason the read is:
 * the admin's fetcher returns `undefined` for a bare string or number, so
 * `Response.json("ok")` would arrive as a successful empty answer and a caller
 * typed `<string>` would silently never see it. A route wanting a scalar wraps
 * it, which the canonical envelopes do anyway.
 *
 * NOTHING is toasted from here. The admin's own mutation hooks raise a toast
 * because they own the surface that follows; a plugin owns its own, and a
 * generic hook that announced every write would put the admin's voice inside
 * someone else's feature.
 */
export function usePluginRouteMutation<
  TBody,
  TResult extends object | null = Record<string, unknown>,
>({
  plugin,
  path,
  method = "POST",
  invalidates,
}: PluginRouteWrite): PluginRouteWriter<TBody, TResult> {
  const client = useQueryClient();
  const route = pluginRouteFullPath(plugin, path);
  const mutation = useMutation<TResult | undefined, Error, TBody>({
    mutationFn: (body: TBody) => sendTo<TResult>(method, route, body),
    onSuccess: async () => {
      // The plugin's OWN reads, keyed exactly as `usePluginRoute` keys them.
      await Promise.all(
        (invalidates ?? []).map(target =>
          client.invalidateQueries({
            queryKey: ["plugin-route", pluginRouteFullPath(plugin, target)],
          })
        )
      );
    },
  });
  return {
    write: async (body: TBody) => {
      try {
        return await mutation.mutateAsync(body);
      } catch {
        // Reported on `error`; see `write`'s own note on why this resolves.
        return undefined;
      }
    },
    pending: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * One request, by verb.
 *
 * A lookup rather than a chain of ifs, so a verb added to
 * {@link PluginRouteMethod} fails to compile here until it is given a sender.
 */
function sendTo<TResult>(
  method: PluginRouteMethod,
  route: string,
  body: unknown
): Promise<TResult | undefined> {
  const senders: Record<PluginRouteMethod, () => Promise<TResult | undefined>> =
    {
      POST: () => protectedApi.post<TResult>(route, body),
      PUT: () => protectedApi.put<TResult>(route, body),
      PATCH: () => protectedApi.patch<TResult>(route, body),
      DELETE: () => protectedApi.delete<TResult>(route, body),
    };
  return senders[method]();
}
