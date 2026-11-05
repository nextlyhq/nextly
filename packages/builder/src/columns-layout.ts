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

/** The template a row's block gives it by default: what Auto returns it to. */
export function defaultTemplate(row: BlockNode): string | undefined {
  const base = (
    getBlock(row.type)?.baseStyles as
      | { base?: { base?: Record<string, unknown> } }
      | undefined
  )?.base?.base?.gridTemplateColumns;
  return typeof base === "string" ? base : undefined;
}

/**
 * The template a row inherits at a device from the nearest wider one that
 * sets one, the base last; `undefined` at the base, or where none does.
 */
export function inheritedTemplate(
  row: BlockNode,
  breakpoint: string,
  breakpoints: BreakpointSet | undefined,
  state: StyleState
): string | undefined {
  if (breakpoint === "base") return undefined;
  const tiers = breakpoints?.viewport ?? [];
  const width = tiers.find(tier => tier.id === breakpoint)?.maxWidth;
  const wider = tiers
    .filter(
      tier =>
        tier.maxWidth !== undefined &&
        width !== undefined &&
        tier.maxWidth > width
    )
    .sort((a, b) => (a.maxWidth ?? 0) - (b.maxWidth ?? 0))
    .map(tier => tier.id);
  for (const id of [...wider, "base"]) {
    const value = readStyleValue(row.styles, {
      state,
      breakpoint: id,
      property: "gridTemplateColumns",
      path: [],
    });
    if (typeof value === "string") return value;
  }
  return undefined;
}

/**
 * The tile a template is: `auto` for none or the block's own default,
 * `custom` for one no tile writes.
 */
export function layoutOf(
  stored: StyleValue | undefined,
  byDefault?: string
): string {
  if (stored === undefined) return "auto";
  const written = typeof stored === "string" ? stored.trim() : undefined;
  if (written !== undefined && written === byDefault?.trim()) return "auto";
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

/**
 * Whether a column is blank, so removing it loses nothing: no blocks in it,
 * and nothing an author set on it, no props, styles, classes, id or
 * attributes. A styled column with nothing in it is still the author's.
 */
function isEmpty(column: BlockNode): boolean {
  const node = column as BlockNode & {
    classes?: readonly unknown[];
    cssId?: unknown;
    attributes?: Record<string, unknown>;
  };
  return (
    Object.values(node.slots ?? {}).every(children => children.length === 0) &&
    Object.keys(node.props ?? {}).length === 0 &&
    node.styles === undefined &&
    (node.classes?.length ?? 0) === 0 &&
    node.cssId === undefined &&
    Object.keys(node.attributes ?? {}).length === 0
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
  at: Address,
  inherited?: string
): LayoutPlan {
  const layout = COLUMNS_LAYOUTS.find(each => each.key === key);
  if (layout === undefined) return { ok: false, reason: "Not a layout." };
  const count = layout.count ?? row.slots?.children?.length ?? 0;
  const removed = removedColumns(row, count);
  if (!Array.isArray(removed)) return { ok: false, reason: removed.reason };
  const added = addedColumns(row, count);
  if (added === undefined) return { ok: false, reason: "No column to add." };
  // Auto clears what is set here; where a wider device's layout reaches
  // this one, clearing would leave it in force, so Auto writes the block's
  // own template here instead.
  const inheritsAnother =
    layout.template === undefined &&
    inherited !== undefined &&
    layoutOf(inherited, defaultTemplate(row)) !== "auto";
  const value = inheritsAnother
    ? (defaultTemplate(row) ?? null)
    : (layout.template ?? null);
  const style = chained(row, [
    { address: { ...at, property: "gridTemplateColumns", path: [] }, value },
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
  /**
   * Every tier at a tablet's width or narrower, widest first, with the stack
   * choice it falls under: where a stack written before, at a tier no longer
   * the widest of its kind, is still found and cleared.
   */
  readonly managed?: readonly {
    readonly id: string;
    readonly on: "tablet" | "mobile";
  }[];
}

export function stackTiers(breakpoints: BreakpointSet | undefined): StackTiers {
  const widest = (fits: (width: number) => boolean) =>
    (breakpoints?.viewport ?? [])
      .filter(tier => tier.maxWidth !== undefined && fits(tier.maxWidth))
      .sort((a, b) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0))[0]?.id;
  const tablet = widest(width => width > 640 && width <= 1024);
  const mobile = widest(width => width <= 640);
  const managed = (breakpoints?.viewport ?? [])
    .filter(tier => tier.maxWidth !== undefined && tier.maxWidth <= 1024)
    .sort((a, b) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0))
    .map(tier => ({
      id: tier.id,
      on:
        (tier.maxWidth ?? 0) > 640 ? ("tablet" as const) : ("mobile" as const),
    }));
  return {
    ...(tablet === undefined ? {} : { tablet }),
    ...(mobile === undefined ? {} : { mobile }),
    ...(managed.length === 0 ? {} : { managed }),
  };
}

export type StackOn = "tablet" | "mobile" | "never";

/** The stack this control writes at a tier, if that is what the tier holds. */
function stackAt(
  row: BlockNode,
  breakpoint: string,
  state: StyleState
): { reversed: boolean } | undefined {
  const read = (property: string) =>
    readStyleValue(row.styles, { state, breakpoint, property, path: [] });
  const direction = read("flexDirection");
  if (read("display") !== "flex") return undefined;
  if (direction !== "column" && direction !== "column-reverse")
    return undefined;
  return { reversed: direction === "column-reverse" };
}

/** Where a row stacks, read from what it stores, and whether it is reversed. */
export function stackOf(
  row: BlockNode,
  tiers: StackTiers,
  state: StyleState
): { on: StackOn; reversed: boolean } {
  for (const tier of tiers.managed ?? []) {
    const stack = stackAt(row, tier.id, state);
    if (stack !== undefined) return { on: tier.on, reversed: stack.reversed };
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
  // Only a stack this control wrote is cleared: a display set at a tier for
  // another reason (hidden on mobile) is the author's and stays.
  for (const tier of tiers.managed ?? []) {
    if (stackAt(row, tier.id, state) === undefined) continue;
    for (const property of ["display", "flexDirection"]) {
      steps.push({
        address: { state, breakpoint: tier.id, property, path: [] },
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
