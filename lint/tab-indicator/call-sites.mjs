// The `tab-indicator` rule: a call site of the Tabs primitive must not take
// over the indicator the primitive draws, through `className` or through an
// inline `style`. Whether a class or a style property takes it over is
// `appearance.mjs`'s question; this file finds the elements that render the
// primitive and reads the values they pass.
//
// A BEST-EFFORT LINT. Silence means "no violation this scan could see", not
// "no violation": it reads syntax, and syntax has an unbounded surface. Known
// gaps, left open deliberately:
//
//   - a `className` bound through a `const` is not read; only literals written
//     in the attribute, inside a template, a conditional or a class map are
//   - an equal-value restatement under a DIFFERENT caller variant, where the
//     owned rule still wins the cascade by emission order
//   - `require` is matched by name rather than by binding, so a local function
//     named `require` is read as CommonJS
//   - an object spread inside a class map (`cn({ ...{ "border-b-0": true } })`)
//     is not traversed
//   - a METHOD in a JSX spread (`{...{ onClick() {} }}`) makes the whole spread
//     unreadable, though its key is statically known to be unrelated
//   - a REASSIGNED component alias freezes ownership at its declaration, so
//     `let T = Other; T = TabsTrigger` is missed. Following it needs
//     reaching-definitions dataflow, which guarded no real call site when it
//     was measured
//   - a class arriving through an identifier from another module, or through
//     Radix `asChild`, where the slotted child's `className` is merged after
//     the wrapper's and never appears on a `Tabs*` element
//
// The rule guards a violation that has not occurred: across the repository
// every real override of these components is layout or size, which `cn()`
// composition exists to serve.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { literalText as wholeLiteral } from "@nextlyhq/module-specifiers/parse-source";

import { displacedBy, ownsStyleProperty } from "./appearance.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The primitive itself: a relative import reaching this file owns the tags. */
const PRIMITIVE = resolve(REPO, "packages/ui/src/components/tabs.tsx");

/**
 * The modules a call site reaches the primitive through. `@nextlyhq/admin`
 * re-exports these components verbatim, so a consumer importing from it
 * renders exactly this primitive.
 */
const OWNING_MODULES = ["@nextlyhq/ui", "@nextlyhq/admin"];

/** The components whose appearance the primitive owns, by exported name. */
const OWNED_EXPORTS = ["TabsList", "TabsTrigger"];

/** The props this contract reads on an owned element. */
const OWNED_PROPS = ["className", "style"];

const UNREADABLE_SPREAD =
  "spreads props this scan cannot read, which may carry `style` or `className` — spread an object literal, or pass the props this primitive owns explicitly";

const UNREADABLE_STYLE_SPREAD =
  "spreads an inline style this scan cannot read — write it as a literal object, or move it to `className` so the primitive keeps its appearance";

/**
 * Whether an import specifier reaches THIS primitive.
 *
 * A relative one is RESOLVED against the importing file rather than tested for
 * ending in `tabs`: `plugin-page-builder/src/render/blocks` holds a second
 * `tabs.tsx`, and a sibling importing `./tabs` there renders a different
 * component. Three spellings reach the same file: extensionless, the exact
 * path, and a `.js` specifier, which resolves to the adjacent TypeScript
 * source under NodeNext. The substitution is anchored to the end, so a
 * directory named `foo.js/` keeps its name.
 */
function reachesThePrimitive(specifier, importer) {
  if (OWNING_MODULES.includes(specifier)) return true;
  if (!specifier.startsWith(".")) return false;
  const target = resolve(dirname(importer), specifier);
  const asSource = target.replace(/\.(js|jsx|mjs|cjs)$/, "");
  return (
    target === PRIMITIVE ||
    `${target}.tsx` === PRIMITIVE ||
    `${asSource}.tsx` === PRIMITIVE
  );
}

/**
 * An expression with the wrappers that emit nothing peeled away.
 *
 * `as`, `satisfies` and `!` are erased before the code runs, so
 * `undefined as string | undefined` reaches React as exactly `undefined`, and
 * that is the ordinary way to write an optional style in a typed codebase.
 * Parentheses are listed for a parser that keeps them; oxlint's does not.
 */
