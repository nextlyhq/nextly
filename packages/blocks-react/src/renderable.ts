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
 * A context provider is the case: React 19 tags both `Ctx` and `Ctx.Provider`
 * as `react.context` and renders the children of both. The pre-19
 * `react.provider` spelling is deliberately absent — this package peers React
 * 19 only, where that tag is no longer an element type React can render, so
 * accepting it would admit a value that throws. Enumerated rather than any
 * `react.*` tagged object, because `memo` and `lazy` are tagged the same way and
 * are wrappers around a COMPONENT — their children are an ordinary prop, so
 * inspecting them would reject valid render props. A consumer is excluded for
 * exactly that reason: `<Ctx.Consumer>{value => ...}</Ctx.Consumer>` is a
 * function child.
 *
 * Missing a future provider-like tag costs an escape; wrongly including a
 * component wrapper costs a working block. The list stays conservative.
 */
const PROVIDER_TAGS: ReadonlySet<symbol> = new Set([
  Symbol.for("react.context"),
]);

/**
 * Whether React draws this element type by drawing its children and nothing
 * else of its own.
 *
 * Exported because two questions need it and must not answer differently: this
 * module walks such a wrapper's children to VALIDATE them, and the boundary
 * walks them to decide whether the block drew anything. A second list would let
 * a wrapper be inspected for safety and then misreported as output.
 *
 * `Suspense` belongs here despite its `fallback`: the fallback is drawn only
 * while the children are pending, and children that are structurally empty
 * cannot suspend. A child that CAN suspend is not empty, so the recursion that
 * uses this already answers that case correctly.
 *
 * A context provider belongs for the same reason it is walked below — it wraps
 * a value around children it renders directly.
 */
export function rendersChildrenTransparently(type: unknown): boolean {
  if (type === FRAGMENT_TYPE || type === STRICT_MODE_TYPE) return true;
  if (type === PROFILER_TYPE || type === SUSPENSE_TYPE) return true;
  if (type === ACTIVITY_TYPE || type === SUSPENSE_LIST_TYPE) return true;
  const tag = reactTag(type);
  return tag !== null && PROVIDER_TAGS.has(tag);
}

/** The built-in wrapper types, by the symbols React identifies them with. */
const FRAGMENT_TYPE = Symbol.for("react.fragment");
const STRICT_MODE_TYPE = Symbol.for("react.strict_mode");
const PROFILER_TYPE = Symbol.for("react.profiler");
const ACTIVITY_TYPE = Symbol.for("react.activity");
/**
 * `SuspenseList`, which renders its children directly and draws nothing when it
 * has none. Named here because the list of types this module ACCEPTS already
 * carries it: a type accepted as renderable but missing from this answer is a
 * wrapper walked to validate its children in one place and reported as output in
 * the other, which is the disagreement sharing this function exists to prevent.
 */
const SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list");

/** The context consumer tag, whose single child must be a function. */
const CONSUMER_TAG = Symbol.for("react.consumer");

/** Suspense, whose `fallback` prop is rendered as well as its children. */
const SUSPENSE_TYPE = Symbol.for("react.suspense");

/** The React symbols that are element types in their own right. */
const RENDERABLE_REACT_SYMBOLS: ReadonlySet<symbol> = new Set([
  Symbol.for("react.fragment"),
  Symbol.for("react.suspense"),
  Symbol.for("react.suspense_list"),
  Symbol.for("react.strict_mode"),
  Symbol.for("react.profiler"),
  // React 19.2's `<Activity>`: an element type like the rest, and one whose
  // children React renders itself.
  Symbol.for("react.activity"),
]);

/**
 * The `$$typeof` tags that make an OBJECT a usable element type.
 *
 * The wrappers a component can be built out of, plus the context tag React 19
 * gives both `Ctx` and `Ctx.Provider`.
 *
 * By identity and enumerated, for the same reason the symbol list is: a tag
 * whose description merely begins `react.` proves nothing. An object tagged
 * `react.portal` is React's own and is still not an element type, a
 * `react.whatever` is not React's at all, and `Symbol("react.context")` is a
 * private symbol wearing the right name — all three were verified to reach
 * "Element type is invalid" from inside React's render.
 */
