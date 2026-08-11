import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Build this package before any suite is collected.
 *
 * Several suites here assert against the BUILT declarations rather than the
 * source, because the questions they ask — what an entry exports, what a
 * consumer can resolve — have answers only in the emitted artifact. A `dist`
 * that is absent fails them at import time and a `dist` that merely predates
 * the source certifies a surface nobody has.
 *
 * **Global setup rather than a suite's own `beforeAll`, because a hook is too
 * late.** Vitest collects suites in parallel, so sibling suites import the
 * package while one suite's hook is still building — on a clean checkout they
 * fail to resolve before the build they depend on has finished.
 *
 * **Run unconditionally rather than skipped when Turbo appears to have built
 * already.** `TURBO_HASH` says a Turbo task is running, never that it was a
 * task carrying this package's build edge: `test:watch` has no such edge, so
 * treating the variable as proof skips the only build that would have
 * happened. Under a task that did build, this is a cache hit costing
 * milliseconds — cheaper than a heuristic that is wrong in one direction and
 * silent about it.
 *
 * Through Turbo rather than `tsup` directly: the declaration build resolves
 * `@nextlyhq/blocks-engine`, so invoking the bundler on a tree where that
 * dependency has not been built fails before any declarations exist. `turbo
 * run build` carries the `^build` edge, so the dependency is built first.
 */
export default function setup(): void {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

  try {
    execFileSync(
      "pnpm",
      ["exec", "turbo", "run", "build", "--filter=@nextlyhq/blocks-react"],
      { cwd: repoRoot, stdio: "pipe" }
    );
  } catch (error) {
    // Compiler diagnostics are the only thing that makes a failure here
    // actionable, and a discarded stream reduces every cause to the same
    // opaque non-zero exit.
    const output = `${streamText(error, "stdout")}${streamText(error, "stderr")}`;
    throw new Error(
      `building @nextlyhq/blocks-react failed:\n${output.trim()}`
    );
  }
}

/** `stdout`/`stderr` off a failed `execFileSync`, without assuming its shape. */
function streamText(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error !== "object" || error === null || !(key in error)) return "";
  const value: unknown = Reflect.get(error, key);
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return "";
}
