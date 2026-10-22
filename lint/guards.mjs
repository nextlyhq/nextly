// The repository's own lint rules that no built-in rule expresses, as one
// oxlint JS plugin. Each one reports a construct by its shape in the syntax
// tree; which files each applies to, and which are exempt, is the config's
// business (oxlint.config.mjs).

/** Every built-in error constructor: each carries no code, so each is a 500. */
const BUILT_IN_ERRORS = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "EvalError",
  "ReferenceError",
  "URIError",
  "AggregateError",
]);

const BARE_ERROR_MESSAGE =
  "Throw a NextlyError, not a bare Error. A bare Error carries no code, so the API layer reports it as a 500 even when it is a caller-fixable refusal. Use NextlyError.validation / .notFound / .conflict / .internal, or `new NextlyError({ code, publicMessage })` for a code without a factory.";

const API_KEY_SCOPE_MESSAGE =
  "Build an API-key scope with `apiKeyScopeFrom(caller)`, or narrow one you hold with " +
  "`narrowScope(scope, keep)`. A hand-written literal is short by whatever it does not name, " +
  "and the fields it omits — the caller's roles, and the permission rows every rule-facing " +
  "spelling is derived from — are exactly the ones each gate behind the coarse check reads. Such " +
  "a scope passes the grant check and then denies every documented permission predicate.";

const KEYBOARD_LISTENER_MESSAGE =
  "Register the shortcut with useKeyboardShortcuts (or useShortcuts from @nextlyhq/ui) instead of adding a keyboard listener. One owner decides who gets a key; a second listener makes that mount order.";

/**
 * `throw new Error(…)` and `throw Error(…)`, for every built-in constructor.
 *
 * Only the throw is matched, by the constructor's name. A value built elsewhere
 * and thrown (`const e = new Error(); throw e;`) is not, because constructing
 * an Error is legitimate here: it normalises an `unknown` in a catch, and it
 * is what an `onError` callback receives. A subclass of NextlyError has
 * another name and is unaffected.
 */
const noBareError = {
  meta: { type: "problem", schema: [] },
  create(context) {
    return {
      ThrowStatement(node) {
        if (isBuiltInError(node.argument)) {
          context.report({ node: node.argument, message: BARE_ERROR_MESSAGE });
        }
      },
    };
  },
};

/** The name an identifier carries; undefined for any other node. */
function identifierName(node) {
  return node?.type === "Identifier" ? node.name : undefined;
}

/** `new X(…)` or `X(…)`, the two ways a throw builds what it throws. */
function isConstruction(node) {
  return node?.type === "NewExpression" || node?.type === "CallExpression";
}

/** A built-in error constructor called by its own name. */
function isBuiltInError(thrown) {
  return (
    isConstruction(thrown) && BUILT_IN_ERRORS.has(identifierName(thrown.callee))
  );
}

/** A property's key when it is written as a plain identifier. */
function keyName(property) {
  return property.type === "Property" && property.key.type === "Identifier"
    ? property.key.name
    : undefined;
}

/** `"apiKey"`, written plainly or as `"apiKey" as const`. */
function isApiKeyValue(value) {
  return value.value === "apiKey" || value.expression?.value === "apiKey";
}

/**
 * An API-key scope written by hand.
 *
 * Two shapes: an object naming both `actorType` and `permissions`, and one
 * whose `actorType` is `"apiKey"` and which spreads another object in, which
 * builds the same scope without naming the field.
 */
const apiKeyScope = {
  meta: { type: "problem", schema: [] },
  create(context) {
    return {
      ObjectExpression(node) {
        if (
          namesActorAndPermissions(node.properties) ||
          spreadsAnApiKey(node.properties)
        ) {
          context.report({ node, message: API_KEY_SCOPE_MESSAGE });
        }
      },
    };
  },
};

/** The first shape: both fields named. */
function namesActorAndPermissions(properties) {
  const names = properties.map(keyName);
  return names.includes("actorType") && names.includes("permissions");
}

/** The second: an `"apiKey"` actor with the rest spread in. */
function spreadsAnApiKey(properties) {
  const apiKeyActor = properties.some(
    property =>
      keyName(property) === "actorType" && isApiKeyValue(property.value)
  );
  return (
    apiKeyActor &&
    properties.some(property => property.type === "SpreadElement")
  );
}

/**
 * `document.addEventListener("keydown" | "keyup" | "keypress", …)`, and the
 * same on `window`. The admin's shortcut manager owns the one keyboard
 * listener; a second makes mount order decide who gets a key.
 */
const noKeyboardListener = {
  meta: { type: "problem", schema: [] },
  create(context) {
    return {
      CallExpression(node) {
        if (
          isGlobalListenerCall(node.callee) &&
          isKeyboardEvent(node.arguments[0])
        ) {
          context.report({ node, message: KEYBOARD_LISTENER_MESSAGE });
        }
      },
    };
  },
};

/** The two globals a page-wide listener is added to. */
const LISTENER_TARGETS = new Set(["document", "window"]);

/** `document.addEventListener` or `window.addEventListener`. */
function isGlobalListenerCall(callee) {
  return (
    callee.type === "MemberExpression" &&
    LISTENER_TARGETS.has(identifierName(callee.object)) &&
    identifierName(callee.property) === "addEventListener"
  );
}

/** A string literal naming a keyboard event. */
function isKeyboardEvent(event) {
  return (
    event?.type === "Literal" &&
    typeof event.value === "string" &&
    /^key(down|up|press)$/.test(event.value)
  );
}

export default {
  meta: { name: "nextly" },
  rules: {
    "no-bare-error": noBareError,
    "api-key-scope": apiKeyScope,
    "no-keyboard-listener": noKeyboardListener,
  },
};
