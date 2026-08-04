import { isValidElement, type ReactNode } from "react";

/** How deep an array of children is inspected before it is taken on trust. */
const MAX_INSPECT_DEPTH = 8;

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

/**
 * Whether React can render a value, checked before handing it over.
 *
 * The engine types a block's output as `unknown` and leaves narrowing to this
 * package, so this is where the contract is actually enforced rather than
 * assumed. It matters because of where the failure would otherwise land: a
 * block returning a plain object throws inside React's own render, after this
 * package's error handling has finished, so it escapes containment and takes
 * the page with it. That is the same damage a throwing block does, from a
 * mistake that is easier to make, and it is only catchable in advance.
 *
 * What passes is exactly `ReactNode`: nothing (`null`, `undefined`, booleans),
 * text (`string`, `number`, `bigint`), elements, and iterables of those.
 */
export function isRenderableNode(
  value: unknown,
  depth = 0
): value is ReactNode {
  if (value === null || value === undefined) return true;

  const type = typeof value;
  if (
    type === "boolean" ||
    type === "string" ||
    type === "number" ||
    type === "bigint"
  ) {
    return true;
  }

  if (isValidElement(value)) return true;

  if (Array.isArray(value)) {
    // Past the bound the contents are accepted rather than walked. A document
    // deep enough to reach it is already refused by the engine's limits, and
    // an unbounded walk over an adversarial structure is its own denial of
    // service.
    if (depth >= MAX_INSPECT_DEPTH) return true;
    return value.every(item => isRenderableNode(item, depth + 1));
  }

  // Everything else is rejected, including plain objects, functions, symbols
  // and Maps. React renders none of them, and several fail as a warning in
  // development and as a blank space in production, which is the worst
  // combination to debug.
  return false;
}

/** A short description of what a block returned, for a placeholder. */
export function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array containing a non-renderable value";
  const type = typeof value;
  if (type === "object") {
    const name = (value as object).constructor?.name;
    return name && name !== "Object" ? `a ${name} instance` : "a plain object";
  }
  return `a ${type}`;
}