const ELEMENT_TYPE_TAGS: ReadonlySet<symbol> = new Set([
  Symbol.for("react.memo"),
  Symbol.for("react.forward_ref"),
  Symbol.for("react.lazy"),
  ...PROVIDER_TAGS,
  CONSUMER_TAG,
]);

/**
 * Whether a symbol is one React accepts as an element type.
 *
 * By IDENTITY, not by description. The two are not the same thing and the
 * difference is exploitable in both directions: `Symbol("react.fragment")` is a
 * different symbol that merely describes itself that way, and
 * `Symbol.for("react.memo")` is genuinely React's yet is a component-wrapper
 * tag rather than an element type — React answers both with "Element type is
 * invalid".
 *
 * Enumerating means a built-in React adds later is refused until this list
 * grows, and that is the right way round: refusing something valid shows up as
 * a placeholder, accepting something invalid takes the page.
 */
function isReactBuiltinSymbol(value: unknown): boolean {
  return typeof value === "symbol" && RENDERABLE_REACT_SYMBOLS.has(value);
}

/**
 * The field React dereferences for each object element type, where there is
 * one.
 *
 * A tag alone is not a wrapper: `{ $$typeof: Symbol.for("react.forward_ref") }`
 * carries the right tag and nothing to render, and React answers it with
 * "Cannot read properties of undefined" from inside its own render — a crash
 * rather than the refusal a bad element type gets. Verified per tag against
 * React 19.2; a context object is genuinely renderable bare, so it has no
 * entry here.
 *
 * These are React internals, which this module otherwise stays out of. The
 * reason it is safe to name them is that the real wrappers are built by React's
 * own factories and always carry them — so `accepts-real-wrappers` in the test
 * suite fails loudly in CI if a rename ever makes this too strict, rather than
 * silently refusing valid blocks in production.
 */
const ELEMENT_TYPE_SHAPE: ReadonlyMap<
  symbol,
  (type: object, depth: number) => boolean
> = new Map([
  [
    Symbol.for("react.memo"),
    // The memo's inner type, not merely a `type` field: React unwraps it and
    // renders THAT, so `{ $$typeof: memo, type: 42 }` has the field and still
    // reaches "Element type is invalid".
    (type: object, depth: number) =>
      isRenderableElementType((type as { type?: unknown }).type, depth + 1),
  ],
  [
    Symbol.for("react.forward_ref"),
    (type: object) =>
      typeof (type as { render?: unknown }).render === "function",
  ],
  [
    Symbol.for("react.lazy"),
    // Both fields React's own `lazy()` builds, not just the one React calls.
    //
    // What a lazy RESOLVES to cannot be checked here: React calls `_init` while
    // rendering, long after this boundary has returned, and calling it here to
    // find out would run the block author's loader twice and suspend outside
    // any boundary. So a forged `{ _init: () => 42 }` reaches React and throws
    // "Element type is invalid" uncontained.
    //
    // Requiring `_payload` narrows that to objects deliberately impersonating
    // the full shape. React itself tolerates its absence, but nothing genuine
    // lacks it — `lazy()` always sets both — so this refuses no real lazy while
    // turning the accidental impersonation into a placeholder.
    (type: object) => {
      const lazyType = type as { _init?: unknown; _payload?: unknown };
      return typeof lazyType._init === "function" && "_payload" in lazyType;
    },
  ],
  [
    Symbol.for("react.consumer"),
    // The context itself, not just the key: React reads through it for the
    // current value, so `{ $$typeof: consumer, _context: null }` carries the
    // field and still throws while rendering.
    (type: object) => {
      const context = (type as { _context?: unknown })._context;
      return typeof context === "object" && context !== null;
    },
  ],
]);

/**
 * How far a wrapper may nest before it is refused.
 *
 * Unwrapping is recursive and a stored object can point at itself, so the walk
 * needs a floor. Real nesting is one or two deep — `memo(forwardRef(fn))` — so
 * this only ever stops a cycle.
 */
const MAX_WRAPPER_DEPTH = 8;

