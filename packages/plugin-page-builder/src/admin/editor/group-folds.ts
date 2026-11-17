/**
 * The folded groups of a panel, kept per author: the Design panel's groups
 * and the Pages panel's each fold the same way, read from and written to the
 * author's own preference store.
 *
 * @module group-folds
 */
import type { PreferenceStore } from "@nextlyhq/builder";
import type { GroupFolds } from "@nextlyhq/builder/shell";
import * as React from "react";

/**
 * The folded groups, read from and written to the author's own store, so a
 * group stays folded across reloads. Without a store every group is open,
 * and folding lasts only as long as the panel.
 */
export function useGroupFolds(store: PreferenceStore | undefined): GroupFolds {
  const [kept, setKept] = React.useState(() => ({
    store,
    folded: foldsRead(store),
  }));
  // A store arriving after the panel mounted, as once the author is known,
  // is read then, so a toggle builds on the folds it holds rather than
  // writing over them.
  if (kept.store !== store) {
    setKept({ store, folded: foldsRead(store) });
  }
  const folded = kept.store === store ? kept.folded : foldsRead(store);
  const onFold = React.useCallback(
    (group: string, fold: boolean) => {
      setKept(current => {
        const next = new Set(current.folded);
        if (fold) next.add(group);
        else next.delete(group);
        store?.write(JSON.stringify([...next]));
        return { store, folded: next };
      });
    },
    [store]
  );
  return React.useMemo(() => ({ folded, onFold }), [folded, onFold]);
}

/** The stored folds, or none: a store that holds nothing or no list of names. */
function foldsRead(store: PreferenceStore | undefined): ReadonlySet<string> {
  const text = store?.read() ?? null;
  if (text === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(text);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : []
    );
  } catch {
    return new Set();
  }
}
