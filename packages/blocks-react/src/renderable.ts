import { isValidElement, type ReactNode } from "react";

/**
 * How many values one block's output is walked before it is refused.
 *
 * The walk never descends INTO an element, so this counts the array and
 * iterable scaffolding a block returned around its elements, not the size of
 * the tree it describes. A block returning more scaffolding than this has
 * produced something no page needs, and the budget also bounds an iterable that
 * never ends.
 */
const MAX_CHECKED_VALUES = 10_000;

/** A block's output, checked and in a form React can render. */
export type NormalizedOutput =
  | { ok: true; node: ReactNode }
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
 * That is the same damage a throwing block does, from a mistake that is easier
 * to make, and it is only catchable in advance.
 *
 * What passes is exactly `ReactNode`: nothing (`null`, `undefined`, booleans),
 * text (`string`, `number`, `bigint`), elements, and ITERABLES of those —
 * `ReactNode` includes `Iterable<ReactNode>`, and a block returning a `Set` or
 * a generator of elements is returning valid output.
 *
 * A non-array iterable is materialised rather than passed through, because
 * checking it any other way would consume it and hand React an iterator with
 * nothing left in it. The array that comes back renders identically.
 *
 * The budget fails CLOSED. Refusing an outlandish structure costs that block a
 * placeholder; accepting one unchecked is the exact escape this function
 * exists to prevent, so the ambiguous case resolves toward containment.
 */
export function normalizeRenderable(value: unknown): NormalizedOutput {
  let remaining = MAX_CHECKED_VALUES;

  const exhausted = (): NormalizedOutput => ({
    ok: false,
    reason: `more than ${MAX_CHECKED_VALUES} values, which is past the point this renderer will inspect`,
  });

  const walk = (current: unknown): NormalizedOutput => {
    if (remaining <= 0) return exhausted();
    remaining -= 1;

    if (current === null || current === undefined) {
      return { ok: true, node: current };
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
      return { ok: true, node: current as ReactNode };
    }

    if (isValidElement(current)) return { ok: true, node: current };

    if (type !== "object") {
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
      if (remaining <= 0) return exhausted();
      remaining -= 1;

      const step = iterator.next();
      if (step.done === true) break;

      const item = walk(step.value);
      if (!item.ok) return item;
      items.push(item.node);
    }
    return { ok: true, node: items };
  };

  return walk(value);
}
