/**
 * The one place the Direct API decides which operations may be made as a
 * plugin-defined signed-in person.
 *
 * Only the collection and Single operations decide access through code
 * rules and open the person's frame. Every other operation that takes a
 * caller defaults to running as the server, so a `principal` it quietly
 * ignored would turn "as this visitor" into "as the server": a role created,
 * an API key minted, a user deleted. Asked inside each operation, the check
 * reaches only the operations that remembered to ask, and an operation added
 * later does not. Asked here, at the instance's public surface, every method
 * and every namespace refuses the option unless it is named below.
 *
 * @module direct-api/principal-boundary
 */
import { runWithAccessMemo } from "../auth/access/request-memo";
import { runAsPrincipal } from "../auth/principal-scope";
import { NextlyError } from "../errors/nextly-error";

/** The `Nextly` methods that run as the person a call names. */
const PERSON_OPERATIONS: ReadonlySet<string> = new Set([
  "find",
  "findByID",
  "create",
  "update",
  "delete",
  "count",
  "group",
  "timeseries",
  "bulkDelete",
  "duplicate",
  "findSingle",
  "updateSingle",
  "findSingles",
]);

/** Whether any argument is an options object naming a person. */
function namesPrincipal(args: readonly unknown[]): boolean {
  return args.some(
    arg =>
      arg !== null &&
      typeof arg === "object" &&
      (arg as { principal?: unknown }).principal !== undefined
  );
}

function refusal(operation: string): NextlyError {
  return NextlyError.invalidInput({
    message: `${operation} cannot be made as a signed-in person; only collection and Single operations can.`,
    logContext: { reason: "principal-call-refused", operation },
  });
}

/**
 * `method` refusing any call that names a person. Refused as a rejected
 * promise, as every Direct API failure reaches its caller, and before the
 * method runs at all.
 *
 * A call that names none runs as no person, even from inside a person's
 * operation, as a person-capable method naming none does: a hook's call
 * would otherwise inherit the person, and the services it reaches would
 * judge it as them, through an operation that cannot be made as one.
 *
 * Each call runs with one memo of access lookups, as `runAsCaller` opens for
 * the collection and Single operations, so a namespace call that asks several
 * permissions of one caller looks the caller up once. A call made inside a
 * request shares that request's memo.
 */
function refusingPrincipal(
  method: (...args: unknown[]) => unknown,
  self: unknown,
  operation: string
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) =>
    namesPrincipal(args)
      ? Promise.reject(refusal(operation))
      : runAsPrincipal(null, () =>
          runWithAccessMemo(() => method.apply(self, args))
        );
}

/**
 * Members the boundary leaves as they are. `plugins` hands out the services
 * plugins contribute: their own code, whose arguments mean whatever the plugin
 * says. A service taking `{ principal }` is passing a person to its own
 * logic, not asking core to run as one, so it is not refused. `defaultConfig`
 * is the instance's settings, not a namespace: its values, a `context`
 * helper or a person held in it among them, reach operations as they are.
 */
const UNGUARDED: ReadonlySet<string> = new Set(["plugins", "defaultConfig"]);

/** Whether `value` is a namespace: a plain object the instance hands out. */
function isNamespace(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * A namespace whose every method refuses a call naming a person, and every
 * namespace nested in it the same, however deep: `media.folders` is a
 * namespace of its own, and one left unwrapped is a way round the boundary.
 * Each guarded object is kept, so a namespace read twice is one proxy.
 */
function guardNamespace(
  namespace: Record<string, unknown>,
  name: string,
  guarded: WeakMap<object, Record<string, unknown>>
): Record<string, unknown> {
  const known = guarded.get(namespace);
  if (known !== undefined) return known;
  const proxy = new Proxy(namespace, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      const path = `${name}.${String(prop)}`;
      if (typeof value === "function") {
        return refusingPrincipal(
          value as (...args: unknown[]) => unknown,
          target,
          path
        );
      }
      return isNamespace(value) ? guardNamespace(value, path, guarded) : value;
    },
  });
  guarded.set(namespace, proxy);
  return proxy;
}

/**
 * The instance as its callers reach it: the collection and Single methods
 * as they are, and every other method and namespace refusing `principal`.
 *
 * Methods run with the guarded instance as `this`, so one method calling
 * another is held to the same boundary. A namespace is a plain object the
 * constructor assigns to the instance itself; the services the instance
 * exposes are read through getters on its class, and pass through untouched
 * whatever their shape, so a person's operation keeps its frame through the
 * service it runs on.
 */
export function guardPrincipalOperations<T extends object>(instance: T): T {
  const namespaces = new WeakMap<object, Record<string, unknown>>();
  const guarded: T = new Proxy(instance, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      const name = String(prop);
      if (UNGUARDED.has(name)) return value;
      if (typeof value === "function") {
        return PERSON_OPERATIONS.has(name)
          ? value
          : refusingPrincipal(
              value as (...args: unknown[]) => unknown,
              guarded,
              name
            );
      }
      if (isNamespace(value) && Object.hasOwn(target, prop)) {
        return guardNamespace(value, name, namespaces);
      }
      return value;
    },
  });
  return guarded;
}
