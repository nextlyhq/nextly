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
import {
  pluginRouteFullPath,
  type JsonValue,
  type RouteMethod,
} from "nextly/config";
import { useCallback, useRef, useState } from "react";

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
  readonly write: (body?: TBody) => Promise<TResult | undefined>;
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
  TBody = JsonValue,
  TResult extends object | null = Record<string, unknown>,
>({
  plugin,
  path,
  method = "POST",
  invalidates,
}: PluginRouteWrite): PluginRouteWriter<TBody, TResult> {
  const client = useQueryClient();
  const route = pluginRouteFullPath(plugin, path);
  const mutation = useMutation<TResult | undefined, Error, PluginWrite<TBody>>({
    // The TARGET travels with the body rather than being closed over. A write
    // paused offline has its options updated by TanStack before its retryer
    // runs, so a closure would send a body submitted against one route to
    // whichever route the hook was rendered with by the time the connection
    // returned — a different endpoint, or a different verb, for a body the
    // author approved for neither.
    mutationFn: (sent: PluginWrite<TBody>) =>
      sendTo<TResult>(sent.method, sent.route, sent.body),
    // 🔴 NEVER retried, and this overrides the admin's own default of two.
    //
    // The admin retries mutations because its own are addressed to routes it
    // owns and knows the shape of. This one is addressed to a route a plugin
    // wrote, with no idempotency key and no requirement that the route be
    // idempotent — and the default verb is POST. A create that commits and
    // then loses its response would be sent again, twice, and the author gets
    // three rows for one click with nothing reporting it.
    //
    // The asymmetry decides it: a write that is not retried costs a failure the
    // caller is told about and may repeat deliberately, and a write that is
    // retried wrongly costs duplicate data nothing can identify afterwards.
    retry: false,
    onSuccess: async (_answered, sent: PluginWrite<TBody>) => {
      // The keys THIS write carried, not the ones the hook points at now. A
      // callback reading the latest render refreshes the wrong plugin's reads
      // when the target changed while the request was in flight, and leaves
      // the data it did change stale.
      await Promise.all(
        sent.invalidates.map(queryKey => client.invalidateQueries({ queryKey }))
      );
    },
  });

  // Tracked HERE rather than read off the mutation, because TanStack's observer
  // follows only the most recent call. Two writes in flight — a double submit,
  // an autosave overlapping a save — and the older one's rejection reaches no
  // observer at all: `error` never sees it, and `pending` goes false while that
  // request is still running. A caller watching those would be told the write
  // succeeded.
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const mutateAsync = mutation.mutateAsync;
  const inFlightRef = useRef(0);

  const write = useCallback(
    async (body?: TBody) => {
      inFlightRef.current += 1;
      setInFlight(inFlightRef.current);
      try {
        const answered = await mutateAsync({
          body,
          method,
          route,
          // Resolved HERE, against this render's plugin and paths, so the write
          // carries the keys it was submitted with.
          invalidates: (invalidates ?? []).map(target => [
            "plugin-route",
            pluginRouteFullPath(plugin, target),
          ]),
        });
        // A write that succeeded clears the last failure. Without this, one
        // failed save left `error` set for the rest of the session — a plugin
        // showing "could not save" beside a save that had just worked, which
        // contradicts what this field says it is.
        setError(null);
        return answered;
      } catch (cause) {
        // Every failed write is reported, not only the newest.
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        // Resolved rather than rethrown; see `write` on the contract.
        return undefined;
      } finally {
        inFlightRef.current -= 1;
        setInFlight(inFlightRef.current);
      }
    },
    [mutateAsync, method, route, plugin, invalidates]
  );

  return { write, pending: inFlight > 0, error };
}

/** One write, with the target it was submitted against. */
interface PluginWrite<TBody> {
  readonly body: TBody | undefined;
  readonly method: PluginRouteMethod;
  readonly route: string;
  /**
   * The read keys this write refreshes, resolved when it was SUBMITTED.
   *
   * Snapshotted for the same reason the route is. TanStack updates a pending
   * mutation's options, so a callback reading the latest render would refresh
   * the reads of whatever the hook points at now — leaving the data this write
   * actually changed stale, and invalidating a list it never touched.
   */
  readonly invalidates: readonly (readonly unknown[])[];
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