const ERASED = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "ParenthesizedExpression",
]);

function withoutTypeWrappers(expression) {
  let value = expression;
  while (value && ERASED.has(value.type)) value = value.expression;
  return value;
}

/**
 * The text of a string literal, or of a template with no substitutions, by the
 * repository's one reader of that question; undefined for anything computed.
 */
function literalText(node) {
  return wholeLiteral(node) ?? undefined;
}

function isBooleanLiteral(node) {
  return node?.type === "Literal" && typeof node.value === "boolean";
}

function isNullLiteral(node) {
  return (
    node?.type === "Literal" &&
    node.value === null &&
    node.regex === undefined &&
    node.bigint === undefined
  );
}

function isVoid(node) {
  return node?.type === "UnaryExpression" && node.operator === "void";
}

/**
 * How names resolve in one file, from the scope analysis the linter already
 * holds, so shadowing, parameters and block scopes are answered by the same
 * tables every scope-aware rule reads rather than by a walk written here.
 *
 * A declaration is identified by the identifier that declares it, by its
 * offset: two bindings can share a spelling, and the declaration is what makes
 * them one binding or two.
 */
function resolverFor(sourceCode) {
  /** The binding a name refers to HERE; undefined for a global or no binding. */
  const variableOf = identifier => {
    for (
      let scope = sourceCode.getScope(identifier);
      scope;
      scope = scope.upper
    ) {
      const variable = scope.set.get(identifier.name);
      // A configured global, `undefined` among them, is a variable with no
      // definition: not a binding this file declares.
      if (variable) return variable.defs.length > 0 ? variable : undefined;
    }
    return undefined;
  };

  /** The identifier declaring what a name refers to, or undefined. */
  const declarationOf = identifier => variableOf(identifier)?.defs[0]?.name;

  /**
   * What a `const` holds, for a name bound to one here.
   *
   * `undefined` for anything else (a `let`, a parameter, an import, a
   * destructured element) because each can hold a different value by the time
   * the element renders, which is the question this does not ask.
   */
  const valueOf = identifier => {
    const definition = variableOf(identifier)?.defs[0];
    if (definition?.type !== "Variable") return undefined;
    if (definition.node.id !== definition.name) return undefined;
    if (definition.parent?.kind !== "const") return undefined;
    return definition.node.init ?? undefined;
  };

  /** The child nodes of any node, in source order. */
  const childrenOf = node => {
    const children = [];
    for (const key of sourceCode.visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) children.push(...child.filter(Boolean));
      else if (child) children.push(child);
    }
    return children;
  };

  const resolver = { declarationOf, valueOf, childrenOf };

  /**
   * The objects a `style` value can hand React.
   *
   * An inline style on an owned element must be written where it can be READ:
   * an object literal, or a choice between object literals. Anything that has
   * to be traced to know its value (a name, a call, a member access) is
   * reported as unreadable rather than analysed. Answering "what does this
   * variable hold here" is reaching-definitions analysis; written by hand it
   * grew to some seven hundred lines and kept producing defects no test could
   * see, because a wrong answer looks exactly like a right one.
   *
   * `absent` is set when SOME alternative supplies no object at all, so the
   * caller keeps whatever preceded a spread reachable on that branch.
   */
  resolver.objectsFrom = root => {
    const objects = [];
    const seen = new Set();
    let readable = true;
    let absent = false;
    const walk = node => {
      // `style={}` carries no expression, and React receives no style.
      if (!node) {
        absent = true;
        return;
      }
      if (seen.has(node)) return;
      seen.add(node);
      const unwrapped = withoutTypeWrappers(node);
      if (unwrapped !== node) return walk(unwrapped);
      if (node.type === "ObjectExpression") {
        objects.push(node);
        return;
      }
      // A literal condition decides its branch, and the branch it excludes is
      // one React never receives: the same helper the class half asks.
      const selected = selectedByLiteralCondition(node);
      if (selected) return walk(selected);
      // A choice between shapes is still readable: every branch is written
      // here, so each is a style the element can render.
      if (node.type === "ConditionalExpression") {
        walk(node.consequent);
        walk(node.alternate);
        return;
      }
      // A branch contributing NOTHING still leaves whatever came before it
      // standing, so it is recorded as an absent alternative.
      if (node.type === "LogicalExpression") {
        walk(node.left);
        walk(node.right);
        return;
      }
      // `undefined`, `null` and the other spellings of nothing are VALUES React
      // receives as no style, not names that have to be traced.
      if (isDefinitelyNothing(node, resolver)) {
        absent = true;
        return;
      }
      // Reported as unreadable rather than assumed empty: an empty object
      // list reports nothing, which is the silent direction.
      readable = false;
    };
    walk(root);
    return { objects, readable, absent };
  };

  return resolver;
}

