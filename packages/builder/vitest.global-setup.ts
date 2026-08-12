/**
 * That the runner still collects every test on disk, checked from outside the
 * globs being checked.
 *
 * This package derives vitest's `include` from one extension list so the globs,
 * the layering guard's idea of a test, and the file walk cannot drift apart.
 * The cost of deriving them together is that a single edit narrows all of them
 * at once, and a suite that stops being collected looks exactly like a suite
 * that passed.
 *
 * That is measured, not hypothetical. Dropping `ts` from `MODULE_EXTENSIONS`
 * leaves one `.mts` control collected and the run reports `1 passed (1)` in
 * green, with every layering and geometry guard silently absent. The previous
 * attempt to catch this put the assertion in `layering.test.ts`, reasoning that
 * any glob set collecting anything would collect that file. The mutation
 * un-collects it too, which is precisely how the mutation went green.
 *
 * A check only survives a mutation it does not depend on. `globalSetup` runs
 * before any test file is collected, so no glob decides whether it executes,
 * and both outcomes are loud: with files collected this throws, and with none
 * collected vitest raises `FilesNotFoundError` by itself.
 *
 * So the rule below reads NEITHER `BUNDLED_MODULE` nor `MODULE_EXTENSIONS`.
 * Both narrow with the mutation — a walk filtered by `BUNDLED_MODULE` stops
 * returning `.ts` files at the same moment the globs stop matching them, and
 * the check would agree with itself and pass. It walks every file, spells out
 * what a test is named like, and compares that against the globs the runner was
 * actually handed.
 */
import { readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { TEST_GLOBS } from "./src/source-modules";

// `import.meta.dirname` only exists from Node 20.11 and the package floor is
// lower, matching how the suite's own guards resolve this directory.
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "src");

/**
 * What a test file is named like, written out rather than derived.
 *
 * The literal is the whole point. Deriving this from `MODULE_EXTENSIONS` would
 * make it narrow in lockstep with the thing it is checking, which is the defect
 * rather than the fix.
 */
const LOOKS_LIKE_A_TEST = /\.test\.[^.]+$/;

/** Every file beneath a directory, with no opinion about extensions. */
function everyFile(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...everyFile(full));
    else out.push(full);
  }
  return out;
}

/**
 * The trailing text a glob matches: `src/**\/*.test.ts` yields `.test.ts`.
 *
 * Read off the value handed to `include` rather than rebuilt from the list it
 * came from, so a glob shape that stopped matching real files is visible here
 * instead of being assumed away.
 */
function globSuffix(glob: string): string {
  return glob.slice(glob.lastIndexOf("*") + 1);
}

export default function assertTheRunnerCollectsEveryTest(): void {
  const onDisk = everyFile(SRC_DIR).filter(file =>
    LOOKS_LIKE_A_TEST.test(file)
  );

  // Positive control. An empty walk satisfies the check below while proving
  // nothing, and passing because it found nothing is the exact failure this
  // file exists to end.
  if (onDisk.length === 0) {
    throw new Error(
      `No test files were found under ${SRC_DIR}, so this check cannot ` +
        `confirm the runner collects them and refuses to report success.`
    );
  }

  const suffixes = TEST_GLOBS.map(globSuffix);
  const uncollected = onDisk
    .filter(file => !suffixes.some(suffix => file.endsWith(suffix)))
    .map(file => relative(SRC_DIR, file).split(sep).join("/"));

  if (uncollected.length > 0) {
    throw new Error(
      `${uncollected.length} test file(s) exist that no vitest glob collects. ` +
        `They would be skipped and the run would still report success:\n` +
        uncollected.map(name => `  src/${name}`).join("\n") +
        `\n\nThe runner was given: ${TEST_GLOBS.join(", ")}\n` +
        `Add the missing extension to MODULE_EXTENSIONS in src/source-modules.ts.`
    );
  }
}