/** The `$$typeof` tag of a value, when it is one React renders elements from. */
function reactTag(value: unknown, depth = 0): symbol | null {
  if (typeof value !== "object" || value === null) return null;
  const tag = (value as { $$typeof?: unknown }).$$typeof;
  if (typeof tag !== "symbol" || !ELEMENT_TYPE_TAGS.has(tag)) return null;
  if (depth > MAX_WRAPPER_DEPTH) return null;
  const hasShape = ELEMENT_TYPE_SHAPE.get(tag);
  return hasShape === undefined || hasShape(value, depth) ? tag : null;
}

/**
 * A tag name React's serializer will accept.
 *
 * React creates a perfectly valid element for `"bad tag"`, `"1div"` or `"a/b"`
 * and then throws `Invalid tag:` while writing it — after this boundary has
 * returned. A block building a host element from a stored `as` field is how
 * such a name arrives. The grammar mirrors React's own: a letter, then letters,
 * digits, `-`, `_`, `:` or `.`, which keeps custom elements (`my-el`) and
 * namespaced SVG (`x:y`) working.
 */
const VALID_TAG_NAME = /^[a-zA-Z][a-zA-Z0-9:_.-]*$/;

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
function isRenderableElementType(type: unknown, depth = 0): boolean {
  if (typeof type === "string") return VALID_TAG_NAME.test(type);
  // A component, and every React built-in (fragment, Suspense, StrictMode).
  if (typeof type === "function") return true;
  if (isReactBuiltinSymbol(type)) return true;
  // An object type is only renderable when its tag is one of the wrappers a
  // component can be built out of. Accepting every `react.*` description here
  // was the same enumeration mistake as accepting every `react.*` symbol, one
  // level over: `{ $$typeof: Symbol.for("react.portal") }` is React's own tag
  // on a value React refuses as a type.
  return reactTag(type, depth) !== null;
}

function rendersOwnChildren(element: unknown): boolean {
  const type = (element as { type?: unknown }).type;
  const tag = reactTag(type);
  if (tag !== null) return PROVIDER_TAGS.has(tag);
  // A host element (`type` is a tag name) and every React built-in (`type` is
  // one of the element-type symbols — fragment, Suspense, StrictMode, Profiler)
  // render their children themselves, so both are walked. The same list decides
  // this and whether the type is renderable at all, which keeps the two answers
  // from disagreeing: a symbol accepted as a type but not walked here would let
  // an invalid child through one element higher.
  //
  // A custom component's `type` is a function, and a `memo`/`lazy`/context
  // wrapper's is an object; both receive children as an ordinary prop and own
  // what they mean, so neither is walked.
  return typeof type === "string" || isReactBuiltinSymbol(type);
}

/**
 * Elements the HTML spec gives no closing tag, and so no contents.
 *
 * An enumeration, unlike the rest of this module — and defensible here because
 * the set is closed by the HTML standard rather than by a library's internals.
 * React hardcodes the same list. Nothing has been added to it since `<wbr>`,
 * and a new one would be a change to HTML itself.
 */
/**
 * Whether React can convert a value to a string without throwing.
 *
 * Checked by SHAPE rather than by attempting the conversion, because a
 * `toString` here is code the block author wrote: coercing to find out would
 * run it once for the check and again for the render, and a method with a side
 * effect would perform it twice.
 *
 * Primitives all coerce except a symbol, which throws. An object coerces
 * through `Symbol.toPrimitive` if it has one and through `toString` or
 * `valueOf` otherwise, so the order here mirrors the language's: a
 * `Symbol.toPrimitive` that is present but not callable throws before either of
 * the other two is consulted. A plain object inherits
 * `Object.prototype.toString` and is fine (React renders `[object Object]`),
 * while `Object.create(null)` and an object that nulls both inherit nothing and
 * throw.
 *
 * The residual case is a REACHABLE method that throws when called. It cannot be
 * detected without calling it, and block code that wants to throw during render
 * can simply throw, which this boundary already contains.
 */
