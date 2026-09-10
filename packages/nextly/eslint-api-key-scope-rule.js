/**
 * The guard against building an API-key scope by hand.
 *
 * Exported as a selector rather than as its own config block, and mounted inside
 * `eslint-bare-error-rule.js`'s `no-restricted-syntax` entry. ESLint's flat config merges that
 * rule by NAME, so a second block declaring it REPLACES the first rather than adding to it: two
 * blocks cannot each contribute a selector to the same file, and the one that loses is enforced
 * nowhere while both still read as mounted.
 *
 * ## Why a lint rule and not a scan over the source
 *
 * `AuthenticatedScope` carries the caller's grants twice over — `permissions` in the spelling the
 * database stores, and the rows every rule-facing spelling is DERIVED from. A literal naming only
 * `actorType` and `permissions` compiles clean, because everything else on the type is optional,
 * and produces a scope that passes the coarse grant check and then denies every documented
 * `({ permissions }) => permissions.includes("posts:read")` behind it.
 *
 * Nine such literals existed across the request paths. A regex over the source cannot refuse that
 * shape: `permissions` written before `actorType`, the shorthand `{ actorType, permissions }`, and
 * any nested object between the two keys each walk past a pattern written for one spelling. A
 * guard certifying "this is the only place a scope is constructed" while three spellings walk past
 * it is worse than no guard, because the next reader takes the green as coverage.
 *
 * A selector reads the AST, so all three are one node shape to it: `:has()` is order-independent,
 * a shorthand property still carries `key.name`, and a nested object is a different
 * `ObjectExpression` this selector does not match.
 *
 * ## A spread can supply either half of the pair, and the halves differ
 *
 * `{ actorType: "apiKey", ...caller }` IS matched. `actorType` names the object as a scope, and
 * whatever the spread carries is not what the constructor would have produced. Measured across
 * this package that costs nothing: no object here takes the shape.
 *
 * `{ ...scope, permissions }` is NOT matched, and cannot be. Nothing in the syntax separates it
 * from an ordinary overlay of a record that happens to hold a `permissions` field —
 * `route-handler/auth-handler.ts` merges the booted config exactly that way, and a selector wide
 * enough to catch the scope catches the config too, on a file that is doing nothing wrong.
 *
 * It is the more dangerous of the two shapes, because it keeps the ORIGINAL rows beside narrowed
 * slugs: the rule-facing spelling then still names grants that `permissions` has given up. So it
 * is refused where the disagreement decides an answer rather than where it is written —
 * `ruleFacingPermissions` reads the rows, and rejects a scope whose two halves do not agree.
 *
 * An object assembled across statements — `const s = {}; s.actorType = "apiKey";` — is not this
 * node shape either. That is the same limit `eslint-bare-error-rule.js` documents for a throw
 * whose operand was built elsewhere, and it is a real gap rather than a nicety: closing it needs
 * type information about what the object is eventually used AS, which no selector has.
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
  // The PAIR, in either order, whatever the values: this is what all nine
  // hand-built scopes looked like.
  'ObjectExpression:has(> Property[key.name="actorType"])' +
  ':has(> Property[key.name="permissions"]), ' +
  // Or the pair with the second half hidden behind a spread —
  // `{ actorType: "apiKey", ...auth }` — which the shape above cannot see.
  //
  // Narrowed to the LITERAL `"apiKey"` on purpose. `actorType` plus any spread
  // matched every object that merely carries a field of that name and spreads
  // anything, and an activity-log row does exactly that while being no kind of
  // scope. A guard that fires on correct code is the one people work around,
  // and the workarounds — renaming the field, disabling the rule — cost its
  // true positives too.
  'ObjectExpression:has(> Property[key.name="actorType"][value.value="apiKey"])' +
  ":has(> SpreadElement)";

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
 *
 * An entry here exempts a path from THIS selector only. `bareErrorConfig` mounts each selector on
 * its own file set for that reason: a shared `ignores` list would take the bare-`Error` guard off
 * these files too, on the strength of neither of them throwing one today.
 */
export const API_KEY_SCOPE_ALLOWLIST_PATHS = [
  "src/auth/authenticated-scope.ts",
  "src/dispatcher/helpers/authenticated-actor.ts",
];
