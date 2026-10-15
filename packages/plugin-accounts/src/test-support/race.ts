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

/**
 * The flow's database, with `commitFirst` run once, just before the flow's
 * first `select(table).where(...).first()` reads its row: a change that
 * commits between two reads a flow makes outside any transaction. Every
 * other member is the database's own.
 */
export function commitBeforeFirstRead(
  db: FlowDeps["db"],
  table: unknown,
  commitFirst: () => Promise<unknown>
): FlowDeps["db"] {
  let ran = false;
  const bound = <T extends object>(target: T, key: string | symbol) => {
    const member = Reflect.get(target, key) as unknown;
    return typeof member === "function"
      ? (member as (...args: unknown[]) => unknown).bind(target)
      : member;
  };

  return new Proxy(db, {
    get(target, key) {
      if (key !== "select" || ran) return bound(target, key);
      return (selected: Parameters<typeof target.select>[0]) => {
        const query = target.select(selected);
        if (selected !== table || ran) return query;
        return new Proxy(query, {
          get(builder, member) {
            if (member !== "where") return bound(builder, member);
            return (condition: Parameters<typeof builder.where>[0]) => {
              const filtered = builder.where(condition);
              return new Proxy(filtered, {
                get(chain, step) {
                  if (step !== "first") return bound(chain, step);
                  return async () => {
                    ran = true;
                    await commitFirst();
                    return chain.first();
                  };
                },
              });
            };
          },
        });
      };
    },
  });
}
