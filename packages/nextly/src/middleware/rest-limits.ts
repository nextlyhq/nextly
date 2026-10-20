/**
 * The REST rate limit, counted by who is asking.
 *
 * Every request is counted against one budget, chosen by the credential
 * authentication itself uses:
 *
 * - a session that verifies spends its user's budget, whatever address it
 *   comes from, and its API key, if it also carries one, is not looked up;
 * - an API key that resolves spends that key's own budget (`apiKeys.rateLimit`),
 *   once;
 * - a request carrying neither spends its address's budget, as before;
 * - one carrying neither from an address the server cannot resolve spends a
 *   ceiling shared by all of them, except on an auth route, which its own
 *   limits judge.
 *
 * A key that does not resolve costs a lookup, so failed lookups are bounded
 * before the next one: by the source's own budget, or for unresolved sources
 * by a ceiling of their own. Once a bound is spent, key requests under it are
 * refused before any lookup until the window turns, which can refuse a valid
 * key sent under the same bound, and nothing else. A plugin's people are
 * bounded the same way, per plugin.
 *
 * @module middleware/rest-limits
 */
import { container } from "../di/container";
import { openWhileStoreIsDown } from "../domains/limits/core-limit-outage";
import { guardedAppRateLimitStore } from "../domains/limits/core-limit-store";
import type { LimitStoreSelection } from "../domains/limits/limit-store-setting";
import { NextlyError } from "../errors/nextly-error";
import { consoleLogger } from "../shared/types";
import { getTrustedClientIp } from "../utils/get-trusted-client-ip";

import {
  InMemoryRateLimitStore,
  isReadOperation,
  RATE_LIMIT_DEFAULTS,
  type RateLimitConfig,
  type RateLimitResult,
  type RateLimitStore,
} from "./rate-limit";
import {
  defaultRestCallerReaders,
  presentedApiKey,
  type RestCallerReaders,
} from "./rest-callers";
import {
  openRestLimitGate,
  type ApiKeyMemory,
  type PersonResolution,
  type RestLimitDecider,
  type RestLimitTarget,
} from "./rest-limit-gate";

/** A session's budget, as a multiple of the per-address budgets. */
export const SESSION_BUDGET_MULTIPLE = 5;

/** The unresolved sources' ceiling, as a multiple of the per-address budgets. */
export const UNRESOLVED_CEILING_MULTIPLE = 10;

type Operation = "read" | "write";

interface Budgets {
  read: number;
  write: number;
}

/** One counter: the key it is kept under, and how many it admits a window. */
interface Bucket {
  key: string;
  limit: number;
}

interface RestLimitSettings {
  windowMs: number;
  perAddress: Budgets;
  sessions: Budgets;
  ceiling: Budgets;
  /** The failed key lookups unresolved sources may cost, a window. */
  keyLookups: Budgets;
  collections: NonNullable<RateLimitConfig["collections"]>;
  /** The request's source, or `null` when none resolves. */
  sourceOf: (request: Request) => string | null;
  skip?: RateLimitConfig["skip"];
  handler?: RateLimitConfig["handler"];
}

function budgets(
  given: { readLimit?: number; writeLimit?: number } | undefined,
  fallback: Budgets
): Budgets {
  return {
    read: given?.readLimit ?? fallback.read,
    write: given?.writeLimit ?? fallback.write,
  };
}

function times(base: Budgets, multiple: number): Budgets {
  return { read: base.read * multiple, write: base.write * multiple };
}

/**
 * The source the default key reads, the trusted client address. A custom
 * `keyGenerator` names the source itself, so whatever it returns resolves.
 */
function sourceReader(
  config: RateLimitConfig
): (request: Request) => string | null {
  if (config.keyGenerator) return config.keyGenerator;
  const trust = {
    trustProxy: config.trustProxy ?? false,
    trustedProxyIps: config.trustedProxyIps ?? [],
  };
  return request => getTrustedClientIp(request, trust);
}

