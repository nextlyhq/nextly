/**
 * Field Types definitions for Nextly
 * Based on the field types defined in the documentation
 */

/**
 * Enum of available field types organized by categories
 */
export enum FieldType {
  // Basic
  TEXT = "text",
  TEXTAREA = "textarea",
  NUMBER = "number",
  EMAIL = "email",
  PASSWORD = "password",
  RICH_TEXT = "rich_text",

  // Content
  EDITOR = "editor",
  MEDIA = "media",

  // Choice
  SELECT = "select",
  BOOLEAN = "boolean",
  RADIO = "radio",
  CHIPS = "chips",

  // Relational
  RELATION = "relation",
  USER = "user",

  // Advanced
  DATE_PICKER = "date_picker",
  TIME_PICKER = "time_picker",

  // Layout
  ARRAY = "repeater",
  REPEATER = "repeater",
  GROUP = "group",
}

/**
 * Base field configuration - common properties for all fields
 */

export interface GroupFieldConfig extends BaseFieldConfig {
  type: FieldType.GROUP;
  fields: Record<string, FieldConfig>;
  ui?: {
    description?: string;
    collapsible?: boolean;
  };
}

export interface BaseFieldConfig {
  id: string;
  type: FieldType;
  name: string;
  label: string;
  lastUpdated?: number; // Optional timestamp for UI state management
  ui?: {
    description?: string;
    placeholder?: string;
  };
}

/**
 * Text Field Configuration
 */
export interface TextFieldConfig extends BaseFieldConfig {
  type: FieldType.TEXT;
  validation?: {
    required?: boolean;
    pattern?: string;
    min_length?: number | null;
    max_length?: number | null;
  };
  ui?: {
    description?: string;
    placeholder?: string;
  };
}

/**
 * Text Area Field Configuration
 */
export interface TextAreaFieldConfig extends BaseFieldConfig {
  type: FieldType.TEXTAREA;
  validation?: {
    required?: boolean;
    pattern?: string;
    min_length?: number;
    max_length?: number;
  };
  ui?: {
    description?: string;
    placeholder?: string;
    rows?: number;
  };
}

/**
 * Number Field Configuration
 */
export interface NumberFieldConfig extends BaseFieldConfig {
  type: FieldType.NUMBER;
  validation?: {
    required?: boolean;
    min?: number;
    max?: number;
  };
}

/**
 * Editor Field Configuration
 */
export interface EditorFieldConfig extends BaseFieldConfig {
  type: FieldType.EDITOR;
  validation?: {
    required?: boolean;
    pattern?: string;
  };
}

/**
 * Select Field Configuration
 */
export interface SelectFieldConfig extends BaseFieldConfig {
  type: FieldType.SELECT;
  allow_multiple_selection?: boolean;
  options: Array<{ label: string; value: string }>;
  validation?: {
    required?: boolean;
    pattern?: string;
  };
}

/**
 * Boolean Field Configuration
 */
export interface BooleanFieldConfig extends BaseFieldConfig {
  type: FieldType.BOOLEAN;
  validation?: {
    required?: boolean;
  };
  ui?: {
    description?: string;
    placeholder?: string;
    label_position?: "left" | "right";
    true_label?: string;
    false_label?: string;
    display_type?: "checkbox" | "switch";
  };
}

/**
 * Radio Field Configuration
 */
export interface RadioFieldConfig extends BaseFieldConfig {
  type: FieldType.RADIO;
  options: Array<{ label: string; value: string }>;
  ui?: {
    description?: string;
    label_position?: "left" | "right";
  };
  validation?: {
    required?: boolean;
  };
}

/**
 * Chips Field Configuration
 */
export interface ChipsFieldConfig extends BaseFieldConfig {
  type: FieldType.CHIPS;
  maxChips?: number;
  minChips?: number;
  validation?: {
    required?: boolean;
    min_items?: number;
    max_items?: number;
  };
  ui?: {
    description?: string;
    placeholder?: string;
  };
}

/**
 * Relation Field Configuration
 */
export interface RelationFieldConfig extends BaseFieldConfig {
  type: FieldType.RELATION;
  validation?: {
    required?: boolean;
    pattern?: string;
    min_items?: number;
    max_items?: number;
  };
  content_type?: string;
  multiple_content_types_selection?: boolean;
  display_field?: string;
  searchable?: boolean;
  multiselect?: boolean;
}

/**
 * User Field Configuration
 */
export interface UserFieldConfig extends BaseFieldConfig {
  type: FieldType.USER;
  validation?: {
    required?: boolean;
    min_items?: number;
    max_items?: number;
  };
  display_field?: string;
  searchable?: boolean;
  multiselect?: boolean;
  user_role?: string;
  user?: string;
}
/**
 * Date Picker Field Configuration
 */
