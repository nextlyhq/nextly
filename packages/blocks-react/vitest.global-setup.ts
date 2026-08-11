import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Build this package before any suite is COLLECTED.
 *
 * Several suites here assert against the BUILT declarations rather than the
 * source, because the questions they ask — what an entry exports, what a
 * consumer can resolve — have answers only in the emitted artifact. A `dist`
 * that is absent fails them at import time and a `dist` that merely predates
 * the source certifies a surface nobody has.
 *
 * **Global setup, because collection is concurrent.** Sibling suites import
 * this package while any one suite's own hook would still be building, so on a
 * tree with no `dist` they fail to resolve before that build finishes. Only a
 * stage that completes before collection starts covers them.
 *
 * It runs ONCE per process, which is the whole of what it guarantees: the
 * declarations are current when the run begins. Keeping them current as inputs
 * change is Turbo's job — `test` depends on `build` and names `dist/**` among
 * its inputs — and a `--watch` session is explicitly outside both, because
 * Vitest selects suites from a module graph that cannot see a `.d.ts` read off
 * disk.
 *
 * Unconditional, with no attempt to detect a build that already happened. The
 * signals available say a Turbo task is running, never that it was one
 * carrying this package's build edge, and a precondition derived from a nearby
 * signal is wrong silently. Where the build did already run this is a cache
 * hit costing milliseconds.
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
