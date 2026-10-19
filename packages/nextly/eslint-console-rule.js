import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The guard against writing to the console directly from this package's source, defined once and
 * mounted from more than one ESLint configuration, as the bare-`Error` guard is
 * (`eslint-bare-error-rule.js` says why: ESLint picks a flat config by CWD, not by linted file).
 *
 * Outside development and test, Nextly masks every email address it logs. That holds for what is
 * written through its loggers (`getNextlyLogger`, `consoleLogger`, the logger every service is
 * handed) and fails for a bare `console.*` call, which writes whatever it is given. So source
 * writes through a logger, and the console is reached only from the writers below.
 *
 * Enforced with ESLint's own `no-console` rather than a bespoke rule: the exceptions are whole
 * files, which `files` and `ignores` express, and AGENTS.md rules out a per-line
 * `eslint-disable`.
 */

/**
 * The exempt files, held as JSON for the reason the bare-`Error` allowlist is: it is data, and a
 * `.js` file here would be linted as typed source. `src/observability/__tests__/console-allowlist.test.ts`
 * reads the same file.
 *
 * - `terminal`: globs that may write to the console for good, each with its reason. They are the
 *   writers the masked loggers end in, and output meant for a person at a terminal.
 * - `pending`: files not yet routed through a logger, each with the number of console calls it
 *   holds. The test pins those numbers, so a call added to a pending file fails, and a file
 *   leaves the list once it is converted. It only shrinks.
 */
export const CONSOLE_ALLOWLIST = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "eslint-console-allowlist.json"
    ),
    "utf8"
  )
);

/** The paths `no-console` does not apply to, terminal and pending alike. */
export const CONSOLE_ALLOWLIST_PATHS = [
  ...Object.keys(CONSOLE_ALLOWLIST.terminal),
  ...Object.keys(CONSOLE_ALLOWLIST.pending),
];

/**
 * Build the config block.
 *
 * `prefix` is prepended to every glob so the same block can mount at a CWD above the package:
 * empty inside `packages/nextly`, `"packages/nextly/"` from the repository root.
 */
export function consoleConfig(prefix = "") {
  // Tests write to the console to make a failure legible, and never ship.
  const tests = [
    `${prefix}src/**/*.test.ts`,
    `${prefix}src/**/*.spec.ts`,
    `${prefix}src/**/*.test-d.ts`,
    `${prefix}src/**/__tests__/**`,
  ];
  return [
    {
      files: [`${prefix}src/**/*.ts`, `${prefix}src/**/*.tsx`],
      ignores: [
        ...CONSOLE_ALLOWLIST_PATHS.map(entry => `${prefix}${entry}`),
        ...tests,
      ],
      rules: { "no-console": "error" },
    },
  ];
}
