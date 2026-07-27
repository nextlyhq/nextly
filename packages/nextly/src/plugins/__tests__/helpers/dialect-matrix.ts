/**
 * Run one suite body against every dialect this machine can reach.
 *
 * Written because the alternative kept hiding things. A suite that covers a
 * second dialect by hand needs its own `describe.skipIf`, its own admin pool,
 * and its own database lifecycle — so most suites did not bother, and the ones
 * that did were skipped silently whenever the URL was unset. That is how
 * `nextly migrate` came to fail on its second run against MySQL with a
 * regression test for exactly that failure class sitting in the repo.
 *
 * A dialect with no server configured is declared with `describe.skip` rather
 * than dropped, so the report says it was skipped instead of saying nothing.
 */
import { describe } from "vitest";

import { getAvailableTestDialects, type TestDialect } from "../../test-nextly";

/** Every dialect, in the order the matrix reports them. */
const ALL_DIALECTS: TestDialect[] = ["sqlite", "postgresql", "mysql"];

/**
 * Declare `body` once per dialect, suffixing the title with the dialect name.
 *
 * The body receives the dialect so it can pass it to `createTestNextly` and,
 * where behaviour legitimately differs, branch on it.
 */
export function describeEachDialect(
  title: string,
  body: (dialect: TestDialect) => void
): void {
  const available = new Set(getAvailableTestDialects());
  for (const dialect of ALL_DIALECTS) {
    const name = `${title} (${dialect})`;
    if (available.has(dialect)) {
      describe(name, () => body(dialect));
    } else {
      describe.skip(name, () => body(dialect));
    }
  }
}
