import { defineConfig } from "vitest/config";

/*
 * The lane `pnpm test:scripts` runs, and the only vitest run rooted here.
 *
 * 🔴 Budgeted, because these are not unit tests. `check-doc-samples` compiles
 * every documentation sample with the TypeScript compiler, and the guards
 * beside it walk the whole workspace. Their cost swings with how warm the
 * compiler's caches are: measured cold on an idle machine, one case takes
 * 1545ms and another 5479ms, against vitest's 5000ms default. Under a
 * concurrent build the first crossed it and failed with "Test timed out in
 * 5000ms", having passed on its own moments earlier. A budget has to cover the
 * cold, contended run, not the warm one that is easy to measure.
 *
 * ⚠️ The 5479ms one passes today only because it never yields. Vitest cannot
 * interrupt synchronous work, so its budget is met by accident, and making that
 * case async would fail it immediately at a length it already has. Stating the
 * budget is what removes the accident.
 *
 * Sized for contention rather than for the measured time. A guard that fails
 * when the machine is busy teaches everyone to re-run rather than to read it,
 * and the next failure that is real gets the same treatment.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
