"use client";

/**
 * useFieldBuilder — Shared state management hook for all builder pages.
 *
 * Encapsulates:
 * - React Hook Form state (schema-generic)
 * - DND sensors, collision detection, and drag state
 * - Field CRUD: add, remove, update, reorder (flat and nested)
 * - Active field selection and sidebar tab navigation
 * - Validation helpers using lib/builder/field-validators
 *
 * Used by: collection, component, and single builder pages (create + edit).
 */

import {
  type DragEndEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
} from "react-hook-form";

import type {
  BuilderField,
  PaletteDragData,
  FieldListDragData,
} from "@admin/components/features/schema-builder";
import {
  generateFieldId,
  findFieldById,
  findParentContainerId,
  addFieldToArray,
  addFieldToGroup,
  updateFieldById,
  deleteFieldById,
  reorderNestedFields,
  validateBuilderFields,
} from "@admin/lib/builder";
// Why: type lives in lib/builder/field-validators.ts alongside the
// validateBuilderFields helper. Re-exported here so external consumers
// (which import via @admin/hooks) keep working unchanged.
import {
  type BuilderHistory,
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  commit,
  createHistory,
  currentState,
  redo as historyRedo,
  startFrom,
  undo as historyUndo,
} from "@admin/lib/builder/builder-history";
import type { FieldBuilderValidationResult } from "@admin/lib/builder/field-validators";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseFieldBuilderOptions<T extends FieldValues = FieldValues> {
  /**
   * React Hook Form resolver — pass `zodResolver(yourSchema)`.
   * Decoupled from Zod so any validation library works.
   */
  resolver: Resolver<T>;
  /** Default values for the metadata form */
  defaultValues: DefaultValues<T>;
  /** Initial fields to populate the builder with (e.g. system fields or loaded data) */
  initialFields?: BuilderField[];
}
export type { FieldBuilderValidationResult };

export interface UseFieldBuilderReturn<T extends FieldValues = FieldValues> {
  // Form
  form: UseFormReturn<T, unknown, T>;

  // Field state
  fields: BuilderField[];
  setFields: React.Dispatch<React.SetStateAction<BuilderField[]>>;

  // Selection
  selectedField: BuilderField | null;
  selectedFieldId: string | null;
  siblingFields: BuilderField[];

  // Active container (for nested add via palette)
  activeContainerId: string | null;
  setActiveContainerId: React.Dispatch<React.SetStateAction<string | null>>;

  // Search
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;

  // Sidebar
  sidebarTab: string;
  setSidebarTab: React.Dispatch<React.SetStateAction<string>>;

  // DND
  activeDragData: PaletteDragData | FieldListDragData | null;
  sensors: ReturnType<typeof useSensors>;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;

  // Field handlers
  handleFieldAdd: (fieldType: string) => void;
  handleFieldSelect: (fieldId: string) => void;
  handleFieldsReorder: (reorderedFields: BuilderField[]) => void;
  handleFieldDelete: (fieldId: string) => void;
  handleFieldUpdate: (updatedField: BuilderField) => void;
  /** PR D: append an already-configured field to a parent group/repeater's nested fields. */
  handleNestedFieldAdd: (parentFieldId: string, newField: BuilderField) => void;
  handleEditorClose: () => void;

  // Validation helper
  validateFields: (userFields: BuilderField[]) => FieldBuilderValidationResult;

  // Undo history
  /** Show `fields` with no history before them: a load, or a discard. */
  resetFields: (fields: BuilderField[]) => void;
  /**
   * Nothing before `saved` can be undone any more: it has just been saved.
   * Edits made after it, while the save was on its way, stay undoable. With
   * no `saved`, the fields shown are the start.
   */
  clearHistory: (saved?: BuilderField[]) => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Step back; the fields before and after, or null with nothing to undo. */
  undo: () => BuilderFieldsStep | null;
  /** Step forward; the fields before and after, or null with nothing to redo. */
  redo: () => BuilderFieldsStep | null;
}

