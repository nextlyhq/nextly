/**
 * Whether the wire shapes the library routes answer are DERIVED from the shapes
 * the panel reads, rather than described beside them.
 *
 * A type test rather than a runtime one, because the property is not
 * observable at runtime: a wire type declared on its own with the same five
 * fields is assignable to the panel's type — every extra field on the panel's
 * side is optional — so a value test passes whether or not the two are one.
 * What the standalone declaration loses is every field it did not repeat: the
 * panel's type gains a search term or a usage count, the wire never carries it,
 * and nothing fails. Measured before this file existed: `keywords` and
 * `usedOn` were on the panel's side and not the wire's, and the code compiled.
 *
 * So the assertion is on KEYS. Every key the panel type has must be a key of
 * the wire type — which a declaration that `extends` it satisfies by
 * construction and a copy satisfies only until either side moves.
 *
 * This package's `tsconfig.tests.json` reads `*.test-d.ts` and excludes
 * `*.test.ts(x)`, so this is the one kind of file in which a type assertion is
 * evaluated at all.
 *
 * @module library-contract.test-d
 */
import type { SavedComponent, SavedPattern } from "@nextlyhq/builder";

import type { LibraryComponent, LibraryPattern } from "./library-contract";

/**
 * Written as an assignment the checker EVALUATES, in the idiom this package's
 * other type tests use: `@ts-expect-error` would suppress whatever error
 * landed on the following line, including none at all once the property
 * stopped holding.
 */
const wireComponentCarriesEveryPanelKey: keyof SavedComponent extends keyof LibraryComponent
  ? true
  : false = true;

const wirePatternCarriesEveryPanelKey: keyof SavedPattern extends keyof LibraryPattern
  ? true
  : false = true;

/**
 * The controls, and both are load-bearing, because the assertion above is
 * vacuous from either side.
 *
 * `X extends Y ? true : false` is `true` whenever `X` is `never`, and `keyof`
 * of a type with no keys IS `never` — so a panel type that lost every field
 * would satisfy the assertions above whatever the wire carried. The left side
 * has to be shown to hold a key.
 */
const panelComponentHasKeys: "id" extends keyof SavedComponent ? true : false =
  true;

/**
 * And from the right: a wire type whose keys widened to `string` — an index
 * signature, say — has every key and the assertions above stay true while
 * promising nothing. A key the wire must NOT have has to come out false, or the
 * pattern certifies by never refusing.
 */
const wireComponentDoesNotCarryEveryKey: "granularity" extends keyof LibraryComponent
  ? true
  : false = false;

export {
  wireComponentCarriesEveryPanelKey,
  wirePatternCarriesEveryPanelKey,
  panelComponentHasKeys,
  wireComponentDoesNotCarryEveryKey,
};
