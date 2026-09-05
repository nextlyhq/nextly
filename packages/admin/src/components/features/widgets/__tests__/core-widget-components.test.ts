/**
 * Every `core#` path a core widget NAMES is a path this package REGISTERS.
 *
 * 🔴 The two halves live in packages that do not depend on each other. A core
 * card declares its body as a string in `packages/nextly`
 * (`core-widgets.ts`), and the component behind that string is bound here
 * (`core-components.ts`) -- so no type, no import and no build step can notice
 * that one names something the other never registered. That is the same
 * two-halves-of-one-name hazard `system-source-ids.ts` exists to manage for a
 * card's `query.source`, and until this file there was nothing holding the
 * component half together at all.
 *
 * The failure it prevents is quiet and partial: `PluginSlot` resolves an
 * unregistered path to its unresolved fallback, so the dashboard stands and one
 * card draws a placeholder -- for every reader, with no error anywhere, and
 * only until someone happens to look at that card. A rename on either side is
 * enough to cause it.
 *
 * ## Why one side is imported and the other is read as TEXT
 *
 * Core's definitions are imported, so the paths compared below are the values
 * the cards actually carry. This test imports that source module directly, as
 * `hooks/__tests__/system-resources-parity.test.ts` does and for the same
 * reason: the admin tsconfig maps only the bare `nextly` specifier, so a
 * `nextly/*` subpath would resolve to built output and make this test require a
 * build.
 *
 * `core-components.ts` cannot be imported at all. It sits in a PRE-EXISTING
 * import cycle -- it imports `TeamSummary` and `CollectionQuickLinks`, which
 * reach the `@admin/hooks/queries` barrel, which reaches
 * `pages/dashboard/index.tsx`, which imports `WidgetGrid`, which calls
 * `registerCoreWidgetComponents()` at module scope and so re-enters the module
 * being evaluated. Importing it from a test throws `Cannot access ... before
 * initialization` before a single case runs. Verified as pre-existing rather
 * than assumed: the same one-line probe fails identically on an unmodified
 * `core-components.ts`.
 *
 * So this reads the registration calls out of the file's source. That is a
 * weaker instrument and the weakness is worth naming: it proves the two LISTS
 * agree, not that each path resolves to a component at runtime. It is the
 * drift that actually happens -- a card renamed on one side of a package
 * boundary -- and it is checkable without depending on the cycle. When the
 * cycle is broken, replace the scan with `hasComponent` and delete this note.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { CORE_WIDGETS } from "../../../../../../nextly/src/domains/widgets/core-widgets";
import { holdsWidgetPermission } from "../../../../../../nextly/src/domains/widgets/definition";
import { LIST_RENDERED_FIELDS } from "../archetypes/list";
import { holdsWidgetGate } from "../resolve-widgets";

/**
 * Resolved from this file rather than from `process.cwd()`, so the test reads
 * the same source whether vitest was invoked from the package or the root.
 */
const CORE_COMPONENTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../core-components.ts"
);

/**
 * The paths core's cards NAME, read off the definitions rather than matched out
 * of their source text.
 *
 * A `custom` card is the only kind that names one; the archetype-drawn cards
 * carry a `query` instead and are correctly absent here.
 */
const named = CORE_WIDGETS.map(widget => widget.component).filter(
  (path): path is string => typeof path === "string"
);

/**
 * The paths this package REGISTERS.
 *
 * Matched on the call rather than on any `core#` string in the file, so a path
 * mentioned in a comment is not mistaken for a registration -- the difference
 * between the two lists is the whole signal, and a prose mention appearing in
 * one of them would be a false agreement.
 */
