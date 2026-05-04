// Why: PR I (Q1 layout B) -- ACF-style visual nesting. Renders one parent's
// children inside a bordered child container that sits inside the parent's
// row. Each parent gets its own SortableContext so within-parent drag
// reorder works (Q2). Children that are themselves repeater/group recurse.
// component fields stay leaves (Q4) and are NOT expanded here -- the
// parent BuilderFieldList only mounts NestedFieldGroup for repeater/group,
// and inside this component the recursion check (`isContainer`) likewise
// excludes component.
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import * as Icons from "@admin/components/icons";
import type { LucideIcon } from "@admin/components/icons";

import { FIELD_TYPES_CATALOG } from "../field-picker-modal/field-types-catalog";
import type { BuilderField } from "../types";

import { NestedAddButton } from "./NestedAddButton";

type Props = {
  parentField: BuilderField;
  readOnly?: boolean;
  onEditField: (id: string) => void;
  onDeleteField: (id: string) => void;
  onDuplicateField: (id: string) => void;
  onAddInsideParent: (parentId: string) => void;
};

const fieldTypeIconName: Record<string, string> = Object.fromEntries(
  FIELD_TYPES_CATALOG.map(t => [t.type, t.icon])
);
const iconMap = Icons as unknown as Record<string, LucideIcon>;
function resolveFieldIcon(type: string): LucideIcon {
  const name = fieldTypeIconName[type] ?? "FileText";
  return iconMap[name] ?? Icons.FileText;
}

export function NestedFieldGroup({
  parentField,
  readOnly = false,
  onEditField,
  onDeleteField,
  onDuplicateField,
  onAddInsideParent,
}: Props) {
  const children = parentField.fields ?? [];
  const parentLabel = parentField.label || parentField.name || "parent";

  return (
    // Why: Q1 layout B -- bordered child container nested inside the
    // parent's row. Soft border + soft bg so it reads as "inside" without
    // double-heavy borders.
    <div className="mt-3 border border-border rounded-md p-2 bg-muted/10">
      {children.length > 0 && (
        <SortableContext
          items={children.map(c => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1.5">
            {children.map(child => (
              <NestedFieldRow
                key={child.id}
                field={child}
                readOnly={readOnly}
                onEditField={onEditField}
                onDeleteField={onDeleteField}
                onDuplicateField={onDuplicateField}
                onAddInsideParent={onAddInsideParent}
              />
            ))}
          </div>
        </SortableContext>
      )}

      {!readOnly && (
        <NestedAddButton
          parentLabel={parentLabel}
          onClick={() => onAddInsideParent(parentField.id)}
        />
      )}
    </div>
  );
}

function NestedFieldRow({
  field,
  readOnly,
  onEditField,
  onDeleteField,
  onDuplicateField,
  onAddInsideParent,
}: {
  field: BuilderField;
  readOnly: boolean;
  onEditField: (id: string) => void;
  onDeleteField: (id: string) => void;
  onDuplicateField: (id: string) => void;
  onAddInsideParent: (parentId: string) => void;
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id, disabled: readOnly });
  const Icon = resolveFieldIcon(field.type);
  // Why: Q4 -- only repeater/group recurse. component is a leaf even when
  // it points to a single component definition (children come from the
  // referenced component, not inline).
  const isContainer = field.type === "repeater" || field.type === "group";

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onEditField(field.id)}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onEditField(field.id);
          }
        }}
        className="border border-border rounded-md px-3 py-2 bg-background hover:border-primary/30 cursor-pointer flex items-center gap-2 group"
      >
        {!readOnly && (
          <button
            type="button"
            aria-label={`Reorder ${field.name}`}
            className="text-muted-foreground select-none cursor-grab text-xs"
            {...attributes}
            {...listeners}
            // Why: stop click-to-edit firing when the user taps the handle.
            onClick={e => e.stopPropagation()}
          >
            ⋮⋮
          </button>
        )}
        <span className="shrink-0 w-6 h-6 rounded-md bg-muted/50 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">
            {field.label || field.name}
          </div>
          <div className="text-[11px] text-muted-foreground truncate font-mono">
            {field.name}
          </div>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            <button
              type="button"
              aria-label={`Duplicate ${field.name}`}
              onClick={e => {
                e.stopPropagation();
                onDuplicateField(field.id);
              }}
              className="p-1 rounded-sm hover:bg-muted text-muted-foreground"
            >
              <Icons.Copy className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label={`Delete ${field.name}`}
              onClick={e => {
                e.stopPropagation();
                onDeleteField(field.id);
              }}
              className="p-1 rounded-sm hover:bg-muted text-destructive"
            >
              <Icons.Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Why: recursive expansion for nested repeater/group only (Q4). */}
      {isContainer && (
        <NestedFieldGroup
          parentField={field}
          readOnly={readOnly}
          onEditField={onEditField}
          onDeleteField={onDeleteField}
          onDuplicateField={onDuplicateField}
          onAddInsideParent={onAddInsideParent}
        />
      )}
    </div>
  );
}
