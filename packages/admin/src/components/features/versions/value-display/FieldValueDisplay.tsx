/**
 * Read-only display of a stored field value.
 *
 * The entry form renders values through inputs, which needs a form runtime and
 * mutable state. Showing a historical value needs neither, so this renders the
 * value directly: one small renderer per field type, resolved through a
 * registry so a plugin can supply one for a field type core does not know.
 *
 * Values arrive in storage shape and are read through `normalizeStoredValue`
 * first, so renderers can assume one shape per type.
 *
 * @module components/features/versions/value-display/FieldValueDisplay
 */

import type { FieldConfig } from "nextly/config";
import type { ReactNode } from "react";

import { Badge } from "@admin/components/ui";
import { formatDateTime } from "@admin/lib/dates/format";
import { cn } from "@admin/lib/utils";

import { normalizeStoredValue } from "./normalize-stored-value";
import { richTextToText } from "./rich-text-to-text";

/** What a renderer receives. */
export interface ValueDisplayContext {
  /** The value, already read into its canonical shape. */
  value: unknown;
  field: FieldConfig;
}

export type ValueDisplayRenderer = (ctx: ValueDisplayContext) => ReactNode;

const registry = new Map<string, ValueDisplayRenderer>();

/**
 * Register a renderer for one or more field types. A later registration for the
 * same type wins, so a plugin can replace a core renderer.
 */
export function defineValueDisplay(
  types: string[],
  render: ValueDisplayRenderer
): void {
  for (const type of types) registry.set(type, render);
}

/** Test and introspection helper. */
export function getRegisteredValueDisplayTypes(): string[] {
  return [...registry.keys()];
}

// ============================================================
// Shared pieces
// ============================================================

/**
 * Shown wherever a field holds nothing. A visible marker rather than blank
 * space, so an empty field is distinguishable from one that failed to render.
 */
function EmptyValue() {
  return <span className="text-muted-foreground italic">Not set</span>;
}

function PlainText({ children }: { children: ReactNode }) {
  return <span className="text-foreground break-words">{children}</span>;
}

/**
 * Stringify a value for the fallback renderer without ever producing
 * "[object Object]", which reads as a rendering bug rather than as data.
 */
function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** Label for a value against a field's configured options. */
function optionLabel(field: FieldConfig, value: unknown): string {
  const options = (field as { options?: { label?: string; value?: unknown }[] })
    .options;
  if (!Array.isArray(options)) return String(value);
  const match = options.find(o => o?.value === value);
  return match?.label ?? String(value);
}

// ============================================================
// Core renderers
// ============================================================

defineValueDisplay(
  ["text", "textarea", "email", "slug", "id", "url", "phone"],
  ({ value }) => <PlainText>{String(value)}</PlainText>
);

defineValueDisplay(["code"], ({ value }) => (
  <pre className="text-xs font-mono bg-muted text-foreground p-2 overflow-x-auto whitespace-pre-wrap break-words">
    {String(value)}
  </pre>
));

// Never render a stored password, even one already hashed: a history view has
// no reason to show it, and the entry list renderer showing it in plain text is
// a defect not to copy.
defineValueDisplay(["password"], () => (
  <span className="text-muted-foreground">••••••••</span>
));

defineValueDisplay(["number"], ({ value }) => (
  <span className="text-foreground font-mono tabular-nums">
    {typeof value === "number" ? value.toLocaleString() : String(value)}
  </span>
));

defineValueDisplay(["checkbox", "boolean"], ({ value }) => (
  <span className="text-foreground">{value === true ? "Yes" : "No"}</span>
));

/**
 * Format a stored date the way its picker stores it.
 *
 * `dayOnly`, `monthOnly`, and `timeOnly` values are written as UTC (midnight,
 * or 1970-01-01 for a time), so reading them in the viewer's local zone shifts
 * the day backwards in any negative-offset timezone — a date saved as the 31st
 * displays as the 30th. Only `dayAndTime` denotes a real instant and is the
 * only appearance formatted in the admin's configured timezone.
 */
function formatByPickerAppearance(field: FieldConfig, value: unknown): string {
  const appearance =
    (field as { admin?: { date?: { pickerAppearance?: string } } }).admin?.date
      ?.pickerAppearance ?? "dayOnly";

  if (appearance === "dayAndTime") return formatDateTime(value as string);

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";

  switch (appearance) {
    case "timeOnly":
      return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      });
    case "monthOnly":
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        timeZone: "UTC",
      });
    default:
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
  }
}