function settingsFrom(config: RateLimitConfig): RestLimitSettings {
  const perAddress = budgets(config, {
    read: RATE_LIMIT_DEFAULTS.readLimit,
    write: RATE_LIMIT_DEFAULTS.writeLimit,
  });
  const ceilingByDefault = times(perAddress, UNRESOLVED_CEILING_MULTIPLE);
  return {
    windowMs: config.windowMs ?? RATE_LIMIT_DEFAULTS.windowMs,
    perAddress,
    sessions: budgets(
      config.sessions,
      times(perAddress, SESSION_BUDGET_MULTIPLE)
    ),
    ceiling: budgets(config.unresolvedCeiling, ceilingByDefault),
    keyLookups: ceilingByDefault,
    collections: config.collections ?? {},
    sourceOf: sourceReader(config),
    skip: config.skip,
    handler: config.handler,
  };
}

function operationOf(method: string): Operation {
  return isReadOperation(method) ? "read" : "write";
}

/**
 * The collection a request's path names, as `/collections/{slug}`.
 *
 * The path only: a query is the caller's to write, so a slug read from it
 * would let one caller name a fresh budget on every request.
 */
function collectionOf(url: string): string | null {
  const match = new URL(url).pathname.match(/\/collections\/([^/]+)/);
  return match ? match[1] : null;
}

/** Lightweight system endpoints, never counted. */
function isSystemEndpoint(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return (
    pathname.endsWith("/auth/setup-status") || pathname.endsWith("/health")
  );
}

/**
 * A bound's state before the work it bounds: refused, or admitted with
 * whether arrival already recorded the attempt and whether it holds one of
 * the bound's places in flight.
 */
type BoundState =
  | { refused: RateLimitResult }
  | { recorded: boolean; reserved: boolean };

/** The limit itself. Holds no per-request state; the store holds the counts. */
class RestLimits implements RestLimitDecider {
  /**
   * The lookups and resolutions a bound is guarding in this process right
   * now, by the bound's key. The store records an attempt only once it has
   * failed, so without these a burst would see one count and start as many
   * lookups as arrived together.
   */
  private readonly inFlight = new Map<string, number>();

  constructor(
    private readonly settings: RestLimitSettings,
    private readonly store: RateLimitStore,
    private readonly readers: RestCallerReaders
  ) {}

  async admit(
    request: Request,
    target: RestLimitTarget,
    keys: ApiKeyMemory
  ): Promise<Response | null> {
    if (await this.exempt(request)) return null;
    const operation = operationOf(request.method);
    const user = await this.readers.sessionUser(request);
    if (user !== null) {
      return this.count(request, {
        key: `ratelimit:session:${user}:${operation}`,
        limit: this.settings.sessions[operation],
      });
    }
    const source = this.sourceBucket(request, operation);
    const rawKey = presentedApiKey(request);
    if (rawKey !== null) {
      const bound = source ?? {
        key: `ratelimit:unresolved:key-lookups:${operation}`,
        limit: this.settings.keyLookups[operation],
      };
      return this.admitKey(request, rawKey, bound, keys);
    }
    if (source) return this.count(request, source);
    // An auth route's unresolved requests are judged by its own limits, so
    // spending the ceiling can never deny a sign-in.
    if (target === "auth") return null;
    return this.count(request, {
      key: `ratelimit:unresolved:${operation}`,
      limit: this.settings.ceiling[operation],
    });
  }

  async admitPerson<T>(
    request: Request,
    plugin: string,
    person: PersonResolution<T>
  ): Promise<{ refused: Response } | { resolved: T }> {
    if (await this.exempt(request)) return { resolved: await person.resolve() };
    const operation = operationOf(request.method);
    const bound = this.failedPersonBucket(request, plugin, operation);
    const before = await this.boundBefore(bound);
    if ("refused" in before) {
      return { refused: this.refusal(request, before.refused) };
    }
    try {
      const resolved = await person.resolve();
      const who = person.personOf(resolved);
      const refused = who
        ? await this.count(request, {
            key: `ratelimit:person:${plugin}:${who.kind}:${who.id}:${operation}`,
            limit: this.settings.sessions[operation],
          })
        : await this.spendBound(request, bound, before);
      return refused ? { refused } : { resolved };
    } finally {
      this.release(bound, before);
    }
  }

