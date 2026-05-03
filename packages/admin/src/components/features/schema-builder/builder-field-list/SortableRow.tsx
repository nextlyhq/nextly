// Why: one DOM container per visual row. Uses dnd-kit's useSortable on the
// row itself so rows can be reordered top-to-bottom; the field cards
// inside share the row's horizontal flex layout. Width-based packing is
// done by the parent (BuilderFieldList) before this component renders —
// SortableRow just lays out whatever fields it's given.
//
// readOnly mode hides the drag affordance and disables the action
// buttons on each card so code-first locked collections can be inspected
// but not changed.
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { parseWidth } from "@admin/lib/builder/reflow";

import type { BuilderField } from "../types";

type Props = {
  rowId: string;
  fields: readonly BuilderField[];
  readOnly?: boolean;
  onEditField: (id: string) => void;
  onDeleteField: (id: string) => void;
};

export function SortableRow({
  rowId,
  fields,
  readOnly = false,
  onEditField,
  onDeleteField,
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
}: {
  field: BuilderField;
  readOnly: boolean;
  dragHandleProps?: DragHandleProps;
  onEdit: () => void;
  onDelete: () => void;
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
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">
          {field.label || field.name}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {field.type} &middot; {widthPct}%
        </div>
      </div>
      {field.validation?.required && (
        <span className="ml-auto text-[10px] text-destructive border border-destructive/40 rounded-sm px-1">
          Required
        </span>
      )}
      {!readOnly && (
        <button
          type="button"
          aria-label={`Delete ${field.name}`}
          onClick={e => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 text-destructive text-xs"
        >
          Delete
        </button>
      )}
    </div>
  );
}
