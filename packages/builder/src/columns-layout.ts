/**
 * A Columns row's layout as tiles, and where it stacks: what each choice
 * writes, and which empty columns it adds or removes with it.
 *
 * Every choice writes Style values on the row and nothing on its columns: a
 * layout is its `grid-template-columns` at the edited device, and stacking is
 * the row laid out as a flex column at a device and below. Column order is
 * never written per column, so moving one never leaves a stale order behind.
 *
 * @module columns-layout
 */
import {
  getBlock,
  makeNode,
  type BlockNode,
  type BreakpointSet,
  type StyleState,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import type { BuilderOp } from "./ops";
import {
  readStyleValue,
  styleClearOp,
  styleWriteOp,
  type StyleAddress,
  type StyleWrite,
} from "./style-values";

/** The row this control belongs to. */
export const COLUMNS_ROW = "core/columns";

/** A tile: what it writes, and how many columns it lays out. */
export interface ColumnsLayout {
  readonly key: string;
  readonly label: string;
  /** The template it writes, or `undefined` to clear back to the default. */
  readonly template: string | undefined;
  /** How many columns it lays out, or `undefined` for any number. */
  readonly count: number | undefined;
  /** The tracks its glyph draws, as relative widths. */
  readonly tracks: readonly number[];
}

export const COLUMNS_LAYOUTS: readonly ColumnsLayout[] = [
  {
    key: "auto",
    label: "Auto",
    template: undefined,
    count: undefined,
    tracks: [1, 1],
  },
  {
    key: "50-50",
    label: "50 / 50",
    template: "1fr 1fr",
    count: 2,
    tracks: [1, 1],
  },
  {
    key: "33-67",
    label: "33 / 67",
    template: "1fr 2fr",
    count: 2,
    tracks: [1, 2],
  },
  {
    key: "67-33",
    label: "67 / 33",
    template: "2fr 1fr",
    count: 2,
    tracks: [2, 1],
  },
  {
    key: "25-75",
    label: "25 / 75",
    template: "1fr 3fr",
    count: 2,
    tracks: [1, 3],
  },
  {
    key: "3",
    label: "3 equal",
    template: "repeat(3, 1fr)",
    count: 3,
    tracks: [1, 1, 1],
  },
  {
    key: "4",
    label: "4 equal",
    template: "repeat(4, 1fr)",
    count: 4,
    tracks: [1, 1, 1, 1],
  },
];

/** The tile a stored template is, `auto` for none, `custom` for any other. */
export function layoutOf(stored: StyleValue | undefined): string {
  if (stored === undefined) return "auto";
  const written = typeof stored === "string" ? stored.trim() : undefined;
  return (
    COLUMNS_LAYOUTS.find(
      layout => layout.template !== undefined && layout.template === written
    )?.key ?? "custom"
  );
}

type Address = Pick<StyleAddress, "state" | "breakpoint">;

/** The styles a write leaves, read off its op, or the ones it started from. */
function stylesAfter(
  write: StyleWrite,
  current: BlockNode["styles"]
): BlockNode["styles"] {
  if (!write.ok || write.op === null) return current;
  const op = write.op as {
    unset?: readonly string[];
    patch?: { styles?: BlockNode["styles"] };
  };
  if (op.unset?.includes("styles") === true) return undefined;
  return op.patch?.styles ?? current;
}

/**
 * Several writes and clears on one node as ONE op: each step starts from the
 * styles the one before left, and the last op that changed anything carries
 * them all, since a style op holds the node's whole styles.
 */
function chained(
  node: BlockNode,
  steps: readonly {
    readonly address: StyleAddress;
    readonly value: StyleValue | null;
  }[]
): BuilderOp | null {
  let styles = node.styles;
  let last: BuilderOp | null = null;
  for (const step of steps) {
    const write =
      step.value === null
        ? styleClearOp(node.id, styles, step.address)
        : styleWriteOp(node.id, styles, step.address, step.value);
    if (!write.ok) return null;
    if (write.op !== null) last = write.op;
    styles = stylesAfter(write, styles);
  }
  return last;
}

/** The type, version and defaults a new column is made with, from the row. */
function columnShape(
  row: BlockNode
):
  | { type: string; version: number; props: Record<string, unknown> }
  | undefined {
  const allowed = getBlock(row.type)?.slots?.children?.allow;
  const type = allowed?.length === 1 ? allowed[0] : undefined;
  const definition = type === undefined ? undefined : getBlock(type);
  if (type === undefined || definition === undefined) return undefined;
  return {
    type,
    version: definition.version,
    props: {
      ...(definition.defaultProps as Record<string, unknown> | undefined),
    },
  };
}

/** Whether a column holds nothing, so removing it loses nothing. */
function isEmpty(column: BlockNode): boolean {
  return Object.values(column.slots ?? {}).every(
    children => children.length === 0
  );
}

export type LayoutPlan =
  | { readonly ok: true; readonly ops: readonly BuilderOp[] }
  | { readonly ok: false; readonly reason: string };

/** Ops adding empty columns at the row's end until it holds `count`. */
function addedColumns(row: BlockNode, count: number): BuilderOp[] | undefined {
  const have = row.slots?.children?.length ?? 0;
  if (count <= have) return [];
  const shape = columnShape(row);
  if (shape === undefined) return undefined;
  return Array.from({ length: count - have }, (_, offset) => ({
    kind: "insert" as const,
    node: makeNode(shape.type, shape.version, shape.props, { children: [] }),
    at: { parentId: row.id, slot: "children", index: have + offset },
  }));
}

/** Why a layout of `count` columns cannot be laid out on this row. */
function refusal(count: number, holding: number): string {
  return `Needs ${count} ${count === 1 ? "column" : "columns"}. This row has ${holding} with content; empty one out first.`;
}

/**
 * Ops removing empty columns until the row holds `count`, the ones added
 * last first, or why not: a column holding content is never removed.
 */
function removedColumns(
  row: BlockNode,
  count: number
): BuilderOp[] | { readonly reason: string } {
  const columns = row.slots?.children ?? [];
  const extra = columns.length - count;
  if (extra <= 0) return [];
  const empty = columns.filter(isEmpty);
  if (empty.length < extra) {
    return { reason: refusal(count, columns.length - empty.length) };
  }
  return empty
    .reverse()
    .slice(0, extra)
    .map(column => ({ kind: "remove" as const, id: column.id }));
}

/**
 * What choosing a tile does: the template at the edited device, and the
 * empty columns added or removed to match its count, as ops for one step. A
 * tile that would remove a column holding content is refused, with why.
 */
export function planLayout(
  row: BlockNode,
  key: string,
  at: Address
): LayoutPlan {
  const layout = COLUMNS_LAYOUTS.find(each => each.key === key);
  if (layout === undefined) return { ok: false, reason: "Not a layout." };
  const count = layout.count ?? row.slots?.children?.length ?? 0;
  const removed = removedColumns(row, count);
  if (!Array.isArray(removed)) return { ok: false, reason: removed.reason };
  const added = addedColumns(row, count);
  if (added === undefined) return { ok: false, reason: "No column to add." };
  const style = chained(row, [
    {
      address: { ...at, property: "gridTemplateColumns", path: [] },
      value: layout.template ?? null,
    },
  ]);
  return {
    ok: true,
    ops: [...(style === null ? [] : [style]), ...added, ...removed],
  };
}

/** The tiers a row can stack at, by width, as the device switcher names them. */
export interface StackTiers {
  readonly tablet?: string;
  readonly mobile?: string;
}

export function stackTiers(breakpoints: BreakpointSet | undefined): StackTiers {
  const widest = (fits: (width: number) => boolean) =>
    (breakpoints?.viewport ?? [])
      .filter(tier => tier.maxWidth !== undefined && fits(tier.maxWidth))
      .sort((a, b) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0))[0]?.id;
  const tablet = widest(width => width > 640 && width <= 1024);
  const mobile = widest(width => width <= 640);
  return {
    ...(tablet === undefined ? {} : { tablet }),
    ...(mobile === undefined ? {} : { mobile }),
  };
}