  async personBoundRefusal(
    request: Request,
    plugin: string
  ): Promise<Response | null> {
    // A store that cannot be asked without recording answers nothing here;
    // the person's request is then judged in full when its route settles.
    if (!this.store.consume || (await this.exempt(request))) return null;
    const bound = this.failedPersonBucket(
      request,
      plugin,
      operationOf(request.method)
    );
    const held = await this.store.consume(bound.key, 0, this.settings.windowMs);
    const pending = this.inFlight.get(bound.key) ?? 0;
    return held.count + pending >= bound.limit
      ? this.refusal(request, refusedBy(bound, held.resetTime))
      : null;
  }

  /** A request this limit never counts: a system endpoint, or a configured skip. */
  private async exempt(request: Request): Promise<boolean> {
    if (isSystemEndpoint(request)) return true;
    return this.settings.skip ? await this.settings.skip(request) : false;
  }

  /** The address's own budget, with its collection's override; `null` unresolved. */
  private sourceBucket(request: Request, operation: Operation): Bucket | null {
    const source = this.settings.sourceOf(request);
    if (source === null) return null;
    const collection = collectionOf(request.url);
    // A collection the config gives limits of its own keeps a budget of its
    // own. Any other slug shares the address's one budget: a slug is the
    // caller's to choose, and a counter per slug would hand a caller a fresh
    // budget for every name it invents.
    const override =
      collection !== null &&
      Object.hasOwn(this.settings.collections, collection)
        ? this.settings.collections[collection]
        : undefined;
    if (collection === null || override === undefined) {
      return {
        key: `ratelimit:${source}:${operation}`,
        limit: this.settings.perAddress[operation],
      };
    }
    const overridden =
      operation === "read" ? override.readLimit : override.writeLimit;
    return {
      key: `ratelimit:${source}:${collection}:${operation}`,
      limit: overridden ?? this.settings.perAddress[operation],
    };
  }

  /**
   * The bound on a plugin's failed person resolutions: for a resolved source,
   * the size of its own budget and apart from it; for unresolved sources, the
   * ceiling's size, per plugin.
   */
  private failedPersonBucket(
    request: Request,
    plugin: string,
    operation: Operation
  ): Bucket {
    const source = this.settings.sourceOf(request);
    return source === null
      ? {
          key: `ratelimit:person-failed:${plugin}:unresolved:${operation}`,
          limit: this.settings.ceiling[operation],
        }
      : {
          key: `ratelimit:person-failed:${plugin}:${source}:${operation}`,
          limit: this.settings.perAddress[operation],
        };
  }

  private async admitKey(
    request: Request,
    rawKey: string,
    bound: Bucket,
    keys: ApiKeyMemory
  ): Promise<Response | null> {
    const before = await this.boundBefore(bound);
    if ("refused" in before) return this.refusal(request, before.refused);
    try {
      const resolved = await this.readers.lookupKey(rawKey);
      if (resolved) {
        keys.remember(rawKey, { resolved, debited: true });
        return await this.readers.debitKey(resolved.id);
      }
      // A key that does not resolve is answered without a second lookup; one
      // nothing could ask about is left for authentication to ask again.
      if (resolved === null) {
        keys.remember(rawKey, { resolved, debited: false });
      }
      return await this.spendBound(request, bound, before);
    } finally {
      this.release(bound, before);
    }
  }

