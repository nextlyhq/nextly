/**
 * State one process shares, whichever copy of a module asks for it.
 *
 * Next.js can evaluate a module in more than one server module graph, so a
 * module-local variable the boot fills can be read empty from a route that
 * loaded another copy. State a boot publishes and a request reads is kept
 * here instead, on `globalThis` under `__nextly_<key>`, as the collection db
 * options and the declared entities already are.
 *
 * @module shared/process-global
 */

/**
 * The process's one value for `key`, made by `create` the first time any copy
 * asks. Answer a mutable box (or a Map or Set), never a primitive, so every
 * copy sees what another writes.
 */
export function processGlobal<T extends object>(
  key: string,
  create: () => T
): T {
  const store = globalThis as unknown as Record<string, unknown>;
  const name = `__nextly_${key}`;
  if (store[name] === undefined) store[name] = create();
  return store[name] as T;
}
