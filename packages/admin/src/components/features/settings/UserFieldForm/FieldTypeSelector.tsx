"use client";


import {
  AlignLeft,
  Calendar,
  Check,
  CheckSquare,
  Circle,
  Hash,
  List,
  Mail,
  Type,
  type LucideIcon,
} from "@admin/components/icons";
import type { UserFieldType } from "@admin/services/userFieldsApi";

const FIELD_TYPE_OPTIONS: {
  value: UserFieldType;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    value: "text",
    label: "Text",
    description: "Single line of text",
    icon: Type,
  },
  {
    value: "textarea",
    label: "Textarea",
    description: "Multi-line text content",
    icon: AlignLeft,
  },
  {
    value: "number",
    label: "Number",
    description: "Numeric values",
    icon: Hash,
  },
  {
    value: "email",
    label: "Email",
    description: "Email address",
    icon: Mail,
  },
  {
    value: "select",
    label: "Select",
    description: "Dropdown with options",
    icon: List,
  },
  {
    value: "radio",
    label: "Radio",
    description: "Single choice from options",
    icon: Circle,
  },
  {
    value: "checkbox",
    label: "Checkbox",
    description: "True/false toggle",
    icon: CheckSquare,
  },
  {
    value: "date",
    label: "Date",
    description: "Date picker",
    icon: Calendar,
  },
];

/** Visual grid picker for selecting a field type */
export function FieldTypePicker({
  value,
  onChange,
  disabled,
}: {
  value: UserFieldType;
  onChange: (type: UserFieldType) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {FIELD_TYPE_OPTIONS.map(opt => {
        const Icon = opt.icon;
        const isSelected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`
              relative flex flex-row items-center gap-4 rounded-none border p-4 text-left transition-all duration-200
              ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/20 hover-unified"
              }
              ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
            `}
            style={{
              border: "1px solid hsl(var(--primary) / 0.25)",
            }}
          >
            {isSelected && (
              <div className="absolute top-2 right-2 flex items-center justify-center w-5 h-5 rounded-none bg-primary text-white">
                <Check className="h-3 w-3 text-primary-foreground" />
              </div>
            )}
            <div
              className={`
                shrink-0 flex items-center justify-center w-9 h-9 transition-all duration-200
                bg-primary/5 text-primary border border-primary/20 rounded-none]
                ${isSelected ? "border border-primary/25" : ""}
              `}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span
                className={`text-sm font-semibold truncate ${isSelected ? "text-primary" : "text-foreground"}`}
              >
                {opt.label}
              </span>
              <span className="text-[12px] text-muted-foreground leading-normal line-clamp-1">
                {opt.description}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
