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
  /** PR D: append an already-configured field to a parent group/repeater's nested fields. */
  handleNestedFieldAdd: (parentFieldId: string, newField: BuilderField) => void;
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
    []
  );

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
    handleNestedFieldAdd,
    handleEditorClose,
    validateFields,
  };
}
