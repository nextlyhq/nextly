/**
 * Whether the code running now is a page builder named query's `run`.
 *
 * A named query is developer code a published page runs to read its rows.
 * It is handed one reader, which reads as an anonymous visitor, only what
 * the query declares, each read counted against the page's allowance and
 * tagging the page's cache. Every guarantee the page builder makes about a
 * named query rests on that reader being the ONLY way it reads. But `run` is
 * ordinary server code: a closure that imports the Direct API could read a
 * collection it never declared, uncounted and untagged, or read with the
 * server's access, and its rows would reach a published page.
 *
 * So the renderer runs `run` inside a frame ({@link openNamedQueryFrame}),
 * and the Direct API refuses EVERY call made inside it. The reader's own
 * reads go through the frame's `read` door, which leaves the frame for the
 * length of that read: the door belongs to the frame that opened it, so code
 * inside `run` cannot open one of its own and walk through it.
 *
 * Fails closed: a call made inside the frame by any other route than the
 * door is refused, whatever access it names.
 *
 * `AsyncLocalStorage`, for the reason every caller scope here uses it: pages
 * render concurrently. The cost is one store lookup per Direct API call.
 *
 * @module auth/named-query-scope
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { NextlyError } from "../errors/nextly-error";

/** One open frame: the query it runs, as the log names it. */
interface FrameToken {
  readonly name: string;
}

const namedQueryFrame = new AsyncLocalStorage<FrameToken>();

/**
 * One named query's frame: `run` executes the query inside it, and `read` is
 * the one door through which the query's own reader reads.
 *
 * @experimental
 */
export interface NamedQueryFrame {
  /** Run `operation` inside the frame. Refused inside another frame. */
  run<T>(operation: () => T): T;
  /**
   * Run `operation` outside the frame, for the reader handed to the query.
   * Refused unless called from inside THIS frame, so a frame code opens
   * for itself is no way out of the one it runs in.
   */
  read<T>(operation: () => T): T;
}

/** The refusal for a call made where a named query may not make one. */
function refusal(query: string, operation: string): NextlyError {
  // The log names the query and the call; a named query reads only through
  // the reader it is given.
  return NextlyError.forbidden({
    logContext: { reason: "named-query-trusted-read", query, operation },
  });
}

/**
 * Open the frame a named query `name` runs in.
 *
 * @experimental
 */
export function openNamedQueryFrame(name: string): NamedQueryFrame {
  const token: FrameToken = { name };
  return Object.freeze({
    run<T>(operation: () => T): T {
      const outer = namedQueryFrame.getStore();
      if (outer !== undefined) {
        throw refusal(outer.name, "a named query frame of its own");
      }
      return namedQueryFrame.run(token, operation);
    },
    read<T>(operation: () => T): T {
      const current = namedQueryFrame.getStore();
      if (current !== token) {
        throw refusal(current?.name ?? name, "a frame's reader door");
      }
      return namedQueryFrame.exit(operation);
    },
  });
}

/**
 * The refusal for a Direct API call made inside a named query's frame, or
 * nothing outside one. `operation` names the call in the log.
 */
export function refusedInsideNamedQuery(
  operation: string
): NextlyError | undefined {
  const frame = namedQueryFrame.getStore();
  return frame === undefined ? undefined : refusal(frame.name, operation);
}

/** Whether a value is plain data: a plain record or an array. */
function isPlainData(value: object): boolean {
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * What a guarded service method returned, guarded in its turn: a function
 * or an object other than plain data (a client, a repository, a closure) is
 * a handle that can read data, so it refuses inside a named query's frame as
 * the service does, whether it is used at once or kept and used later. A
 * promise is guarded once it settles. Plain data is read as it is, and a
 * handle held inside it, at any depth, comes back guarded when it is read.
 */
function guardedResult(value: unknown, path: string): unknown {
  if (typeof value === "function") return refusingInsideNamedQuery(value, path);
  if (typeof value !== "object" || value === null) return value;
  if (value instanceof Promise) {
    return value.then(settled => guardedResult(settled, path));
  }
  return isPlainData(value)
    ? plainDataGuarded(value, path)
    : refusingInsideNamedQuery(value, path);
}

/** Each plain record or array already traversed, so one read twice is one proxy. */
const traversedPlain = new WeakMap<object, object>();

/**
 * Plain data, read as it is, each of its own properties that is a handle
 * coming back guarded (`guardedResult`), lazily, when it is read: a record
 * holding `{ repository: new Repository() }` hands out the repository
 * guarded. Inherited members, such as an array's `map`, are read as they
 * are, so plain data stays usable inside the frame.
 */
function plainDataGuarded(value: object, path: string): object {
  const known = traversedPlain.get(value);
  if (known !== undefined) return known;
  const proxy = new Proxy(value, {
    get(target, prop, receiver) {
      if (!Object.hasOwn(target, prop)) {
        return Reflect.get(target, prop, receiver) as unknown;
      }
      return guardedResult(
        Reflect.get(target, prop, target),
        `${path}.${String(prop)}`
      );
    },
  });
  traversedPlain.set(value, proxy);
  return proxy;
}

/** Each object already guarded, so one reached twice is one proxy. */
const guardedObjects = new WeakMap<object, object>();

/**
 * `value` with every function reached through it refusing to run inside a
 * named query's frame: for a namespace the Direct API hands out whose
 * methods do not pass through its own guarded entry points, such as the
 * services plugins contribute. A method taken from it outside the frame and
 * called inside one is refused all the same, since the check is made when it
 * is called. Values other than functions and objects pass as they are.
 */
export function refusingInsideNamedQuery<T>(value: T, path: string): T {
  if (typeof value === "function") {
    const method = value as (...args: unknown[]) => unknown;
    return ((...args: unknown[]) => {
      const refused = refusedInsideNamedQuery(path);
      if (refused !== undefined) throw refused;
      return guardedResult(method(...args), `${path}()`);
    }) as T;
  }
  if (typeof value !== "object" || value === null) return value;
  const known = guardedObjects.get(value);
  if (known !== undefined) return known as T;
  const proxy = new Proxy(value, {
    get(target, prop) {
      // Refused before the property is read, since reading one runs its
      // getter, which can read data as a method can.
      const at = `${path}.${String(prop)}`;
      const refusedHere = refusedInsideNamedQuery(at);
      if (refusedHere !== undefined) throw refusedHere;
      // Read with the target as the receiver, so a getter reading a private
      // field reads it from the object that holds it.
      const member = Reflect.get(target, prop, target) as unknown;
      if (typeof member === "function") {
        const method = member as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => {
          const refused = refusedInsideNamedQuery(at);
          if (refused !== undefined) throw refused;
          return guardedResult(Reflect.apply(method, target, args), `${at}()`);
        };
      }
      return refusingInsideNamedQuery(member, at);
    },
    // A property's descriptor hands out its getter itself, to be called
    // with any receiver: refused inside the frame for the same reason.
    getOwnPropertyDescriptor(target, prop) {
      const refused = refusedInsideNamedQuery(`${path}.${String(prop)}`);
      if (refused !== undefined) throw refused;
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  });
  guardedObjects.set(value, proxy);
  return proxy;
}
