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
import { Button } from "@revnixhq/ui";

import {
  packIntoRows,
  parseWidth,
  type WidthField,
} from "@admin/lib/builder/reflow";

import { BuiltInGroup } from "./builder-field-list/BuiltInGroup";
import { EmptyState } from "./builder-field-list/EmptyState";
import { SortableRow } from "./builder-field-list/SortableRow";
import type { BuilderField } from "./types";

type Props = {
  fields: readonly BuilderField[];
  /** Called when the user wants to insert a new field. index = position. */
  onAddAt: (index: number) => void;
  onEditField: (id: string) => void;
  onDeleteField: (id: string) => void;
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
      <BuiltInGroup systemFields={systemFields} onEditField={onEditField} />

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
          <div className="space-y-2">
            {rows.map((row, idx) => (
              <SortableRow
                key={`row-${idx}`}
                rowId={`row-${idx}`}
                fields={row.map(r => r._field)}
                readOnly={readOnly}
                onEditField={onEditField}
                onDeleteField={onDeleteField}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
