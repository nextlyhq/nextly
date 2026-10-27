export function useFields(): (
  | {
      title: string;
      items: (
        | {
            icon: string;
            name: string;
            label: string;
            type: string;
            description: string;
            required: boolean;
            unique: boolean;
            private: boolean;
            default: string;
            options: {
              variant: string;
              format?: undefined;
            };
            validation: {
              minLength: number;
              maxLength: number;
              regex: string;
              min?: undefined;
              max?: undefined;
            };
          }
        | {
            icon: string;
            name: string;
            label: string;
            type: string;
            description: string;
            required: boolean;
            unique: boolean;
            private: boolean;
            default: string;
            validation: {
              minLength: number;
              maxLength: number;
              regex?: undefined;
              min?: undefined;
              max?: undefined;
            };
            options?: undefined;
          }
        | {
            icon: string;
            name: string;
            label: string;
            type: string;
            description: string;
            required: boolean;
            private: boolean;
            default: string;
            validation: {
              minLength: number;
              maxLength: number;
              regex?: undefined;
              min?: undefined;
              max?: undefined;
            };
            unique?: undefined;
            options?: undefined;
          }
        | {
            icon: string;
            name: string;
            label: string;
            type: string;
            required: boolean;
            description: string;
            unique?: undefined;
            private?: undefined;
            default?: undefined;
            options?: undefined;
            validation?: undefined;
          }
        | {
            icon: string;
            name: string;
            label: string;
            type: string;
            description: string;
            required: boolean;
            unique: boolean;
            private: boolean;
            default: number;
            options: {
              format: string;
              variant?: undefined;
            };
            validation: {
              min: number;
              max: number;
              minLength?: undefined;
              maxLength?: undefined;
              regex?: undefined;
            };
          }
      )[];
    }
  | {
      title: string;
      items: {
        icon: string;
        name: string;
        label: string;
        type: string;
        description: string;
        required: boolean;
        private: boolean;
      }[];
    }
  | {
      title: string;
      items: (
        | {
            icon: string;
            name: string;
            label: string;
            type: string;
            description: string;
            required?: undefined;
            private?: undefined;
            default?: undefined;
          }
        | {
            icon: string;
            name: string;
            label: string;
            type: string;
            description: string;
            required: boolean;
            private: boolean;
            default: boolean;
          }
      )[];
    }
  | {
      title: string;
      items: {
        icon: string;
        name: string;
        label: string;
        type: string;
        description: string;
        required: boolean;
        private: boolean;
        options: {
          relationType: string;
          target: string;
          targetLabelField: string;
        };
      }[];
    }
  | {
      title: string;
      items: {
        icon: string;
        name: string;
        label: string;
        type: string;
        description: string;
        required: boolean;
        unique: boolean;
        private: boolean;
        default: null;
        options: {
          format: string;
        };
      }[];
    }
)[] {
  const fields = [
    {
      title: "Basic Fields",
      items: [
        {
          icon: "Type",
          name: "title",
          label: "Title",
          type: "text",
          description: "Short text content like titles, names, etc.",
          required: true,
          unique: true,
          private: false,
          default: "Untitled",
          options: { variant: "short" },
          validation: {
            minLength: 5,
            maxLength: 100,
            regex: "^[A-Za-z0-9]+$",
          },
        },
        {
          icon: "Mail",
          name: "contact_email",
          label: "Contact Email",
          type: "email",
          description: "Email address field with validation",
          required: true,
          unique: true,
          private: false,
          default: "",
          validation: { minLength: 5, maxLength: 255 },
        },
        {
          icon: "Lock",
          name: "admin_password",
          label: "Admin Password",
          type: "password",
          description: "Password field with security validation",
          required: true,
          private: true,
          default: "",
          validation: { minLength: 8, maxLength: 64 },
        },
        {
          icon: "AlignLeft",
          name: "my_field_label",
          label: "My Field Label",
          type: "textarea",
          required: true,
          description: "Multi-line text content",
        },
        {
          icon: "Hash",
          name: "price",
          label: "Price",
          type: "number",
          description: "Numeric values like price, quantity, etc.",
          required: true,
          unique: false,
          private: false,
          default: 0,
          options: { format: "float" },
          validation: { min: 0, max: 10000 },
        },
      ],
    },
    {
      title: "Content Fields",
      items: [
        {
          icon: "Edit",
          name: "content",
          label: "Content",
          type: "richText",
          description: "Rich text editor with formatting options",
          required: true,
          private: false,
        },
      ],
    },
    {
      title: "Choice Fields",
      items: [
        {
          icon: "List",
          name: "select",
          label: "Select",
          type: "select",
          description: "Select from predefined options",
        },
        {
          icon: "ToggleLeft",
          name: "is_featured",
          label: "Is Featured",
          type: "checkbox",
          description:
            "Yes/no or true/false values with multiple display options",
          required: false,
          private: false,
          default: false,
        },
        {
          icon: "Circle",
          name: "radio",
          label: "Radio",
          type: "radio",
          description: "Yes/no or true/false values displayed as radio buttons",
        },
      ],
    },
    {
      title: "Relational Fields",
      items: [
        {
          icon: "Link2",
          name: "author",
          label: "Author",
          type: "relationship",
          description: "Reference to other content",
          required: true,
          private: false,
          options: {
            relationType: "hasOne",
            target: "user",
            targetLabelField: "name",
          },
        },
      ],
    },
    {
      title: "Advanced Fields",
      items: [
        {
          icon: "Calendar",
          name: "published_at",
          label: "Published At",
          type: "date",
          description: "Date picker for date/time values",
          required: false,
          unique: false,
          private: false,
          default: null,
          options: { format: "datetime" },
        },
      ],
    },
  ];

  return fields;
}