/**
 * The operand a LITERAL condition selects, when the condition decides it, so
 * `cn("w-full", false && "border-b-0")` and `true ? {} : { ... }` contribute
 * only the branch that can be taken. `undefined` keeps both in play.
 */
function selectedByLiteralCondition(node) {
  if (node.type === "ConditionalExpression") {
    const decided = staticTruthiness(node.test);
    if (decided === undefined) return undefined;
    return decided ? node.consequent : node.alternate;
  }
  if (node.type !== "LogicalExpression") return undefined;
  // `??` chooses on presence rather than on truth.
  if (node.operator === "??") {
    return isDefinitelyPresent(node.left) ? node.left : undefined;
  }
  // The operand each operator YIELDS: `0 && x` is the value `0`.
  const decided = staticTruthiness(node.left);
  if (decided === undefined) return undefined;
  if (node.operator === "&&") return decided ? node.right : node.left;
  return decided ? node.left : node.right;
}

/**
 * Every class string reachable inside an attribute value: a template's text,
 * a conditional's branches, a class map's keys. A bare identifier contributes
 * nothing, which is the documented gap rather than a silent one.
 */
function literalStrings(node, found, resolver) {
  // Asked before any operand is visited, so a concatenation contributes the
  // string it evaluates to rather than its halves.
  const whole = staticStringOf(node);
  if (whole !== undefined) {
    found.push(whole);
    return found;
  }
  if (node.type === "TemplateLiteral") {
    for (const quasi of node.quasis) found.push(quasi.value.cooked ?? "");
    for (const expression of node.expressions) {
      literalStrings(expression, found, resolver);
    }
    return found;
  }
  const selected = selectedByLiteralCondition(node);
  if (selected) return literalStrings(selected, found, resolver);
  if (node.type === "ObjectExpression") {
    for (const property of node.properties) {
      const named = classMapEntry(property, resolver);
      if (named !== undefined) found.push(named);
    }
    return found;
  }
  for (const child of resolver.childrenOf(node)) {
    literalStrings(child, found, resolver);
  }
  return found;
}

/**
 * The class one class-map entry applies, if it can apply one. The KEY is the
 * class and the VALUE is the condition, so a key switched off applies
 * nothing, and a value is never a class.
 */
function classMapEntry(property, resolver) {
  if (property.type !== "Property") return undefined;
  // `cn({ rounded })` is `{ rounded: rounded }` to clsx.
  if (property.shorthand) {
    return staticTruthiness(property.value, resolver) === false
      ? undefined
      : property.key.name;
  }
  if (property.kind !== "init" || property.method) return undefined;
  if (staticTruthiness(property.value, resolver) === false) return undefined;
  return propertyNameOf(property);
}

/**
 * The property a key names, when it is written as a constant: an identifier,
 * a quoted name, or a computed key that is statically a string.
 */
function propertyNameOf(property, resolver) {
  const key = property.key;
  if (property.computed) return staticKeyOf(key, resolver);
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
}

/**
 * The property a computed key names, when that is decidable without running
 * it: a literal, or a `const` holding one, followed from where each binding is
 * written. `seen` holds declarations, so an alias chain that crosses two
 * bindings of one spelling is not mistaken for a cycle.
 *
 * KNOWN LIMIT: a reassignable key escapes. For a KEY, undecidable means the
 * property is unknown, and defaulting to "owned" would report every computed
 * key in the repository.
 */