  /**
   * Whether a bound is already spent, asked before the work it bounds.
   *
   * Asked with a zero-limit `consume`, which records nothing, and counted
   * with the work under the bound already in flight here, which then takes a
   * place: the check and the reservation follow the store's answer with no
   * await between them, so in one process a burst starts no more work than
   * the bound has room for. Each further process can start at most the
   * bound's room again before the store holds its failures. A store without
   * `consume` cannot be asked without recording, so there the attempt is
   * recorded on arrival: stricter, since work that succeeds then spends the
   * bound too, and never looser.
   */
  private async boundBefore(bound: Bucket): Promise<BoundState> {
    if (this.store.consume) {
      const held = await this.store.consume(
        bound.key,
        0,
        this.settings.windowMs
      );
      const pending = this.inFlight.get(bound.key) ?? 0;
      if (held.count + pending >= bound.limit) {
        return { refused: refusedBy(bound, held.resetTime) };
      }
      this.inFlight.set(bound.key, pending + 1);
      return { recorded: false, reserved: true };
    }
    const record = await this.store.increment(
      bound.key,
      this.settings.windowMs
    );
    return record.count > bound.limit
      ? { refused: refusedBy(bound, record.resetTime) }
      : { recorded: true, reserved: false };
  }

  /**
   * Give back the place a request held in flight, once its failure, if any,
   * is recorded, so no request starts in the gap between the two.
   */
  private release(bound: Bucket, before: { reserved: boolean }): void {
    if (!before.reserved) return;
    const left = (this.inFlight.get(bound.key) ?? 1) - 1;
    if (left > 0) this.inFlight.set(bound.key, left);
    else this.inFlight.delete(bound.key);
  }

  /** Spend a bound for work that failed, unless arrival already spent it. */
  private spendBound(
    request: Request,
    bound: Bucket,
    before: { recorded: boolean }
  ): Promise<Response | null> {
    return before.recorded ? Promise.resolve(null) : this.count(request, bound);
  }

  /** Count one request, answering the refusal once the bucket is over. */
  private async count(
    request: Request,
    bucket: Bucket
  ): Promise<Response | null> {
    const record = await this.store.increment(
      bucket.key,
      this.settings.windowMs
    );
    if (record.count <= bucket.limit) return null;
    return this.refusal(request, refusedBy(bucket, record.resetTime));
  }

  private refusal(request: Request, result: RateLimitResult): Response {
    if (this.settings.handler) return this.settings.handler(request, result);
    return tooManyRequests(result);
  }
}

function refusedBy(bucket: Bucket, resetTime: number): RateLimitResult {
  return { allowed: false, limit: bucket.limit, remaining: 0, resetTime };
}

/** The standard 429 for a spent REST budget. */
function tooManyRequests(result: RateLimitResult): Response {
  const retryAfter = Math.max(
    0,
    Math.ceil((result.resetTime - Date.now()) / 1000)
  );
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please try again later.",
        retryAfter,
      },
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(result.resetTime),
      },
    }
  );
}

/** The decision with rate limiting off: every request admitted, nothing kept. */
const UNLIMITED: RestLimitDecider = {
  admit: () => Promise.resolve(null),
  async admitPerson(_request, _plugin, person) {
    return { resolved: await person.resolve() };
  },
  personBoundRefusal: () => Promise.resolve(null),
};

/**
 * The REST limit for a configuration: what a per-request gate decides with.
 *
 * @param readers - How the limit tells who is asking. The REST entry point
 *   passes readers that can start services for a key lookup.
 */
export function createRestLimits(
  config: RateLimitConfig,
  readers: RestCallerReaders = defaultRestCallerReaders()
): RestLimitDecider {
  if (!config.enabled) return UNLIMITED;
  const settings = settingsFrom(config);
  consoleLogger.info(
    `[Nextly] Rate limiting enabled: ${settings.perAddress.read} reads / ${settings.perAddress.write} writes per ${settings.windowMs / 1000}s window per address`
  );
  return new RestLimits(
    settings,
    // Let through while the store is away: the general API limit refusing
    // would take the site down with its store (see `core-limit-outage`).
    openWhileStoreIsDown(config.store ?? new InMemoryRateLimitStore()),
    readers
  );
}

