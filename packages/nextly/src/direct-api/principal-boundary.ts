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
 */
function refusingPrincipal(
  method: (...args: unknown[]) => unknown,
  self: unknown,
  operation: string
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) =>
    namesPrincipal(args)
      ? Promise.reject(refusal(operation))
      : method.apply(self, args);
}

/** Whether `value` is a namespace: a plain object the instance hands out. */
function isNamespace(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** A namespace whose every method refuses a call naming a person. */
function guardNamespace(
  namespace: Record<string, unknown>,
  name: string
): Record<string, unknown> {
  return new Proxy(namespace, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function"
        ? refusingPrincipal(
            value as (...args: unknown[]) => unknown,
            target,
            `${name}.${String(prop)}`
          )
        : value;
    },
  });
}

/**
 * The instance as its callers reach it: the collection and Single methods
 * as they are, and every other method and namespace refusing `principal`.
 *
 * Methods run with the guarded instance as `this`, so one method calling
 * another is held to the same boundary. Services the instance exposes are
 * class instances, not namespaces, and pass through untouched.
 */
export function guardPrincipalOperations<T extends object>(instance: T): T {
  const namespaces = new WeakMap<object, Record<string, unknown>>();
  const guarded: T = new Proxy(instance, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      const name = String(prop);
      if (typeof value === "function") {
        return PERSON_OPERATIONS.has(name)
          ? value
          : refusingPrincipal(
              value as (...args: unknown[]) => unknown,
              guarded,
              name
            );
      }
      if (isNamespace(value)) {
        let wrapped = namespaces.get(value);
        if (wrapped === undefined) {
          wrapped = guardNamespace(value, name);
          namespaces.set(value, wrapped);
        }
        return wrapped;
      }
      return value;
    },
  });
  return guarded;
}
