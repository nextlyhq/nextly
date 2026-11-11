"use client";

/**
 * Field Cards
 *
 * The form builder's field list: one card per field. A field is added through
 * the shared field picker and edited in the shared settings panel, configured
 * for forms (`forms-field-surface`): docked beside the list where the window
 * is wide enough, and opened inside the selected card where it is not.
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
import {
  describeFieldTypes,
  FieldPicker,
  FieldSettingsPanel,
  type FieldPickerChoice,
  type FieldPickerConfig,
  type FieldSettingsField,
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
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { AnyFormField, FormFieldTypeId } from "../../../types";
import { buildFieldReferenceMap } from "../../../utils/field-references";
import {
  generateFieldName,
  useFieldBookkeeping,
  useFormBuilder,
} from "../../context/FormBuilderContext";

import { FORMS_FIELD_SURFACE, formFieldName } from "./forms-field-surface";
import { fromPanelField, toPanelField } from "./panel-field";

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
  /** The settings panel, when it opens inside this card. */
  settings: ReactNode;
  deleteBlockers: string[];
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
  settings,
  deleteBlockers,
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
          aria-controls={expanded && settings ? bodyId : undefined}
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

      {/* The settings panel, where the window is too narrow to dock it. */}
      {expanded && settings && (
        <div
          id={bodyId}
          role="region"
          aria-labelledby={headerId}
          className="border-t border-border"
        >
          {settings}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Where the settings panel goes
// ---------------------------------------------------------------------------

/**
 * The width from which the settings panel docks beside the list: the Schema
 * Builder's. The form editor folds the Forms panel away, so from 1024px the
 * list keeps room to read a field's label beside the docked panel.
 */
const DOCKED = "(min-width: 1024px)";

function subscribeDocked(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(DOCKED);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the window is wide enough to dock the panel. A window without
 * `matchMedia` (a server render, a test) opens it inside the card, which works
 * at any width.
 */
function useDocked(): boolean {
  return useSyncExternalStore(
    subscribeDocked,
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(DOCKED).matches,
    () => false
  );
}

// ---------------------------------------------------------------------------
// The list
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
   * reads it there.
   */
  onAddField: (type: FormFieldTypeId, choice?: FieldPickerChoice) => void;
}

export function FieldCards({
  enabledTypes,
  disabledFieldTypes,
  onAddField,
}: FieldCardsProps): JSX.Element {
  const {
    fields,
    notifications,
    selectedFieldId,
    selectField,
    deleteField,
    duplicateField,
    moveField,
  } = useFormBuilder();
  // A colleague's claim makes every setting read-only, as the provider holds it.
  const { savedFieldNames, replaceField, readOnly, restored } =
    useFieldBookkeeping();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const docked = useDocked();

  // A card's React key, and the id the settings panel tells fields apart by,
  // cannot be the field's name: the name is the one property the Name input
  // rewrites on every keystroke, and a list keyed by it unmounts the renamed
  // card mid-word, destroying the input and the focus in it. Keys are minted
  // per card here and follow the field through a rename (handleChange below),
  // so editing a name never remounts the card. Forms store no field ids, so
  // these are also the ids the panel is given.
  const cardKeysRef = useRef(new Map<string, string>());
  const nextCardKeyRef = useRef(0);

  const cardKeyFor = useCallback((name: string): string => {
    let key = cardKeysRef.current.get(name);
    if (key === undefined) {
      key = `card-${++nextCardKeyRef.current}`;
      cardKeysRef.current.set(name, key);
    }
    return key;
  }, []);

  // The name a card's field had before its Name was cleared: a rename that
  // clears the input first passes through the empty name, and the references
  // to the field still use the name it had, so they move from that one.
  const clearedFromRef = useRef(new Map<string, string>());

  const handleChange = useCallback(
    (field: AnyFormField, next: FieldSettingsField) => {
      let updated = fromPanelField(next);
      const key = cardKeyFor(field.name);
      if (updated.name !== field.name) {
        // A name is the key its answers are stored under, so two fields never
        // share one: a rename onto another field's name, typed or following a
        // label, is made unique the way the picker makes a new name unique.
        const others = fields.filter(f => f !== field).map(f => f.name);
        if (updated.name !== "" && others.includes(updated.name)) {
          updated = {
            ...updated,
            name: generateFieldName(updated.name, others),
          };
        }
        // Move the card's key to the field's incoming name before the state
        // update re-renders the list, so the renamed field keeps its card.
        cardKeysRef.current.delete(field.name);
        cardKeysRef.current.set(updated.name, key);
      }
      // The name the rest of the form refers to the field by.
      const referencedAs =
        field.name !== "" ? field.name : clearedFromRef.current.get(key);
      if (updated.name === "") {
        if (referencedAs !== undefined) {
          clearedFromRef.current.set(key, referencedAs);
        }
      } else {
        clearedFromRef.current.delete(key);
      }
      replaceField(field.name, updated, referencedAs);
    },
    [fields, cardKeyFor, replaceField]
  );

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

  // One O(N^2) pass per fields/notifications change; each card then looks
  // its blockers up in O(1) instead of re-walking everything per render.
  const referenceMap = useMemo(
    () => buildFieldReferenceMap(fields, notifications),
    [fields, notifications]
  );

  // Every field as the panel sees it, so a condition can name any of them.
  const panelFields = useMemo(
    () => fields.map(field => toPanelField(field, cardKeyFor(field.name))),
    [fields, cardKeyFor]
  );

  const selectedIndex = fields.findIndex(f => f.name === selectedFieldId);
  const selected = selectedIndex === -1 ? undefined : fields[selectedIndex];
  const settingsPanel = selected && (
    <FieldSettingsPanel
      // Opened afresh on the restored field after an Undo, so nothing the
      // panel keeps of its own shows what was taken back.
      key={restored}
      surface={FORMS_FIELD_SURFACE}
      field={panelFields[selectedIndex]}
      ancestors={[]}
      siblings={panelFields}
      saved={savedFieldNames.has(selected.name)}
      readOnly={readOnly}
      onChange={next => handleChange(selected, next)}
      onClose={docked ? () => selectField(null) : undefined}
    />
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

  const addButton = (label: string, className?: string) => (
    <Button
      type="button"
      variant={fields.length === 0 ? "default" : "outline"}
      size="sm"
      disabled={pickerConfig === null || readOnly}
      onClick={() => setIsAddOpen(true)}
      className={className}
    >
      {fields.length > 0 && (
        <Lucide.Plus className="h-4 w-4" aria-hidden="true" />
      )}
      {pickerConfig === null ? "Loading field types…" : label}
    </Button>
  );

  return (
    <div
      className={
        docked && settingsPanel
          ? "grid grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] items-start gap-4"
          : undefined
      }
    >
      <div className="space-y-3">
        {fields.length === 0 ? (
          <div className="flex flex-col items-center gap-3 border border-dashed border-border bg-card px-6 py-14 text-center">
            <span className="flex h-10 w-10 items-center justify-center bg-primary/10 text-primary">
              <Lucide.ListPlus className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">
                No fields yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add the first field to start building this form.
              </p>
            </div>
            {addButton("Add field")}
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
                    <li key={cardKeyFor(field.name)}>
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
                        settings={
                          !docked && selectedFieldId === field.name
                            ? settingsPanel
                            : null
                        }
                        deleteBlockers={(
                          referenceMap.get(field.name) ?? []
                        ).map(ref => ref.label)}
                        onDuplicate={() => duplicateField(field.name)}
                        onDelete={() => deleteField(field.name)}
                        onMove={direction =>
                          moveField(index, index + direction)
                        }
                      />
                    </li>
                  ))}
                </ul>
              </SortableContext>
            </DndContext>

            {addButton("Add field", "w-full border-dashed")}
          </>
        )}
      </div>

      {docked && settingsPanel && (
        <aside
          aria-label="Field settings"
          // A column the panel fills, so its own body scrolls; short enough to
          // stay clear of the save bar along the bottom of the page.
          className="sticky top-4 flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden border border-border bg-card"
        >
          {settingsPanel}
        </aside>
      )}

      {pickerConfig && (
        <FieldPicker
          open={isAddOpen}
          config={pickerConfig}
          onCancel={() => setIsAddOpen(false)}
          onAdd={(choice, how) => {
            onAddField(choice.type, choice);
            if (!how.addAnother) setIsAddOpen(false);
          }}
        />
      )}
    </div>
  );
}