/**
 * The store the REST limit counts in, from the sanitized `rateLimit` config:
 * an app's store of the older contract when it configured one, else where
 * the services count core's own limits, read per call.
 *
 * @param startServices - Registers the services, asked only when a shared
 *   store is selected.
 */
export function restLimitCounts(
  config:
    | { store?: RateLimitStore; limitStore?: LimitStoreSelection }
    | undefined,
  startServices: () => Promise<unknown>
): RateLimitStore {
  const own = config?.store;
  if (own !== undefined) {
    return coreCountsOr(guardedAppRateLimitStore(own), {
      consume: own.consume !== undefined,
    });
  }
  const shared =
    config?.limitStore !== undefined && config.limitStore !== "memory";
  return coreCountsOr(new InMemoryRateLimitStore(), {
    consume: true,
    ...(shared ? { startServices } : {}),
  });
}

/**
 * Where core's own limits count, read on every call, or `fallback` while the
 * services are not registered yet.
 *
 * Read per call because the REST limit is built when the route handler is,
 * which can be before the services are: one store chosen then would be this
 * process's memory for good, and on the database store each instance would
 * count a budget of its own.
 *
 * @param options.startServices - Registers the services, for a site whose
 *   limits count in a shared store: a cold worker serving only requests that
 *   never start them would otherwise count in its own memory for good.
 * @param options.consume - Whether the store offers `consume`. An app's store
 *   of the older contract may not, and the REST limit picks its counting path
 *   by whether `consume` exists, so it is offered only where the store has it.
 */
export function coreCountsOr(
  fallback: RateLimitStore,
  options: { startServices?: () => Promise<unknown>; consume: boolean }
): RateLimitStore {
  const registered = (): RateLimitStore | undefined => {
    try {
      if (container.has("coreRateLimitStore")) {
        return container.get<RateLimitStore>("coreRateLimitStore");
      }
    } catch {
      // The container is not initialized yet.
    }
    return undefined;
  };
  const current = async (): Promise<RateLimitStore> => {
    const store = registered();
    if (store !== undefined) return store;
    if (options.startServices === undefined) return fallback;
    try {
      await options.startServices();
    } catch {
      // The REST limit needs the services only to find its store. A route
      // that never starts them must not fail because they could not start:
      // this request counts in this process's memory instead, as the general
      // limit lets requests through while its store is away.
      return fallback;
    }
    return registered() ?? fallback;
  };
  const counts: RateLimitStore = {
    increment: async (key, windowMs) =>
      (await current()).increment(key, windowMs),
    reset: async key => (await current()).reset(key),
  };
  if (!options.consume) return counts;
  return {
    ...counts,
    consume: async (key, limit, windowMs) => {
      const store = await current();
      // Offered only where the store has it; refused rather than emulated
      // otherwise, since a peek emulated by `increment` would record the
      // very request it was asked not to.
      if (!store.consume) {
        throw NextlyError.internal({
          logContext: { reason: "rest-limit-store-without-consume" },
        });
      }
      return store.consume(key, limit, windowMs);
    },
  };
}

/**
 * Create a rate limiter middleware function.
 *
 * @param config - Rate limiting configuration
 * @returns Middleware function that checks rate limits. Its optional second
 *   argument says the request goes to a route with an auth limit of its own,
 *   which keeps it out of the unresolved sources' ceiling.
 *
 * @example
 * ```typescript
 * const rateLimiter = createRateLimiter({
 *   enabled: true,
 *   readLimit: 100,
 *   writeLimit: 30,
 * });
 *
 * // In route handler
 * const rateLimitResponse = await rateLimiter(request);
 * if (rateLimitResponse) {
 *   return rateLimitResponse; // 429 Too Many Requests
 * }
 * // Continue with request handling
 * ```
 */
export function createRateLimiter(config: RateLimitConfig) {
  const limits = createRestLimits(config);
  return (
    request: Request,
    target: RestLimitTarget = "core"
  ): Promise<Response | null> =>
    openRestLimitGate(limits, request).settle(target);
}
