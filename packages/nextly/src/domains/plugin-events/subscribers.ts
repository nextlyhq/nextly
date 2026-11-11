/**
 * The durable subscribers registered in this process.
 *
 * Each is named within its plugin (`<plugin>:<name>`), and the name is what a
 * delivery is owed to: it is stored with the delivery, so after a restart the
 * delivery reaches the subscriber of that name, whatever was added or
 * reordered meanwhile, and a delivery whose name no one registers any more is
 * held for an operator rather than given to someone else. A name is unique
 * within its plugin, whichever event it subscribes to.
 *
 * A plugin torn down to be registered again (a reload) is retired rather
 * than forgotten: until it registers again, or for a grace at most, its
 * subscribers are still owed every event dispatched, their deliveries held
 * until a handler is back. Otherwise an event dispatched in that gap would
 * be fanned out without them, and finished for good if no one else
 * subscribes.
 *
 * @module domains/plugin-events/subscribers
 * @experimental
 */
import { NextlyError } from "../../errors/nextly-error";

/** @experimental What a durable subscriber receives. */
export interface DurableEvent {
  /** The event's id: the key a handler de-duplicates on, as it may run again. */
  readonly id: string;
  readonly name: string;
  readonly payload: Record<string, unknown>;
  /** Which try this is, from 1. */
  readonly attempt: number;
}

/** @experimental A durable subscriber's handler: a throw is a failed try. */
export type DurableHandler = (event: DurableEvent) => unknown;

/**
 * One subscriber an event is owed to, as fan-out reads it. Its handler is
 * read through `handlerOf`, which a retired subscriber has none of.
 */
export interface DurableSubscriber {
  /** `<plugin>:<name>`: what its deliveries are owed to. */
  readonly key: string;
}

/** The durable subscribers of one process. */
export interface DurableSubscribers {
  /** Register `handler` for `event` as `owner`'s subscriber `name`. */
  register(
    owner: string,
    event: string,
    name: string,
    handler: DurableHandler
  ): void;
  /**
   * Who `event` is owed to, in the order they were registered: every
   * running subscriber, and every retired one within its grace.
   */
  forEvent(event: string): readonly DurableSubscriber[];
  /** The handler registered under `key`, if any is. */
  handlerOf(key: string): DurableHandler | undefined;
  /**
   * Retire every subscriber of `owner`, as when the plugin is torn down to be
   * registered again: none runs, each is still owed what is dispatched for
   * {@link DURABLE_SUBSCRIBER_GRACE_MS}, and registering its name again
   * replaces it.
   */
  retireOwner(owner: string): void;
  /** Forget every subscriber of `owner` at once, retired ones included. */
  removeOwner(owner: string): void;
}

/**
 * How long a retired subscriber is still owed the events dispatched: far
 * longer than a reload takes to register it again. One that never does is
 * owed its deliveries made meanwhile, held for an operator as any whose
 * subscriber is gone, and no new ones after.
 */
export const DURABLE_SUBSCRIBER_GRACE_MS = 15 * 60 * 1000;

/** A subscriber's name: short, lower-case, and free of the key's separator. */
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

interface Entry extends DurableSubscriber {
  readonly handler: DurableHandler;
  readonly owner: string;
  readonly event: string;
  /** When it was retired, on the registry's clock; absent while it runs. */
  readonly retiredAt?: number;
}

/** A fresh, empty set of durable subscribers. */
export function createDurableSubscribers(
  options: { now?: () => number } = {}
): DurableSubscribers {
  const now = options.now ?? Date.now;
  const byKey = new Map<string, Entry>();
  // Still owed what is dispatched: running, or retired within the grace.
  const owed = (entry: Entry, at: number): boolean =>
    entry.retiredAt === undefined ||
    at - entry.retiredAt < DURABLE_SUBSCRIBER_GRACE_MS;
  return {
    register(owner, event, name, handler) {
      if (!NAME.test(name)) {
        throw NextlyError.invalidInput({
          message: `A durable subscriber's name must be 1 to 64 lower-case letters, digits, dots, dashes or underscores, starting with a letter or digit; "${name}" is not.`,
          logContext: { owner, event },
        });
      }
      const key = `${owner}:${name}`;
      const existing = byKey.get(key);
      // A retired subscriber of the name is replaced: the plugin is back.
      if (existing !== undefined && existing.retiredAt === undefined) {
        throw NextlyError.invalidInput({
          message: `The plugin "${owner}" already has a durable subscriber named "${name}". Each needs a name of its own: it is what a delivery waiting for it is owed to.`,
          logContext: { owner, event, name },
        });
      }
      byKey.set(key, { key, owner, event, handler });
    },
    forEvent(event) {
      const at = now();
      return [...byKey.values()]
        .filter(entry => entry.event === event && owed(entry, at))
        .map(({ key }) => ({ key }));
    },
    handlerOf(key) {
      const entry = byKey.get(key);
      return entry?.retiredAt === undefined ? entry?.handler : undefined;
    },
    retireOwner(owner) {
      const at = now();
      for (const [key, entry] of byKey) {
        if (!owed(entry, at)) byKey.delete(key);
        else if (entry.owner === owner && entry.retiredAt === undefined) {
          byKey.set(key, { ...entry, retiredAt: at });
        }
      }
    },
    removeOwner(owner) {
      for (const [key, entry] of byKey) {
        if (entry.owner === owner) byKey.delete(key);
      }
    },
  };
}

// On globalThis, as the event bus is, so a module evaluated twice by the
// bundler still shares one set: subscribers registered at a plugin's init are
// the ones the dispatch job reads.
const globalForSubscribers = globalThis as unknown as {
  __nextly_durableSubscribers?: DurableSubscribers;
};

/** The durable subscribers of this process, which plugins register into. */
export function getDurableSubscribers(): DurableSubscribers {
  globalForSubscribers.__nextly_durableSubscribers ??=
    createDurableSubscribers();
  return globalForSubscribers.__nextly_durableSubscribers;
}
