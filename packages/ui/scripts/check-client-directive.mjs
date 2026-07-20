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

/**
 * The directive is only meaningful on the first line of the module. Returns
 * null when the artifact is absent, which is itself a failure worth naming
 * rather than an exception from deep inside the check.
 */
function readClientDirective(file) {
  let source;
  try {
    source = readFileSync(join(DIST, file), "utf8");
  } catch {
    return null;
  }
  const first = source.trimStart().split("\n")[0];
  return /^["']use client["'];?$/.test(first.trim());
}

const mustHave = ["index.mjs", "index.cjs"];
// The server-safe entries: build tooling and a pure helper, both of which
// server code must be able to import.
const mustNotHave = [
  "tailwind-preset.mjs",
  "tailwind-preset.cjs",
  "utils.mjs",
  "utils.cjs",
];

const problems = [];

for (const file of mustHave) {
  const directive = readClientDirective(file);
  if (directive === null) {
    problems.push(`${file} was not emitted by the build.`);
    continue;
  }
  if (!directive) {
    problems.push(
      `${file} is missing the "use client" directive on its first line. ` +
        `Components using hooks, context, forwardRef or Radix cannot render in ` +
        `a Server Component without it.`
    );
  }
}

for (const file of mustNotHave) {
  const directive = readClientDirective(file);
  if (directive === null) {
    problems.push(`${file} was not emitted by the build.`);
    continue;
  }
  if (directive) {
    problems.push(
      `${file} carries "use client" but contains no React runtime, so it ` +
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
