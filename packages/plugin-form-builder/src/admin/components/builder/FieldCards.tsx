"use client";

/**
 * Field Cards
 *
 * The form builder's field list: one collapsible card per field, edited
 * inline. This is the whole field-editing surface — there is no separate
 * palette or properties sidebar.
 *
 * Reordering is triple-redundant on purpose: drag handles (pointer), the
 * same handle with Space + arrow keys (dnd-kit keyboard sensor), and
 * explicit Move up / Move down menu items. Deleting a field that another
 * field's condition or a notification references is blocked with the list
 * of referrers instead of silently breaking them.
 *
 * @module admin/components/builder/FieldCards
 */

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { usePluginFieldTypeEntries } from "@nextlyhq/plugin-sdk/admin";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nextlyhq/ui";
import * as Lucide from "lucide-react";
import type {
  FieldTypeCatalogEntry,
  FormFieldCatalogType,
} from "nextly/field-catalog";
import { FORM_FIELD_TYPE_CATALOG } from "nextly/field-catalog";
import { useCallback, useMemo, useState } from "react";

import type { AnyFormField, FormFieldTypeId } from "../../../types";
import { buildFieldReferenceMap } from "../../../utils/field-references";
import { useFormBuilder } from "../../context/FormBuilderContext";

import { AddFieldDialog } from "./AddFieldDialog";
import { FieldEditor } from "./FieldEditor";

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

const CATALOG_BY_TYPE = new Map<
  string,
  FieldTypeCatalogEntry<FormFieldCatalogType>
>(FORM_FIELD_TYPE_CATALOG.map(entry => [entry.type, entry]));

