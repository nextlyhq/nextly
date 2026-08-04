import { isValidElement, type ReactNode } from "react";

/**
 * How many values one block's output is walked before it is refused.
 *
 * A block that returns more structure than this has produced something no page
 * needs, and the budget also bounds an iterable that never ends.
 */
const MAX_CHECKED_VALUES = 10_000;

/** The only React-tagged object that is a NODE rather than a component type. */
const PORTAL_TYPE = Symbol.for("react.portal");

/** A block's output, checked and in a form React can render. */
export type NormalizedOutput =
  | {
      ok: true;
      node: ReactNode;
      /**
       * True when a promise was left in place rather than substituted — which
       * happens only inside borrowed JSX children, where nothing can be
       * replaced. React suspends on such a child, so the caller still has to
       * provide a boundary above it.
       */
      hasUnwrappedThenable: boolean;
    }
  | { ok: false; reason: string };

export interface NormalizeOptions {
  /**
   * Substitutes a promise this renderer OWNS with something that awaits it
   * under containment.
   *
   * Without this, a promise in a returned list reaches React as-is and a
   * rejection surfaces inside React's render — after the block boundary has
   * returned, so no placeholder happens and the page goes down for one bad
   * child. The substitution is the caller's to make because what to substitute
   * is a React component question, and this module renders nothing itself.
   */
  wrapOwnedThenable?: (
    pending: PromiseLike<unknown>,
    index: number
  ) => ReactNode;
}

/**
 * Whether a value is awaitable.
 *
 * Duck-typed rather than an `instanceof Promise` check, because the thing a
 * block returns is whatever its own runtime produced: an async function in a
 * different realm, a bundler's promise polyfill and a library's thenable are
 * all awaitable and none of them is `Promise` from this module's perspective.
 *
 * Total, because reading `then` can itself throw — it is an ordinary property
 * access and a getter may do anything. A value whose `then` cannot be read is
 * not usable as a promise by anyone, so answering `false` sends it down the
 * path that refuses it rather than raising out of a predicate.
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (typeof value !== "object" || value === null) return false;
  try {
    return typeof (value as PromiseLike<unknown>).then === "function";
  } catch {
    return false;
  }
}

/**
 * A description of a thrown value, which is not necessarily an `Error`.
 *
 * Total: `String(value)` throws for a null-prototype object and for anything
 * with a throwing `toString`, and this runs inside catch blocks that exist to
 * keep a failure contained. Throwing here would defeat the containment it is
 * part of.
 */
export function describeThrown(error: unknown): string {
  try {
    if (error instanceof Error && typeof error.message === "string") {
      return error.message;
    }
    return String(error);
  } catch {
    return "a value that could not be described";
  }
}

/** A short description of a value, for a placeholder's detail line. */
export function describeValue(value: unknown): string {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "object") {
    try {
      const name = (value as object).constructor?.name;
      return name && name !== "Object"
        ? `a ${name} instance`
        : "a plain object";
    } catch {
      return "an object that could not be described";
    }
  }
  return `a ${type}`;
}

/**
 * A portal: the one React-tagged object that is a child rather than a type.
 *
 * Checked by exact tag rather than by "any `react.*` symbol". The looser rule
 * looks equivalent and is not — `React.memo(C)` and `React.lazy(f)` carry
 * `react.*` tags too, and both are component TYPES whose `isValidElement` is
 * false. Rendering one as a child throws inside React, so the broad rule would
 * have opened the very hole this module exists to shut.
 */
function isPortal(value: object): boolean {
  return (value as { $$typeof?: unknown }).$$typeof === PORTAL_TYPE;
}

/** An element's children, without assuming `props` is shaped any particular way. */
function childrenOf(element: unknown): unknown {
  const props = (element as { props?: unknown }).props;
  if (typeof props !== "object" || props === null) return undefined;
  return (props as { children?: unknown }).children;
}

function isIterable(value: object): value is Iterable<unknown> {
  return typeof (value as Iterable<unknown>)[Symbol.iterator] === "function";
}

/**
 * Whether reading an iterable would use it up.
 *
 * A generator is its own iterator, so iterating it once leaves nothing behind;
 * a `Set` hands out a fresh iterator each time and can be read repeatedly. That
 * decides whether a borrowed value may be inspected at all, and asking for the
 * iterator to find out is itself free — it is exactly what returns `this` for a
 * generator and a new object for a collection.
 */
function isSingleUse(value: Iterable<unknown>): boolean {
  try {
    return (value[Symbol.iterator]() as unknown) === (value as unknown);
  } catch {
    // An iterator that cannot even be requested is not one to read.
    return true;
  }
}

