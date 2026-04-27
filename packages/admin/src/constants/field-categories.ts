/**
 * Field Categories & Field Type Definitions
 *
 * Constants and functions extracted from types/field-types.ts.
 * Contains UI display info and categorization for field types.
 */

import {
  FieldType,
  type FieldTypeDefinition,
} from "@admin/types/field-types";

/**
 * Field categories for UI organization
 */
export const FIELD_CATEGORIES = {
  BASIC: "Basic",
  CONTENT: "Content",
  CHOICE: "Choice",
  RELATIONAL: "Relational",
  ADVANCED: "Advanced",
  LAYOUT: "Layout",
} as const;

/**
 * Field types that support regex pattern validation
 * Only these field types should show the validation pattern field in their configuration
 */
export const FIELD_TYPES_WITH_PATTERN_VALIDATION: FieldType[] = [
  FieldType.TEXT,
  FieldType.EMAIL,
  FieldType.PASSWORD,
  FieldType.TEXTAREA,
  FieldType.NUMBER,
];

/**
 * Field type definitions with UI display info organized by categories
 */
export const FIELD_TYPES: Record<FieldType, FieldTypeDefinition> = {
  // Basic
  [FieldType.TEXT]: {
    type: FieldType.TEXT,
    label: "Text",
    description: "Short text content like titles, names, etc.",
    icon: "type",
    category: FIELD_CATEGORIES.BASIC,
    defaultConfig: {
      validation: {
        required: false,
      },
    },
  },
  [FieldType.EMAIL]: {
    type: FieldType.EMAIL,
    label: "Email",
    description: "Email address field with validation",
    icon: "mail",
    category: FIELD_CATEGORIES.BASIC,
    defaultConfig: {
      validation: {
        required: false,
        custom_validation: true,
      },
    },
  },
  [FieldType.PASSWORD]: {
    type: FieldType.PASSWORD,
    label: "Password",
    description: "Password field with security validation",
    icon: "lock",
    category: FIELD_CATEGORIES.BASIC,
    defaultConfig: {
      validation: {
        required: false,
        min_length: 8,
        require_uppercase: true,
        require_lowercase: true,
        require_numbers: true,
        require_special: true,
      },
      ui: {
        show_password_toggle: true,
        show_strength_indicator: true,
      },
    },
  },
  [FieldType.RICH_TEXT]: {
    type: FieldType.RICH_TEXT,
    label: "Rich Text",
    description: "Formatted text content with images, links, and more",
    icon: "file-text",
    category: FIELD_CATEGORIES.CONTENT,
    defaultConfig: {
      validation: {
        required: false,
      },
      ui: {
        toolbar_options: {
          basic_formatting: true,
          links: true,
          lists: true,
          alignment: true,
          images: true,
          media: false,
          tables: false,
          code_blocks: false,
          custom_styles: false,
        },
        height: 300,
      },
    },
  },
  [FieldType.TEXTAREA]: {
    type: FieldType.TEXTAREA,
    label: "Text Area",
    description: "Multi-line text content",
    icon: "align-left",
    category: FIELD_CATEGORIES.BASIC,
    defaultConfig: {
      validation: {
        required: false,
      },
      ui: {
        rows: 4,
      },
    },
  },
  [FieldType.NUMBER]: {
    type: FieldType.NUMBER,
    label: "Number",
    description: "Numeric values like price, quantity, etc.",
    icon: "hash",
    category: FIELD_CATEGORIES.BASIC,
    defaultConfig: {
      validation: {
        required: false,
      },
    },
  },

  // Content
  [FieldType.EDITOR]: {
    type: FieldType.EDITOR,
    label: "Editor",
    description: "Rich text editor with formatting options",
    icon: "edit",
    category: FIELD_CATEGORIES.CONTENT,
    defaultConfig: {
      validation: {
        required: false,
      },
    },
  },
  [FieldType.MEDIA]: {
    type: FieldType.MEDIA,
    label: "Media",
    description: "Upload and manage media files",
    icon: "media",
    category: FIELD_CATEGORIES.CONTENT,
    defaultConfig: {
      allowed_types: ["*"],
      max_size: 10000000,
      validation: {
        required: false,
      },
    },
  },

  // Choice
  [FieldType.SELECT]: {
    type: FieldType.SELECT,
    label: "Select",
    description: "Select from predefined options",
    icon: "list",
    category: FIELD_CATEGORIES.CHOICE,
    defaultConfig: {
      allow_multiple_selection: false,
      options: [],
      validation: {
        required: false,
      },
    },
  },
  [FieldType.BOOLEAN]: {
    type: FieldType.BOOLEAN,
    label: "Boolean",
    description: "Yes/no or true/false values with multiple display options",
    icon: "toggle-left",
    category: FIELD_CATEGORIES.CHOICE,
    defaultConfig: {
      validation: {
        required: false,
      },
      ui: {
        label_position: "right",
        true_label: "Yes",
        false_label: "No",
        display_type: "checkbox",
      },
    },
  },
  [FieldType.RADIO]: {
    type: FieldType.RADIO,
    label: "Radio",
    description: "Radio buttons for single selection from multiple options",
    icon: "radio",
    category: FIELD_CATEGORIES.CHOICE,
    defaultConfig: {
      options: [],
      ui: {
        label_position: "right",
      },
      validation: {
        required: false,
      },
    },
  },
  [FieldType.CHIPS]: {
    type: FieldType.CHIPS,
    label: "Chips",
    description: "Free-form multi-value string field for tags, keywords, etc.",
    icon: "tags",
    category: FIELD_CATEGORIES.CHOICE,
    defaultConfig: {
      validation: {
        required: false,
      },
    },
  },

  // Relational
  [FieldType.RELATION]: {
    type: FieldType.RELATION,
    label: "Relation",
    description: "Reference to other content",
    icon: "link",
    category: FIELD_CATEGORIES.RELATIONAL,
    defaultConfig: {
      multiple_content_types_selection: false,
      searchable: true,
      multiselect: false,
      display_field: "title",
      validation: {
        required: false,
        min_items: 0,
        max_items: 1,
      },
    },
  },
  [FieldType.USER]: {
    type: FieldType.USER,
    label: "User",
    description: "Reference to a user",
    icon: "user",
    category: FIELD_CATEGORIES.RELATIONAL,
    defaultConfig: {
      multiple_content_types_selection: false,
      searchable: true,
      multiselect: false,
      display_field: "username",
      validation: {
        required: false,
        min_items: 0,
        max_items: 1,
      },
    },
  },

  // Advanced
  [FieldType.DATE_PICKER]: {
    type: FieldType.DATE_PICKER,
    label: "Date Picker",
    description: "Date picker for date/time values",
    icon: "calendar",
    category: FIELD_CATEGORIES.ADVANCED,
    defaultConfig: {
      date_format: "yyyy-MM-dd",
      validation: {
        required: false,
      },
    },
  },
  [FieldType.TIME_PICKER]: {
    type: FieldType.TIME_PICKER,
    label: "Time Picker",
    description: "Time picker for selecting time values",
    icon: "clock",
    category: FIELD_CATEGORIES.ADVANCED,
    defaultConfig: {
      time_format: "24h",
      step: 15,
      validation: {
        required: false,
      },
      ui: {
        show_seconds: false,
      },
    },
  },

  // Layout
  [FieldType.REPEATER]: {
    type: FieldType.REPEATER,
    label: "Repeater",
    description: "Repeatable group of fields",
    icon: "layers",
    category: FIELD_CATEGORIES.LAYOUT,
    defaultConfig: {
      sub_fields: [],
      validation: {
        required: false,
        min_items: 0,
        max_items: 10,
      },
      ui: {
        add_button_label: "Add Item",
        remove_button_label: "Remove",
        allow_reordering: true,
        collapsed_by_default: false,
      },
    },
  },

  [FieldType.GROUP]: {
    type: FieldType.GROUP,
    label: "Group",
    description: "A group of fields",
    icon: "folder",
    category: FIELD_CATEGORIES.LAYOUT,
    defaultConfig: {
      fields: {},
      ui: {
        description: "",
        collapsible: true,
      },
    },
  },
};

/**
 * Get field types grouped by category
 */
export function getFieldTypesByCategory(): Record<
  string,
  FieldTypeDefinition[]
> {
  const grouped: Record<string, FieldTypeDefinition[]> = {};

  Object.values(FIELD_TYPES).forEach(fieldType => {
    if (!grouped[fieldType.category]) {
      grouped[fieldType.category] = [];
    }
    grouped[fieldType.category].push(fieldType);
  });

  return grouped;
}