function staticKeyOf(expression, resolver, seen = new Set()) {
  const value = withoutTypeWrappers(expression);
  const text = literalText(value);
  if (text !== undefined) return text;
  if (value.type === "Identifier" && resolver) {
    const declaration = resolver.declarationOf(value);
    if (!declaration || seen.has(declaration.start)) return undefined;
    seen.add(declaration.start);
    const bound = resolver.valueOf(value);
    if (bound) return staticKeyOf(bound, resolver, seen);
  }
  return undefined;
}

/**
 * The string a value is written as, when it is written as one. `"border-b-" +
 * "0"` is ONE class at runtime, so the concatenation is performed here.
 */
function staticStringOf(expression, resolver, seen = new Set()) {
  const inner = withoutTypeWrappers(expression);
  const text = literalText(inner);
  if (text !== undefined) return text;
  if (inner.type === "BinaryExpression" && inner.operator === "+") {
    const left = staticStringOf(inner.left, resolver, seen);
    const right = staticStringOf(inner.right, resolver, seen);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }
  // A name holding the value is the same value: `const noImage = "none"`.
  if (!resolver || inner.type !== "Identifier") return undefined;
  const declaration = resolver.declarationOf(inner);
  if (!declaration || seen.has(declaration.start)) return undefined;
  seen.add(declaration.start);
  const bound = resolver.valueOf(inner);
  return bound ? staticStringOf(bound, resolver, seen) : undefined;
}

/**
 * What a value is worth in a boolean test, when that is decidable;
 * `undefined` keeps the write it guards in play.
 */
function staticTruthiness(value, resolver) {
  const inner = withoutTypeWrappers(value);
  if (inner.type === "ObjectExpression" || inner.type === "ArrayExpression") {
    return true;
  }
  const text = literalText(inner);
  if (text !== undefined) return text.length > 0;
  if (inner.type === "Literal" && typeof inner.value === "number") {
    return inner.value !== 0;
  }
  // `undefined` is falsy to clsx and is a NAME, not a keyword: only the
  // unshadowed global is decided. Borrowed from `isDefinitelyNothing` for this
  // one case only, since `true` paints no style yet applies a class.
  if (
    resolver &&
    inner.type === "Identifier" &&
    inner.name === "undefined" &&
    !resolver.declarationOf(inner)
  ) {
    return false;
  }
  if (isBooleanLiteral(inner)) return inner.value;
  if (isNullLiteral(inner) || isVoid(inner)) return false;
  return undefined;
}

/**
 * Whether a value is certainly neither `null` nor `undefined`. Narrow on
 * purpose: answering "yes" removes a value from consideration.
 */
function isDefinitelyPresent(value) {
  const inner = withoutTypeWrappers(value);
  return (
    inner.type === "ObjectExpression" ||
    inner.type === "ArrayExpression" ||
    literalText(inner) !== undefined ||
    (inner.type === "Literal" && typeof inner.value === "number") ||
    isBooleanLiteral(inner)
  );
}

/**
 * Whether a value is WRITTEN as nothing React emits a declaration for: the
 * global `undefined`, `null`, `void`, a boolean, or the empty string (each
 * verified with `renderToStaticMarkup`, which emits no `style` attribute for
 * any of them). Not "could be nullish at runtime": a variable that holds
 * `undefined` now holds a colour on the next render.
 */
function isDefinitelyNothing(initializer, resolver) {
  const value = withoutTypeWrappers(initializer);
  if (value.type === "Identifier") {
    return value.name === "undefined" && !resolver.declarationOf(value);
  }
  const text = literalText(value);
  if (text !== undefined) return text === "";
  return isBooleanLiteral(value) || isNullLiteral(value) || isVoid(value);
}

/**
 * Whether React emits a declaration for this value, following a `const` to
 * what it holds so `{ borderBottomColor: empty }` and `{ borderBottomColor }`
 * read alike. Anything undecidable counts as emitting: the reporting side.
 */
