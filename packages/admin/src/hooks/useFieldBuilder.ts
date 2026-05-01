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
import { useCallback, useEffect, useMemo, useState } from "react";
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
  _nestedFieldPriorityCollision,
  findComponentFieldMissingReference,
  findSelectFieldMissingOptions,
} from "@admin/lib/builder";

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

export interface FieldBuilderValidationResult {
  valid: boolean;
  errorMessage?: string;
}

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
  handleEditorClose: () => void;

  // Validation helper
  validateFields: (userFields: BuilderField[]) => FieldBuilderValidationResult;
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
  const [fields, setFields] = useState<BuilderField[]>(initialFields);
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

      // Case 1: Dragging from palette → field list
      if (activeData.source === "palette") {
        const overId = String(over.id);
        const overData = over.data.current;

        // Case 1a: Dropped on an Array field's nested drop zone
        if (
          overData?.type === "array-field" ||
          overId.startsWith("array-drop-")
        ) {
          let arrayFieldId = overData?.parentFieldId;
          if (arrayFieldId === undefined && overId.startsWith("array-drop-")) {
            arrayFieldId = overId.slice("array-drop-".length);
          }
          if (arrayFieldId !== undefined) {
            const newField: BuilderField = {
              id: generateFieldId(),
              name: "",
              label: "",
              type: activeData.fieldType,
              validation: {},
            };
            setFields(prev => addFieldToArray(prev, arrayFieldId, newField));
            setSelectedFieldId(newField.id);
          }
          return;
        }

        // Case 1b: Dropped on a Group field's nested drop zone
        if (
          overData?.type === "group-field" ||
          overId.startsWith("group-drop-")
        ) {
          let groupFieldId = overData?.parentFieldId;
          if (groupFieldId === undefined && overId.startsWith("group-drop-")) {
            groupFieldId = overId.slice("group-drop-".length);
          }
          if (groupFieldId !== undefined) {
            const newField: BuilderField = {
              id: generateFieldId(),
              name: "",
              label: "",
              type: activeData.fieldType,
              validation: {},
            };
            setFields(prev => addFieldToGroup(prev, groupFieldId, newField));
            setSelectedFieldId(newField.id);
          }
          return;
        }

        // Case 1c: Landed on a child field inside a nested container
        if (overId.startsWith("field_")) {
          const parent = findParentContainerId(fields, overId);
          if (parent) {
            const newField: BuilderField = {
              id: generateFieldId(),
              name: "",
              label: "",
              type: activeData.fieldType,
              validation: {},
            };
            if (parent.containerType === "repeater") {
              setFields(prev =>
                addFieldToArray(prev, parent.containerId, newField)
              );
            } else {
              setFields(prev =>
                addFieldToGroup(prev, parent.containerId, newField)
              );
            }
            setSelectedFieldId(newField.id);
            return;
          }
        }

        // Case 1d: Dropped on field list drop zone or root-level field
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

      // Case 2: Reordering within field list (top-level or nested)
      if (activeData.source === "field-list") {
        const overId = String(over.id);
        const overData = over.data.current;

        // Case 2a: Moving field into an Array drop zone
        if (
          overId.startsWith("array-drop-") ||
          overData?.type === "array-field"
        ) {
          let arrayFieldId = overData?.parentFieldId;
          if (arrayFieldId === undefined && overId.startsWith("array-drop-")) {
            arrayFieldId = overId.slice("array-drop-".length);
          }
          if (arrayFieldId && active.id !== arrayFieldId) {
            setFields(prev => {
              const fieldToMove = findFieldById(prev, String(active.id));
              if (!fieldToMove) return prev;
              const withoutActive = deleteFieldById(prev, String(active.id));
              return addFieldToArray(withoutActive, arrayFieldId, fieldToMove);
            });
          }
          return;
        }

        // Case 2b: Moving field into a Group drop zone
        if (
          overId.startsWith("group-drop-") ||
          overData?.type === "group-field"
        ) {
          let groupFieldId = overData?.parentFieldId;
          if (groupFieldId === undefined && overId.startsWith("group-drop-")) {
            groupFieldId = overId.slice("group-drop-".length);
          }
          if (groupFieldId && active.id !== groupFieldId) {
            setFields(prev => {
              const fieldToMove = findFieldById(prev, String(active.id));
              if (!fieldToMove) return prev;
              const withoutActive = deleteFieldById(prev, String(active.id));
              return addFieldToGroup(withoutActive, groupFieldId, fieldToMove);
            });
          }
          return;
        }

        // Case 2c: No-op when same target
        if (active.id === over.id) return;

        const activeParent = findParentContainerId(fields, String(active.id));
        const overParent = findParentContainerId(fields, overId);

        if (
          activeParent &&
          overParent &&
          activeParent.containerId === overParent.containerId
        ) {
          // Both in same nested container — reorder within it
          setFields(prev =>
            reorderNestedFields(prev, String(active.id), overId)
          );
          return;
        }

        if (activeParent && !overParent && overId.startsWith("field_")) {
          // Active is nested, over is root — move to root
          setFields(prev => {
            const fieldToMove = findFieldById(prev, String(active.id));
            if (!fieldToMove) return prev;
            const withoutActive = deleteFieldById(prev, String(active.id));
            const overIndex = withoutActive.findIndex(f => f.id === overId);
            if (overIndex === -1) return [...withoutActive, fieldToMove];
            const result = [...withoutActive];
            result.splice(overIndex, 0, fieldToMove);
            return result;
          });
          return;
        }

        // Standard reorder (same level)
        setFields(prev => reorderNestedFields(prev, String(active.id), overId));
      }
    },
    [fields]
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
    [activeContainerId, fields]
  );

  const handleFieldSelect = useCallback((fieldId: string) => {
    setSelectedFieldId(fieldId);
    setSidebarTab("edit");
  }, []);

  const handleFieldsReorder = useCallback((reorderedFields: BuilderField[]) => {
    setFields(reorderedFields);
  }, []);

  const handleFieldDelete = useCallback(
    (fieldId: string) => {
      setFields(prev => deleteFieldById(prev, fieldId));
      if (selectedFieldId === fieldId) {
        setSelectedFieldId(null);
      }
    },
    [selectedFieldId]
  );

  const handleFieldUpdate = useCallback((updatedField: BuilderField) => {
    setFields(prev => updateFieldById(prev, updatedField));
  }, []);

  const handleEditorClose = useCallback(() => {
    setSelectedFieldId(null);
    setSidebarTab("settings");
    setActiveContainerId(null);
  }, []);

  // -------------------------------------------------------------------------
  // Validation helper
  // -------------------------------------------------------------------------

  const validateFields = useCallback(
    (userFields: BuilderField[]): FieldBuilderValidationResult => {
      if (userFields.length === 0) {
        return {
          valid: false,
          errorMessage: "Please add at least one field",
        };
      }

      const unnamedField = userFields.find(f => !f.name);
      if (unnamedField) {
        return { valid: false, errorMessage: "All fields must have a name" };
      }

      const missingRef = findComponentFieldMissingReference(userFields);
      if (missingRef) {
        return {
          valid: false,
          errorMessage: `Component field "${missingRef}" must have a component selected`,
        };
      }

      const missingOptions = findSelectFieldMissingOptions(userFields);
      if (missingOptions) {
        return {
          valid: false,
          errorMessage: `Select/Radio field "${missingOptions}" must have at least one option`,
        };
      }

      return { valid: true };
    },
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
    handleEditorClose,
    validateFields,
  };
}
