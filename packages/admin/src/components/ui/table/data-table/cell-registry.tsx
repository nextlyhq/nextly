/**
 * Field-type -> cell renderer registry.
 *
 * A renderer advertises the field `types` it can render; the DataTable resolves a
 * column's cell by `column.cell ?? registry(column.fieldType) ?? textRenderer`.
 * Plugins add renderers via `registerCellRenderer` (re-exported through the plugin
 * SDK), so third parties can support new field types without patching core.
 *
 * @module components/ui/table/data-table/cell-registry
 */

import { cn } from "@admin/lib/utils";

import type {
  CellContext,
  CellRenderer,
  CellRendererDefinition,
  NextlyFieldType,
} from "./types";

// ============================================================================
// Registry
// ============================================================================

const registry = new Map<NextlyFieldType, CellRenderer>();

/**
 * Register a cell renderer for one or more field types. Later registrations for
 * the same type win (so plugins/apps can override a core renderer).
 */
export function defineCellRenderer(def: CellRendererDefinition): void {
  for (const type of def.types) {
    registry.set(type, def.component);
  }
}

/** Resolve the renderer for a field type, or undefined if none is registered. */
export function getCellRenderer(
  fieldType?: NextlyFieldType
): CellRenderer | undefined {
  if (!fieldType) return undefined;
  return registry.get(fieldType);
}

/** Test/introspection helper. */
export function getRegisteredCellTypes(): NextlyFieldType[] {
  return [...registry.keys()];
}

/**
 * Resolve the renderer for a column: explicit `cell` -> registry(fieldType) -> text.
 *
 * Registry renderers are stored against the base row shape but only read
 * `ctx.value`/`ctx.row` generically, so they are runtime-safe for any `Row`.
 * This helper contains the single, inherent variance bridge for a heterogeneous
 * field-type -> renderer registry (not `any`), so the DataTable itself stays
 * assertion-free.
 */
export function resolveCellRenderer<Row extends object>(
  cell: CellRenderer<Row> | undefined,
  fieldType: NextlyFieldType | undefined
): CellRenderer<Row> {
  if (cell) return cell;
  const fromRegistry = fieldType ? registry.get(fieldType) : undefined;
  return (fromRegistry ?? textRenderer) as CellRenderer<Row>;
}

// ============================================================================
// Core renderers
// ============================================================================

/** Empty/nullish placeholder used across renderers. */
function EmptyValue() {
  return <span className="text-muted-foreground">-</span>;
}

/** Safely stringify an unknown value for display (never "[object Object]"). */
function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/** Fallback text renderer (also the default when no field type matches). */
export const textRenderer: CellRenderer = ({ value }: CellContext) => {
  if (value === null || value === undefined || value === "")
    return <EmptyValue />;
  return <span className="text-sm text-foreground">{toText(value)}</span>;
};

const mutedTextRenderer: CellRenderer = ({ value }: CellContext) => {
  if (value === null || value === undefined || value === "")
    return <EmptyValue />;
  return (
    <span className="text-sm text-muted-foreground truncate">
      {toText(value)}
    </span>
  );
};

/** Monospace id/slug renderer. */
const monoRenderer: CellRenderer = ({ value }: CellContext) => {
  if (!value) return <EmptyValue />;
  return (
    <span className="font-mono text-xs text-muted-foreground">
      {toText(value)}
    </span>
  );
};

/** Boolean/checkbox as a subtle Yes/No badge (monochrome). */
const booleanRenderer: CellRenderer = ({ value }: CellContext) => {
  const on = value === true || value === "true" || value === 1;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-none px-2 py-0.5 text-[11px] font-medium border border-border",
        on ? "bg-muted text-foreground" : "bg-transparent text-muted-foreground"
      )}
    >
      {on ? "Yes" : "No"}
    </span>
  );
};

/** Number, right-aligned. */
const numberRenderer: CellRenderer = ({ value }: CellContext) => {
  if (value === null || value === undefined || value === "")
    return <EmptyValue />;
  return (
    <span className="text-sm text-foreground tabular-nums">
      {toText(value)}
    </span>
  );
};

/**
 * Parse a cell value into a Date. Date-only `YYYY-MM-DD` strings are parsed as a
 * LOCAL calendar date: `new Date("2025-01-31")` would parse as UTC midnight and
 * render one day early in negative-offset timezones.
 */
function parseCellDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const text = toText(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3])
    );
  }
  return new Date(text);
}

