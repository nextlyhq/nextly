/**
 * The variables an import's judging writes may name before the site holds
 * them.
 *
 * An import's preview judges its documents by writing them and rolling back,
 * before the site style holds the variables the file adds, and a page write
 * may only add a reference to a variable the site defines
 * (`token-reference-judgement`). The judging writes carry every document
 * whole, so preview and apply judge the same values: the variables the
 * import adds are counted as defined for those writes instead, and every
 * other reference in the same value is still judged.
 *
 * Held in an `AsyncLocalStorage` rather than handed down as an argument: the
 * write's validation runs inside core, in the same async flow as the write
 * that started it, and core hands a field type's validator no context of its
 * own. Only code in this server process can enter the store, so neither a
 * request nor a stored value can widen what a write may name.
 *
 * Server-only: it imports `node:async_hooks`, so `plugin.ts` and the import
 * route load it at call time, keeping it out of any browser bundle that
 * reaches the package root.
 *
 * @module transfer/provisional-variables
 */
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<ReadonlySet<string>>();

const NONE: ReadonlySet<string> = new Set();

/**
 * Run `run` with `ids` counted as defined variables, for every write it
 * makes and every await inside it. Outside it, nothing is.
 */
export function withProvisionalVariables<T>(
  ids: Iterable<string>,
  run: () => Promise<T>
): Promise<T> {
  return store.run(new Set(ids), run);
}

/** The variables the current flow counts as defined; empty outside one. */
export function provisionalVariables(): ReadonlySet<string> {
  return store.getStore() ?? NONE;
}

/**
 * The variables a write may name: the site's own, and the current flow's
 * provisional ones. The site's set is returned as it is where there are none,
 * so a write outside an import's judgement is judged exactly as before.
 */
export function withProvisionalTokenIds(
  siteTokenIds: ReadonlySet<string>
): ReadonlySet<string> {
  const provisional = provisionalVariables();
  if (provisional.size === 0) return siteTokenIds;
  return new Set([...siteTokenIds, ...provisional]);
}
