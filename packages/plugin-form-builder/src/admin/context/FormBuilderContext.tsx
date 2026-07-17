"use client";

/**
 * Form Builder Context
 *
 * Provides state management for the Form Builder UI.
 * Manages form fields, selection state, and form metadata.
 *
 * @module admin/context/FormBuilderContext
 * @since 0.1.0
 */

"use client";

import { FORM_FIELD_TYPE_CATALOG } from "nextly/field-catalog";
import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { FormField, FormFieldType, FormNotification } from "../../types";

// ============================================================================
// Types
// ============================================================================

/** Form settings configuration */
export interface FormSettings {
  /** Submit button text */
  submitButtonText: string;
  /** Show reset button */
  showResetButton: boolean;
  /** Reset button text */
  resetButtonText: string;
  /** Success message after submission */
  confirmationMessage: string;
  /** Redirect URL after submission (optional) */
  redirectUrl?: string;
  /** Enable honeypot spam protection */
  honeypotEnabled: boolean;
  /** Enable CAPTCHA */
  captchaEnabled: boolean;
  /** Store submissions in database */
  storeSubmissions: boolean;
  /** Limit submissions per user/IP */
  submissionLimit?: number;
}

/**
 * The notification rule type lives in `types.ts` (the same shape the send
 * path consumes); re-exported here so admin components keep one import site.
 */
export type { FormNotification } from "../../types";

export interface FormBuilderState {
  /** Form fields array */
  fields: FormField[];
  /** Currently selected field ID (name) */
  selectedFieldId: string | null;
  /** Active tab: builder, preview, settings, or notifications */
  activeTab: "builder" | "preview" | "settings" | "notifications";
  /** Whether form has unsaved changes */
  isDirty: boolean;
  /** Form metadata */
  formData: {
    id?: string;
    name: string;
    slug: string;
    description?: string;
    status: "draft" | "published" | "closed";
  };
  /** Form settings */
  settings: FormSettings;
  /** Email notifications */
  notifications: FormNotification[];
}

export interface FormBuilderActions {
  /** Set all fields */
  setFields: (fields: FormField[]) => void;
  /** Add a new field */
  addField: (field: FormField, index?: number) => void;
  /** Update a field by name */
  updateField: (fieldName: string, updates: Partial<FormField>) => void;
  /** Delete a field by name */
  deleteField: (fieldName: string) => void;
  /** Move a field from one index to another */
  moveField: (fromIndex: number, toIndex: number) => void;
  /** Duplicate a field */
  duplicateField: (fieldName: string) => void;
  /** Select a field */
  selectField: (fieldName: string | null) => void;
  /** Set active tab */
  setActiveTab: (
    tab: "builder" | "preview" | "settings" | "notifications"
  ) => void;
  /** Update form metadata */
  updateFormData: (updates: Partial<FormBuilderState["formData"]>) => void;
  /** Update form settings */
  updateSettings: (updates: Partial<FormSettings>) => void;
  /** Add a notification */
  addNotification: (notification: FormNotification) => void;
  /** Duplicate a notification (the copy starts disabled) */
  duplicateNotification: (id: string) => void;
  /** Update a notification */
  updateNotification: (id: string, updates: Partial<FormNotification>) => void;
  /** Delete a notification */
  deleteNotification: (id: string) => void;
  /** Seed default notifications into an empty list without dirtying the form */
  seedNotifications: (rules: FormNotification[]) => void;
  /** Mark form as saved (clears dirty flag) */
  markAsSaved: () => void;
}

export interface FormBuilderContextValue
  extends FormBuilderState,
    FormBuilderActions {}

export interface FormBuilderProviderProps {
  /** Initial form data (for editing existing forms) */
  initialData?: {
    id?: string;
    name?: string;
    slug?: string;
    description?: string;
    status?: "draft" | "published" | "closed";
    fields?: FormField[];
    settings?: Partial<FormSettings>;
    notifications?: FormNotification[];
  };
  /** Child components */
  children: ReactNode;
}

/** Default form settings */
export const DEFAULT_SETTINGS: FormSettings = {
  submitButtonText: "Submit",
  showResetButton: false,
  resetButtonText: "Reset",
  confirmationMessage: "Thank you for your submission!",
  redirectUrl: undefined,
  honeypotEnabled: true,
  captchaEnabled: false,
  storeSubmissions: true,
  submissionLimit: undefined,
};