defineValueDisplay(["date", "datetime"], ({ value, field }) => {
  const formatted = formatByPickerAppearance(field, value);
  return formatted ? <PlainText>{formatted}</PlainText> : <EmptyValue />;
});

defineValueDisplay(["select", "radio"], ({ value, field }) => {
  if (Array.isArray(value)) {
    // An empty multi-select is a field holding nothing, not a rendering
    // failure, so it reads the same as any other empty value.
    if (value.length === 0) return <EmptyValue />;
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((entry, i) => (
          <Badge key={`${String(entry)}-${i}`} variant="default">
            {optionLabel(field, entry)}
          </Badge>
        ))}
      </div>
    );
  }
  return <PlainText>{optionLabel(field, value)}</PlainText>;
});

defineValueDisplay(["chips"], ({ value }) => {
  const items = Array.isArray(value) ? value : [];
  if (items.length === 0) return <EmptyValue />;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((entry, i) => (
        <Badge key={`${String(entry)}-${i}`} variant="default">
          {String(entry)}
        </Badge>
      ))}
    </div>
  );
});

/**
 * A relationship arrives resolved to `{ id, label }` by the read path. A null
 * label means the caller may not read that document: the reference is shown as
 * present but unnamed rather than hidden, so the value is not misread as empty.
 */
function RelationshipValue({ entry }: { entry: unknown }) {
  if (typeof entry === "string") {
    return <Badge variant="outline">{entry}</Badge>;
  }
  if (typeof entry === "object" && entry !== null) {
    // A polymorphic reference stores `{ relationTo, value }`. Unresolved, the
    // id lives under `value`; showing the object itself would print JSON.
    const poly = entry as { relationTo?: string; value?: unknown };
    if (typeof poly.value === "string" && poly.relationTo !== undefined) {
      return <Badge variant="outline">{poly.value}</Badge>;
    }
    const { id, label } = entry as { id?: string; label?: string | null };
    return label ? (
      <Badge variant="default">{label}</Badge>
    ) : (
      <Badge variant="outline" className="text-muted-foreground">
        {id ?? "Unknown"}
      </Badge>
    );
  }
  return <EmptyValue />;
}

defineValueDisplay(["relationship"], ({ value }) => {
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length === 0) return <EmptyValue />;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map((entry, i) => (
        <RelationshipValue key={i} entry={entry} />
      ))}
    </div>
  );
});

function UploadValue({ entry }: { entry: unknown }) {
  if (typeof entry === "string") {
    return <Badge variant="outline">{entry}</Badge>;
  }
  if (typeof entry !== "object" || entry === null) return <EmptyValue />;

  const file = entry as {
    id?: string;
    filename?: string | null;
    thumbnailUrl?: string | null;
    url?: string | null;
  };
  const src = file.thumbnailUrl ?? file.url;
  const name = file.filename ?? file.id ?? "Unknown file";

  return (
    <span className="inline-flex items-center gap-2 border border-border p-1 pr-2">
      {src ? (
        <img src={src} alt="" className="h-8 w-8 object-cover" loading="lazy" />
      ) : (
        <span className="h-8 w-8 bg-muted" aria-hidden="true" />
      )}
      <span className="text-sm text-foreground break-all">{name}</span>
    </span>
  );
}

defineValueDisplay(["upload", "media"], ({ value }) => {
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length === 0) return <EmptyValue />;
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map((entry, i) => (
        <UploadValue key={i} entry={entry} />
      ))}
    </div>
  );
});

defineValueDisplay(["richText"], ({ value }) => {
  const text = richTextToText(value);
  if (!text) return <EmptyValue />;
  return (
    <div className="text-foreground whitespace-pre-wrap break-words">
      {text}
    </div>
  );
});

defineValueDisplay(["json"], ({ value }) => (
  <pre className="text-xs font-mono bg-muted text-foreground p-2 overflow-x-auto whitespace-pre-wrap break-words">
    {JSON.stringify(value, null, 2)}
  </pre>
));

// ============================================================
// Containers
// ============================================================

function childFields(field: FieldConfig): FieldConfig[] {
  const nested = (field as { fields?: unknown }).fields;
  return Array.isArray(nested) ? (nested as FieldConfig[]) : [];
}