/**
 * Checks a block's output and returns it in the form React should receive.
 *
 * The engine types a block's output as `unknown` and leaves narrowing to this
 * package, so this is where the contract is enforced rather than assumed. It
 * matters because of where the failure would otherwise land: a value React
 * cannot render throws inside React's own render, after this package's error
 * handling has finished, so it escapes containment and takes the page with it.
 *
 * Two modes, and the difference between them is ownership:
 *
 * - The returned value is OURS. Iterables are materialised and promises are
 *   substituted for something that awaits them under containment.
 * - An element's children are NOT ours. They are inspected but never rebuilt,
 *   and a single-use iterable among them is left alone entirely, because
 *   reading a generator to check it would leave React nothing to render.
 *   Re-readable collections like `Set` ARE walked, since reading one costs
 *   nothing.
 *
 * **The limits of the guarantee**, both properties of borrowed children rather
 * than gaps that can be closed here: a promise inside existing JSX cannot be
 * substituted, so its rejection still reaches the route's error handling; and
 * children produced by a component exist only once React renders it, so
 * `<Thing />` returning a bad value is not visible from here.
 *
 * Total: it never throws. A hostile iterable, a throwing getter and an
 * undescribable value all become refusals, because the alternative is an
 * exception raised outside the caller's try block — the very escape this exists
 * to close.
 */
export function normalizeRenderable(
  value: unknown,
  options: NormalizeOptions = {}
): NormalizedOutput {
  let remaining = MAX_CHECKED_VALUES;
  let hasUnwrappedThenable = false;
  let wrappedCount = 0;

  const overBudget = () =>
    `more than ${MAX_CHECKED_VALUES} values, which is past the point this renderer will inspect`;

  const spend = (): boolean => {
    if (remaining <= 0) return false;
    remaining -= 1;
    return true;
  };

  /** Classifies a borrowed value: never consumed, never rebuilt. */
  const inspect = (current: unknown): string | null => {
    if (!spend()) return overBudget();
    if (current === null || current === undefined) return null;

    const type = typeof current;
    if (
      type === "boolean" ||
      type === "string" ||
      type === "number" ||
      type === "bigint"
    ) {
      return null;
    }

    if (type !== "object" && type !== "function") return describeValue(current);

    if (isThenable(current)) {
      // Nothing can be substituted inside an element that already exists, so
      // this one passes through and the caller is told a boundary is needed.
      hasUnwrappedThenable = true;
      return null;
    }

    if (isValidElement(current)) return inspect(childrenOf(current));
    if (type === "object" && isPortal(current)) return null;
    if (type === "function") return describeValue(current);

    if (current instanceof Map) {
      return "a Map, which React does not render";
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        const reason = inspect(item);
        if (reason !== null) return reason;
      }
      return null;
    }

    if (!isIterable(current)) return describeValue(current);

    // Reading a single-use iterable would leave React nothing to render, so it
    // is the one thing accepted unchecked. A re-readable collection has no such
    // cost and is walked.
    if (isSingleUse(current)) return null;
    for (const item of current) {
      const reason = inspect(item);
      if (reason !== null) return reason;
    }
    return null;
  };

  /** Classifies a value this renderer owns, materialising and substituting. */
  const take = (current: unknown): NormalizedOutput => {
    if (!spend()) return { ok: false, reason: overBudget() };
    if (current === null || current === undefined) {
      return { ok: true, node: current, hasUnwrappedThenable };
    }

    const type = typeof current;
    // Checked before the iterable branch below: a string is iterable, and
    // walking it character by character would turn every word into an array.
    if (
      type === "boolean" ||
      type === "string" ||
      type === "number" ||
      type === "bigint"
    ) {
      return { ok: true, node: current as ReactNode, hasUnwrappedThenable };
    }

    if (type !== "object" && type !== "function") {
      return { ok: false, reason: describeValue(current) };
    }

    if (isThenable(current)) {
      const wrap = options.wrapOwnedThenable;
      if (!wrap) {
        hasUnwrappedThenable = true;
        return { ok: true, node: current as ReactNode, hasUnwrappedThenable };
      }
      const node = wrap(current, wrappedCount);
      wrappedCount += 1;
      return { ok: true, node, hasUnwrappedThenable };
    }

    if (isValidElement(current)) {
      const reason = inspect(childrenOf(current));
      return reason === null
        ? { ok: true, node: current as ReactNode, hasUnwrappedThenable }
        : { ok: false, reason };
    }
    if (type === "object" && isPortal(current)) {
      return { ok: true, node: current as ReactNode, hasUnwrappedThenable };
    }

    if (type === "function") {
      return { ok: false, reason: describeValue(current) };
    }

    // React refuses a Map as a child even though it is iterable: its entries
    // are `[key, value]` pairs, which would render as their contents rather
    // than as anything the author intended.
    if (current instanceof Map) {
      return { ok: false, reason: "a Map, which React does not render" };
    }

    if (!isIterable(current)) {
      return { ok: false, reason: describeValue(current) };
    }

    const items: ReactNode[] = [];
    const iterator = current[Symbol.iterator]();
    for (;;) {
      if (!spend()) return { ok: false, reason: overBudget() };

      const step = iterator.next();
      if (step.done === true) break;

      const item = take(step.value);
      if (!item.ok) return item;
      items.push(item.node);
    }
    return { ok: true, node: items, hasUnwrappedThenable };
  };

  try {
    return take(value);
  } catch (error) {
    // Reading an iterable can throw, and it would throw here rather than where
    // the block was called, which is outside the caller's try block.
    return {
      ok: false,
      reason: `output that failed while being read (${describeThrown(error)})`,
    };
  }
}
