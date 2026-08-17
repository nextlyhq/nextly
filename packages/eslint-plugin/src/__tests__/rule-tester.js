import { RuleTester } from "eslint";
import { afterAll, describe, it } from "vitest";

// `RuleTester` discovers its runner from globals. Vitest does not install any
// unless `globals: true` is set, so without this wiring the tester registers no
// cases and the suite reports "no tests" — a pass that ran nothing. Injecting
// vitest's functions keeps the config free of globals while still letting each
// case appear individually in the report.
RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/** A tester configured for the JSX + modern ESM the admin and plugins are written in. */
export function createRuleTester() {
  return new RuleTester({
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  });
}
