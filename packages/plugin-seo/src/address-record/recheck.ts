/**
 * One later look, a while after a start, at what a process still running an
 * earlier version of the plugin wrote during a deploy.
 *
 * Each start brings the address record and the not-found log up to date with
 * what such a process wrote. A long-running server may not start again until
 * the next deploy, though, and the processes of the earlier version can go on
 * serving after its start: on a rolling update the old ones stop only once
 * the new ones are up. So the same look is taken once more, after
 * {@link RECHECK_AFTER_MS}. The timer never keeps the process alive, and on a
 * serverless platform, where a frozen process never reaches it, starts are
 * frequent enough to stand in for it.
 *
 * @module address-record/recheck
 */

/**
 * How long after a start the later look is taken: longer than a rolling
 * update keeps its old processes serving, as a rule.
 */
export const RECHECK_AFTER_MS: number = 30 * 60 * 1000;

/**
 * Run `look` once, `afterMs` from now, never keeping the process alive for
 * it; answers what cancels it. What `look` throws is handed to `failed`.
 */
export function startRecheck(
  look: () => Promise<void>,
  failed: (error: unknown) => void,
  afterMs: number = RECHECK_AFTER_MS
): () => void {
  const timer = setTimeout(() => {
    look().catch(failed);
  }, afterMs);
  timer.unref();
  return () => clearTimeout(timer);
}
