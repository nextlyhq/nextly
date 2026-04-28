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

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { FormField, FormFieldType } from "../../types";

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

/** Email notification configuration */
export interface FormNotification {
  /** Unique ID for this notification */
  id: string;
  /** Notification name */
  name: string;
  /** Whether this notification is enabled */
  enabled: boolean;
  /** ID of the email provider to use; undefined = system default */
  providerId?: string;
  /** Sender email override; undefined = use provider's configured address */
  senderEmail?: string;
  /** How the recipient address is determined */
  recipientType: "static" | "field";
  /** Recipient address: static email or a {{fieldName}} reference */
  to: string;
  /** CC email addresses */
  cc: string[];
  /** BCC email addresses */
  bcc: string[];
  /** Slug of the email template to use */
  templateSlug?: string;
}

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
  /** Update a notification */
  updateNotification: (id: string, updates: Partial<FormNotification>) => void;
  /** Delete a notification */
  deleteNotification: (id: string) => void;
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

/** Create a new email integration with default values */
export function createNotification(): FormNotification {
  const id = `notif_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  return {
    id,
    name: "Email Notification",
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
 * Generate a unique field name based on type and timestamp.
 */
export function generateFieldName(type: FormFieldType): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${type}_${timestamp}_${random}`;
}

/**
 * Generate a human-readable label from field type.
 */
export function generateFieldLabel(type: FormFieldType): string {
  const labels: Record<FormFieldType, string> = {
    text: "Text Field",
    email: "Email Address",
    number: "Number",
    phone: "Phone Number",
    url: "Website URL",
    textarea: "Text Area",
    select: "Dropdown",
    checkbox: "Checkbox",
    radio: "Radio Buttons",
    file: "File Upload",
    date: "Date",
    time: "Time",
    hidden: "Hidden Field",
  };
  return labels[type] || "New Field";
}

/**
 * Create a new field from a field type with default values.
 */
export function createFieldFromType(type: FormFieldType): FormField {
  const name = generateFieldName(type);
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
      return { ...baseField, type: "email", label: "Email Address" };

    case "number":
      return { ...baseField, type: "number" };

    case "phone":
      return { ...baseField, type: "phone", label: "Phone Number" };

    case "url":
      return { ...baseField, type: "url", label: "Website" };

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
      return { ...baseField, type: "hidden", label: "Hidden Field" };

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

  const duplicateField = useCallback((fieldName: string) => {
    let newFieldName: string | null = null;

    setFieldsState(prev => {
      const fieldIndex = prev.findIndex(f => f.name === fieldName);
      if (fieldIndex === -1) return prev;

      const field = prev[fieldIndex];
      newFieldName = generateFieldName(field.type);
      const newField: FormField = {
        ...field,
        name: newFieldName,
        label: `${field.label} (Copy)`,
      };

      const newFields = [...prev];
      newFields.splice(fieldIndex + 1, 0, newField);
      return newFields;
    });

    // Select the duplicated field so it appears in the editor panel
    if (newFieldName) {
      setSelectedFieldId(newFieldName);
    }
    setIsDirty(true);
  }, []);

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
      updateNotification,
      deleteNotification,
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
      updateNotification,
      deleteNotification,
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