function emitsValue(value, resolver, seen = new Set()) {
  const inner = withoutTypeWrappers(value);
  if (isDefinitelyNothing(inner, resolver)) return false;
  if (inner.type === "Identifier") {
    const declaration = resolver.declarationOf(inner);
    if (!declaration || seen.has(declaration.start)) return true;
    seen.add(declaration.start);
    const bound = resolver.valueOf(inner);
    if (bound) return emitsValue(bound, resolver, new Set(seen));
  }
  return true;
}

/**
 * What an object literal declares once it is built, as one map per shape the
 * element can render: a spread whose source is chosen at runtime produces
 * different objects on different renders, and any one declaring an owned
 * property is a violation. A later key replaces an earlier one, so
 * `{ ...inherited, borderBottomColor: undefined }` clears what it spread.
 *
 * `onPath` is the ACTIVE recursion path, so a source spread twice is read
 * twice. `unreadable` is set when a spread source cannot be read, which leaves
 * the object only partly known.
 */
function declaredProperties(object, resolver, onPath, unreadable) {
  if (onPath.has(object)) return [new Map()];
  onPath.add(object);
  let variants = [new Map()];
  const setOnEach = (name, state) => {
    for (const variant of variants) variant.set(name, state);
  };
  for (const property of object.properties) {
    if (property.type !== "SpreadElement") {
      const declared = declaredProperty(property, resolver);
      if (declared) setOnEach(...declared);
      continue;
    }
    const spread = resolver.objectsFrom(property.argument);
    if (!spread.readable) unreadable.value = true;
    const branches = spread.objects.flatMap(source =>
      declaredProperties(source, resolver, onPath, unreadable)
    );
    // On the branch that supplies nothing, every property set before this
    // spread survives untouched.
    if (spread.absent) branches.push(new Map());
    if (branches.length === 0) continue;
    variants = variants.flatMap(base =>
      branches.map(branch => new Map([...base, ...branch]))
    );
  }
  onPath.delete(object);
  return variants;
}

/** What one object entry declares, as `[name, state]`, or undefined. */
function declaredProperty(property, resolver) {
  // A shorthand's value lives in its binding, which `emitsValue` follows.
  if (property.shorthand) {
    const emits = emitsValue(property.value, resolver);
    return [property.key.name, { emits, value: undefined }];
  }
  const name = propertyNameOf(property, resolver);
  if (!name) return undefined;
  if (property.kind === "init" && !property.method) {
    return [
      name,
      {
        emits: emitsValue(property.value, resolver),
        value: staticStringOf(property.value, resolver),
      },
    ];
  }
  // React reads a getter and emits whatever it returns, which is not
  // decidable here, so it counts as emitting.
  return property.kind === "get"
    ? [name, { emits: true, value: undefined }]
    : undefined;
}

/** An owned inline property this object still declares once it is complete. */
function ownedStyleProperty(slot, object, resolver, unreadable) {
  for (const variant of declaredProperties(
    object,
    resolver,
    new Set(),
    unreadable
  )) {
    for (const [name, state] of variant) {
      if (state.emits && ownsStyleProperty(slot, name, state.value)) {
        return name;
      }
    }
  }
  return undefined;
}

/**
 * The attributes a JSX spread carries, when they can be read: one list per
 * object the spread can resolve to, kept apart because the objects are
 * ALTERNATIVES. `readable` false means it may carry anything, including the
 * two props this contract owns.
 */
function spreadAttributes(attribute, resolver) {
  const { objects, readable } = resolver.objectsFrom(attribute.argument);
  if (!readable) return { alternatives: [], readable: false };
  const alternatives = [];
  for (const object of objects) {
    const attributes = [];
    for (const property of object.properties) {
      const attribute = spreadAttribute(property, resolver);
      if (attribute === UNREAD) return { alternatives: [], readable: false };
      if (attribute) attributes.push(attribute);
    }
    alternatives.push(attributes);
  }
  return { alternatives, readable: true };
}

/** A spread entry whose contents are unknown rather than absent. */
const UNREAD = Symbol("unread");

/**
 * One spread entry as `{ name, value }`, undefined for an entry that cannot
 * carry an owned prop, or UNREAD.
 */