export interface DatePickerFieldConfig extends BaseFieldConfig {
  type: FieldType.DATE_PICKER;
  validation?: {
    required?: boolean;
    pattern?: string;
    min_date?: string;
    max_date?: string;
  };
  date_format?: "dd/MM/yyyy" | "MM/dd/yyyy" | "yyyy-MM-dd";
}

/**
 * Time Picker Field Configuration
 */
export interface TimePickerFieldConfig extends BaseFieldConfig {
  type: FieldType.TIME_PICKER;
  validation?: {
    required?: boolean;
    min_time?: string;
    max_time?: string;
  };
  time_format?: "12h" | "24h";
  step?: number; // Minutes step (e.g., 15 for 15-minute intervals)
  ui?: {
    description?: string;
    placeholder?: string;
    show_seconds?: boolean;
  };
}

/**
 * Array Field Configuration
 */
export interface ArrayFieldConfig extends BaseFieldConfig {
  type: FieldType.ARRAY;
  sub_fields: FieldConfig[];
  validation?: {
    required?: boolean;
    pattern?: string;
    min_items?: number;
    max_items?: number;
  };
  ui?: {
    description?: string;
    placeholder?: string;
    add_button_label?: string;
    remove_button_label?: string;
    allow_reordering?: boolean;
    collapsed_by_default?: boolean;
  };
}

/**
 * Repeater Field Configuration
 */
export interface RepeaterFieldConfig extends BaseFieldConfig {
  type: FieldType.REPEATER;
  sub_fields: FieldConfig[];
  validation?: {
    required?: boolean;
    pattern?: string;
    min_items?: number;
    max_items?: number;
  };
  ui?: {
    description?: string;
    placeholder?: string;
    add_button_label?: string;
    remove_button_label?: string;
    allow_reordering?: boolean;
    collapsed_by_default?: boolean;
  };
}

/**
 * Rich Text Field Configuration
 */
export interface RichTextFieldConfig extends BaseFieldConfig {
  type: FieldType.RICH_TEXT;
  validation?: {
    required?: boolean;
    max_length?: number | null;
  };
  ui?: {
    description?: string;
    placeholder?: string;
    toolbar_options?: {
      basic_formatting?: boolean;
      links?: boolean;
      lists?: boolean;
      alignment?: boolean;
      images?: boolean;
      media?: boolean;
      tables?: boolean;
      code_blocks?: boolean;
      custom_styles?: boolean;
    };
    height?: number;
  };
}

/**
 * Email Field Configuration
 */
export interface EmailFieldConfig extends BaseFieldConfig {
  type: FieldType.EMAIL;
  validation?: {
    required?: boolean;
    pattern?: string;
    custom_validation?: boolean;
  };
  ui?: {
    description?: string;
    placeholder?: string;
  };
}

/**
 * Media Field Configuration
 */
export interface MediaFieldConfig extends BaseFieldConfig {
  type: FieldType.MEDIA;
  allowed_types: string[];
  max_size: number;
  validation?: {
    required?: boolean;
  };
  ui?: {
    description?: string;
    placeholder?: string;
  };
}

/**
 * Password Field Configuration
 */
export interface PasswordFieldConfig extends BaseFieldConfig {
  type: FieldType.PASSWORD;
  validation?: {
    required?: boolean;
    pattern?: string;
    min_length?: number | null;
    max_length?: number | null;
    require_uppercase?: boolean;
    require_lowercase?: boolean;
    require_numbers?: boolean;
    require_special?: boolean;
  };
  ui?: {
    description?: string;
    placeholder?: string;
    show_password_toggle?: boolean;
    show_strength_indicator?: boolean;
  };
}

export type FieldConfig =
  | TextFieldConfig
  | EmailFieldConfig
  | PasswordFieldConfig
  | TextAreaFieldConfig
  | NumberFieldConfig
  | EditorFieldConfig
  | SelectFieldConfig
  | BooleanFieldConfig
  | RadioFieldConfig
  | ChipsFieldConfig
  | RelationFieldConfig
  | UserFieldConfig
  | DatePickerFieldConfig
  | TimePickerFieldConfig
  | ArrayFieldConfig
  | RepeaterFieldConfig
  | GroupFieldConfig
  | MediaFieldConfig
  | RichTextFieldConfig;

/**
 * Field type definition with display info for UI
 */
export interface FieldTypeDefinition {
  type: FieldType;
  label: string;
  description: string;
  icon: string;
  category: string;
  defaultConfig: Partial<FieldConfig>;
}

export interface FieldEditorDialogProps {
  initialData?: FieldConfig;
  initialFieldType?: FieldType;
  onClose: () => void;
  onSave: (field: FieldConfig) => void;
  fieldIndex?: number;
}
