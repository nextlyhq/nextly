import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The guard against throwing a bare `Error` from this package, defined once and mounted from
 * more than one ESLint configuration.
 *
 * ESLint resolves a flat config from the CWD, not from the linted file, so the same source is
 * governed by `packages/nextly/eslint.config.js` when lint runs inside the package and by the
 * repository-root config when lint-staged runs from the root. A rule written into only one of
 * them applies only to the invocation that happens to read it. Both mount this builder instead,
 * so there is one definition and the globs are the only thing that differ.
 */

/**
 * Both spellings of a bare throw: `throw new Error(...)` and `throw Error(...)`. They produce the
 * same value, so rejecting only the first would leave the second as an unguarded path to it.
 *
 * What this does NOT match is a throw whose operand was built elsewhere — `const e = new Error();
 * throw e;` — and that is deliberate. Constructing an `Error` is legitimate throughout the
 * package: it normalises an `unknown` in a catch, and it is the value handed to `onError`
 * callbacks. Matching construction rather than the throw would reject those, and the exemptions
 * needed to allow them would be indistinguishable from exemptions for real violations.
 */
export const BARE_ERROR_SELECTOR = [
  "ThrowStatement > NewExpression[callee.name='Error']",
  "ThrowStatement > CallExpression[callee.name='Error']",
].join(", ");

export const BARE_ERROR_MESSAGE =
  "Throw a NextlyError, not a bare Error. A bare Error carries no code, so the API layer reports it as a 500 even when it is a caller-fixable refusal. Use NextlyError.validation / .notFound / .conflict / .internal, or `new NextlyError({ code, publicMessage })` for a code without a factory.";

/**
 * Files that still throw a bare `Error`, exempt until they do not.
 *
 * Held as JSON rather than as a module because it is data, and because a `.js` file is linted as
 * typed source by whichever config picks it up — which fails, since files beside a package's
 * config are outside its TypeScript project. `src/errors/__tests__/bare-error-allowlist.test.ts`
 * reads the same JSON and fails on any entry that no longer throws, so the list can only shrink.
 */
export const BARE_ERROR_ALLOWLIST = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "eslint-bare-error-allowlist.json"
    ),
    "utf8"
  )
);

/**
 * Build the config block.
 *
 * `prefix` is prepended to every glob so the same block can mount at a CWD above the package.
 * It must be empty (lint running inside `packages/nextly`) or a trailing-slashed path to the
 * package from the CWD (`"packages/nextly/"` from the repository root).
 */
export function bareErrorConfig(prefix = "") {
  return {
    // A thrown bare `Error` reaches the API layer with no code to map, so it becomes a 500
    // whatever it actually was — a caller-fixable refusal reads as a server fault, and the
    // message is the only thing left to act on. `NextlyError` carries the code instead.
    //
    // Enforced as a syntax restriction rather than a bespoke rule so there is no plugin to
    // build or version — the same trade this repo made for the keyboard-listener guard in
    // `packages/admin/eslint.config.js`. The selector matches the throw itself, which is the
    // thing that must not appear.
    files: [`${prefix}src/**/*.ts`, `${prefix}src/**/*.tsx`],
    ignores: [
      ...BARE_ERROR_ALLOWLIST.map(entry => `${prefix}${entry}`),
      // Tests may throw whatever makes a failure legible; they never cross the API boundary.
      // The shared base config already ignores them globally, so this is what keeps the rule's
      // scope readable rather than what enforces it.
      `${prefix}src/**/*.test.ts`,
      `${prefix}src/**/*.spec.ts`,
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: BARE_ERROR_SELECTOR, message: BARE_ERROR_MESSAGE },
      ],
    },
  };
}
