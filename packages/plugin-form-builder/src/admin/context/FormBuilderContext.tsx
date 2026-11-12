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
  type JSX,
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { FORM_SUBMISSION_TEMPLATE } from "../../emails/starter-messages";
import type {
  AnyFormField,
  FormFieldTypeId,
  FormNotification,
  FormSettings,
} from "../../types";
import {
  renameInFieldConditions,
  renameInNotifications,
} from "../../utils/field-references";
import {
  DEFAULT_FORM_SETTINGS,
  normalizeFormSettings,
} from "../../utils/form-settings";

import { generateFieldName } from "./field-names";
import { useBeenLive } from "./use-been-live";
import { useChangeHistory } from "./use-change-history";
import { useFieldIdentity } from "./use-field-identity";

export { generateFieldName } from "./field-names";

// ============================================================================
// Types
// ============================================================================

/**
 * The canonical settings shape lives in `types.ts` (the same shape the
 * collection group declares and the submit handler consumes); re-exported
 * here so admin components keep one import site.
 */
export type { FormSettings } from "../../types";

/**
 * The notification rule type lives in `types.ts` (the same shape the send
 * path consumes); re-exported here so admin components keep one import site.
 */
export type { FormNotification } from "../../types";

export interface FormBuilderState {
  /** Form fields array */
  fields: AnyFormField[];
  /** Currently selected field ID (name) */
  selectedFieldId: string | null;
  /**
   * Active tab: builder, preview, settings, or notifications.
   * @deprecated The editor shows the page its address names; this is no
   * longer what it shows, and is kept for hosts that read it.
   */
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
    /** What a closed form tells a visitor who reaches it. */
    closedMessage?: string;
  };
  /** Form settings */
  settings: FormSettings;
  /** Email notifications */
  notifications: FormNotification[];
}