/** One undo or redo: the fields it left, and the fields it showed. */
export interface BuilderFieldsStep {
  from: BuilderField[];
  to: BuilderField[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFieldBuilder<T extends FieldValues = FieldValues>(
  options: UseFieldBuilderOptions<T>
): UseFieldBuilderReturn<T> {
  const { resolver, defaultValues, initialFields = [] } = options;

  // -------------------------------------------------------------------------
  // Form
  // -------------------------------------------------------------------------
  const form = useForm<T>({
    resolver,
    defaultValues,
    mode: "onChange",
  });

  // -------------------------------------------------------------------------
  // Field state
  // -------------------------------------------------------------------------
  // The fields as states of an undo history, the last shown being the one
  // edited. Every change to the fields goes through `commitFields`, so each is
  // a step that undo can take back; one field's settings typed in a row are
  // one step, keyed by the field.
  const [history, setHistory] = useState<BuilderHistory<BuilderField[]>>(() =>
    createHistory(initialFields)
  );
  const fields = currentState(history);
  // Undo and redo answer with the fields they left and showed, which a
  // functional update could not hand back; they read the history as last
  // rendered, which is what the person was looking at.
  const historyRef = useRef(history);
  historyRef.current = history;

  const commitFields = useCallback(
    (next: SetStateAction<BuilderField[]>, key?: string) => {
      setHistory(prev =>
        commit(
          prev,
          typeof next === "function" ? next(currentState(prev)) : next,
          key
        )
      );
    },
    []
  );
  const setFields = useCallback<Dispatch<SetStateAction<BuilderField[]>>>(
    next => commitFields(next),
    [commitFields]
  );
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [activeContainerId, setActiveContainerId] = useState<string | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarTab, setSidebarTab] = useState("settings");

  // -------------------------------------------------------------------------
  // Drag state
  // -------------------------------------------------------------------------
  const [activeDragData, setActiveDragData] = useState<
    PaletteDragData | FieldListDragData | null
  >(null);

  // -------------------------------------------------------------------------
  // DND sensors
  // -------------------------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // -------------------------------------------------------------------------
  // Computed values
  // -------------------------------------------------------------------------
  const selectedField = useMemo(
    () => (selectedFieldId ? findFieldById(fields, selectedFieldId) : null),
    [fields, selectedFieldId]
  );

  const siblingFields = useMemo(() => {
    if (!selectedFieldId) return [];
    const parent = findParentContainerId(fields, selectedFieldId);
    if (!parent) return fields;
    const container = findFieldById(fields, parent.containerId);
    return container?.fields ?? [];
  }, [fields, selectedFieldId]);

  // -------------------------------------------------------------------------
  // Sidebar effects
  // -------------------------------------------------------------------------

  // Clear active container when leaving the "add" tab
  useEffect(() => {
    if (sidebarTab !== "add") {
      setActiveContainerId(null);
    }
  }, [sidebarTab]);

  // On mobile, collapse sidebar by default
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarTab("");
    }
  }, []);

  // Switch away from "edit" tab when no field is selected
  useEffect(() => {
    if (!selectedFieldId && sidebarTab === "edit") {
      setSidebarTab("settings");
    }
  }, [selectedFieldId, sidebarTab]);

  // -------------------------------------------------------------------------
  // Drag handlers
  // -------------------------------------------------------------------------

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as
      | PaletteDragData
      | FieldListDragData
      | undefined;
    if (data) {
      setActiveDragData(data);
    }
  }, []);

  // Why: PR I trimmed dead branches that targeted "array-drop-<id>" /
  // "group-drop-<id>" drop zones (no current component renders them since
  // the offcanvas-sheet drop zones were removed). Q2 also locked drag
  // scope to within-parent-only, so cross-parent moves between root and
  // nested are no longer in scope. The page-level handleRowDragEnd is
  // the live drag handler now; this hook-level handler is kept as a safe
  // no-op-ish fallback for palette → root drops and same-level reorder
  // in case any non-page caller exists.
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDragData(null);

      if (!over) return;

      const activeData = active.data.current as
        | PaletteDragData
        | FieldListDragData
        | undefined;

      if (!activeData) return;

      // Palette → field list (root drop only -- nested drop zones removed).
      if (activeData.source === "palette") {
        const overId = String(over.id);
        if (overId === "field-list-drop-zone" || overId.startsWith("field_")) {
          const newField: BuilderField = {
            id: generateFieldId(),
            name: "",
            label: "",
            type: activeData.fieldType,
            validation: {},
          };
          setFields(prev => [...prev, newField]);
          setSelectedFieldId(newField.id);
        }
        return;
      }

      // Reordering within the field list. PR I keeps only same-level
      // reorder (top-level row OR within the same nested container).
      // Cross-parent moves intentionally do nothing (Q2).
      if (activeData.source === "field-list") {
        if (active.id === over.id) return;
        const overId = String(over.id);

        const activeParent = findParentContainerId(fields, String(active.id));
        const overParent = findParentContainerId(fields, overId);
        const sameContainer =
          (!activeParent && !overParent) ||
          (activeParent &&
            overParent &&
            activeParent.containerId === overParent.containerId);

        if (sameContainer) {
          setFields(prev =>
            reorderNestedFields(prev, String(active.id), overId)
          );
        }
      }
    },
    [fields, setFields]
  );

  // -------------------------------------------------------------------------
  // Field handlers
  // -------------------------------------------------------------------------

  const handleFieldAdd = useCallback(
    (fieldType: string) => {
      const newField: BuilderField = {
        id: generateFieldId(),
        name: "",
        label: "",
        type: fieldType,
        validation: {},
      };

      if (activeContainerId) {
        const container = findFieldById(fields, activeContainerId);
        if (container) {
          if (container.type === "repeater") {
            setFields(prev =>
              addFieldToArray(prev, activeContainerId, newField)
            );
          } else if (container.type === "group") {
            setFields(prev =>
              addFieldToGroup(prev, activeContainerId, newField)
            );
          }
          setSelectedFieldId(newField.id);
          setSidebarTab("edit");
          setActiveContainerId(null);
          return;
        }
      }

      setFields(prev => [...prev, newField]);
      setSelectedFieldId(newField.id);
      setSidebarTab("edit");
    },
    [activeContainerId, fields, setFields]
  );

  const handleFieldSelect = useCallback((fieldId: string) => {
    setSelectedFieldId(fieldId);
    setSidebarTab("edit");
  }, []);

  const handleFieldsReorder = useCallback(
    (reorderedFields: BuilderField[]) => {
      setFields(reorderedFields);
    },
    [setFields]
  );

  // Why: PR D parent-aware "+ Add field" inside group/repeater editors.
  // Unlike handleFieldAdd (which builds an empty field by type), this
  // accepts an already-configured field and appends it to the parent's
  // nested fields array. Used by the create-overlay's onApply when the
  // user has been configuring a child via the FieldEditorSheet.
  const handleNestedFieldAdd = useCallback(
    (parentFieldId: string, newField: BuilderField) => {
      setFields(prev => {
        const parent = findFieldById(prev, parentFieldId);
        if (!parent) return prev;
        if (parent.type === "repeater") {
          return addFieldToArray(prev, parentFieldId, newField);
        }
        if (parent.type === "group") {
          return addFieldToGroup(prev, parentFieldId, newField);
        }
        return prev;
      });
    },
    [setFields]
  );

  const handleFieldDelete = useCallback(
    (fieldId: string) => {
      setFields(prev => deleteFieldById(prev, fieldId));
      if (selectedFieldId === fieldId) {
        setSelectedFieldId(null);
      }
    },
    [selectedFieldId, setFields]
  );

  // Keyed by the field, so a setting typed a character at a time is one
  // step, ended by an edit of anything else or an undo.
  const handleFieldUpdate = useCallback(
    (updatedField: BuilderField) => {
      commitFields(
        prev => updateFieldById(prev, updatedField),
        `field:${updatedField.id}`
      );
    },
    [commitFields]
  );

  const resetFields = useCallback((next: BuilderField[]) => {
    setHistory(createHistory(next));
  }, []);

  const clearHistory = useCallback((saved?: BuilderField[]) => {
    setHistory(prev =>
      saved === undefined
        ? createHistory(currentState(prev))
        : startFrom(prev, saved)
    );
  }, []);

  const undo = useCallback((): BuilderFieldsStep | null => {
    const before = historyRef.current;
    if (!historyCanUndo(before)) return null;
    const after = historyUndo(before);
    historyRef.current = after;
    setHistory(after);
    return { from: currentState(before), to: currentState(after) };
  }, []);

  const redo = useCallback((): BuilderFieldsStep | null => {
    const before = historyRef.current;
    if (!historyCanRedo(before)) return null;
    const after = historyRedo(before);
    historyRef.current = after;
    setHistory(after);
    return { from: currentState(before), to: currentState(after) };
  }, []);

  const handleEditorClose = useCallback(() => {
    setSelectedFieldId(null);
    setSidebarTab("settings");
    setActiveContainerId(null);
  }, []);

  // -------------------------------------------------------------------------
  // Validation helper
  // -------------------------------------------------------------------------

  // Why: validation logic moved to lib/builder/field-validators.ts so it
  // can be tested as a pure function without hook plumbing. The "at least
  // flow already creates schemas with empty user fields and system columns
  // (id, title, slug, timestamps, status) make a zero-user-field schema
  // fully functional. The validation paternalistically blocked the user's
  // reproduction: create → add field → save → remove field → save →
  // "Please add at least one field" (07-admin-bugs-feedback item 3).
  const validateFields = useCallback(
    (userFields: BuilderField[]) => validateBuilderFields(userFields),
    []
  );

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    form: form,
    fields,
    setFields,
    selectedField,
    selectedFieldId,
    siblingFields,
    activeContainerId,
    setActiveContainerId,
    searchQuery,
    setSearchQuery,
    sidebarTab,
    setSidebarTab,
    activeDragData,
    sensors,
    handleDragStart,
    handleDragEnd,
    handleFieldAdd,
    handleFieldSelect,
    handleFieldsReorder,
    handleFieldDelete,
    handleFieldUpdate,
    handleNestedFieldAdd,
    handleEditorClose,
    validateFields,
    resetFields,
    clearHistory,
    canUndo: historyCanUndo(history),
    canRedo: historyCanRedo(history),
    undo,
    redo,
  };
}
