// Strict field type options used across the Field Group form
export enum FieldType {
  TEXT = "TEXT",
  EMAIL = "EMAIL",
  PASSWORD = "PASSWORD",
  URL = "URL",
  TEXTAREA = "TEXTAREA",
  NUMBER = "NUMBER",
  COLOR = "COLOR",
  MEDIA = "MEDIA",
  EDITOR = "EDITOR",
  SELECT = "SELECT",
  BOOLEAN = "BOOLEAN",
  RADIO = "RADIO",
  RELATION = "RELATION",
  USER = "USER",
  DATE_PICKER = "DATE_PICKER",
  TIME_PICKER = "TIME_PICKER",
  ARRAY = "ARRAY",
  REPEATER = "REPEATER",
}

// Minimal validation configuration supported in this UI
export interface FieldValidationConfig {
  required?: boolean;
}

// Field configuration used by the table and form state
export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType | string; // keep string compatibility with external sources while preferring FieldType
  validation?: FieldValidationConfig;
}

// Basic form data used by the FieldGroup form
export interface FormData {
  name: string;
  slug: string;
}

// Data shape for initial field group (when editing)
export interface FieldGroupInitialData extends FormData {
  id: string;
  description?: string | null;
  contentTypes?: string[];
  fields?: FieldConfig[];
}

// Component props
export interface FieldGroupFormProps {
  initialData?: FieldGroupInitialData;
  isEditing?: boolean;
  onSubmit?: (
    data: FormData & { fields: FieldConfig[]; contentTypes: string[] }
  ) => void | Promise<void>;
}

// Methods exposed to parent via ref
export interface FieldGroupFormHandle {
  submit: () => Promise<void> | void;
  getFormData: () => FormData & {
    fields: FieldConfig[];
    contentTypes: string[];
  };
}

// Content type interface
export interface ContentType {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

// Controlled FieldsTable interface (reusable)
export interface FieldsTableProps {
  fields: FieldConfig[];
  onReorder: (fields: FieldConfig[]) => void;
  onEditRequest?: (index: number) => void;
  onDeleteRequest?: (index: number) => void;
  onAddRequest?: () => void;
}

export interface SortableFieldRowProps {
  id: string;
  field: FieldConfig;
  index: number;
  onEdit: (index: number) => void;
  setDeletingIndex: (index: number) => void;
}
