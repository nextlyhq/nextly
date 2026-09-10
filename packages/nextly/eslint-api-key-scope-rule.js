/**
 * The guard against building an API-key scope by hand.
 *
 * Exported as a selector rather than as its own config block, and mounted inside
 * `eslint-bare-error-rule.js`'s single `no-restricted-syntax` entry. ESLint's flat config merges
 * that rule by NAME, so a second block declaring it REPLACES the first instead of adding to it —
 * mounted separately, this guard silently took the bare-Error selector out of service, and
 * `bare-error-allowlist.test` is what caught it.
 *
 * ## Why a lint rule and not the source scan this replaces
 *
 * `AuthenticatedScope` carries the caller's grants twice over — `permissions` in the spelling the
 * database stores, and the rows every rule-facing spelling is DERIVED from. A literal naming only
 * `actorType` and `permissions` compiles clean, because everything else on the type is optional,
 * and produces a scope that passes the coarse grant check and then denies every documented
 * `({ permissions }) => permissions.includes("posts:read")` behind it.
 *
 * Nine such literals existed across the request paths. The first guard against them was a regex
 * over the source, and it was incomplete in three ways a reviewer found by reading it: a literal
 * writing `permissions` before `actorType` evaded it, so did the shorthand `{ actorType,
 * permissions }`, and so did any nested object between the two keys. A guard that certifies "this
 * is the only place a scope is constructed" while three spellings walk past it is worse than no
 * guard, because the next reader takes the green as coverage.
 *
 * A selector reads the AST, so all three are the same node shape to it: `:has()` is
 * order-independent, a shorthand property still carries `key.name`, and a nested object is a
 * different `ObjectExpression` that this selector simply does not match.
 *
 * ## What it deliberately does not reach
 *
 * An object assembled across statements — `const s = {}; s.actorType = "apiKey";` — is not this
 * node shape and is not matched. That is the same limit `eslint-bare-error-rule.js` documents for
 * a throw whose operand was built elsewhere, and it is a real gap rather than a nicety: closing it
 * needs type information about what the object is eventually used AS, which no selector has.
 * Nothing in this package builds one that way today, and the honest description of this rule is
 * that it refuses the shape every real instance took.
 */

/**
 * An object literal declaring itself an API-key scope.
 *
 * Both keys, in either order, shorthand or not. `actorType` alone would reject the webhook
 * outbox row and its Drizzle column definitions, which carry that field and are not scopes;
 * `permissions` alone would reject half the access-control context objects in the package. The
 * PAIR is what a scope is.
 */
export const API_KEY_SCOPE_SELECTOR =
  'ObjectExpression:has(> Property[key.name="actorType"]):has(> Property[key.name="permissions"])';

export const API_KEY_SCOPE_MESSAGE =
  "Build an API-key scope with `apiKeyScopeFrom(caller)`, or narrow one you hold with " +
  "`narrowScope(scope, keep)`. A hand-written literal is short by whatever it does not name, " +
  "and the fields it omits — the caller's roles, and the permission rows every rule-facing " +
  "spelling is derived from — are exactly the ones each gate behind the coarse check reads. Such " +
  "a scope passes the grant check and then denies every documented permission predicate.";

/**
 * Files where the literal IS the definition, or where there is nothing better to build from.
 *
 * `authenticated-scope.ts` constructs the canonical shape; a rule that rejected it would leave no
 * way to make one at all.
 *
 * `dispatcher/helpers/authenticated-actor.ts` rebuilds a scope from route params, which carry
 * strings — so it has no permission rows for `apiKeyScopeFrom` to take, and its `actorType` is a
 * variable that may be `user` or `system`, neither of which that constructor produces. Nothing
 * reads its answer while a scope is pinned for the request, which is every request arriving
 * through the route handler.
 */
export const API_KEY_SCOPE_ALLOWLIST_PATHS = [
  "src/auth/authenticated-scope.ts",
  "src/dispatcher/helpers/authenticated-actor.ts",
];
