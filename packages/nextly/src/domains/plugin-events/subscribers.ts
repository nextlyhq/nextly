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

/** One subscriber, as the dispatcher reads it. */
export interface DurableSubscriber {
  /** `<plugin>:<name>`: what its deliveries are owed to. */
  readonly key: string;
  readonly handler: DurableHandler;
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
  /** The subscribers of `event`, in the order they were registered. */
  forEvent(event: string): readonly DurableSubscriber[];
  /** The handler registered under `key`, if any is. */
  handlerOf(key: string): DurableHandler | undefined;
  /** Forget every subscriber of `owner`, as when the plugin is torn down. */
  removeOwner(owner: string): void;
}

/** A subscriber's name: short, lower-case, and free of the key's separator. */
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

interface Entry extends DurableSubscriber {
  readonly owner: string;
  readonly event: string;
}

/** A fresh, empty set of durable subscribers. */
export function createDurableSubscribers(): DurableSubscribers {
  const byKey = new Map<string, Entry>();
  return {
    register(owner, event, name, handler) {
      if (!NAME.test(name)) {
        throw NextlyError.invalidInput({
          message: `A durable subscriber's name must be 1 to 64 lower-case letters, digits, dots, dashes or underscores, starting with a letter or digit; "${name}" is not.`,
          logContext: { owner, event },
        });
      }
      const key = `${owner}:${name}`;
      if (byKey.has(key)) {
        throw NextlyError.invalidInput({
          message: `The plugin "${owner}" already has a durable subscriber named "${name}". Each needs a name of its own: it is what a delivery waiting for it is owed to.`,
          logContext: { owner, event, name },
        });
      }
      byKey.set(key, { key, owner, event, handler });
    },
    forEvent(event) {
      return [...byKey.values()].filter(entry => entry.event === event);
    },
    handlerOf(key) {
      return byKey.get(key)?.handler;
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