function spreadAttribute(property, resolver) {
  // A shorthand names its key, which is all this needs when the key is not an
  // owned prop: `{...{ value }}` is the ordinary way to pass Radix's `value`.
  // An owned prop carried that way hides its value.
  if (property.type === "Property" && property.shorthand) {
    return OWNED_PROPS.includes(property.key.name) ? UNREAD : undefined;
  }
  // A nested spread, a method or an accessor: unknown, not absent.
  if (
    property.type !== "Property" ||
    property.kind !== "init" ||
    property.method
  ) {
    return UNREAD;
  }
  const named = propertyNameOf(property, resolver);
  return named === undefined ? UNREAD : { name: named, value: property.value };
}

/**
 * What a `require(...)` initializer names: the module, and the export selected
 * from it when one is. Three spellings: `const UI = require("x")`,
 * `const { TabsTrigger } = require("x")` and
 * `const TabsTrigger = require("x").TabsTrigger`, one member deep only.
 */
function requiredFrom(initializer) {
  const value = withoutTypeWrappers(initializer);
  if (
    value.type === "MemberExpression" &&
    !value.computed &&
    value.property.type === "Identifier"
  ) {
    const required = requiredFrom(value.object);
    if (!required || required.exported !== undefined) return undefined;
    return { module: required.module, exported: value.property.name };
  }
  if (
    value.type === "CallExpression" &&
    value.callee.type === "Identifier" &&
    value.callee.name === "require" &&
    value.arguments.length === 1
  ) {
    const first = value.arguments[0];
    if (first.type === "Literal" && typeof first.value === "string") {
      return { module: first.value };
    }
  }
  return undefined;
}

/**
 * Which bindings in this file render an owned component, and under which
 * exported name.
 *
 * Resolved from the IMPORT and then by BINDING, never by spelling. A name is a
 * claim made by whoever wrote the file: a local component may reuse an
 * imported name and is entitled to its own appearance, and a local object may
 * shadow a namespace import. `owning` and `owningNamespaces` hold the
 * declaring identifiers; the spelling maps answer only for a name no binding
 * in this file declares.
 */
function ownershipIn(program, resolver, importer) {
  const state = {
    exportedNameOf: new Map(),
    namespaces: new Set(),
    owning: new Map(),
    owningNamespaces: new Set(),
  };
  const visit = node => {
    if (node.type === "ImportDeclaration") recordImport(node, importer, state);
    if (node.type === "VariableDeclarator" && node.init) {
      recordRequire(node, importer, state);
      recordAlias(node, state, resolver);
    }
    for (const child of resolver.childrenOf(node)) visit(child);
  };
  visit(program);
  return state;
}

function own(state, identifier, exported) {
  state.exportedNameOf.set(identifier.name, exported);
  state.owning.set(identifier.start, exported);
}

function ownNamespace(state, identifier) {
  state.namespaces.add(identifier.name);
  state.owningNamespaces.add(identifier.start);
}

/** `const { TabsTrigger: Trigger } = source` names the component again. */
function ownDestructured(state, pattern) {
  for (const element of pattern.properties) {
    if (element.type !== "Property" || element.computed) continue;
    const local =
      element.value.type === "AssignmentPattern"
        ? element.value.left
        : element.value;
    if (
      element.key.type === "Identifier" &&
      local.type === "Identifier" &&
      OWNED_EXPORTS.includes(element.key.name)
    ) {
      own(state, local, element.key.name);
    }
  }
}

/** A named or namespace import of a module that reaches the primitive. */
function recordImport(node, importer, state) {
  if (!reachesThePrimitive(node.source.value, importer)) return;
  for (const specifier of node.specifiers) {
    if (specifier.type === "ImportNamespaceSpecifier") {
      ownNamespace(state, specifier.local);
    }
    if (specifier.type !== "ImportSpecifier") continue;
    const exported =
      specifier.imported.type === "Identifier"
        ? specifier.imported.name
        : specifier.imported.value;
    if (OWNED_EXPORTS.includes(exported)) own(state, specifier.local, exported);
  }
}

