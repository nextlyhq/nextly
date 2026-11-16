/**
 * What a field rewrite the plugin makes tells the validation core runs inside
 * it.
 *
 * Core judges each copy's new value with the field's validator inside the
 * rewrite's transaction, which holds the entry's row lock and, on a pool of
 * one connection, the only connection there is. The blocks validator reads
 * the site's style through the pool there, where it would wait on that very
 * connection; and it judges Layers locks against the newest stored form, the
 * draft, which is right for a save but not for the live copy, whose own value
 * is what it replaces. So the rewrite runs inside this scope:
 *
 * - `siteDefinitions`: the site's classes, breakpoints and variables, read
 *   through the pool just before the rewrite opened its transaction, and
 *   answered from here to a read made without one;
 * - `current`: the copy the rewrite is deciding now, its field and its stored
 *   value, which the Layers-lock judgement compares a value with.
 *
 * Held in an `AsyncLocalStorage`, as `transfer/provisional-variables` holds
 * what an import's judging writes may name: the validator runs inside core,
 * in the same async flow as the rewrite that started it, and core hands it no
 * context of its own. Only code in this server process enters the scope.
 *
 * Server-only: it imports `node:async_hooks`, so its readers load it at call
 * time, keeping it out of any browser bundle that reaches the package root.
 *
 * @module host-rewrite/rewrite-scope
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { SiteDefinitions } from "../fields/blocks-composition";

/** The copy a rewrite is deciding: the field, and the copy's stored value. */
export interface RewriteCopy {
  readonly field: string;
  readonly stored: unknown;
}

/** What one rewrite's validation reads from its scope. */
export interface RewriteScope {
  readonly siteDefinitions: SiteDefinitions | undefined;
  /** Set as each copy is decided; `null` before the first. */
  current: RewriteCopy | null;
}

const store = new AsyncLocalStorage<RewriteScope>();

/** Run `run` inside `scope`: every await within it reads this scope. */
export function withRewriteScope<T>(
  scope: RewriteScope,
  run: () => Promise<T>
): Promise<T> {
  return store.run(scope, run);
}

/** The scope the current flow runs in, or `undefined` outside a rewrite. */
export function rewriteScope(): RewriteScope | undefined {
  return store.getStore();
}

/**
 * The site's definitions for a read made with no transaction: those read
 * before the current rewrite's transaction opened, inside one, and `read`'s
 * answer anywhere else.
 */
export async function siteDefinitionsInScope(
  read: () => Promise<SiteDefinitions>
): Promise<SiteDefinitions> {
  return store.getStore()?.siteDefinitions ?? read();
}

/**
 * The stored value a Layers-lock judgement of `field` compares with inside a
 * rewrite: the copy being decided, whose own value the new one replaces.
 * `undefined` outside a rewrite, or for another field, where the judgement
 * reads the stored form as it does for any save.
 */
export function rewriteBaseline(
  field: string
): { stored: unknown } | undefined {
  const current = store.getStore()?.current;
  return current?.field === field ? { stored: current.stored } : undefined;
}
