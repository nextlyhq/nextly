// Why: top-level field list — Built-in group above (always shown), user
// fields below packed into rows by width using packIntoRows from
// lib/builder/reflow. The page that mounts this owns the DndContext and
// the in-memory builder state; this component renders SortableRows that
// participate in the parent's sortable context.
//
// readOnly hides the "+ Add field" button and disables per-card delete +
// drag affordances (each SortableRow handles its own readOnly rendering).
//
// PR 1 scope note: SortableContext wiring (which sortable strategy, the
// sensors setup, the onDragEnd handler) lives in the parent page in
// PR 2. This component provides the visual layout and click-to-edit; DnD
// reordering will be hooked up alongside the page-level mount.
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@revnixhq/ui";
import { useEffect, useState } from "react";

import {
  packIntoRows,
  parseWidth,
  type WidthField,
} from "@admin/lib/builder/reflow";

import { EmptyState } from "./builder-field-list/EmptyState";
import { SortableRow } from "./builder-field-list/SortableRow";
import { SystemFieldsRow } from "./builder-field-list/SystemFieldsRow";
import type { BuilderField } from "./types";

type Props = {
  fields: readonly BuilderField[];
  /** Called when the user wants to insert a new field. index = position. */
  onAddAt: (index: number) => void;
  onEditField: (id: string) => void;
  onDeleteField: (id: string) => void;
  onDuplicateField: (id: string) => void;
  /** Reorder callback — wired by the parent's DndContext.onDragEnd. */
  onReorder: (orderedIds: readonly string[]) => void;
  /** Lock all editing affordances for code-first / locked collections. */
  readOnly?: boolean;
};

type RowItem = WidthField & { _field: BuilderField };

export function BuilderFieldList({
  fields,
  onAddAt,
  onEditField,
  onDeleteField,
  onDuplicateField,
  readOnly = false,
}: Props) {
  const systemFields = fields.filter(f => f.isSystem);
  const userFields = fields.filter(f => !f.isSystem);

  const rows = packIntoRows<RowItem>(
    userFields.map(f => ({
      id: f.id,
      width: parseWidth(f.admin?.width),
      _field: f,
    }))
  );

  return (
    <div className="space-y-6 p-4">
      <SystemFieldsContainer systemFields={systemFields} />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Your fields
          </div>
          {!readOnly && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAddAt(userFields.length)}
            >
              + Add field
            </Button>
          )}
        </div>

        {userFields.length === 0 ? (
          <EmptyState onAdd={() => onAddAt(0)} readOnly={readOnly} />
        ) : (
          // Why: dnd-kit's useSortable inside SortableRow needs an
          // enclosing SortableContext that knows the ordered list of
          // sortable item IDs. Without this wrapper, useSortable never
          // registers and pointer events are silently ignored.
          <SortableContext
            items={rows.map((_, idx) => `row-${idx}`)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <SortableRow
                  key={`row-${idx}`}
                  rowId={`row-${idx}`}
                  fields={row.map(r => r._field)}
                  readOnly={readOnly}
                  onEditField={onEditField}
                  onDeleteField={onDeleteField}
                  onDuplicateField={onDuplicateField}
                />
              ))}
            </div>
          </SortableContext>
        )}

        {!readOnly && userFields.length > 0 && (
          // Why: a second "+ Add field" affordance below the last row
          // matches the natural reading order -- after seeing all fields,
          // the user can add another without scrolling back to the top.
          // Hidden on the empty state because the empty-state CTA already
          // serves that purpose. Feedback Section 5 last item.
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAddAt(userFields.length)}
            className="self-start mt-2"
          >
            + Add field
          </Button>
        )}
      </div>
    </div>
  );
}

function SystemFieldsContainer({
  systemFields,
}: {
  systemFields: readonly BuilderField[];
}) {
  // Why: state lives here so the inline Hide button + the Settings
  // modal toggle both land back in the localStorage pref and broadcast
  // via the existing 'builder:show-system-fields' window event. PR G
  // (feedback 2) made this an all-or-nothing toggle: when false, the
  // entire SystemFieldsRow unmounts (label + box + chips). The
  // Settings modal switch is the only way to bring it back.
  const [showSystemFields, setShowSystemFields] = useState(true);

  useEffect(() => {
    const v = localStorage.getItem("builder.showSystemInternals");
    setShowSystemFields(v === null ? true : v === "true");
  }, []);

  useEffect(() => {
    const onUpdate = (e: Event) => {
      setShowSystemFields((e as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener("builder:show-system-fields", onUpdate);
    return () =>
      window.removeEventListener("builder:show-system-fields", onUpdate);
  }, []);

  if (!showSystemFields) return null;

  return (
    <SystemFieldsRow
      systemFields={systemFields}
      onSetVisible={setShowSystemFields}
    />
  );
}
