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
import type React from "react";
import type { JSX } from "react";

import * as Icons from "@admin/components/icons";
import type { LucideIcon } from "@admin/components/icons";
import { fieldSubject } from "@admin/lib/builder/builder-announcements";
import {
  positionAfter,
  type FieldInsertPosition,
} from "@admin/lib/builder/insert-field";
import { packIntoRows, parseWidth } from "@admin/lib/builder/reflow";
import type { WidthField } from "@admin/lib/builder/reflow";
import { cn } from "@admin/lib/utils";

import { FIELD_TYPES_CATALOG } from "../field-picker-modal/field-types-catalog";
import type { BuilderField } from "../types";

import { InsertBetweenButton } from "./InsertBetweenButton";
import { NestedAddButton } from "./NestedAddButton";
import { isSlashToAdd } from "./slash-to-add";
import { isFieldLocked } from "./SortableRow";

type Props = {
  parentField: BuilderField;
  readOnly?: boolean;
  onEditField: (id: string) => void;
  onDeleteField: (id: string) => void;
  onDuplicateField: (id: string) => void;
  /** Opens the field picker at a position inside this container. */
  onAddAt: (position: FieldInsertPosition) => void;
};

const fieldTypeIconName: Record<string, string> = Object.fromEntries(
  FIELD_TYPES_CATALOG.map(t => [t.type, t.icon])
);
const iconMap = Icons as unknown as Record<string, LucideIcon>;
function resolveFieldIcon(type: string): LucideIcon {
  const name = fieldTypeIconName[type] ?? "FileText";
  return iconMap[name] ?? Icons.FileText;
}

type RowItem = WidthField & { _field: BuilderField };

export function NestedFieldGroup({
  parentField,
  readOnly = false,
  onEditField,
  onDeleteField,
  onDuplicateField,
  onAddAt,
}: Props): JSX.Element {
  const children = parentField.fields ?? [];
  const parentLabel = parentField.label || parentField.name || "parent";
  // Nothing is added into a container that is read-only, locked or owned by a
  // plugin, and what it holds is read-only with it, at every depth below.
  const locked = isFieldLocked(parentField, readOnly);
  // "/" on a field adds right after it, placed from this container's own list.
  const addAfter = (fieldId: string) => {
    const position = positionAfter(children, fieldId, parentField.id);
    if (position) onAddAt(position);
  };

  const rows = packIntoRows<RowItem>(
    children.map(c => ({
      id: c.id,
      width:
        c.type === "repeater" || c.type === "group"
          ? 100
          : parseWidth(c.admin?.width),
      _field: c,
    }))
  );

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
            {rows.map((row, rIdx) => (
              <div key={rIdx} className="space-y-1.5">
                {rIdx > 0 && !locked && (
                  <InsertBetweenButton
                    before={row[0]._field}
                    onClick={() =>
                      onAddAt({
                        parentFieldId: parentField.id,
                        beforeFieldId: row[0].id,
                      })
                    }
                  />
                )}
                <div className="flex gap-2 w-full">
                  {row.map(item => (
                    <NestedFieldRow
                      key={item.id}
                      field={item._field}
                      readOnly={locked}
                      onEditField={onEditField}
                      onDeleteField={onDeleteField}
                      onDuplicateField={onDuplicateField}
                      onAddAt={onAddAt}
                      onAddAfter={addAfter}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SortableContext>
      )}

      {!locked && (
        <NestedAddButton
          parentLabel={parentLabel}
          onClick={() => onAddAt({ parentFieldId: parentField.id })}
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
  onAddAt,
  onAddAfter,
}: {
  field: BuilderField;
  readOnly: boolean;
  onEditField: (id: string) => void;
  onDeleteField: (id: string) => void;
  onDuplicateField: (id: string) => void;
  onAddAt: (position: FieldInsertPosition) => void;
  onAddAfter: (id: string) => void;
}) {
  // One lock answer per row, as the top-level cards have: a field locked on its
  // own (plugin-contributed or locked) is inert even in an editable container.
  const rowLocked = isFieldLocked(field, readOnly);
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id, disabled: rowLocked });
  const interactiveProps = rowLocked
    ? {}
    : {
        role: "button" as const,
        tabIndex: 0,
        "aria-keyshortcuts": "/",
        onClick: () => onEditField(field.id),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onEditField(field.id);
          } else if (isSlashToAdd(e)) {
            // "/" adds a field right after this one, in this container.
            e.preventDefault();
            onAddAfter(field.id);
          }
        },
      };
  const Icon = resolveFieldIcon(field.type);
  // Why: Q4 -- only repeater/group recurse. component is a leaf even when
  // it points to a single component definition (children come from the
  // referenced component, not inline).
  const isContainer = field.type === "repeater" || field.type === "group";

  const widthPct = parseWidth(field.admin?.width);
  const flexBasis = `calc(${widthPct}% - 0.5rem)`;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        flex: isContainer ? "0 0 100%" : `0 0 ${flexBasis}`,
      }}
      className={cn(isContainer ? "w-full" : "")}
    >
      <div
        {...interactiveProps}
        // Named as the top-level cards are, so a row is found the same way at any depth.
        data-testid={`field-row-${field.name}`}
        // Full-strength hover border, more visible than the resting border, not a fainter alpha.
        className={cn(
          "border border-border rounded-md px-3 py-2 bg-background flex items-center gap-2 group",
          rowLocked ? "opacity-90" : "hover:border-primary cursor-pointer"
        )}
      >
        {!rowLocked && (
          <button
            type="button"
            aria-label={`Reorder ${fieldSubject(field)}`}
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
          <div className="text-xs text-muted-foreground truncate font-mono">
            {field.name}
          </div>
        </div>
        {!rowLocked && (
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
          onAddAt={onAddAt}
        />
      )}
    </div>
  );
}
