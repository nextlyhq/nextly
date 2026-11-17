/**
 * The judgement of the long editing session (`long-session.mjs`): which of
 * the main thread's long tasks count, whether any is over the limit, and the
 * heap and lock readings the report quotes. Plain functions over what the
 * session recorded, so they are tested without a browser
 * (`scripts/builder-long-session-report.test.mjs`).
 *
 * @module builder-speed/long-session-report
 */

/** No main-thread task may run longer than this after the first minute. */
export const LONG_TASK_LIMIT_MS = 1000;
/** The first minute: the builder's code loading and warming up. */
export const GRACE_MS = 60_000;

/**
 * Long tasks from every frame, each once.
 *
 * The admin's frame and the canvas frame share one main thread, and each
 * frame's observer may report the same task, so a task seen by both is kept
 * once: the same start, to the millisecond, is the same task. The longer
 * duration is kept, since a frame's entry can end where its own work did.
 */
export function mergeLongTasks(lists) {
  const byStart = new Map();
  for (const list of lists)
    for (const task of list) {
      const key = Math.round(task.start);
      const seen = byStart.get(key);
      if (seen === undefined || task.duration > seen.duration)
        byStart.set(key, { start: task.start, duration: task.duration });
    }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

/**
 * Whether the session kept every task under the limit after the first
 * minute.
 *
 * `paused` are the windows in which the session itself held the page: each
 * heap reading forces two garbage collections, and the task that runs them is
 * the check's, not the builder's. A task starting inside one is left out.
 */
export function judgeLongTasks(
  tasks,
  { startedAt, endedAt, paused = [] },
  { limitMs = LONG_TASK_LIMIT_MS, graceMs = GRACE_MS } = {}
) {
  const counted = tasks.filter(
    task =>
      task.start >= startedAt + graceMs &&
      task.start <= endedAt &&
      !paused.some(w => task.start >= w.from && task.start <= w.to)
  );
  const over = counted.filter(task => task.duration > limitMs);
  const longest = counted.reduce(
    (most, task) => Math.max(most, task.duration),
    0
  );
  return {
    counted: counted.length,
    over: over.map(task => ({
      atSecond: Math.round((task.start - startedAt) / 1000),
      ms: Math.round(task.duration),
    })),
    longestMs: Math.round(longest),
    passed: over.length === 0,
  };
}

/**
 * The reading nearest each of `minutes` (1, 10, 20, 30 for a 30-minute run),
 * from the samples taken about once a minute; a minute past the end of the
 * run reads as null.
 */
export function readingsAt(samples, minutes) {
  const out = {};
  for (const minute of minutes) {
    const near = samples
      .filter(s => Math.abs(s.minute - minute) <= 0.75)
      .sort(
        (a, b) => Math.abs(a.minute - minute) - Math.abs(b.minute - minute)
      );
    out[minute] = near[0] ?? null;
  }
  return out;
}

/**
 * How much the heap grew from the first minute to the last reading, in
 * percent; null without both.
 */
export function heapGrowth(samples) {
  const first = samples.find(s => s.minute >= 1);
  const last = samples.at(-1);
  if (first === undefined || last === undefined || first === last) return null;
  return Number(
    (((last.heapBytes - first.heapBytes) / first.heapBytes) * 100).toFixed(1)
  );
}