const registered = [
  ...readFileSync(CORE_COMPONENTS, "utf8").matchAll(
    /registerCoreComponent\(\s*"(core#[A-Za-z0-9_]+)"/g
  ),
].map(match => match[1] as string);

describe("core widget component paths resolve", () => {
  /*
   * The populations, asserted before any claim that they agree. Both sides can
   * come back empty for reasons that have nothing to do with drift -- a renamed
   * field on one side, a reformatted call the pattern no longer matches on the
   * other -- and two empty lists are EQUAL, so the comparison below would pass
   * having checked nothing.
   *
   * Membership rather than a count: a list that dropped one card and gained
   * another matches any total worth comparing against, and the dropped one is
   * exactly the card that would then go unchecked.
   */
  it("reads a non-empty set of named paths from core", () => {
    expect(named).toEqual(
      expect.arrayContaining(["core#TeamSummary", "core#RecentActivity"])
    );
  });

  it("reads a non-empty set of registrations from the admin", () => {
    expect(registered).toEqual(
      expect.arrayContaining(["core#TeamSummary", "core#RecentActivity"])
    );
  });

  /*
   * Both directions in one assertion, deliberately. A path named and not
   * registered is a card drawing the unresolved fallback; a path registered and
   * not named is dead code, or the leftover of a card that was removed. Neither
   * is acceptable and the message names whichever it is.
   */
  it("names exactly what it registers", () => {
    expect([...registered].sort()).toEqual([...named].sort());
  });
});

/**
 * A list card asking for fields its renderer will not draw.
 *
 * 🔴 This is the OTHER cross-package silence, and it fails more quietly than an
 * unregistered component: the card renders, correctly, showing fewer columns
 * than its author selected. Nothing throws, nothing logs, and the row looks
 * deliberate -- so it survives review by anyone who does not happen to know the
 * renderer takes two. Both shipped list cards were wrong this way, and one of
 * them dropped the timestamp from a card whose description promises "newest
 * first".
 *
 * The bound is IMPORTED from the renderer rather than written here, so drawing a
 * third field is a one-line change in one file rather than a number to find in
 * two.
 */
describe("core list cards select only fields that get drawn", () => {
  const listCards = CORE_WIDGETS.filter(
    widget => widget.archetype === "list"
  ).map(widget => [widget.id, widget.query?.select ?? []] as const);

  // The population: `filter` returning nothing would make `it.each` register no
  // cases at all, and a describe block with no tests reports as passing.
  it("finds the list cards to check", () => {
    expect(listCards.map(([id]) => id)).toEqual(
      expect.arrayContaining(["core/recently-edited", "core/upcoming-releases"])
    );
  });

  it.each(listCards)("%s selects at most what is drawn", (_id, select) => {
    expect(select.length).toBeLessThanOrEqual(LIST_RENDERED_FIELDS);
  });
});

/**
 * The admin's permission gate against core's.
 *
 * 🔴 `resolveWidgets` runs in the BROWSER and cannot import the server's
 * `holdsWidgetPermission`, which lives in a package the browser bundle must
 * not pull in wholesale -- the same constraint that makes `useCurrentUserPermissions` keep its
 * own copy of core's system resources. So the any-of rule is written twice, and
 * this is what makes the second copy checkable rather than merely intended.
 *
 * The comparison is on the DECISION, not the shape: for each declaration, what
 * core's reader says the gate names is used to answer the admin's
 * `hasPermission`, and the two verdicts must agree. A test asserting both
 * functions "look the same" would pass on two implementations that diverge on
 * the inputs nobody wrote down -- an empty array, a member that is not a slug.
 */
describe("the admin's widget gate agrees with core's", () => {
  const held = new Set(["read-content-releases"]);
  const hasPermission = (slug: string) => held.has(slug);

  /*
   * Every case is one both copies must answer identically, and the malformed
   * ones are the point: each has an obvious wrong reading that fails OPEN, and
   * core's copy had to be corrected out of exactly that once already.
   */
  const cases: readonly (readonly [string, unknown, boolean])[] = [
    ["no gate at all", undefined, true],
    ["a held slug", "read-content-releases", true],
    ["a slug not held", "read-posts", false],
    ["any-of, first held", ["read-content-releases", "create-x"], true],
    ["any-of, last held", ["create-x", "read-content-releases"], true],
    ["any-of, none held", ["create-x", "publish-x"], false],
    ["an empty string", "", false],
    ["an empty array", [], false],
    ["an array carrying a non-slug", ["read-content-releases", 7], false],
    ["an object", { read: true }, false],
  ];

  /*
   * Core's side is the REAL `holdsWidgetPermission`, not a restatement of it
   * here. A test that recomputed the rule would be a third copy, and it would
   * agree with whichever of the two it was written from while the other drifted.
   *
   * Its verdict map is what `permissionVerdicts` would have resolved: a decision
   * per slug, with an unheld slug present and `false` rather than missing, so a
   * gate naming an unknown slug is exercised too.
   */
  const verdicts = new Map(
    [...held, "read-posts", "create-x", "publish-x"].map(slug => [
      slug,
      held.has(slug),
    ])
  );

  it.each(cases)("%s", (_label, gate, expected) => {
    expect(holdsWidgetPermission(gate, verdicts), "core's").toBe(expected);
    expect(holdsWidgetGate(gate as never, hasPermission), "the admin's").toBe(
      expected
    );
  });
});