/** `require` is the same two imports in JavaScript's other spelling. */
function recordRequire(node, importer, state) {
  const required = requiredFrom(node.init);
  if (!required || !reachesThePrimitive(required.module, importer)) return;
  if (required.exported === undefined) {
    if (node.id.type === "Identifier") ownNamespace(state, node.id);
    if (node.id.type === "ObjectPattern") ownDestructured(state, node.id);
    return;
  }
  if (
    node.id.type === "Identifier" &&
    OWNED_EXPORTS.includes(required.exported)
  ) {
    own(state, node.id, required.exported);
  }
}

/**
 * An alias carries ownership forward: `const Trigger = TabsTrigger`,
 * `const Trigger = UI.TabsTrigger`, `const { TabsTrigger: T } = UI`.
 */
function recordAlias(node, state, resolver) {
  const exported = ownedReference(node.init, state, resolver);
  if (exported && node.id.type === "Identifier") own(state, node.id, exported);
  if (
    node.id.type === "ObjectPattern" &&
    node.init.type === "Identifier" &&
    isOwnedNamespace(node.init, state, resolver)
  ) {
    ownDestructured(state, node.id);
  }
}

/** Whether a name refers to a namespace that reaches the primitive. */
function isOwnedNamespace(identifier, state, resolver) {
  const declaration = resolver.declarationOf(identifier);
  if (declaration) return state.owningNamespaces.has(declaration.start);
  return state.namespaces.has(identifier.name);
}

/**
 * The exported name an expression or a JSX tag refers to, when it is an owned
 * component: a name bound to one, or a member of an owned namespace. One
 * implementation for both, so an alias and a tag cannot disagree about what a
 * name means in one file.
 */
function ownedReference(node, state, resolver) {
  if (node.type === "Identifier" || node.type === "JSXIdentifier") {
    const declaration = resolver.declarationOf(node);
    if (!declaration) return state.exportedNameOf.get(node.name);
    // A resolved declaration answers on its own; falling back to the spelling
    // would restore exactly the shadowing this replaces.
    return state.owning.get(declaration.start);
  }
  const member =
    (node.type === "MemberExpression" && !node.computed) ||
    node.type === "JSXMemberExpression";
  if (
    member &&
    (node.object.type === "Identifier" ||
      node.object.type === "JSXIdentifier") &&
    OWNED_EXPORTS.includes(node.property.name) &&
    isOwnedNamespace(node.object, state, resolver)
  ) {
    return node.property.name;
  }
  return undefined;
}

/** The objects a `style` attribute can resolve to. */
function styleObjectsFor(attribute, resolver) {
  const value = attribute.value;
  // `style="x"` is not an object React can read, nor this contract's business.
  if (value && value.type !== "JSXExpressionContainer") {
    return { objects: [], readable: true };
  }
  const expression =
    value?.expression.type === "JSXEmptyExpression"
      ? undefined
      : value?.expression;
  return resolver.objectsFrom(expression);
}

/**
 * The violations one owned element carries, as `{ node, why }`.
 *
 * JSX props are one object built left to right, so a later attribute REPLACES
 * an earlier one of the same name: `{...props} className="x"` renders `x`
 * however `props` was written. The surviving source of each owned prop is
 * resolved first, as a LIST, since a spread between object literals supplies
 * alternatives rather than a sequence; only those are read.
 */
function violationsAt(element, exported, resolver) {
  const { effective, unread } = ownedPropSources(element, resolver);
  const found = [];
  // An unreadable spread may carry either owned prop, so it stops mattering
  // only once BOTH are written again after it.
  for (const spread of unread) {
    if (spread.awaiting.size > 0) {
      found.push({ node: spread.at, why: UNREADABLE_SPREAD });
    }
  }
  // Reported once per line and sentence: two alternatives of one spread sit
  // on the same line and say the same thing.
  const said = new Set();
  const report = (node, why) => {
    const key = `${node.loc.start.line}:${why}`;
    if (said.has(key)) return;
    said.add(key);
    found.push({ node, why });
  };
  for (const source of effective.get("className") ?? []) {
    const why = classNameViolation(source, exported, resolver);
    if (why) report(source.at, why);
  }
  for (const source of effective.get("style") ?? []) {
    const why = styleViolation(source, exported, resolver);
    if (why) report(source.at, why);
  }
  return found;
}

