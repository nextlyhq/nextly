"use client";

/**
 * Field Cards
 *
 * The form builder's fields as one outline: a row per field showing its
 * label, type and name, with badges for what it would otherwise take opening
 * it to see (required, width, a condition, a default). Selecting a row opens
 * the shared settings panel (`FieldInspector`): docked at the window's edge
 * where the window is wide enough, and under the row where it is not.
 *
 * A field is added through the shared field picker, from the toolbar, from
 * between two rows, or with "/" on a row, which adds below it.
 *
 * Reordering is triple-redundant on purpose: drag handles (pointer), the
 * same handle with Space + arrow keys (dnd-kit keyboard sensor), and
 * explicit Move up / Move down menu items. Deleting a field that another
 * field's condition, a notification or a form setting references is blocked
 * with the list of referrers instead of silently breaking them.
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
import {
  describeFieldTypes,
  FieldPicker,
  type FieldPickerChoice,
  type FieldPickerConfig,
} from "@nextlyhq/plugin-sdk/admin";
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
import {
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";

import type { AnyFormField, FormFieldTypeId } from "../../../types";
import { buildFieldReferenceMap } from "../../../utils/field-references";
import {
  useFieldBookkeeping,
  useFormBuilder,
} from "../../context/FormBuilderContext";

import { fieldBadges, type FieldBadge } from "./field-badges";
import { DOCKED_PANEL_ID, useDocked, useFieldPanel } from "./FieldInspector";
import { formFieldName } from "./forms-field-surface";

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
// One row
// ---------------------------------------------------------------------------

/** A row's badges, quiet chips; Required reads in the foreground colour. */
function Badges({ badges }: { badges: readonly FieldBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <span className="hidden shrink-0 flex-wrap justify-end gap-1 sm:flex">
      {badges.map(badge => (
        <span
          key={badge.kind}
          title={badge.title}
          className={`inline-flex h-5 items-center gap-1 whitespace-nowrap rounded border border-border bg-card px-1.5 text-[11px] font-medium ${
            badge.kind === "required"
              ? "text-foreground"
              : "text-muted-foreground"
          }`}
        >
          {badge.kind === "condition" ? (
            <Lucide.GitBranch className="h-3 w-3" aria-hidden="true" />
          ) : null}
          {badge.label}
        </span>
      ))}
    </span>
  );
}

interface FieldActionsProps {
  label: string;
  index: number;
  total: number;
  deleteBlockers: readonly string[];
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}

