/**
 * The tree's keys as commands: what a key pressed on a row asks for, decided
 * apart from doing it, so the outline's handler only carries commands out.
 *
 * Up and Down move; Right unfolds a folded container or enters an open one;
 * Left folds an open container or leaves for the container above; Home and
 * End; Enter and Space open the panel; Shift+F10 and the context-menu key open
 * the row's menu; Alt+Up and Alt+Down move the field; "/" adds a field after
 * it; any other character is type-ahead.
 */
import type { VisibleRow } from "@admin/lib/builder/outline/outline-model";

/** What a key asks for. */
export type TreeCommand =
  | { kind: "focus"; index: number }
  | { kind: "toggle" }
  | { kind: "focus-parent" }
  | { kind: "select" }
  | { kind: "menu" }
  | { kind: "move"; delta: -1 | 1 }
  | { kind: "add-after" }
  | { kind: "type-ahead"; key: string };

/** The parts of a key press the commands read. */
export interface TreeKey {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** The keys that need nothing but where focus is. */
const PLAIN: Readonly<
  Record<string, (index: number, last: number) => TreeCommand>
> = {
  ArrowDown: index => ({ kind: "focus", index: index + 1 }),
  ArrowUp: index => ({ kind: "focus", index: index - 1 }),
  Home: () => ({ kind: "focus", index: 0 }),
  End: (_, last) => ({ kind: "focus", index: last }),
  Enter: () => ({ kind: "select" }),
  " ": () => ({ kind: "select" }),
  "/": () => ({ kind: "add-after" }),
};

/** Right and Left, which depend on whether the row is open. */
function horizontal(
  key: string,
  row: VisibleRow,
  index: number
): TreeCommand | null {
  if (key === "ArrowRight") {
    if (row.expanded === false) return { kind: "toggle" };
    return row.expanded ? { kind: "focus", index: index + 1 } : null;
  }
  if (row.expanded === true) return { kind: "toggle" };
  return row.node.parentId ? { kind: "focus-parent" } : null;
}

/**
 * The command a key asks for on the row at `index`, or null for a key the
 * tree leaves to the browser. A command the row cannot take (a move of a
 * read-only row, say) is still returned; the outline refuses it there.
 */
export function treeCommand(
  event: TreeKey,
  row: VisibleRow,
  index: number,
  rowCount: number
): TreeCommand | null {
  const { key } = event;
  if (event.altKey && (key === "ArrowUp" || key === "ArrowDown")) {
    return { kind: "move", delta: key === "ArrowUp" ? -1 : 1 };
  }
  if ((event.shiftKey && key === "F10") || key === "ContextMenu") {
    return { kind: "menu" };
  }
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (key === "ArrowRight" || key === "ArrowLeft") {
    return horizontal(key, row, index);
  }
  const plain = PLAIN[key];
  if (plain) return plain(index, rowCount - 1);
  return key.length === 1 ? { kind: "type-ahead", key } : null;
}

/**
 * The row type-ahead lands on: the first after `index`, wrapping round, whose
 * label (else name) starts with `text`. A text longer than one character may
 * still match the row it is on, so typing on keeps the place.
 */
export function typeAheadTarget(
  rows: readonly VisibleRow[],
  index: number,
  text: string
): VisibleRow | undefined {
  const lower = text.toLowerCase();
  const after = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
  const order = text.length > 1 ? [rows[index], ...after] : after;
  return order.find(candidate => {
    if (!candidate) return false;
    const { label, name } = candidate.node.field;
    return (label || name).toLowerCase().startsWith(lower);
  });
}
