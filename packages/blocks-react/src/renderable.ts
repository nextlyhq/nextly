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
  // A function carrying `then` is awaitable — `await` looks for the method, not
  // for a particular typeof. Excluding functions here sent a library's callable
  // promise-like down the reject-a-function path instead of awaiting it.
  const type = typeof value;
  if ((type !== "object" && type !== "function") || value === null)
    return false;
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
 * Whether React renders this element's children itself.
 *
 * True for a host element (`type` is a tag name) and for a fragment. False for
 * a custom component, and that distinction decides whether its children may be
 * judged at all: React hands a component its children as an ordinary prop, so
 * `<List>{item => <Row item={item} />}</List>` is valid and so is a component
 * that ignores `children` entirely. Both were verified to render. Inspecting
 * those would replace working blocks with placeholders, which is a worse
 * failure than the escape it would close — a component's children are its own
 * contract.
 */
/**
 * Element types whose children React renders itself even though the type is an
 * object rather than a symbol.
 *
 * A context provider is the case: React 19 uses the context object directly
 * (`react.context`) and earlier versions use `Ctx.Provider` (`react.provider`),
 * and React renders the children of both. Enumerated rather than accepting any
 * `react.*` tagged object, because `memo` and `lazy` are tagged the same way and
 * are wrappers around a COMPONENT — their children are an ordinary prop, so
 * inspecting them would reject valid render props. A consumer is excluded for
 * exactly that reason: `<Ctx.Consumer>{value => ...}</Ctx.Consumer>` is a
 * function child.
 *
 * Missing a future provider-like tag costs an escape; wrongly including a
 * component wrapper costs a working block. The list stays conservative.
 */
const PROVIDER_TAGS: ReadonlySet<string> = new Set([
  "react.context",
  "react.provider",
]);

/** The context consumer tag, whose single child must be a function. */
const CONSUMER_TAG = "react.consumer";

/** Suspense, whose `fallback` prop is rendered as well as its children. */
const SUSPENSE_TYPE = Symbol.for("react.suspense");

/**
 * Whether a symbol is one of React's own element types.
 *
 * Matched by DESCRIPTION prefix rather than against a list of known symbols, so
 * a built-in React adds later is covered without an edit — and rather than by
 * `typeof === "symbol"` alone, which accepted any foreign symbol:
 * `createElement(Symbol("x"))` passes `isValidElement` and React then refuses
 * it with "Element type is invalid".
 */
function isReactBuiltinSymbol(value: unknown): boolean {
  return (
    typeof value === "symbol" &&
    typeof value.description === "string" &&
    value.description.startsWith("react.")
  );
}

/** The `$$typeof` tag of a value, when it carries a React one. */
function reactTag(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const tag = (value as { $$typeof?: unknown }).$$typeof;
  if (typeof tag !== "symbol" || typeof tag.description !== "string") {
    return null;
  }
  return tag.description.startsWith("react.") ? tag.description : null;
}

/**
 * Whether React can render an element's TYPE at all.
 *
 * `isValidElement` answers whether a value is shaped like an element, not
 * whether React can render it: `createElement(props.as)` with `as` stored as a
 * number produces a perfectly valid element whose type React refuses with
 * "Element type is invalid" — thrown from inside its own render, after the
 * block boundary has returned. A block building JSX from stored data is exactly
 * how that value gets there.
 */
function isRenderableElementType(type: unknown): boolean {
  if (typeof type === "string") return type.length > 0;
  // A component, and every React built-in (fragment, Suspense, StrictMode).
  if (typeof type === "function") return true;
  if (isReactBuiltinSymbol(type)) return true;
  return reactTag(type) !== null;
}

function rendersOwnChildren(element: unknown): boolean {
  const type = (element as { type?: unknown }).type;
  const tag = reactTag(type);
  if (tag !== null) return PROVIDER_TAGS.has(tag);
  // A host element (`type` is a tag name) and every React built-in (`type` is a
  // `react.*` symbol — fragment, Suspense, StrictMode, Profiler) render their
  // children themselves. Matching the symbol KIND rather than listing the known
  // ones means a built-in this module has not heard of is still covered, which
  // is the opposite of the enumeration problem: being late to a new symbol
  // would reopen the escape, while covering one early costs nothing.
  //
  // A custom component's `type` is a function, and a `memo`/`lazy`/context
  // wrapper's is an object; both receive children as an ordinary prop and own
  // what they mean, so neither is walked.
  return typeof type === "string" || isReactBuiltinSymbol(type);
}

/**
 * A host-element prop React's server renderer refuses outright.
 *
 * Deliberately ONE case rather than a general prop validator. React throws on
 * a non-object `style`, and that is the one worth pre-empting here because it
 * arrives from stored content — a block reading a text field into `style` is an
 * ordinary mistake, and React raises it while writing the attribute, long after
 * this package's containment has returned.
 *
 * The line stops there on purpose. Reproducing React's own prop validation
 * would mean tracking its internals across versions, and every rule that drifts
 * out of date becomes a valid block refused in production. What React accepts
 * is React's to say; what is a renderable NODE is this module's.
 */
