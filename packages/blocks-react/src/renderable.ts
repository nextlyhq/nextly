import { isValidElement, type ReactNode } from "react";

/**
 * How many values one block's output is walked before it is refused.
 *
 * A block that returns more structure than this has produced something no page
 * needs, and the budget also bounds an iterable that never ends.
 */
const MAX_CHECKED_VALUES = 10_000;

/** A block's output, checked and in a form React can render. */
export type NormalizedOutput =
  | {
      ok: true;
      node: ReactNode;
      /**
       * True when a promise was found somewhere in the output. React 19 renders
       * a promise child by suspending on it, so the caller has to place a
       * boundary or the suspension escapes to whatever boundary is above the
       * whole page.
       */
      hasAsyncChildren: boolean;
    }
  | { ok: false; reason: string };

/**
 * Whether a value is awaitable.
 *
 * Duck-typed rather than an `instanceof Promise` check, because the thing a
 * block returns is whatever its own runtime produced: an async function in a
 * different realm, a bundler's promise polyfill and a library's thenable are
 * all awaitable and none of them is `Promise` from this module's perspective.
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

/** A short description of a value, for a placeholder's detail line. */
export function describeValue(value: unknown): string {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "object") {
    const name = (value as object).constructor?.name;
    return name && name !== "Object" ? `a ${name} instance` : "a plain object";
  }
  return `a ${type}`;
}

/**
 * Anything React tags as one of its own node types.
 *
 * Broader than `isValidElement` on purpose: portals, lazy components and
 * whatever React tags next all carry a `react.*` symbol in `$$typeof`, and
 * refusing one because this module had not heard of it would replace working
 * output with a placeholder.
 */
function isReactNodeObject(value: object): boolean {
  const tag = (value as { $$typeof?: unknown }).$$typeof;
  return (
    typeof tag === "symbol" &&
    typeof tag.description === "string" &&
    tag.description.startsWith("react.")
  );
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
 * - The returned value is OURS. A non-array iterable is materialised, because
 *   checking one any other way consumes it and would hand React an iterator
 *   with nothing left in it.
 * - An element's children are NOT ours. They are inspected without being
 *   consumed or rebuilt, so a generator passed as a JSX child still arrives at
 *   React intact. That costs the ability to check inside such a child, which is
 *   the right trade: destroying valid output to check it is worse than not
 *   checking it.
 *
 * **The limit of the guarantee.** Children produced by a component only exist
 * once React renders it, so `<Thing />` whose own render returns a bad value is
 * not visible here and reaches the route's error handling instead. What IS
 * caught is everything present in the value the block returned, which is where
 * the ordinary mistake lives.
 *
 * Total: it never throws. A custom iterable that fails while being read becomes
 * a refusal, because the alternative is an exception raised outside the caller's
 * try block, which is the very escape this exists to close.
 */
export function normalizeRenderable(value: unknown): NormalizedOutput {
  let remaining = MAX_CHECKED_VALUES;
  let hasAsyncChildren = false;

  const overBudget = () =>
    `more than ${MAX_CHECKED_VALUES} values, which is past the point this renderer will inspect`;

  /** Consumes one unit of budget; false once it is gone. */
  const spend = (): boolean => {
    if (remaining <= 0) return false;
    remaining -= 1;
    return true;
  };

  /** Classifies a value without consuming or rebuilding it. Returns a reason, or null. */
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
      hasAsyncChildren = true;
      return null;
    }

    if (isValidElement(current) || isReactNodeObject(current)) {
      return inspect(childrenOf(current));
    }

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

    // A non-array iterable belongs to whoever created it. Reading it here to
    // check it would leave React nothing to render, so it is accepted as-is.
    if (isIterable(current)) return null;

    return describeValue(current);
  };

  /** Classifies a value this renderer owns, materialising iterables. */
  const take = (current: unknown): NormalizedOutput => {
    if (!spend()) return { ok: false, reason: overBudget() };
    if (current === null || current === undefined) {
      return { ok: true, node: current, hasAsyncChildren };
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
      return { ok: true, node: current as ReactNode, hasAsyncChildren };
    }

    if (type !== "object" && type !== "function") {
      return { ok: false, reason: describeValue(current) };
    }

    if (isThenable(current)) {
      hasAsyncChildren = true;
      return { ok: true, node: current as ReactNode, hasAsyncChildren };
    }

    if (isValidElement(current) || isReactNodeObject(current)) {
      const reason = inspect(childrenOf(current));
      return reason === null
        ? { ok: true, node: current as ReactNode, hasAsyncChildren }
        : { ok: false, reason };
    }

    if (type === "function")
      return { ok: false, reason: describeValue(current) };

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
    return { ok: true, node: items, hasAsyncChildren };
  };

  try {
    return take(value);
  } catch (error) {
    // Reading an iterable can throw, and it would throw here rather than where
    // the block was called, which is outside the caller's try block.
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: `output that failed while being read (${message})`,
    };
  }
}
