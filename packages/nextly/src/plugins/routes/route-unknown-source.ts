/**
 * Which budget a request to a plugin's `rateLimit: "auth"` route counts
 * against when its client address cannot be resolved.
 *
 * Keyed on the address, every such request shared one bucket per route, so
 * one visitor spending the budget closed the route to everyone. Here a route
 * that declares a `limitKey` counts each request against the identity it
 * names, at the auth budget; every request to the plugin's auth routes also
 * spends a ceiling of {@link UNKNOWN_SOURCE_CEILING_MULTIPLE} times that
 * budget, the plugin's own, so inventing identities buys no capacity and a
 * flood of one plugin refuses nothing core's sign-in or another plugin's
 * routes admit. A route without a `limitKey` is bounded by that ceiling
 * alone: it names no identity to count by, and one shared budget is the
 * defect this replaces.
 *
 * @module plugins/routes/route-unknown-source
 */
import {
  pluginRouteLimitKey,
  readLimiterBody,
  UNKNOWN_SOURCE_CEILING_MULTIPLE,
} from "../../auth/handlers/unknown-source";
import { authRateLimiter } from "../../auth/middleware/rate-limiter";
import {
  MemoryUnknownSourceCounter,
  StoreUnknownSourceCounter,
  type UnknownSourceCounter,
  type UnknownSourceLimits,
  type UnknownSourceVerdict,
} from "../../auth/middleware/unknown-source-counter";
import {
  askLimitKey,
  limiterRequest,
} from "../../auth/pipeline/strategy-chain";
import type { RateLimitStore } from "../../middleware/rate-limit";

import type { PluginRoute } from "./route-types";

/** The ceiling's key for one plugin, apart from core's and every other's. */
function ceilingKey(pluginName: string): string {
  return `plugin-auth-unknown:ceiling:${pluginName}`;
}

/** The budget shared by one plugin's requests that name no identity. */
function noIdentityKey(pluginName: string): string {
  return `plugin-auth-unknown:no-identity:${pluginName}`;
}

/**
 * The process-local counters, one per plugin: a memory counter's size is
 * bounded by its one ceiling, so each ceiling has a counter of its own.
 */
const memoryCounters = new Map<string, MemoryUnknownSourceCounter>();

function counterFor(
  pluginName: string,
  store: RateLimitStore | undefined
): UnknownSourceCounter {
  if (store !== undefined) {
    return new StoreUnknownSourceCounter(
      authRateLimiter(store),
      ceilingKey(pluginName)
    );
  }
  let counter = memoryCounters.get(pluginName);
  if (!counter) {
    counter = new MemoryUnknownSourceCounter();
    memoryCounters.set(pluginName, counter);
  }
  return counter;
}

/** What a plugin auth route's admission is judged against. */
export interface RouteUnknownSourceInput {
  pluginName: string;
  route: Pick<PluginRoute, "limitKey">;
  /** The auth budget per identity, above zero. */
  budget: number;
  windowMs: number;
  store?: RateLimitStore;
  secret: string;
}

/**
 * Admit or refuse a request to a plugin's auth route whose client address
 * cannot be resolved. The caller has already established that the limiter is
 * enabled.
 */
export async function admitRouteUnknownSource(
  request: Request,
  input: RouteUnknownSourceInput
): Promise<UnknownSourceVerdict> {
  const limits: UnknownSourceLimits = {
    budget: input.budget,
    ceiling: input.budget * UNKNOWN_SOURCE_CEILING_MULTIPLE,
    windowMs: input.windowMs,
  };
  const counter = counterFor(input.pluginName, input.store);
  const { limitKey } = input.route;
  // Asking the route is the work the ceiling bounds, so the ceiling is spent
  // on arrival, before the body is read or the route asked; with no
  // `limitKey` there is nothing else to spend.
  const arrival = await counter.arrive(limits);
  if (!arrival.allowed || limitKey === undefined) return arrival;

  const body = await readLimiterBody(request);
  const answer = await askLimitKey(limitKey.bind(input.route), {
    request: await limiterRequest(request),
    body,
  });
  const key = answer.handles
    ? pluginRouteLimitKey(input.pluginName, answer.key, input.secret)
    : null;
  return counter.admitArrived(
    key ?? noIdentityKey(input.pluginName),
    limits,
    arrival.at
  );
}
