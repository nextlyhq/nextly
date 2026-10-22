/**
 * How long the slow fixture's card takes to answer, set by the e2e spec.
 *
 * Kept on `globalThis` rather than in a module variable: the route that sets it
 * and the resolver that reads it are loaded as separate modules by the dev
 * server, and only the process they share is one object for both.
 */
const KEY = "__nextlyE2eSlowWidgetMs";

type WithDelay = typeof globalThis & { [KEY]?: number };

export function slowWidgetDelayMs(): number {
  return (globalThis as WithDelay)[KEY] ?? 0;
}

export function setSlowWidgetDelayMs(ms: number): void {
  (globalThis as WithDelay)[KEY] = ms;
}