/** Create a new notification rule with default values */
export function createNotification(): FormNotification {
  const id = `notif_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  return {
    id,
    name: "New notification",
    enabled: true,
    recipientType: "static",
    to: "",
    cc: [],
    bcc: [],
  };
}

// ============================================================================
// Context
// ============================================================================

const FormBuilderContext = createContext<FormBuilderContextValue | null>(null);

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a readable unique field name: the type itself for the first
 * field of that type, then a numeric suffix (`email`, `email_2`, ...).
 * Names key submission data, so they should read like keys a developer
 * would have chosen, not timestamps.
 */
export function generateFieldName(
  type: FormFieldType,
  existingNames: readonly string[] = []
): string {
  const taken = new Set(existingNames);
  if (!taken.has(type)) return type;
  let suffix = 2;
  while (taken.has(`${type}_${suffix}`)) suffix += 1;
  return `${type}_${suffix}`;
}

/**
 * Generate a human-readable label from field type, using the shared catalog
 * so a new field's default label matches what the picker called the type.
 */
export function generateFieldLabel(type: FormFieldType): string {
  const entry = FORM_FIELD_TYPE_CATALOG.find(row => row.type === type);
  return entry?.label ?? "New Field";
}

/**
 * Create a new field from a field type with default values.
 */
export function createFieldFromType(
  type: FormFieldType,
  existingNames: readonly string[] = []
): FormField {
  const name = generateFieldName(type, existingNames);
  const label = generateFieldLabel(type);

  const baseField = {
    name,
    label,
    required: false,
  };

  switch (type) {
    case "text":
      return { ...baseField, type: "text" };

    case "email":
      return { ...baseField, type: "email" };

    case "number":
      return { ...baseField, type: "number" };

    case "phone":
      return { ...baseField, type: "phone" };

    case "url":
      return { ...baseField, type: "url" };

    case "textarea":
      return { ...baseField, type: "textarea", rows: 4 };

    case "select":
      return {
        ...baseField,
        type: "select",
        options: [
          { label: "Option 1", value: "option_1" },
          { label: "Option 2", value: "option_2" },
        ],
      };

    case "checkbox":
      return { ...baseField, type: "checkbox" };

    case "radio":
      return {
        ...baseField,
        type: "radio",
        options: [
          { label: "Option 1", value: "option_1" },
          { label: "Option 2", value: "option_2" },
        ],
      };

    case "file":
      return { ...baseField, type: "file" };

    case "date":
      return { ...baseField, type: "date" };

    case "time":
      return { ...baseField, type: "time" };

    case "hidden":
      return { ...baseField, type: "hidden" };

    default:
      return { ...baseField, type: "text" };
  }
}

// ============================================================================
// Provider
// ============================================================================

/**
 * FormBuilderProvider - Provides form builder state to child components
 *
 * Wraps the form builder UI to provide centralized state management
 * for fields, selection, and form metadata.
 *
 * @example
 * ```tsx
 * <FormBuilderProvider initialData={existingForm}>
 *   <FormBuilderView />
 * </FormBuilderProvider>
 * ```
 */
export function FormBuilderProvider({
  initialData,
  children,
}: FormBuilderProviderProps) {
  // State
  const [fields, setFieldsState] = useState<FormField[]>(
    initialData?.fields || []
  );
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "builder" | "preview" | "settings" | "notifications"
  >("builder");
  const [isDirty, setIsDirty] = useState(false);
  const [formData, setFormData] = useState<FormBuilderState["formData"]>({
    id: initialData?.id,
    name: initialData?.name || "",
    slug: initialData?.slug || "",
    description: initialData?.description,
    status: initialData?.status || "draft",
  });
  const [settings, setSettings] = useState<FormSettings>({
    ...DEFAULT_SETTINGS,
    ...initialData?.settings,
  });
  const [notifications, setNotifications] = useState<FormNotification[]>(
    initialData?.notifications || []
  );

  // Actions
  const setFields = useCallback((newFields: FormField[]) => {
    setFieldsState(newFields);
    setIsDirty(true);
  }, []);

  const addField = useCallback((field: FormField, index?: number) => {
    setFieldsState(prev => {
      if (index !== undefined && index >= 0 && index <= prev.length) {
        const newFields = [...prev];
        newFields.splice(index, 0, field);
        return newFields;
      }
      return [...prev, field];
    });
    setSelectedFieldId(field.name);
    setIsDirty(true);
  }, []);

  const updateField = useCallback(
    (fieldName: string, updates: Partial<FormField>) => {
      setFieldsState(prev =>
        prev.map(f =>
          f.name === fieldName ? ({ ...f, ...updates } as FormField) : f
        )
      );
      // If the field name is being changed, also update selectedFieldId
      // This prevents the sidebar from disappearing when renaming a field
      if (updates.name && updates.name !== fieldName) {
        setSelectedFieldId(updates.name);
      }
      setIsDirty(true);
    },
    []
  );

  const deleteField = useCallback(
    (fieldName: string) => {
      setFieldsState(prev => prev.filter(f => f.name !== fieldName));
      if (selectedFieldId === fieldName) {
        setSelectedFieldId(null);
      }
      setIsDirty(true);
    },
    [selectedFieldId]
  );

  const moveField = useCallback((fromIndex: number, toIndex: number) => {
    setFieldsState(prev => {
      if (
        fromIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex < 0 ||
        toIndex >= prev.length
      ) {
        return prev;
      }
      const newFields = [...prev];
      const [removed] = newFields.splice(fromIndex, 1);
      newFields.splice(toIndex, 0, removed);
      return newFields;
    });
    setIsDirty(true);
  }, []);

  const duplicateField = useCallback(
    (fieldName: string) => {
      // Computed from the current fields (not inside the state updater):
      // updaters must stay pure, and the selection below needs the new name
      // deterministically.
      const fieldIndex = fields.findIndex(f => f.name === fieldName);
      if (fieldIndex === -1) return;

      const field = fields[fieldIndex];
      const newFieldName = generateFieldName(
        field.type,
        fields.map(f => f.name)
      );
      const newField: FormField = {
        ...field,
        name: newFieldName,
        label: `${field.label} (Copy)`,
      };

      const newFields = [...fields];
      newFields.splice(fieldIndex + 1, 0, newField);
      setFieldsState(newFields);

      // Select the duplicated field so its card expands
      setSelectedFieldId(newFieldName);
      setIsDirty(true);
    },
    [fields]
  );

  const selectField = useCallback((fieldName: string | null) => {
    setSelectedFieldId(fieldName);
  }, []);

  const updateFormData = useCallback(
    (updates: Partial<FormBuilderState["formData"]>) => {
      setFormData(prev => ({ ...prev, ...updates }));
      setIsDirty(true);
    },
    []
  );

  const updateSettings = useCallback((updates: Partial<FormSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
    setIsDirty(true);
  }, []);

  const addNotification = useCallback((notification: FormNotification) => {
    setNotifications(prev => [...prev, notification]);
    setIsDirty(true);
  }, []);

  const duplicateNotification = useCallback((id: string) => {
    // The non-deterministic id is generated outside the updater (updaters
    // must stay pure and may re-run); the copy itself derives from `prev`
    // so rapid duplications never work from a stale snapshot.
    const copyId = `notif_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    setNotifications(prev => {
      const index = prev.findIndex(n => n.id === id);
      if (index === -1) return prev;
      const source = prev[index];
      const copy: FormNotification = {
        ...source,
        id: copyId,
        name: `${source.name} (Copy)`,
        // Copies start disabled so duplicating never doubles the emails a
        // live rule sends until the copy is deliberately turned on.
        enabled: false,
      };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
    setIsDirty(true);
  }, []);

  const seedNotifications = useCallback((rules: FormNotification[]) => {
    // Only fills an empty list, and does not mark the form dirty: the seed
    // is a starting point the user hasn't authored, not an unsaved edit.
    setNotifications(prev => (prev.length > 0 ? prev : rules));
  }, []);

  const updateNotification = useCallback(
    (id: string, updates: Partial<FormNotification>) => {
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, ...updates } : n))
      );
      setIsDirty(true);
    },
    []
  );

  const deleteNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    setIsDirty(true);
  }, []);

  const markAsSaved = useCallback(() => {
    setIsDirty(false);
  }, []);

  // Memoized context value
  const value = useMemo<FormBuilderContextValue>(
    () => ({
      // State
      fields,
      selectedFieldId,
      activeTab,
      isDirty,
      formData,
      settings,
      notifications,
      // Actions
      setFields,
      addField,
      updateField,
      deleteField,
      moveField,
      duplicateField,
      selectField,
      setActiveTab,
      updateFormData,
      updateSettings,
      addNotification,
      duplicateNotification,
      updateNotification,
      deleteNotification,
      seedNotifications,
      markAsSaved,
    }),
    [
      fields,
      selectedFieldId,
      activeTab,
      isDirty,
      formData,
      settings,
      notifications,
      setFields,
      addField,
      updateField,
      deleteField,
      moveField,
      duplicateField,
      selectField,
      updateFormData,
      updateSettings,
      addNotification,
      duplicateNotification,
      updateNotification,
      deleteNotification,
      seedNotifications,
      markAsSaved,
    ]
  );

  return (
    <FormBuilderContext.Provider value={value}>
      {children}
    </FormBuilderContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * useFormBuilder - Access form builder context
 *
 * Hook to access form builder state and actions from within the builder UI.
 * Must be used within a FormBuilderProvider.
 *
 * @returns Form builder context value
 * @throws Error if used outside of FormBuilderProvider
 *
 * @example
 * ```tsx
 * function FieldList() {
 *   const { fields, selectField, deleteField } = useFormBuilder();
 *
 *   return (
 *     <ul>
 *       {fields.map(field => (
 *         <li key={field.name} onClick={() => selectField(field.name)}>
 *           {field.label}
 *           <button onClick={() => deleteField(field.name)}>Delete</button>
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useFormBuilder(): FormBuilderContextValue {
  const context = useContext(FormBuilderContext);

  if (!context) {
    throw new Error("useFormBuilder must be used within a FormBuilderProvider");
  }

  return context;
}

/**
 * useOptionalFormBuilder - Access form builder context safely
 *
 * Like useFormBuilder but returns null if not within a provider.
 * Useful for components that may be rendered outside of the form builder.
 *
 * @returns Form builder context value or null
 */
export function useOptionalFormBuilder(): FormBuilderContextValue | null {
  return useContext(FormBuilderContext);
}
