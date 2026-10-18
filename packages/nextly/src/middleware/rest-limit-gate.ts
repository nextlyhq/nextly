/**
 * The REST limit's decision for one request, made once.
 *
 * The decision needs to know where the request is going: a plugin route that
 * asks for a kind of signed-in person is counted by that person, and an auth
 * route is kept out of the shared ceiling. The REST entry point cannot always
 * tell that before routing, so it opens a gate and the first place that can
 * tell settles it, before any work. Every later settle answers nothing, so a
 * request is never counted twice whichever paths it passes through.
 *
 * The gate also remembers the API key the limit looked up, so authentication
 * neither looks the same key up again nor debits its budget a second time.
 *
 * @module middleware/rest-limit-gate
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { ApiKeyService } from "../domains/auth/services/api-key-service";

/** Whether a request's destination has an auth limit of its own. */
export type RestLimitTarget = "core" | "auth";

/** What a key lookup answered: the key, or `null` when it does not resolve. */
export type ResolvedApiKey = Awaited<
  ReturnType<ApiKeyService["authenticateApiKey"]>
>;

/** A key the limit has already looked up for this request. */
export interface KnownApiKey {
  resolved: ResolvedApiKey;
  /** Whether the limit already spent the key's own budget for this request. */
  debited: boolean;
}

/** A plugin person's resolution, as the limit needs to see it. */
export interface PersonResolution<T> {
  /** Resolve the person: called at most once. */
  resolve: () => Promise<T>;
  /** The person the resolution names, or `null` for nobody. */
  personOf: (resolved: T) => { kind: string; id: string } | null;
}

/** The decisions a gate delegates to. */
export interface RestLimitDecider {
  admit(
    request: Request,
    target: RestLimitTarget,
    keys: ApiKeyMemory
  ): Promise<Response | null>;
  admitPerson<T>(
    request: Request,
    plugin: string,
    person: PersonResolution<T>
  ): Promise<{ refused: Response } | { resolved: T }>;
}

/** Where a gate keeps the keys it has looked up. */
export interface ApiKeyMemory {
  remember(rawKey: string, known: KnownApiKey): void;
}

export class RestLimitGate implements ApiKeyMemory {
  private settled = false;
  private readonly keys = new Map<string, KnownApiKey>();

  constructor(
    private readonly decider: RestLimitDecider,
    private readonly request: Request
  ) {}

  /** Whether nothing has decided this request's limit yet. */
  get pending(): boolean {
    return !this.settled;
  }

  /** Decide the limit for a destination; `null` once anything has decided. */
  async settle(target: RestLimitTarget): Promise<Response | null> {
    if (this.settled) return null;
    this.settled = true;
    return this.decider.admit(this.request, target, this);
  }

  /**
   * Decide the limit for a plugin route that asks for a kind of person,
   * around that person's one resolution. Once anything has decided, the
   * person is only resolved.
   */
  async settlePerson<T>(
    plugin: string,
    person: PersonResolution<T>
  ): Promise<{ refused: Response } | { resolved: T }> {
    if (this.settled) return { resolved: await person.resolve() };
    this.settled = true;
    return this.decider.admitPerson(this.request, plugin, person);
  }

  remember(rawKey: string, known: KnownApiKey): void {
    this.keys.set(rawKey, known);
  }

  /** The key the limit looked up for this request, when it was this one. */
  knownKey(rawKey: string): KnownApiKey | undefined {
    return this.keys.get(rawKey);
  }
}

const running = new AsyncLocalStorage<RestLimitGate>();

/**
 * Gates by the request they were opened for, for an app that calls the
 * limiter and then authenticates the same request outside any scope.
 */
const byRequest = new WeakMap<Request, RestLimitGate>();

/** Open the gate for `request`. */
export function openRestLimitGate(
  decider: RestLimitDecider,
  request: Request
): RestLimitGate {
  const gate = new RestLimitGate(decider, request);
  byRequest.set(request, gate);
  return gate;
}

/** Run `operation` with `gate` as the current request's gate. */
export function runWithRestLimitGate<T>(
  gate: RestLimitGate,
  operation: () => T
): T {
  return running.run(gate, operation);
}

/**
 * The gate of the request being served: the one running, or the one opened
 * for `request`.
 */
export function currentRestLimitGate(
  request?: Request
): RestLimitGate | undefined {
  return running.getStore() ?? (request ? byRequest.get(request) : undefined);
}
