import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Button } from "@revnixhq/ui";

import { Edit, Trash } from "@admin/components/icons";
import type {
  FieldConfig,
  SortableFieldRowProps,
  FieldType,
} from "@admin/types/ui/collection";

function formatFieldTypeLabel(type: FieldType | string) {
  const value = String(type);
  return value
    .split("_")
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

function SortableFieldRow({
  id,
  field,
  index,
  onEdit,
  setDeletingIndex,
}: SortableFieldRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <tr
      ref={setNodeRef}
      className={`${isDragging ? "bg-primary/5" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <td className="px-6 py-4 whitespace-nowrap text-sm">
        <span
          className="cursor-grab flex items-center select-none"
          {...attributes}
          {...listeners}
          tabIndex={0}
          aria-label="Drag handle"
          style={{ touchAction: "none" }}
        >
          <svg
            width="16"
            height="16"
            fill="currentColor"
            className="mr-2 text-gray-400"
            viewBox="0 0 20 20"
          >
            <circle cx="5" cy="6" r="1.5" />
            <circle cx="5" cy="10" r="1.5" />
            <circle cx="5" cy="14" r="1.5" />
            <circle cx="10" cy="6" r="1.5" />
            <circle cx="10" cy="10" r="1.5" />
            <circle cx="10" cy="14" r="1.5" />
          </svg>
          {field.name}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm">{field.label}</td>
      <td className="px-6 py-4 whitespace-nowrap text-sm">
        <Badge variant="outline">{formatFieldTypeLabel(field.type)}</Badge>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm">
        {"validation" in field && field.validation && field.validation.required
          ? "Yes"
          : "No"}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
        <div className="flex space-x-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onEdit(index)}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setDeletingIndex(index)}
          >
            <Trash className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export interface SortableFieldsTableProps {
  fields: FieldConfig[];
  onReorder: (fields: FieldConfig[]) => void;
  onEdit: (index: number) => void;
  onDeleteRequest: (index: number) => void;
}

export function SortableFieldsTable({
  fields,
  onReorder,
  onEdit,
  onDeleteRequest,
}: SortableFieldsTableProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = fields.findIndex(f => f.name === active.id);
    const newIndex = fields.findIndex(f => f.name === over.id);
    if (oldIndex !== newIndex) {
      onReorder(arrayMove(fields, oldIndex, newIndex));
    }
  };

  return (
    <div className="border rounded-none">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={fields.map(f => f.name)}
          strategy={verticalListSortingStrategy}
        >
          <table className="w-full divide-y divide-border">
            <thead className="bg-primary/5">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Name
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Label
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Type
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Required
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {fields.map((field, index) => (
                <SortableFieldRow
                  key={field.name}
                  id={field.name}
                  field={field}
                  index={index}
                  onEdit={onEdit}
                  setDeletingIndex={onDeleteRequest}
                />
              ))}
            </tbody>
          </table>
        </SortableContext>
      </DndContext>
    </div>
  );
}