function hostPropReason(element: unknown): string | null {
  const type = (element as { type?: unknown }).type;
  if (typeof type !== "string") return null;

  const props = (element as { props?: unknown }).props;
  if (typeof props !== "object" || props === null) return null;

  const style = (props as { style?: unknown }).style;
  if (style != null && typeof style !== "object") {
    return `a ${typeof style} \`style\` prop on <${type}>, where React requires an object`;
  }
  return null;
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

/** What reading a borrowed iterable would cost. */
type IterableKind = "single-use" | "re-readable" | "unopenable";

/**
 * Whether an iterable can be read without using it up.
 *
 * Decided by asking for the iterator TWICE and comparing. A collection hands
 * out a fresh iterator each time, so reading it costs nothing; a generator
 * returns itself, so reading it is the only read anyone gets.
 *
 * Comparing the two answers rather than checking whether the iterator is its
 * own iterator, which looks equivalent and is not: a `Set`'s iterator is also
 * its own iterator, so that test calls every collection single-use and quietly
 * stops inspecting all of them. Asking twice separates the cases and costs
 * nothing — requesting an iterator does not advance a generator.
 *
 * It also catches a wrapper that DELEGATES to a shared generator, whose
 * iterator is neither itself nor fresh; walking one would drain the generator
 * and leave React nothing to render, with no error to say so.
 */
function classifyIterable(value: Iterable<unknown>): IterableKind {
  try {
    const first = value[Symbol.iterator]();
    const second = value[Symbol.iterator]();
    return first === second ? "single-use" : "re-readable";
  } catch {
    // Distinct from single-use: an iterable that cannot even be opened here
    // will not open for React either, and accepting it unchecked means the
    // throw lands inside React's render instead of becoming a placeholder.
    return "unopenable";
  }
}

/** A Suspense element's fallback, which React renders as surely as its children. */
function suspenseFallbackOf(element: unknown): unknown {
  const type = (element as { type?: unknown }).type;
  if (type !== SUSPENSE_TYPE) return undefined;
  const props = (element as { props?: unknown }).props;
  if (typeof props !== "object" || props === null) return undefined;
  return (props as { fallback?: unknown }).fallback;
}

/**
 * What is wrong with an element itself, before its children are considered.
 *
 * Shared by both walks so the owned and borrowed paths cannot drift on what
 * makes an element unusable.
 */
function elementShapeReason(element: unknown): string | null {
  const type = (element as { type?: unknown }).type;
  if (!isRenderableElementType(type)) {
    return "an element whose type React cannot render";
  }

  // A consumer takes exactly one child and calls it. React answers anything
  // else with "render is not a function", raised while it renders rather than
  // while this walk runs. Checked by shape and never invoked: calling an
  // author's function here would run it outside the render it belongs to.
  if (reactTag(type) === CONSUMER_TAG) {
    return typeof childrenOf(element) === "function"
      ? null
      : "a context consumer whose child is not a function";
  }

  return hostPropReason(element);
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
 * **The limits of the guarantee**, stated so nobody is surprised by them:
 *
 * - A promise inside existing JSX cannot be substituted without cloning
 *   someone else's element, so its rejection reaches the route's error handling.
 * - Children produced by a component exist only once React renders it, so
 *   `<Thing />` returning a bad value is not visible from here.
 * - A CUSTOM component's children are not judged at all. React passes them to
 *   the component as an ordinary prop, so a render prop or an opaque value is
 *   legitimate; only host elements and fragments have children React renders
 *   directly.
 * - Prop-level validity is React's to decide, with the single exception of a
 *   non-object `style` on a host element. Everything else about props is left
 *   alone rather than approximated.
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
      // Nothing can be substituted inside an element that already exists, and
      // Suspense resolves a promise child without containing one that rejects
      // or resolves to something unrenderable. Passing it through would put
      // that failure inside React's render, past this block's boundary — so it
      // is refused. A block wanting an async child returns the promise itself,
      // or puts it inside a component it owns.
      return "a promise inside JSX, which cannot be awaited under this block's containment";
    }

    if (isValidElement(current)) {
      const elementReason = elementShapeReason(current);
      if (elementReason !== null) return elementReason;
      if (!rendersOwnChildren(current)) return null;
      // A Suspense fallback is rendered by React as surely as its children are,
      // just later, so an unrenderable one fails at the first suspension —
      // outside anything this package can catch.
      const fallbackReason = inspect(suspenseFallbackOf(current));
      if (fallbackReason !== null) return fallbackReason;
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

    if (!isIterable(current)) return describeValue(current);

    const kind = classifyIterable(current);
    if (kind === "unopenable") {
      return "an iterable whose iterator could not be obtained";
    }
    // Reading a single-use iterable would leave React nothing to render, so it
    // is the one thing accepted unchecked. A re-readable collection has no such
    // cost and is walked.
    if (kind === "single-use") return null;
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
      const elementReason = elementShapeReason(current);
      if (elementReason !== null) return { ok: false, reason: elementReason };
      if (!rendersOwnChildren(current)) {
        return { ok: true, node: current as ReactNode, hasUnwrappedThenable };
      }
      const reason =
        inspect(suspenseFallbackOf(current)) ?? inspect(childrenOf(current));
      return reason === null
        ? { ok: true, node: current as ReactNode, hasUnwrappedThenable }
        : { ok: false, reason };
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