/** Date/datetime, formatted short. Shows "-" when the value is missing. */
const dateRenderer: CellRenderer = ({ value }: CellContext) => {
  if (!value) return <EmptyValue />;
  const d = parseCellDate(value);
  if (Number.isNaN(d.getTime())) return <EmptyValue />;
  const formatted = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <span className="text-sm text-muted-foreground whitespace-nowrap">
      {formatted}
    </span>
  );
};

/** Single choice (select/radio) as a clear muted chip. */
const badgeRenderer: CellRenderer = ({ value }: CellContext) => {
  if (value === null || value === undefined || value === "")
    return <EmptyValue />;
  return (
    <span className="inline-flex items-center rounded-none px-2 py-0.5 text-[11px] font-medium bg-muted text-foreground border border-border">
      {toText(value)}
    </span>
  );
};

/** Multi-choice (chips) as up to a few chips + overflow count. */
const chipsRenderer: CellRenderer = ({ value }: CellContext) => {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  if (items.length === 0) return <EmptyValue />;
  const shown = items.slice(0, 3);
  const extra = items.length - shown.length;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((v, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded-none px-1.5 py-0.5 text-[11px] font-medium bg-muted text-foreground border border-border"
        >
          {toText(v)}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[11px] text-muted-foreground">+{extra}</span>
      )}
    </span>
  );
};

/** Relationship: show a title/label if present, else the id, muted. */
const relationshipRenderer: CellRenderer = ({ value }: CellContext) => {
  if (!value) return <EmptyValue />;
  if (typeof value === "object" && value !== null) {
    const rel = value as Record<string, unknown>;
    const label = rel.title ?? rel.name ?? rel.label ?? rel.id;
    return (
      <span className="text-sm text-foreground">{toText(label) || "-"}</span>
    );
  }
  return <span className="text-sm text-muted-foreground">{toText(value)}</span>;
};

/** Upload/media: a tiny thumbnail if a url is available, else the filename. */
const uploadRenderer: CellRenderer = ({ value }: CellContext) => {
  if (!value) return <EmptyValue />;
  const media =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  const url = media?.url ?? media?.thumbnailUrl;
  const name = media?.filename ?? media?.name;
  if (typeof url === "string") {
    return (
      <img
        src={url}
        alt={typeof name === "string" ? name : "media"}
        className="h-8 w-8 rounded-none border border-border object-cover"
      />
    );
  }
  return (
    <span className="text-sm text-muted-foreground truncate">
      {typeof name === "string" ? name : toText(value)}
    </span>
  );
};

/** JSON/code: compact preview. */
const jsonRenderer: CellRenderer = ({ value }: CellContext) => {
  if (value === null || value === undefined) return <EmptyValue />;
  let preview: string;
  try {
    preview = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    preview = toText(value);
  }
  return (
    <span className="font-mono text-xs text-muted-foreground truncate max-w-[24ch] inline-block align-bottom">
      {preview}
    </span>
  );
};

/** Rich text / textarea: plain-text excerpt (strip tags), muted. */
const excerptRenderer: CellRenderer = ({ value }: CellContext) => {
  if (!value) return <EmptyValue />;
  const text = toText(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return <EmptyValue />;
  const excerpt = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return (
    <span className="text-sm text-muted-foreground truncate">{excerpt}</span>
  );
};

// ============================================================================
// Register the core renderers
// ============================================================================

defineCellRenderer({
  id: "text",
  types: ["text", "email"],
  component: textRenderer,
});
defineCellRenderer({
  id: "password",
  types: ["password"],
  component: () => <EmptyValue />,
});
defineCellRenderer({
  id: "id",
  types: ["id", "slug"],
  component: monoRenderer,
});
defineCellRenderer({
  id: "boolean",
  types: ["checkbox", "boolean"],
  component: booleanRenderer,
});
defineCellRenderer({
  id: "number",
  types: ["number"],
  component: numberRenderer,
});
defineCellRenderer({
  id: "date",
  types: ["date", "datetime"],
  component: dateRenderer,
});
defineCellRenderer({
  id: "badge",
  types: ["select", "radio"],
  component: badgeRenderer,
});
defineCellRenderer({ id: "chips", types: ["chips"], component: chipsRenderer });
defineCellRenderer({
  id: "relationship",
  types: ["relationship"],
  component: relationshipRenderer,
});
defineCellRenderer({
  id: "upload",
  types: ["upload", "media"],
  component: uploadRenderer,
});
defineCellRenderer({
  id: "json",
  types: ["json", "code"],
  component: jsonRenderer,
});
defineCellRenderer({
  id: "excerpt",
  types: ["richText", "textarea"],
  component: excerptRenderer,
});

export { mutedTextRenderer };