/**
 * Child fields for one component instance.
 *
 * A component field does not carry its children inline. The API enriches it
 * with `componentFields` when the field holds a single component type, and with
 * `componentSchemas` keyed by type when it is a dynamic zone — so the instance
 * decides which schema applies. Reading `field.fields` alone finds neither and
 * renders an empty shell.
 */
function componentChildFields(
  field: FieldConfig,
  instance: unknown
): FieldConfig[] {
  const enriched = field as {
    componentFields?: FieldConfig[];
    componentSchemas?: Record<string, { fields?: FieldConfig[] }>;
  };

  const typeName =
    typeof instance === "object" && instance !== null
      ? (instance as { _componentType?: string })._componentType
      : undefined;

  if (typeName && enriched.componentSchemas?.[typeName]?.fields) {
    return enriched.componentSchemas[typeName].fields;
  }
  if (Array.isArray(enriched.componentFields)) return enriched.componentFields;

  return childFields(field);
}

/** A labelled stack of child values, used by every container type. */
function NestedFields({
  fields,
  source,
}: {
  fields: FieldConfig[];
  source: unknown;
}) {
  if (typeof source !== "object" || source === null) return <EmptyValue />;
  const row = source as Record<string, unknown>;

  return (
    <div className="flex flex-col gap-2">
      {fields.map(child =>
        child.name ? (
          <FieldValueDisplay
            key={child.name}
            field={child}
            value={row[child.name]}
            dense
          />
        ) : null
      )}
    </div>
  );
}

defineValueDisplay(["group"], ({ value, field }) => {
  const children = childFields(field);
  if (children.length === 0) return <EmptyValue />;
  return (
    <div className="border-l-2 border-border pl-3">
      <NestedFields fields={children} source={value} />
    </div>
  );
});

defineValueDisplay(["repeater"], ({ value, field }) => {
  const rows = Array.isArray(value) ? value : [];
  const children = childFields(field);
  if (rows.length === 0) return <EmptyValue />;

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, i) => (
        <div key={i} className="border border-border p-3">
          <div className="text-xs text-muted-foreground mb-2">Item {i + 1}</div>
          <NestedFields fields={children} source={row} />
        </div>
      ))}
    </div>
  );
});

defineValueDisplay(["component"], ({ value, field }) => {
  const instances = Array.isArray(value) ? value : [value];
  if (instances.length === 0 || instances[0] === null) return <EmptyValue />;

  return (
    <div className="flex flex-col gap-3">
      {instances.map((instance, i) => {
        const typeName =
          typeof instance === "object" && instance !== null
            ? ((instance as { _componentType?: string })._componentType ?? null)
            : null;
        return (
          <div key={i} className="border border-border p-3">
            {typeName ? (
              <div className="text-xs text-muted-foreground mb-2">
                {typeName}
              </div>
            ) : null}
            <NestedFields
              fields={componentChildFields(field, instance)}
              source={instance}
            />
          </div>
        );
      })}
    </div>
  );
});

// ============================================================
// Entry point
// ============================================================

export interface FieldValueDisplayProps {
  field: FieldConfig;
  /** The value in storage shape; normalization happens here. */
  value: unknown;
  /** Tighter spacing and a smaller label, for values nested in a container. */
  dense?: boolean;
  className?: string;
}

/**
 * Render one field's stored value read-only, with its label.
 *
 * A field type with no registered renderer falls back to text rather than
 * rendering nothing, so an unknown or plugin-contributed type still shows its
 * value.
 */
export function FieldValueDisplay({
  field,
  value,
  dense = false,
  className,
}: FieldValueDisplayProps) {
  const normalized = normalizeStoredValue(field, value);
  const label =
    (field as { label?: string }).label ?? field.name ?? "Untitled field";

  const render = registry.get(field.type);
  const body =
    normalized === null ? (
      <EmptyValue />
    ) : (
      (render?.({ value: normalized, field }) ?? (
        <PlainText>{toText(normalized)}</PlainText>
      ))
    );

  return (
    <div
      className={cn("flex flex-col", dense ? "gap-0.5" : "gap-1", className)}
    >
      <span
        className={cn(
          "text-muted-foreground",
          dense ? "text-xs" : "text-sm font-medium"
        )}
      >
        {label}
      </span>
      <div className={dense ? "text-sm" : "text-base"}>{body}</div>
    </div>
  );
}