export interface FormBuilderActions {
  /** Set all fields */
  setFields: (fields: AnyFormField[]) => void;
  /** Add a new field */
  addField: (field: AnyFormField, index?: number) => void;
  /** Update a field by name */
  updateField: (fieldName: string, updates: Partial<AnyFormField>) => void;
  /** Delete a field by name */
  deleteField: (fieldName: string) => void;
  /** Move a field from one index to another */
  moveField: (fromIndex: number, toIndex: number) => void;
  /** Duplicate a field */
  duplicateField: (fieldName: string) => void;
  /** Select a field */
  selectField: (fieldName: string | null) => void;
  /**
   * Set active tab.
   * @deprecated The editor's tabs are links to each page's address.
   */
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

/**
 * The builder's own field bookkeeping, kept off the exported state and
 * actions so a host that builds or mocks those types is not asked for it.
 * The provider supplies it; the builder's field list reads it through
 * `useFieldBookkeeping`, which the package does not export.
 */
export interface FieldBookkeeping {
  /**
   * The names of the fields the stored form holds, as of the last load or
   * save. A field named here has answers stored under its name and type, so
   * its type is fixed; a renamed one keeps its place here under its new name.
   */
  savedFieldNames: ReadonlySet<string>;
  /**
   * Replace a field by name with the whole of its next definition, so a
   * setting the next one leaves out is gone rather than kept from before.
   * Given `referencesFrom`, the name other fields' conditions and the
   * notifications know the field by, those references move to its new name.
   */
  replaceField: (
    fieldName: string,
    next: AnyFormField,
    referencesFrom?: string
  ) => void;
  /** Called as a save begins, before anything is sent. */
  beginSave: () => void;
  /**
   * Records the fields a save stored, by the names they were saved under.
   * Given the names the save was handed, so an edit made while it was under
   * way is not counted as stored; and a name deleted or renamed away since
   * the save began is not either, since a field under it now is another one.
   */
  markFieldsSaved: (names: readonly string[]) => void;
  /** Whether a colleague holds the form, so nothing in it may change. */
  readOnly: boolean;
  /**
   * How many unsaved changes the form holds, across every tab: typing into
   * one input counts once while the keystrokes keep coming. `isDirty` is this
   * above zero.
   */
  changeCount: number;
  /** Take the last unsaved change back, on any tab. */
  undo: () => void;
  /**
   * How many times Undo has restored the form: the key for an editor that
   * keeps its own copy of a value, so it rereads the restored one.
   */
  restored: number;
  /**
   * Whether the form's ID is fixed: it has been live as stored (set back to
   * draft, it still has), or the save that makes it live is under way. An
   * unsaved pick in the bar does not count.
   */
  formIdFixed: boolean;
  /** The save that began was refused or failed: nothing was stored. */
  saveFailed: () => void;
  /**
   * The key a field is known by while it is edited, whatever its name
   * becomes: the list's row key and the settings panel's field id.
   */
  fieldKey: (name: string) => string;
  /**
   * Replace `field` with its edited definition: a name another field has is
   * made unique, and references move from the name the form knows the field
   * by, even through an empty one. Kept here, not in the list, so a rename
   * finished after a trip to another page still moves them.
   */
  editField: (
    field: AnyFormField,
    next: AnyFormField,
    fields: readonly AnyFormField[]
  ) => void;
}

export type FormBuilderInternalValue = FormBuilderContextValue &
  FieldBookkeeping;

export interface FormBuilderProviderProps {
  /** Initial form data (for editing existing forms) */
  initialData?: {
    id?: string;
    name?: string;
    slug?: string;
    description?: string;
    status?: "draft" | "published" | "closed";
    /** When the form first went live, as the server stamped it. */
    wentLiveAt?: string | null;
    closedMessage?: string;
    fields?: AnyFormField[];
    settings?: Partial<FormSettings>;
    notifications?: FormNotification[];
  };
  /** Child components */
  children: ReactNode;
  /**
   * The document belongs to someone else right now, so nothing here may change
   * it.
   *
   * Held here rather than at each control because the builder has dozens of
   * them across four tabs, and a rule spelled at every one is a rule one new
   * control forgets. Reading is untouched: the editor still browses fields,
   * switches tabs and opens settings, which is exactly what the strip above
   * offers them.
   */
  readOnly?: boolean;
}

/**
 * The actions that survive a read-only document.
 *
 * Everything else on the context changes the form, and every one of those marks
 * it dirty - the same question asked twice, so this is the complement of it
 * rather than a second list of what to block. `markAsSaved` is the save's own
 * bookkeeping and cannot run while the save is withheld anyway.
 */
const READS_ONLY = new Set([
  "selectField",
  "fieldKey",
  "setActiveTab",
  "markAsSaved",
  "beginSave",
  "saveFailed",
  "markFieldsSaved",
]);

/** What Undo restores: the form, and which of its fields are stored. */
interface FormDocument {
  fields: AnyFormField[];
  formData: FormBuilderState["formData"];
  settings: FormSettings;
  notifications: FormNotification[];
  savedFieldNames: ReadonlySet<string>;
}

/**
 * The metadata keys typed into, whose keystrokes join one change. A status
 * picked from a menu is a change of its own every time.
 */
const TYPED_FORM_DATA = new Set([
  "name",
  "slug",
  "description",
  "closedMessage",
]);

/** What an edit to the form's metadata edited, when it may join the next. */
function formDataKey(
  updates: Partial<FormBuilderState["formData"]>
): string | null {
  const keys = Object.keys(updates);
  return keys.length > 0 && keys.every(key => TYPED_FORM_DATA.has(key))
    ? `form:${keys.sort().join(",")}`
    : null;
}

/**
 * `record` with every field of it the server now stores counted as stored:
 * which fields are stored is the server's to say, not an edit's to undo.
 */
function withStoredFields(
  record: FormDocument,
  stored: ReadonlySet<string>
): FormDocument {
  const named = record.fields
    .map(field => field.name)
    .filter(name => stored.has(name) && !record.savedFieldNames.has(name));
  return named.length === 0
    ? record
    : {
        ...record,
        savedFieldNames: new Set([...record.savedFieldNames, ...named]),
      };
}

/** The open field's name, while that field is still among `fields`. */
function keptSelection(
  selected: string | null,
  fields: readonly AnyFormField[]
): string | null {
  return selected !== null && fields.some(field => field.name === selected)
    ? selected
    : null;
}

/**
 * What an edit to a field edited: its place in the list, which a rename does
 * not move, so renaming one keystroke at a time is still one change.
 */
function fieldChangeKey(fields: readonly AnyFormField[], name: string): string {
  return `field:${fields.findIndex(field => field.name === name)}`;
}

/** Default form settings (the canonical defaults from the settings reader) */
export const DEFAULT_SETTINGS: FormSettings = DEFAULT_FORM_SETTINGS;

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
    // The team's starter message, so a new notification sends as soon as it
    // has an address, rather than starting without one and never sending.
    templateSlug: FORM_SUBMISSION_TEMPLATE,
  };
}

