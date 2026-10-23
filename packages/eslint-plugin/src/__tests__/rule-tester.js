import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

// `RuleTester` discovers its runner from globals. Vitest does not install any
// unless `globals: true` is set, so without this wiring the tester registers no
// cases and the suite reports "no tests" — a pass that ran nothing. Injecting
// vitest's functions keeps the config free of globals while still letting each
// case appear individually in the report.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/**
 * A tester configured for the JSX + modern ESM the admin and plugins are written in.
 *
 * Oxlint's tester rather than ESLint's: the repository lints with oxlint, which
 * loads these rules as a JS plugin, so this is the host they run in here. Oxlint
 * parses JavaScript, JSX and TypeScript itself, so no parser package — and no
 * TypeScript compiler API — is involved. Oxlint always parses the latest
 * ECMAScript, so there is no `ecmaVersion` to set.
 */
export function createRuleTester(config = {}) {
  return new RuleTester({
    ...config,
    languageOptions: {
      sourceType: "module",
      parserOptions: { lang: "jsx" },
      ...config.languageOptions,
    },
  });
}