/**
 * Where each owned prop's value comes from once the attribute list is read,
 * and the spreads that could not be read and may still carry one.
 */
function ownedPropSources(element, resolver) {
  const effective = new Map();
  const unread = [];
  const take = (name, sources) => {
    effective.set(name, sources);
    for (const spread of unread) spread.awaiting.delete(name);
  };
  for (const attribute of element.attributes) {
    if (attribute.type !== "JSXSpreadAttribute") {
      const name =
        attribute.name.type === "JSXIdentifier" ? attribute.name.name : "";
      if (OWNED_PROPS.includes(name)) {
        take(name, [
          { kind: "attribute", at: attribute, value: attribute.value },
        ]);
      }
      continue;
    }
    const spread = spreadAttributes(attribute, resolver);
    if (spread.readable)
      takeSpread(attribute, spread.alternatives, effective, take);
    else unread.push({ at: attribute, awaiting: new Set(OWNED_PROPS) });
  }
  return { effective, unread };
}

/**
 * The owned props a readable spread supplies. Only a spread EVERY alternative
 * supplies replaces what came before; a branch omitting the prop renders the
 * earlier value, which stays in play.
 */
function takeSpread(attribute, alternatives, effective, take) {
  for (const name of OWNED_PROPS) {
    const carried = carriedBy(alternatives, name, attribute);
    if (carried.length === 0) continue;
    take(
      name,
      carried.length === alternatives.length
        ? carried
        : [...(effective.get(name) ?? []), ...carried]
    );
  }
}

/** The values a spread's alternatives carry for one prop, as sources. */
function carriedBy(alternatives, name, at) {
  return alternatives
    .map(alternative => alternative.find(a => a.name === name))
    .filter(found => found !== undefined)
    .map(found => ({ kind: "spread", at, value: found.value }));
}

/** Why a `className` source takes over owned appearance, if it does. */
function classNameViolation(source, exported, resolver) {
  if (!source.value) return undefined;
  const displaced = displacedBy(
    exported,
    literalStrings(source.value, [], resolver).join(" ")
  );
  if (displaced.length === 0) return undefined;
  const verb = source.kind === "spread" ? "spreads" : "displaces";
  return `${verb} ${displaced.join(", ")} — the primitive owns that appearance, and every surface should change with it`;
}

/** Why a `style` source takes over owned appearance, if it does. */
function styleViolation(source, exported, resolver) {
  const verb = source.kind === "spread" ? "spreads" : "sets";
  const { objects, readable } =
    source.kind === "attribute"
      ? styleObjectsFor(source.at, resolver)
      : resolver.objectsFrom(source.value);
  // An expression the scan cannot read is reported for BEING unreadable, so
  // "no violation" and "could not tell" never look the same from outside.
  if (!readable) {
    return `${verb} an inline style this scan cannot read — write it as a literal object, or move it to \`className\` so the primitive keeps its appearance`;
  }
  const spreadUnreadable = { value: false };
  const property = objects
    .map(object =>
      ownedStyleProperty(exported, object, resolver, spreadUnreadable)
    )
    .find(Boolean);
  if (property) {
    return `${verb} \`${property}\` inline, which beats every class the primitive applies`;
  }
  return spreadUnreadable.value ? UNREADABLE_STYLE_SPREAD : undefined;
}

export const tabIndicator = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const sourceCode = context.sourceCode;
    // Most files never mention these components, and the ownership pass
    // walks the whole tree.
    if (!OWNED_EXPORTS.some(tag => sourceCode.text.includes(tag))) return {};
    const resolver = resolverFor(sourceCode);
    let state;
    return {
      // The whole file first, so an alias declared below a use, as a hoisted
      // function allows, still owns the tag.
      Program(program) {
        state = ownershipIn(program, resolver, resolve(REPO, context.filename));
      },
      JSXOpeningElement(node) {
        const exported = ownedReference(node.name, state, resolver);
        if (!exported) return;
        for (const { node: at, why } of violationsAt(
          node,
          exported,
          resolver
        )) {
          context.report({ node: at, message: why });
        }
      },
    };
  },
};