/** Resolve a catalog icon name against lucide; unknown names fall back. */
function CatalogIcon({
  name,
  className,
}: {
  name: string | undefined;
  className?: string;
}) {
  const icons = Lucide as unknown as Record<string, React.ElementType>;
  const Icon = (name && icons[name]) || Lucide.Type;
  return <Icon className={className} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// One field card
// ---------------------------------------------------------------------------

interface FieldCardProps {
  field: AnyFormField;
  index: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  allFields: AnyFormField[];
  deleteBlockers: string[];
  onUpdate: (updates: Partial<AnyFormField>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}

function FieldCard({
  field,
  index,
  total,
  expanded,
  onToggle,
  allFields,
  deleteBlockers,
  onUpdate,
  onDuplicate,
  onDelete,
  onMove,
}: FieldCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.name });

  const entry = CATALOG_BY_TYPE.get(field.type);
  const headerId = `field-card-header-${field.name}`;
  const bodyId = `field-card-body-${field.name}`;
  const deleteBlocked = deleteBlockers.length > 0;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        // Dragging uses full-strength border-primary so the lifted card stands out; the resting state uses border-border, keeping the two distinct.
        isDragging
          ? "border border-primary bg-card opacity-80 relative z-10"
          : "border border-border bg-card"
      }
    >
      {/* Header row: every control is a real, separate interactive element —
          no nested-button markup. */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-none text-muted-foreground hover:text-foreground hover:bg-primary/5 cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`Reorder ${field.label || field.name}. Press Space to lift, arrow keys to move, Space to drop.`}
        >
          <Lucide.GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          id={headerId}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-none py-1 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-primary/5 text-primary">
            <CatalogIcon name={entry?.icon} className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {field.label || field.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {entry?.label ?? field.type}
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span className="font-mono">{field.name}</span>
            </span>
          </span>
          {field.required && (
            <span className="shrink-0 border border-border bg-primary/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              Required
            </span>
          )}
          <Lucide.ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8 shrink-0 rounded-none text-muted-foreground hover:text-foreground"
              aria-label={`Actions for ${field.label || field.name}`}
            >
              <Lucide.MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56 shadow-none border-border"
          >
            <DropdownMenuItem
              disabled={index === 0}
              onClick={() => onMove(-1)}
              className="gap-2 cursor-pointer"
            >
              <Lucide.ArrowUp className="h-4 w-4 text-muted-foreground" />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === total - 1}
              onClick={() => onMove(1)}
              className="gap-2 cursor-pointer"
            >
              <Lucide.ArrowDown className="h-4 w-4 text-muted-foreground" />
              Move down
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDuplicate}
              className="gap-2 cursor-pointer"
            >
              <Lucide.Copy className="h-4 w-4 text-muted-foreground" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {deleteBlocked ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <div>
                    <DropdownMenuItem
                      disabled
                      className="gap-2 text-muted-foreground"
                    >
                      <Lucide.Trash2 className="h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-64">
                  Used by {deleteBlockers.join(", ")}. Remove those references
                  first.
                </TooltipContent>
              </Tooltip>
            ) : (
              <DropdownMenuItem
                onClick={onDelete}
                className="gap-2 cursor-pointer text-destructive focus:text-destructive"
              >
                <Lucide.Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Inline properties: the card IS the properties panel. */}
      {expanded && (
        <div
          id={bodyId}
          role="region"
          aria-labelledby={headerId}
          className="border-t border-border"
        >
          <FieldEditor
            field={field}
            allFields={allFields}
            onUpdate={onUpdate}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export interface FieldCardsProps {
  /**
   * Form-surface types the host has NOT excluded (the plugin's field
   * enable/disable option). `null` while the host configuration is still
   * loading — the Add dialog waits rather than flashing the unfiltered set.
   * Types outside this set stay renderable on existing fields but cannot be
   * added.
   */
  enabledTypes: readonly FormFieldCatalogType[] | null;
  /**
   * Type ids the host disabled (`config.fields[type] === false`). Applied to
   * plugin field types too, so the host exclude layer is not bypassed for
   * contributed types.
   */
  disabledFieldTypes?: ReadonlySet<string>;
  /** Creates a field of the given type and returns it (context helper). */
  onAddField: (type: FormFieldTypeId) => void;
}

export function FieldCards({
  enabledTypes,
  disabledFieldTypes,
  onAddField,
}: FieldCardsProps) {
  const {
    fields,
    notifications,
    selectedFieldId,
    selectField,
    updateField,
    deleteField,
    duplicateField,
    moveField,
  } = useFormBuilder();

  const [isAddOpen, setIsAddOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Plugin field types that opted into the forms surface, offered alongside the
  // enabled built-ins. A plugin reusing a built-in id never shadows it.
  const pluginEntries = usePluginFieldTypeEntries("forms");

  const entries = useMemo(() => {
    if (enabledTypes === null) return null;
    const allowed = new Set<string>(enabledTypes);
    const builtinTypes = new Set<string>(
      FORM_FIELD_TYPE_CATALOG.map(entry => entry.type)
    );
    const builtins: FieldTypeCatalogEntry<FormFieldTypeId>[] =
      FORM_FIELD_TYPE_CATALOG.filter(entry => allowed.has(entry.type));
    return [
      ...builtins,
      // A plugin type a built-in shadows, or one the host disabled, is excluded.
      ...pluginEntries.filter(
        entry =>
          !builtinTypes.has(entry.type) && !disabledFieldTypes?.has(entry.type)
      ),
    ];
  }, [enabledTypes, pluginEntries, disabledFieldTypes]);

  // One O(N^2) pass per fields/notifications change; each card then looks
  // its blockers up in O(1) instead of re-walking everything per render.
  const referenceMap = useMemo(
    () => buildFieldReferenceMap(fields, notifications),
    [fields, notifications]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = fields.findIndex(f => f.name === active.id);
      const to = fields.findIndex(f => f.name === over.id);
      if (from !== -1 && to !== -1) moveField(from, to);
    },
    [fields, moveField]
  );

  return (
    <div className="space-y-3">
      {fields.length === 0 ? (
        <div className="flex flex-col items-center gap-3 border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex h-10 w-10 items-center justify-center bg-primary/10 text-primary">
            <Lucide.ListPlus className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">No fields yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add the first field to start building this form.
            </p>
          </div>
          <Button type="button" size="sm" onClick={() => setIsAddOpen(true)}>
            Add field
          </Button>
        </div>
      ) : (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={fields.map(f => f.name)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2" aria-label="Form fields">
                {fields.map((field, index) => (
                  <li key={field.name}>
                    <FieldCard
                      field={field}
                      index={index}
                      total={fields.length}
                      expanded={selectedFieldId === field.name}
                      onToggle={() =>
                        selectField(
                          selectedFieldId === field.name ? null : field.name
                        )
                      }
                      allFields={fields}
                      deleteBlockers={(referenceMap.get(field.name) ?? []).map(
                        ref => ref.label
                      )}
                      onUpdate={updates => updateField(field.name, updates)}
                      onDuplicate={() => duplicateField(field.name)}
                      onDelete={() => deleteField(field.name)}
                      onMove={direction => moveField(index, index + direction)}
                    />
                  </li>
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsAddOpen(true)}
            className="w-full border-dashed"
          >
            <Lucide.Plus className="h-4 w-4" aria-hidden="true" />
            Add field
          </Button>
        </>
      )}

      <AddFieldDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        entries={entries}
        onAdd={onAddField}
      />
    </div>
  );
}