export type StackOn = "tablet" | "mobile" | "never";

/** Where a row stacks, read from what it stores, and whether it is reversed. */
export function stackOf(
  row: BlockNode,
  tiers: StackTiers,
  state: StyleState
): { on: StackOn; reversed: boolean } {
  for (const on of ["tablet", "mobile"] as const) {
    const breakpoint = tiers[on];
    if (breakpoint === undefined) continue;
    const read = (property: string) =>
      readStyleValue(row.styles, { state, breakpoint, property, path: [] });
    const direction = read("flexDirection");
    if (
      read("display") === "flex" &&
      (direction === "column" || direction === "column-reverse")
    ) {
      return { on, reversed: direction === "column-reverse" };
    }
  }
  return { on: "never", reversed: false };
}

/**
 * Stacking as ONE op on the row: cleared at both tiers, then, unless Never,
 * the row laid out as a flex column at the chosen tier, which applies there
 * and below; reversed, the last column comes first.
 */
export function planStack(
  row: BlockNode,
  on: StackOn,
  reversed: boolean,
  { tiers, state }: { tiers: StackTiers; state: StyleState }
): BuilderOp | null {
  const steps: { address: StyleAddress; value: StyleValue | null }[] = [];
  for (const tier of [tiers.tablet, tiers.mobile]) {
    if (tier === undefined) continue;
    for (const property of ["display", "flexDirection"]) {
      steps.push({
        address: { state, breakpoint: tier, property, path: [] },
        value: null,
      });
    }
  }
  const breakpoint = on === "never" ? undefined : tiers[on];
  if (breakpoint !== undefined) {
    steps.push(
      {
        address: { state, breakpoint, property: "display", path: [] },
        value: "flex",
      },
      {
        address: { state, breakpoint, property: "flexDirection", path: [] },
        value: reversed ? "column-reverse" : "column",
      }
    );
  }
  return chained(row, steps);
}