function isStringable(value: unknown): boolean {
  if (typeof value === "symbol") return false;
  if (value === null || typeof value !== "object") {
    return typeof value !== "function" || typeof value.toString === "function";
  }
  const candidate = value as {
    toString?: unknown;
    valueOf?: unknown;
    [Symbol.toPrimitive]?: unknown;
  };
  // Reading a property can run a getter, so a throw here is an answer of "no"
  // rather than something to propagate out of a predicate.
  try {
    const toPrimitive = candidate[Symbol.toPrimitive];
    if (toPrimitive !== undefined && typeof toPrimitive !== "function") {
      return false;
    }
  } catch {
    return false;
  }
  return (
    typeof candidate.toString === "function" ||
    typeof candidate.valueOf === "function"
  );
}

const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * A host-element prop React's server renderer refuses outright.
 *
 * A short list of named invariants rather than a general prop validator, and
 * each one is here for the same reason: React raises it while WRITING the
 * element, long after this package's containment has returned, and the value
 * that trips it arrives from stored content — a block reading a text field into
 * `style`, or a caption into a tag that cannot hold one.
 *
 * The line stops at invariants React THROWS on and that are stable properties
 * of HTML or of React's documented API. Reproducing React's full prop
 * validation would mean tracking its internals across versions, and every rule
 * that drifted out of date would become a valid block refused in production.
 * What React accepts is React's to say; what is a renderable NODE is this
 * module's.
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

  // `!= null` throughout, matching React: it skips a prop that is absent OR
  // null, so refusing a null here would reject markup React renders without
  // complaint. Any other non-null value counts — React throws on `children:
  // false` and `children: ""` as readily as on a string, because it tests the
  // prop rather than what the prop would render to.
  const children = (props as { children?: unknown }).children;
  const html = (props as { dangerouslySetInnerHTML?: unknown })
    .dangerouslySetInnerHTML;

  if (html != null) {
    if (typeof html !== "object" || !("__html" in html)) {
      return `a \`dangerouslySetInnerHTML\` prop on <${type}> that is not an object carrying \`__html\``;
    }
    if (children != null) {
      return `both \`children\` and \`dangerouslySetInnerHTML\` on <${type}>, which React refuses`;
    }
    // React STRINGIFIES `__html` while serializing, which is after this
    // boundary has returned — so a value that cannot be coerced throws where
    // nothing can contain it. Verified against React 19.2: a symbol and an
    // object with no reachable `toString`/`valueOf` both throw, while a number,
    // a boolean, an array and a plain object are all coerced without complaint.
    const markup = (html as { __html?: unknown }).__html;
    if (!isStringable(markup)) {
      return `a \`dangerouslySetInnerHTML.__html\` value on <${type}> that React cannot convert to a string`;
    }
  }

  if (VOID_ELEMENTS.has(type)) {
    if (children != null) {
      return `children on <${type}>, which is a void element and cannot have contents`;
    }
    if (html != null) {
      return `a \`dangerouslySetInnerHTML\` prop on <${type}>, which is a void element and cannot have contents`;
    }
  }

  // `<textarea>` holds its text in a prop, not in children, and React THROWS on
  // the two shapes below rather than warning as it does for a lone child. The
  // sibling `<select multiple>` rules are deliberately absent: React only warns
  // for a mismatched `value`/`defaultValue` there and renders the element
  // anyway, so refusing would take a page that React was willing to serve.
  if (type === "textarea" && children != null) {
    const controlled = props as { defaultValue?: unknown; value?: unknown };
    if (controlled.defaultValue != null || controlled.value != null) {
      return "both a value prop and children on <textarea>, which React refuses";
    }
    if (Array.isArray(children) && children.length > 1) {
      return "more than one child on <textarea>, which can hold at most one";
    }
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
  // Promises already substituted for an awaiting wrapper. If the output is
  // refused later — `[Promise.reject(e), { bad: true }]` — those wrappers are
  // discarded before React ever renders them, so nothing would await the
  // promises the block already started.
  const wrapped: PromiseLike<unknown>[] = [];

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
      // Refusing to render it does not make it go away: the block already
      // started this promise, and a rejection nobody is listening for takes
      // down the process under Node's default `--unhandled-rejections=throw`.
      // Marking it handled is not swallowing an error — the placeholder is
      // where the failure gets reported — it is declining to let a value this
      // renderer refused kill the server.
      markHandled(current);
      return "a promise inside JSX, which cannot be awaited under this block's containment";
    }

    if (isValidElement(current)) {
      const elementReason = elementShapeReason(current);
      if (elementReason !== null) {
        // Refused for its own shape, so nothing below descends. Any promise a
        // block already started inside these children would be left with no
        // handler at all.
        sweepThenables(suspenseFallbackOf(current));
        sweepThenables(childrenOf(current));
        return elementReason;
      }
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
    // A borrowed single-use iterator is refused rather than walked OR passed
    // through. Walking it would consume it and leave React nothing to render;
    // passing it through leaves the only pass over its values to React, after
    // this boundary has returned — where a yielded object throws uncontained
    // and an endless generator hangs the whole page render rather than one
    // block. Nothing can be substituted here either, because the value sits
    // inside an element the block already built.
    //
    // Refusing is also what React asks for: it warns that iterators as children
    // are unsupported "because enumerating a generator mutates it", and points
    // at `Array.from()` or a spread. A block that does either is accepted by
    // the branch below.
    if (kind === "single-use") {
      return "a single-use iterator inside JSX, which React does not support as a child — spread it into an array first";
    }
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
      wrapped.push(current);
      return { ok: true, node, hasUnwrappedThenable };
    }

    if (isValidElement(current)) {
      const elementReason = elementShapeReason(current);
      if (elementReason !== null) {
        sweepThenables(suspenseFallbackOf(current));
        sweepThenables(childrenOf(current));
        return { ok: false, reason: elementReason };
      }
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

  const markHandled = (pending: PromiseLike<unknown>): void => {
    void Promise.resolve(pending).catch(() => undefined);
  };

  /**
   * Budget for the refusal sweep below, separate from the inspection budget.
   *
   * Sharing one would mean a refusal discovered near the limit had nothing left
   * to sweep with, which is exactly the case where an unhandled rejection is
   * most likely.
   */
  let sweepBudget = MAX_CHECKED_VALUES;

  /**
   * Marks every thenable inside a subtree that is being refused.
   *
   * An element is judged by its OWN shape before its children are looked at, so
   * refusing it returns before anything descends — and a promise a block had
   * already started sits there with no handler attached. React never renders it
   * (the element was replaced by a placeholder), so nothing else will attach one
   * either, and Node's default `--unhandled-rejections=throw` turns that into a
   * process exit: strictly worse than the escape the refusal closed.
   *
   * Marking is not swallowing. The placeholder is where the failure is
   * reported; this only declines to let a value already refused kill the server.
   *
   * Consuming a single-use iterator here is deliberate and safe: this runs only
   * on a subtree nothing will render.
   */
  const sweepThenables = (current: unknown): void => {
    if (sweepBudget <= 0) return;
    sweepBudget -= 1;
    if (current === null || current === undefined) return;

    const type = typeof current;
    if (type !== "object" && type !== "function") return;

    if (isThenable(current)) {
      markHandled(current);
      return;
    }

    if (isValidElement(current)) {
      sweepThenables(suspenseFallbackOf(current));
      sweepThenables(childrenOf(current));
      return;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        if (sweepBudget <= 0) return;
        sweepThenables(item);
      }
      return;
    }

    if (!isIterable(current)) return;
    try {
      for (const item of current) {
        // Checked BEFORE pulling the next value, not just inside the recursive
        // call: an exhausted budget makes that call return immediately while
        // this loop keeps asking the iterator for more, so an endless generator
        // child would spin here forever rather than being abandoned.
        if (sweepBudget <= 0) return;
        sweepThenables(item);
      }
    } catch {
      // A hostile iterator throwing mid-sweep must not replace the refusal that
      // is already on its way back with a different one.
    }
  };

  try {
    const result = take(value);
    // Only on refusal: an accepted output keeps its wrappers, and those await
    // the promises under this block's containment.
    if (!result.ok) wrapped.forEach(markHandled);
    return result;
  } catch (error) {
    wrapped.forEach(markHandled);
    // Reading an iterable can throw, and it would throw here rather than where
    // the block was called, which is outside the caller's try block.
    return {
      ok: false,
      reason: `output that failed while being read (${describeThrown(error)})`,
    };
  }
}