/** A row's menu: move, duplicate, and delete unless something refers to it. */
function FieldActions({
  label,
  index,
  total,
  deleteBlockers,
  onDuplicate,
  onDelete,
  onMove,
}: FieldActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Actions for ${label}`}
        >
          <Lucide.MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className="gap-2"
        >
          <Lucide.ArrowUp className="h-4 w-4 text-muted-foreground" />
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          className="gap-2"
        >
          <Lucide.ArrowDown className="h-4 w-4 text-muted-foreground" />
          Move down
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDuplicate} className="gap-2">
          <Lucide.Copy className="h-4 w-4 text-muted-foreground" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {deleteBlockers.length > 0 ? (
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
            className="gap-2 text-destructive focus:text-destructive"
          >
            <Lucide.Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * "Add here", on the edge above a row: a field goes where it belongs rather
 * than at the end and dragged up. Shown on hover of that row and on keyboard
 * focus, and absent above the first row.
 */
function AddHere({
  label,
  onAdd,
}: {
  label: string;
  onAdd: (() => void) | undefined;
}) {
  if (onAdd === undefined) return null;
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={`Add a field above ${label}`}
      // 24px tall, the smallest target a pointer is asked to hit, and shown
      // only for the row under the pointer, so the list does not fill with
      // them at once.
      className="absolute left-1/2 top-0 z-10 inline-flex h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-border bg-card px-2.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100"
    >
      <Lucide.Plus className="h-3 w-3" aria-hidden="true" />
      Add here
    </button>
  );
}

interface OutlineRowProps extends Omit<FieldActionsProps, "label"> {
  field: AnyFormField;
  /** Its key while edited: React's, and the inline panel's id. */
  rowKey: string;
  badges: readonly FieldBadge[];
  selected: boolean;
  /** The panel under the row, where the window is too narrow to dock it. */
  settings: ReactNode;
  /** Where a selected row's settings open, for `aria-controls`. */
  settingsId: string | undefined;
  onSelect: () => void;
  /** "/" on the row: add a field below it. */
  onAddBelow: () => void;
  /** "Add here", above this row; absent on the first. */
  onAddAbove: (() => void) | undefined;
  readOnly: boolean;
}

function OutlineRow({
  field,
  rowKey,
  badges,
  selected,
  settings,
  settingsId,
  onSelect,
  onAddBelow,
  onAddAbove,
  readOnly,
  ...actions
}: OutlineRowProps) {
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
  const label = field.label || field.name;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "/" || readOnly) return;
    event.preventDefault();
    onAddBelow();
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group/row relative border-b border-border last:border-b-0 ${
        isDragging ? "z-10 bg-card opacity-80" : ""
      }`}
    >
      {readOnly ? null : <AddHere label={label} onAdd={onAddAbove} />}
      <div
        className={`relative flex min-h-[52px] items-center gap-2 pl-1.5 pr-2.5 ${
          selected
            ? "bg-accent shadow-[inset_0_0_0_1.5px_var(--nx-foreground)]"
            : "hover:bg-muted"
        }`}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Reorder ${label}. Press Space to lift, arrow keys to move, Space to drop.`}
        >
          <Lucide.GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onSelect}
          onKeyDown={onKeyDown}
          aria-expanded={selected}
          aria-controls={selected ? settingsId : undefined}
          aria-keyshortcuts="/"
          className="flex min-w-0 flex-1 items-center gap-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md border border-border bg-background text-foreground">
            <CatalogIcon name={entry?.icon} className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {label}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {entry?.label ?? field.type}
              <span className="mx-1.5">·</span>
              <code className="font-mono text-[11.5px]">{field.name}</code>
            </span>
          </span>
          <Badges badges={badges} />
        </button>
        <FieldActions label={label} {...actions} />
      </div>
      {selected && settings ? (
        <div
          id={`field-settings-${rowKey}`}
          role="region"
          aria-label={`${label} settings`}
          className="border-t border-border"
        >
          {settings}
        </div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// The outline
// ---------------------------------------------------------------------------

export interface FieldCardsProps {
  /**
   * Form-surface types the host has NOT excluded (the plugin's field
   * enable/disable option). `null` while the host configuration is still
   * loading: Add field waits rather than offering the unfiltered set. Types
   * outside this set stay editable on existing fields but cannot be added.
   */
  enabledTypes: readonly FormFieldCatalogType[] | null;
  /**
   * Type ids the host disabled (`config.fields[type] === false`). Applied to
   * plugin field types too, so the host exclude layer is not bypassed for
   * contributed types.
   */
  disabledFieldTypes?: ReadonlySet<string>;
  /**
   * Creates and selects a field of the chosen type. The picker's whole choice
   * comes second (the label the person typed and the name it gives), so a host
   * written for the type alone keeps working and one that wants the label
   * reads it there. The third is where in the list it goes, when it was added
   * between two rows or below one; absent for the end.
   */
  onAddField: (
    type: FormFieldTypeId,
    choice?: FieldPickerChoice,
    index?: number
  ) => void;
  /**
   * Where the selected field's settings dock from 1024px: `"beside"` the list
   * (the default, for a list drawn on its own), or by the `"host"` page,
   * which draws `FieldInspector` against the window's edge itself. Below
   * 1024px they open under the row either way.
   */
  dockedSettings?: "beside" | "host";
}

/**
 * The list with the selected field's settings docked beside it, for a list
 * drawn on its own; the column scrolls on its own body.
 */
function BesideSettings({
  list,
  panel,
}: {
  list: JSX.Element;
  panel: ReactNode;
}): JSX.Element {
  if (panel === null) return list;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] items-start gap-4">
      {list}
      <aside
        id={DOCKED_PANEL_ID}
        aria-label="Field settings"
        className="sticky top-4 flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-md border border-border bg-card"
      >
        {panel}
      </aside>
    </div>
  );
}

/**
 * What every submission stores beside a form's own fields: its IP address
 * and browser only while the form keeps them (Settings › Privacy).
 */
function storedWithEverySubmission(storesAddress: boolean): string {
  return storesAddress
    ? "Every submission also stores when it was submitted, its status, internal notes, and the IP address and browser it came from."
    : "Every submission also stores when it was submitted, its status and internal notes. This form keeps no IP address or browser.";
}

export function FieldCards({
  enabledTypes,
  disabledFieldTypes,
  onAddField,
  dockedSettings = "beside",
}: FieldCardsProps): JSX.Element {
  const {
    fields,
    notifications,
    settings,
    selectedFieldId,
    selectField,
    deleteField,
    duplicateField,
    moveField,
  } = useFormBuilder();
  const { readOnly, fieldKey } = useFieldBookkeeping();

  // Where the picker adds, while it is open: an index, or the end.
  const [addAt, setAddAt] = useState<number | "end" | null>(null);
  const docked = useDocked();
  const inlinePanel = useFieldPanel(false);
  const besidePanel = useFieldPanel(true);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // The picker offers the enabled built-ins, then the plugin types that opted
  // into the forms surface; a plugin reusing a built-in's id never shadows it,
  // and a type the host disabled is left out whoever declared it.
  const pickerConfig = useMemo<FieldPickerConfig | null>(() => {
    if (enabledTypes === null) return null;
    const allowed = new Set<string>(enabledTypes);
    return {
      surface: "forms",
      types: describeFieldTypes(
        FORM_FIELD_TYPE_CATALOG.filter(entry => allowed.has(entry.type))
      ),
      exclude: [
        ...FORM_FIELD_TYPE_CATALOG.filter(
          entry => !allowed.has(entry.type)
        ).map(entry => entry.type),
        ...(disabledFieldTypes ?? []),
      ],
      deriveName: formFieldName,
    };
  }, [enabledTypes, disabledFieldTypes]);

  // One O(N^2) pass per fields/notifications change; each row then looks
  // its blockers up in O(1) instead of re-walking everything per render.
  const referenceMap = useMemo(
    () => buildFieldReferenceMap(fields, notifications, settings),
    [fields, notifications, settings]
  );

  const labels = useMemo(
    () => new Map(fields.map(field => [field.name, field.label || field.name])),
    [fields]
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

  const canAdd = pickerConfig !== null && !readOnly;
  const addButton = (
    <Button
      type="button"
      variant={fields.length === 0 ? "default" : "outline"}
      size="sm"
      disabled={!canAdd}
      // One label throughout, so the button keeps its width when the field
      // types land; while they load it is held back and says why.
      aria-busy={pickerConfig === null || undefined}
      title={pickerConfig === null ? "Loading field types…" : undefined}
      onClick={() => setAddAt("end")}
    >
      <Lucide.Plus className="h-4 w-4" aria-hidden="true" />
      Add field
    </Button>
  );

  const list = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Fields</h2>
        {fields.length > 0 ? (
          <span className="hidden text-xs text-muted-foreground md:inline">
            Drag to reorder. Press / on a field to add one below it.
          </span>
        ) : null}
        <span className="flex-1" />
        {fields.length > 0 ? addButton : null}
      </div>

      {fields.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-foreground">
            <Lucide.ListPlus className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">No fields yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add the first field to start building this form.
            </p>
          </div>
          {addButton}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={fields.map(f => f.name)}
            strategy={verticalListSortingStrategy}
          >
            <ul
              aria-label="Form fields"
              className="overflow-visible rounded-md border border-border bg-card"
            >
              {fields.map((field, index) => {
                const key = fieldKey(field.name);
                const selected = selectedFieldId === field.name;
                return (
                  <OutlineRow
                    key={key}
                    rowKey={key}
                    field={field}
                    index={index}
                    total={fields.length}
                    badges={fieldBadges(
                      field,
                      name => labels.get(name) ?? name
                    )}
                    selected={selected}
                    settings={!docked && selected ? inlinePanel : null}
                    settingsId={
                      docked ? DOCKED_PANEL_ID : `field-settings-${key}`
                    }
                    onSelect={() => selectField(selected ? null : field.name)}
                    onAddBelow={() => canAdd && setAddAt(index + 1)}
                    onAddAbove={
                      index === 0 || !canAdd ? undefined : () => setAddAt(index)
                    }
                    readOnly={readOnly}
                    deleteBlockers={(referenceMap.get(field.name) ?? []).map(
                      ref => ref.label
                    )}
                    onDuplicate={() => duplicateField(field.name)}
                    onDelete={() => deleteField(field.name)}
                    onMove={direction => moveField(index, index + direction)}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <p className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
        <Lucide.Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {storedWithEverySubmission(settings.storeIpAndBrowser !== false)}
      </p>

      {pickerConfig && (
        <FieldPicker
          open={addAt !== null}
          config={pickerConfig}
          onCancel={() => setAddAt(null)}
          onAdd={(choice, how) => {
            const at = addAt;
            onAddField(
              choice.type,
              choice,
              typeof at === "number" ? at : undefined
            );
            // A field added between rows moves the next one down, so another
            // goes below it.
            if (typeof at === "number")
              setAddAt(how.addAnother ? at + 1 : null);
            else if (!how.addAnother) setAddAt(null);
          }}
        />
      )}
    </div>
  );
  return docked && dockedSettings === "beside" ? (
    <BesideSettings list={list} panel={besidePanel} />
  ) : (
    list
  );
}
