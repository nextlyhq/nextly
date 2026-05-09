// Why: one DOM container per visual row. Uses dnd-kit's useSortable on the
// row itself so rows can be reordered top-to-bottom; the field cards
// inside share the row's horizontal flex layout. Width-based packing is
// done by the parent (BuilderFieldList) before this component renders --
// SortableRow just lays out whatever fields it's given.
//
// readOnly mode hides the drag affordance and the Edit/Duplicate/Delete
// icon cluster so code-first locked collections can be inspected but
// not changed.
//
// PR D updates each field card with:
//   - field-type icon on the left (replaces the "type · width" subtitle)
//   - internal name as the subtitle (machine identifier under the label)
//   - width badge with a `title=` tooltip explaining how to change it
//   - Edit / Duplicate / Delete icon cluster (hover-revealed)
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type React from "react";

import * as Icons from "@admin/components/icons";
import type { LucideIcon } from "@admin/components/icons";
import { parseWidth } from "@admin/lib/builder/reflow";

import { FIELD_TYPES_CATALOG } from "../field-picker-modal/field-types-catalog";
import type { BuilderField } from "../types";

// Why: lookup map from field type -> Lucide icon name. Catalog is the
// source of truth (PR C centralized icons there).
const fieldTypeIconName: Record<string, string> = Object.fromEntries(
  FIELD_TYPES_CATALOG.map(t => [t.type, t.icon])
);
const iconMap = Icons as unknown as Record<string, LucideIcon>;
function resolveFieldIcon(type: string): LucideIcon {
  const name = fieldTypeIconName[type] ?? "FileText";
  return iconMap[name] ?? Icons.FileText;
}

type Props = {
  rowId: string;
  fields: readonly BuilderField[];
  readOnly?: boolean;
  onEditField: (id: string) => void;
  onDeleteField: (id: string) => void;
  onDuplicateField: (id: string) => void;
};

export function SortableRow({
  rowId,
  fields,
  readOnly = false,
  onEditField,
  onDeleteField,
  onDuplicateField,
}: Props) {
  // Why: previously only setNodeRef + transform/transition were extracted,
  // so useSortable's pointer/keyboard listeners were never attached to the
  // drag handle -- making the row visually styled but undraggable. Spread
  // {attributes, listeners} on the handle inside the first card below.
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rowId, disabled: readOnly });

  return (
    <div
      ref={setNodeRef}
      data-row-id={rowId}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex gap-2"
    >
      {fields.map((f, i) => (
        <FieldCard
          key={f.id}
          field={f}
          readOnly={readOnly}
          // Why: only the first card in each row mounts the drag handle.
          // The handle drives the whole row's reorder (rows are the
          // sortable unit, not individual cards).
          dragHandleProps={
            i === 0 && !readOnly ? { attributes, listeners } : undefined
          }
          onEdit={() => onEditField(f.id)}
          onDelete={() => onDeleteField(f.id)}
          onDuplicate={() => onDuplicateField(f.id)}
        />
      ))}
    </div>
  );
}

type DragHandleProps = {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
};

function FieldCard({
  field,
  readOnly,
  dragHandleProps,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  field: BuilderField;
  readOnly: boolean;
  dragHandleProps?: DragHandleProps;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const widthPct = parseWidth(field.admin?.width);
  // Tailwind doesn't have arbitrary calc() in flex-basis utilities at
  // every value, so set it inline based on the parsed width.
  const flexBasis = `calc(${widthPct}% - 0.5rem)`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit();
        }
      }}
      style={{ flex: `0 0 ${flexBasis}` }}
      className="border border-border rounded-md p-3 bg-background hover:border-primary/30 cursor-pointer flex items-center gap-2 group"
    >
      {!readOnly && dragHandleProps && (
        <button
          type="button"
          aria-label="Reorder field"
          className="text-muted-foreground select-none cursor-grab"
          {...dragHandleProps.attributes}
          {...dragHandleProps.listeners}
          // Why: stop the row's click-to-edit from firing when the user
          // taps the handle (vs drags it).
          onClick={e => e.stopPropagation()}
        >
          ⋮⋮
        </button>
      )}
      {/* Why: PR D -- field-type icon replaces the "type · width" text
          below the field name. Icon comes from the catalog so picker +
          list stay visually consistent. */}
      <span className="shrink-0 w-7 h-7 rounded-md bg-muted/50 flex items-center justify-center">
        <FieldIcon type={field.type} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">
          {field.label || field.name}
        </div>
        <div className="text-xs text-muted-foreground truncate font-mono">
          {field.name}
        </div>
      </div>
      {/* Why: width badge has a tooltip explaining how to change it. We
          use the `title` HTML attribute as a portable tooltip; on richer
          platforms this becomes a Radix Tooltip in a follow-up. */}
      <span
        title={`Width: ${widthPct}%. Configure in the field's Display tab.`}
        className="text-[10px] border border-border rounded-sm px-1 py-0.5 text-muted-foreground"
      >
        {widthPct}%
      </span>
      {field.validation?.required && (
        <span className="text-[10px] text-destructive border border-destructive/40 rounded-sm px-1">
          Required
        </span>
      )}
      {!readOnly && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <IconActionButton
            ariaLabel={`Edit ${field.name}`}
            onClick={e => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Icons.Pencil className="h-3.5 w-3.5" />
          </IconActionButton>
          <IconActionButton
            ariaLabel={`Duplicate ${field.name}`}
            onClick={e => {
              e.stopPropagation();
              onDuplicate();
            }}
          >
            <Icons.Copy className="h-3.5 w-3.5" />
          </IconActionButton>
          <IconActionButton
            ariaLabel={`Delete ${field.name}`}
            onClick={e => {
              e.stopPropagation();
              onDelete();
            }}
            variant="destructive"
          >
            <Icons.Trash2 className="h-3.5 w-3.5" />
          </IconActionButton>
        </div>
      )}
    </div>
  );
}

function FieldIcon({ type }: { type: string }) {
  const Icon = resolveFieldIcon(type);
  return <Icon className="h-4 w-4 text-muted-foreground" />;
}

function IconActionButton({
  ariaLabel,
  onClick,
  variant,
  children,
}: {
  ariaLabel: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: "destructive";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={
        "p-1 rounded-sm hover:bg-muted " +
        (variant === "destructive"
          ? "text-destructive hover:text-destructive"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}
