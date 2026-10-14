import type { FlowDeps } from "../flows/deps";

/**
 * The flow's database, with `commitFirst` run once, outside any of the
 * flow's transactions, just before the flow opens its first one: a change
 * that commits after the flow read what it acts on and before it writes.
 * Every other member is the database's own.
 */
export function commitBeforeFirstTransaction(
  db: FlowDeps["db"],
  commitFirst: () => Promise<unknown>
): FlowDeps["db"] {
  let ran = false;

  return new Proxy(db, {
    get(target, key, receiver) {
      if (key !== "transaction" || ran)
        return Reflect.get(target, key, receiver) as unknown;
      return async (work: Parameters<typeof target.transaction>[0]) => {
        ran = true;
        await commitFirst();
        return target.transaction(work);
      };
    },
  });
}
