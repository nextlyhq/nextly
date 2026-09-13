/**
 * Folding every language's pending change into one write.
 *
 * A pending change stores the whole document as it looked when its author saved
 * it, not only the fields they touched, so a shared value inside one is either
 * an edit or a stale copy of what was live, and the two look identical. Applied
 * one after another, a later save would put back a shared value another
 * language's author had changed. A shared value is therefore taken from a
 * pending change only where it differs from the live row, oldest save first, so
 * a later save wins only when two languages changed the same value. Each
 * language's translations come from its own pending change.
 *
 * Every value compared here is schema-shaped, the way a pending change is
 * restored, so a key present on either side is a field the schema declares.
 *
 * @module domains/collections/services/pending-change-merge
 */

import { isDeepStrictEqual } from "node:util";

/** One language's pending change, ready to apply. */
export interface PendingLanguageChange {
  locale: string;
  snapshot: unknown;
  updatedAt: Date;
}

/**
 * How one component field's instances hold translations.
 *
 * Asked per instance, because a dynamic zone mixes component types and each
 * type declares its own translatable fields.
 */
export interface ComponentValueShape {
  translatableKeys(instance: Record<string, unknown>): ReadonlySet<string>;
  nested(
    instance: Record<string, unknown>,
    key: string
  ): ComponentValueShape | undefined;
}

/** What building one language's write needs. */
export interface LanguageTargetInput {
  /** The pending change. */
  pending: Record<string, unknown>;
  /** The document as it was live before this write began. */
  live: Record<string, unknown>;
  /** The document as it stands now inside this write. */
  current: Record<string, unknown>;
  /** The document's own translatable fields. */
  localizedFieldNames: ReadonlySet<string>;
  /** Component fields by name. */
  componentFields: ReadonlyMap<string, ComponentValueShape>;
}

/**
 * The pending changes a whole-document write applies, oldest save first.
 *
 * Only languages the app still configures: a change held for a removed language
 * cannot be read or written through the API, so it stays where it is rather
 * than being published or deleted as a side effect. Ties break on the language
 * code, so the order never depends on what the database happens to return.
 */
export function pendingChangesToApply(
  drafts: ReadonlyArray<{
    locale: string | null;
    snapshot: unknown;
    updatedAt: Date | string;
  }>,
  configuredLocales: ReadonlySet<string>
): PendingLanguageChange[] {
  const out: PendingLanguageChange[] = [];
  for (const draft of drafts) {
    if (draft.locale === null || !configuredLocales.has(draft.locale)) continue;
    out.push({
      locale: draft.locale,
      snapshot: draft.snapshot,
      updatedAt: new Date(draft.updatedAt),
    });
  }
  return out.sort(
    (a, b) =>
      a.updatedAt.getTime() - b.updatedAt.getTime() ||
      a.locale.localeCompare(b.locale)
  );
}

/**
 * Whether two values hold the same content.
 *
 * An instant compares by the moment it names: a pending change is JSON, so it
 * carries the ISO string, while the row comes back from the driver as a `Date`.
 */
export function sameContent(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(comparable(a), comparable(b));
}

/** The keys of `target` whose value differs from `current`. */
export function changedKeys(
  target: Record<string, unknown>,
  current: Record<string, unknown>
): Set<string> {
  const out = new Set<string>();
  for (const key of Object.keys(target)) {
    if (!sameContent(target[key], current[key])) out.add(key);
  }
  return out;
}

/** A component value with every translatable key removed, at every depth. */
export function withoutTranslations(
  value: unknown,
  shape: ComponentValueShape
): unknown {
  if (Array.isArray(value)) {
    return value.map(instance => withoutTranslations(instance, shape));
  }
  if (!isPlainRecord(value)) return value;
  const translatable = shape.translatableKeys(value);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (translatable.has(key)) continue;
    const nested = shape.nested(value, key);
    assign(out, key, nested ? withoutTranslations(child, nested) : child);
  }
  return out;
}

/**
 * The current component value carrying one language's translations from its
 * pending change, matched instance by instance on `id`.
 *
 * Structure stays as it currently stands: which instances exist, their order,
 * and their shared values. An instance the pending change does not hold keeps
 * the translations it has.
 */
export function withTranslationsFrom(args: {
  current: unknown;
  pending: unknown;
  shape: ComponentValueShape;
}): unknown {
  const sources = instancesById(args.pending);
  const overlay = (instance: unknown): unknown => {
    if (!isPlainRecord(instance) || typeof instance.id !== "string") {
      return instance;
    }
    const source = sources.get(instance.id);
    return source ? overlayInstance(instance, source, args.shape) : instance;
  };
  return Array.isArray(args.current)
    ? args.current.map(overlay)
    : overlay(args.current);
}

/** The document one language's promotion writes. */
export function languageTarget(
  input: LanguageTargetInput
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = new Set([
    ...Object.keys(input.current),
    ...Object.keys(input.pending),
  ]);
  for (const key of keys) {
    assign(out, key, valueForKey(input, key));
  }
  return out;
}

function valueForKey(input: LanguageTargetInput, key: string): unknown {
  const { pending, live, current } = input;
  // A field the pending change does not hold, one the schema gained after it
  // was saved, is a field it says nothing about.
  if (!hasOwn(pending, key)) return current[key];
  if (input.localizedFieldNames.has(key)) return pending[key];
  const shape = input.componentFields.get(key);
  if (shape)
    return componentValue(pending[key], live[key], current[key], shape);
  return sameContent(pending[key], live[key]) ? current[key] : pending[key];
}

/**
 * A component field's value: this change's own instances when it changed their
 * structure or shared values, otherwise the current instances carrying this
 * language's translations.
 */
function componentValue(
  pending: unknown,
  live: unknown,
  current: unknown,
  shape: ComponentValueShape
): unknown {
  const structureChanged = !sameContent(
    withoutTranslations(pending, shape),
    withoutTranslations(live, shape)
  );
  return structureChanged
    ? pending
    : withTranslationsFrom({ current, pending, shape });
}

function overlayInstance(
  instance: Record<string, unknown>,
  source: Record<string, unknown>,
  shape: ComponentValueShape
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const translatable = shape.translatableKeys(instance);
  for (const [key, child] of Object.entries(instance)) {
    const nested = shape.nested(instance, key);
    if (!hasOwn(source, key)) {
      assign(out, key, child);
    } else if (translatable.has(key)) {
      assign(out, key, source[key]);
    } else if (nested) {
      assign(
        out,
        key,
        withTranslationsFrom({
          current: child,
          pending: source[key],
          shape: nested,
        })
      );
    } else {
      assign(out, key, child);
    }
  }
  return out;
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(comparable);
  if (!isPlainRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    assign(out, key, comparable(child));
  }
  return out;
}

function instancesById(value: unknown): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  const add = (instance: unknown): void => {
    if (isPlainRecord(instance) && typeof instance.id === "string") {
      out.set(instance.id, instance);
    }
  };
  if (Array.isArray(value)) value.forEach(add);
  else add(value);
  return out;
}

/**
 * A plain record, as opposed to a value the store round-trips whole: a `Date`
 * is an object with no own keys, and walking it as a container rebuilds it as
 * an empty object.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Assign a key that may be `__proto__` without invoking the prototype setter. */
function assign(
  out: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  Object.defineProperty(out, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
