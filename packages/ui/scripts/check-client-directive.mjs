/**
 * Verify the published component bundles still carry `"use client"`, and that
 * the build-time preset still does not.
 *
 * The directive is a per-module property, so a bundling build drops it from
 * every non-entry module. That failed silently once: the source files kept
 * their directives, the build kept succeeding, and the published package would
 * have thrown for anyone importing a component from a Server Component. Only
 * the built artifact proves it, so it is asserted here rather than trusted.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

/** The directive is only meaningful on the first line of the module. */
function hasClientDirective(file) {
  const first = readFileSync(join(DIST, file), "utf8").trimStart().split("\n")[0];
  return /^["']use client["'];?$/.test(first.trim());
}

const mustHave = ["index.mjs", "index.cjs"];
const mustNotHave = ["tailwind-preset.mjs", "tailwind-preset.cjs"];

const problems = [];

for (const file of mustHave) {
  if (!hasClientDirective(file)) {
    problems.push(
      `${file} is missing the "use client" directive on its first line. ` +
        `Components using hooks, context, forwardRef or Radix cannot render in ` +
        `a Server Component without it.`
    );
  }
}

for (const file of mustNotHave) {
  if (hasClientDirective(file)) {
    problems.push(
      `${file} carries "use client" but is build-time-only tooling, which ` +
        `should stay importable from server code.`
    );
  }
}

if (problems.length > 0) {
  console.error("Client-directive check failed:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `Client-directive check passed (${mustHave.join(", ")} marked; ` +
    `${mustNotHave.join(", ")} clean).`
);
