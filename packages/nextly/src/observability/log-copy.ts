/**
 * The one walk over a log value that both log maskers share.
 *
 * Email masking and credential redaction each need a copy of a log value with
 * something taken out of every string, field name and error at any depth.
 * Walking it twice, by two hands, is how one of them came to pass errors
 * through untouched while the other copied them with care. So the walk lives
 * here once, and each masker supplies only its rules.
 *
 * @module observability/log-copy
 */

/** What a masker changes as the walk copies a value. */
export interface LogCopyRules {
  /**
   * Rewrites every string the walk meets: values, field names, and an error's
   * name, message and stack.
   */
  text: (text: string) => string;
  /**
   * Whether a field's value is replaced by `hidden` on its name alone, without
   * being walked.
   */
  hideField?: (key: string, value: unknown) => boolean;
  /** What a field `hideField` picks is replaced with. */
  hidden?: unknown;
  /**
   * A replacement for an object of a class the walk doesn't copy, or
   * `undefined` to keep it as it is.
   */
  other?: (value: object) => unknown;
}

/**
 * A copy of a value with `rules` applied: strings, the fields of plain
 * objects, list members, and an error's message, stack, cause and own fields,
 * at any depth. The value given is never changed. An object of any other class
 * goes to `rules.other`, and is kept as it is when that has nothing to say,
 * since copying it could lose what makes it that class.
 */
export function copyForLog<T>(value: T, rules: LogCopyRules): T {
  return walk(value, rules, new WeakMap()) as T;
}

function walk(
  value: unknown,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): unknown {
  if (typeof value === "string") return rules.text(value);
  if (value === null || typeof value !== "object") return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (value instanceof Error) return copyError(value, rules, seen);
  if (Array.isArray(value)) return copyList(value, rules, seen);
  if (isPlainObject(value)) return copyRecord(value, rules, seen);
  return rules.other?.(value) ?? value;
}

/** Whether a value is plain data: an object literal or a null-prototype one. */
function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A list copied with each member walked. */
function copyList(
  value: readonly unknown[],
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): unknown[] {
  const list: unknown[] = [];
  // Recorded before the members, so a list that contains itself ends.
  seen.set(value, list);
  for (let i = 0; i < value.length; i++) list[i] = walk(value[i], rules, seen);
  return list;
}

/** A plain object copied field by field. */
function copyRecord(
  value: Record<string, unknown>,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  // Recorded before the fields, so an object that contains itself ends.
  seen.set(value, copy);
  for (const [key, field] of Object.entries(value)) {
    copyField(copy, key, field, rules, seen, true);
  }
  return copy;
}

/**
 * One field copied onto `target`: its name rewritten too, since a payload can
 * be keyed by what it is about (a recipient's address, a token), and its value
 * hidden or walked.
 */
function copyField(
  target: object,
  key: string,
  field: unknown,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>,
  enumerable: boolean
): void {
  const hide = rules.hideField?.(key, field) === true;
  defineOwn(
    target,
    freeKey(target, rules.text(key)),
    hide ? rules.hidden : walk(field, rules, seen),
    enumerable
  );
}

/**
 * `key`, or `key (2)`, `key (3)` and so on when it is taken: two names that
 * rewrite alike stay two fields rather than one overwriting the other.
 */
function freeKey(copy: object, key: string): string {
  if (!Object.hasOwn(copy, key)) return key;
  let n = 2;
  while (Object.hasOwn(copy, `${key} (${n})`)) n++;
  return `${key} (${n})`;
}

/**
 * An error copied with its name, message, stack, cause and own fields
 * rewritten, still an instance of the error's own class so `instanceof` and
 * `name` survive.
 *
 * The copy is made inside a log call, often inside a `catch` that exists to
 * absorb a failure, so it never throws: an error whose fields cannot be read
 * or copied is logged as a plain `Error` carrying its rewritten message.
 */
function copyError(
  error: Error,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): Error {
  try {
    return copyErrorFields(error, rules, seen);
  } catch {
    const plain = new Error(
      rules.text(readText(() => error.message, "(unreadable error)"))
    );
    seen.set(error, plain);
    return plain;
  }
}

function copyErrorFields(
  error: Error,
  rules: LogCopyRules,
  seen: WeakMap<object, unknown>
): Error {
  const name = rules.text(error.name);
  const copy = blankCopyOf(error, rules.text(error.message), name);
  seen.set(error, copy);
  // Set as own data properties rather than assigned: an error class may
  // declare any of them as an accessor with no setter on its prototype, and
  // assigning through one throws.
  if (copy.name !== name) defineOwn(copy, "name", name, false);
  if (error.stack !== undefined) {
    defineOwn(copy, "stack", rules.text(error.stack), false);
  }
  if (error.cause !== undefined) {
    defineOwn(copy, "cause", walk(error.cause, rules, seen), false);
  }
  if (error instanceof AggregateError) {
    // The constructor makes `errors` an own property that is not enumerable,
    // so the loop below would leave the copy without its failures.
    defineOwn(copy, "errors", walk(error.errors, rules, seen), false);
  }
  for (const [key, field] of Object.entries(error)) {
    copyField(copy, key, field, rules, seen, true);
  }
  return copy;
}

/**
 * An empty error of the same class as `error`, holding `message`. A
 * `DOMException` (an aborted `fetch`, say) is built by its own constructor:
 * its `name`, `message` and `code` read slots only that constructor creates,
 * so a plain `Error` given its prototype throws on the first of them it
 * touches.
 */
function blankCopyOf(error: Error, message: string, name: string): Error {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return new DOMException(message, name);
  }
  const copy = new Error(message);
  Object.setPrototypeOf(copy, Object.getPrototypeOf(error) as object);
  return copy;
}

/** A value read as text, or `fallback` when reading it throws. */
function readText(read: () => unknown, fallback: string): string {
  try {
    return String(read());
  } catch {
    return fallback;
  }
}

/**
 * Set `key` on `target` as a writable own data property. Defined rather than
 * assigned, so a `__proto__` key becomes a field and not the prototype.
 */
function defineOwn(
  target: object,
  key: string,
  value: unknown,
  enumerable: boolean
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    configurable: true,
    enumerable,
  });
}
