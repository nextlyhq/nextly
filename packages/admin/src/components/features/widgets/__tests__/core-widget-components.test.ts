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
