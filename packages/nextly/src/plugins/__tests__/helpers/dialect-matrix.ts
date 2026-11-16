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

import { getConfiguredTestDialects, type TestDialect } from "../../test-nextly";

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
  const available = new Set(getConfiguredTestDialects());
  for (const dialect of ALL_DIALECTS) {
    const name = `${title} (${dialect})`;
    if (available.has(dialect)) {
      describe(name, () => body(dialect));
    } else {
      describe.skip(name, () => body(dialect));
    }
  }
}

/** Where a suite's entities keep their translatable values. */
export interface StorageMode {
  /** How the mode reads in a suite's title. */
  name: string;
  /** Passed to `createTestNextly`: every translatable field kept per language from the start. */
  perLanguageStorage: boolean;
}

/**
 * The two storage layouts a suite whose behaviour must not depend on where translatable values
 * live runs under: as each entity keeps them today, and with every translatable field kept per
 * language (`experimental.perLanguageStorage`). For `describe.each` in a suite that already
 * declares its dialects itself.
 */
export const STORAGE_MODES: readonly StorageMode[] = [
  { name: "storage as declared", perLanguageStorage: false },
  { name: "per-language storage", perLanguageStorage: true },
];

/**
 * Declare `body` once per dialect and storage mode, suffixing the title with both.
 *
 * For a behaviour suite (entry and Single reads and writes, components, drafts, the Direct API and
 * REST), which must answer alike whichever layout holds its translatable values. A suite that
 * asserts the layout itself (columns, statement counts, migration files) declares one mode, and
 * covers per-language storage with cases of its own.
 */
export function describeEachDialectAndStorage(
  title: string,
  body: (dialect: TestDialect, storage: StorageMode) => void
): void {
  for (const storage of STORAGE_MODES) {
    describeEachDialect(`${title}, ${storage.name}`, dialect =>
      body(dialect, storage)
    );
  }
}