// ============================================================================
// Context
// ============================================================================

const FormBuilderContext = createContext<FormBuilderInternalValue | null>(null);

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a human-readable label from field type, using the shared catalog
 * so a new field's default label matches what the picker called the type. A
 * plugin type not in the built-in catalog falls back to a title-cased id.
 */
export function generateFieldLabel(type: FormFieldTypeId): string {
  const entry = FORM_FIELD_TYPE_CATALOG.find(row => row.type === type);
  if (entry) return entry.label;
  const titleCased = type
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return titleCased || "New Field";
}

/**
 * Create a new field from a field type with default values.
 */
export function createFieldFromType(
  type: FormFieldTypeId,
  existingNames: readonly string[] = []
): AnyFormField {
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

    case "consent":
      // Always required, and seeded with a text to agree to, since a consent
      // with none could not be saved.
      return {
        ...baseField,
        type: "consent",
        required: true,
        agreementText: "I agree to the privacy policy",
      };

    default:
      // A plugin-contributed type keeps its own id; the plugin owns the editor
      // component and value semantics, so no built-in defaults are seeded.
      return { ...baseField, type };
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
  readOnly = false,
}: FormBuilderProviderProps): JSX.Element {
  // State
  const [fields, setFieldsState] = useState<AnyFormField[]>(
    initialData?.fields || []
  );
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "builder" | "preview" | "settings" | "notifications"
  >("builder");
  // The names that stopped meaning the field they named (deleted, or renamed
  // away) since the save under way began.
  const vacatedRef = useRef(new Set<string>());

  const [savedFieldNames, setSavedFieldNames] = useState<ReadonlySet<string>>(
    () => new Set((initialData?.fields ?? []).map(field => field.name))
  );
  const [formData, setFormData] = useState<FormBuilderState["formData"]>({
    id: initialData?.id,
    name: initialData?.name || "",
    slug: initialData?.slug || "",
    description: initialData?.description,
    status: initialData?.status || "draft",
    closedMessage: initialData?.closedMessage,
  });
  // Stored settings may carry legacy keys from earlier builder versions —
  // the normalizer migrates them on read (nothing rewrites until save).
  const [settings, setSettings] = useState<FormSettings>(() =>
    normalizeFormSettings(initialData?.settings)
  );
  const [notifications, setNotifications] = useState<FormNotification[]>(
    initialData?.notifications || []
  );

  // The form as last rendered, which a change records as what it replaced.
  // One object per render, so two writes in one event record it once.
  const formDocument = useMemo<FormDocument>(
    () => ({ fields, formData, settings, notifications, savedFieldNames }),
    [fields, formData, settings, notifications, savedFieldNames]
  );
  // Puts a form back for Undo. The setters are stable, so this is too.
  const restore = useCallback((previous: FormDocument) => {
    setFieldsState(previous.fields);
    setFormData(previous.formData);
    setSettings(previous.settings);
    setNotifications(previous.notifications);
    setSavedFieldNames(previous.savedFieldNames);
    setSelectedFieldId(selected => keptSelection(selected, previous.fields));
  }, []);
  // Each of these is stable; the handle that carries them is not.
  const {
    changeCount,
    restored,
    record,
    undo,
    current: currentDocument,
    markSaved: historyMarkSaved,
    beginSave: historyBeginSave,
    rebase: rebaseHistory,
  } = useChangeHistory(formDocument, restore);

  // Actions
  const setFields = useCallback(
    (newFields: AnyFormField[]) => {
      setFieldsState(newFields);
      record(null);
    },
    [record]
  );

  const addField = useCallback(
    (field: AnyFormField, index?: number) => {
      setFieldsState(prev => {
        if (index !== undefined && index >= 0 && index <= prev.length) {
          const newFields = [...prev];
          newFields.splice(index, 0, field);
          return newFields;
        }
        return [...prev, field];
      });
      setSelectedFieldId(field.name);
      record(null);
    },
    [record]
  );

  /**
   * What a field's rename moves with it. The selection follows it, so the
   * open settings stay open — including when the name passes through the
   * empty string, where a rename that clears the input first goes: skipping it
   * there would stop the renamed field matching its own selection and close
   * its settings mid-rename. And a saved field stays saved under its new name.
   */
  const followRename = useCallback((from: string, to: string | undefined) => {
    if (to === undefined || to === from) return;
    vacatedRef.current.add(from);
    setSelectedFieldId(to);
    setSavedFieldNames(prev => {
      if (!prev.has(from)) return prev;
      const next = new Set(prev);
      next.delete(from);
      next.add(to);
      return next;
    });
  }, []);

  const updateField = useCallback(
    (fieldName: string, updates: Partial<AnyFormField>) => {
      setFieldsState(prev =>
        prev.map(f => (f.name === fieldName ? { ...f, ...updates } : f))
      );
      record(fieldChangeKey(currentDocument().fields, fieldName));
      followRename(fieldName, updates.name);
    },
    [followRename, record, currentDocument]
  );

  const replaceField = useCallback(
    (fieldName: string, next: AnyFormField, referencesFrom?: string) => {
      const moves =
        referencesFrom !== undefined &&
        next.name !== "" &&
        next.name !== referencesFrom;
      setFieldsState(prev => {
        const replaced = prev.map(f => (f.name === fieldName ? next : f));
        return moves
          ? renameInFieldConditions(replaced, referencesFrom, next.name)
          : replaced;
      });
      if (moves) {
        setNotifications(prev =>
          renameInNotifications(prev, referencesFrom, next.name)
        );
        // The Email field one response per person compares, by name.
        setSettings(prev =>
          prev.oneResponseField === referencesFrom
            ? { ...prev, oneResponseField: next.name }
            : prev
        );
      }
      record(fieldChangeKey(currentDocument().fields, fieldName));
      followRename(fieldName, next.name);
    },
    [followRename, record, currentDocument]
  );

  const { fieldKey, editField } = useFieldIdentity(replaceField);

  const deleteField = useCallback(
    (fieldName: string) => {
      setFieldsState(prev => prev.filter(f => f.name !== fieldName));
      vacatedRef.current.add(fieldName);
      // The name no longer stands for a stored field: a new field given it
      // later is a new field, with its type and name still its own to choose.
      setSavedFieldNames(prev => {
        if (!prev.has(fieldName)) return prev;
        const next = new Set(prev);
        next.delete(fieldName);
        return next;
      });
      if (selectedFieldId === fieldName) {
        setSelectedFieldId(null);
      }
      record(null);
    },
    [selectedFieldId, record]
  );

  const moveField = useCallback(
    (fromIndex: number, toIndex: number) => {
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
      record(null);
    },
    [record]
  );

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
      const newField: AnyFormField = {
        ...field,
        name: newFieldName,
        label: `${field.label} (Copy)`,
      };

      const newFields = [...fields];
      newFields.splice(fieldIndex + 1, 0, newField);
      setFieldsState(newFields);

      // Select the duplicated field so its card expands
      setSelectedFieldId(newFieldName);
      record(null);
    },
    [fields, record]
  );

  const selectField = useCallback((fieldName: string | null) => {
    setSelectedFieldId(fieldName);
  }, []);

  const updateFormData = useCallback(
    (updates: Partial<FormBuilderState["formData"]>) => {
      setFormData(prev => ({ ...prev, ...updates }));
      record(formDataKey(updates));
    },
    [record]
  );

  const updateSettings = useCallback(
    (updates: Partial<FormSettings>) => {
      setSettings(prev => ({ ...prev, ...updates }));
      record(`settings:${Object.keys(updates).sort().join(",")}`);
    },
    [record]
  );

  const addNotification = useCallback(
    (notification: FormNotification) => {
      setNotifications(prev => [...prev, notification]);
      record(null);
    },
    [record]
  );

  const duplicateNotification = useCallback(
    (id: string) => {
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
      record(null);
    },
    [record]
  );

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
      record(`notification:${id}`);
    },
    [record]
  );

  const deleteNotification = useCallback(
    (id: string) => {
      setNotifications(prev => prev.filter(n => n.id !== id));
      record(null);
    },
    [record]
  );

  // A save stores the form as it stood when it began, its status among it.
  const {
    idFixed: formIdFixed,
    beginSave: statusBeginSave,
    markSaved: markAsSaved,
    saveFailed,
  } = useBeenLive(initialData, currentDocument, {
    beginSave: historyBeginSave,
    markSaved: historyMarkSaved,
  });

  const beginSave = useCallback(() => {
    vacatedRef.current = new Set();
    statusBeginSave();
  }, [statusBeginSave]);

  const isDirty = changeCount > 0;

  const markFieldsSaved = useCallback(
    (names: readonly string[]) => {
      // What was saved is what the stored form now holds.
      const vacated = vacatedRef.current;
      const stored = new Set(names.filter(name => !vacated.has(name)));
      setSavedFieldNames(stored);
      // A change kept after the save (made while it ran) holds the stored
      // set from before it, so taking that change back would forget what the
      // save stored and unfix a stored field's type.
      rebaseHistory(record => withStoredFields(record, stored));
    },
    [rebaseHistory]
  );

  // Memoized context value
  const value = useMemo<FormBuilderInternalValue>(
    () => ({
      // State
      fields,
      selectedFieldId,
      activeTab,
      isDirty,
      savedFieldNames,
      formData,
      settings,
      notifications,
      // Actions
      setFields,
      addField,
      updateField,
      replaceField,
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
      beginSave,
      markFieldsSaved,
      readOnly,
      changeCount,
      undo,
      restored,
      formIdFixed,
      saveFailed,
      fieldKey,
      editField,
    }),
    [
      fields,
      selectedFieldId,
      activeTab,
      isDirty,
      savedFieldNames,
      formData,
      settings,
      notifications,
      setFields,
      addField,
      updateField,
      replaceField,
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
      beginSave,
      markFieldsSaved,
      readOnly,
      changeCount,
      undo,
      restored,
      formIdFixed,
      saveFailed,
      fieldKey,
      editField,
    ]
  );

  /**
   * The same value with every document-changing action withheld.
   *
   * 🔴 Fail-closed, and deliberately so: it withholds every function EXCEPT the
   * ones named, rather than naming the ones to withhold. An action added here
   * later is inert under a colleague's claim without anyone remembering this
   * exists, which is the opposite of how a list of things-to-disable ages.
   *
   * What stays is navigation and the save's own bookkeeping. Neither changes
   * the document, and both are what "you can read it" has to mean.
   */
  const guarded = useMemo<FormBuilderInternalValue>(() => {
    if (!readOnly) return value;
    return Object.fromEntries(
      Object.entries(value).map(([name, member]) =>
        typeof member === "function" && !READS_ONLY.has(name)
          ? [name, () => undefined]
          : [name, member]
      )
    ) as FormBuilderInternalValue;
  }, [value, readOnly]);

  return (
    <FormBuilderContext.Provider value={guarded}>
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

/**
 * The builder's state and actions with its field bookkeeping (see
 * `FieldBookkeeping`), for the builder's own components. Not exported from
 * the package.
 */
export function useFieldBookkeeping(): FormBuilderInternalValue {
  const context = useContext(FormBuilderContext);
  if (!context) {
    throw new Error(
      "useFieldBookkeeping must be used within a FormBuilderProvider"
    );
  }
  return context;
}
