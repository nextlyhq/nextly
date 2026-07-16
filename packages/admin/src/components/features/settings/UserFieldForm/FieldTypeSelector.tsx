"use client";

import { narrowFieldTypeCatalog } from "nextly/field-catalog";
import type React from "react";

import * as Icons from "@admin/components/icons";
import { Check, Type } from "@admin/components/icons";
import type { UserFieldType } from "@admin/services/userFieldsApi";

// The profile-field subset of the shared catalog: flat scalar types only.
// Labels, hints, and icon names come from the catalog so this picker cannot
// drift from the schema builder's description of the same types.
const USER_FIELD_TYPE_KEYS: readonly UserFieldType[] = [
  "text",
  "textarea",
  "number",
  "email",
  "select",
  "radio",
  "checkbox",
  "date",
];

const FIELD_TYPE_OPTIONS = narrowFieldTypeCatalog(USER_FIELD_TYPE_KEYS).map(
  entry => ({
    value: entry.type,
    label: entry.label,
    description: entry.hint,
    icon: (Icons as Record<string, React.ElementType>)[entry.icon] ?? Type,
  })
);

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
              relative flex flex-row items-center gap-4 rounded-none  border border-border p-4 text-left transition-all duration-200
              ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-border hover-unified"
              }
              ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
            `}
            style={{
              border:
                "1px solid color-mix(in srgb, var(--nx-primary) 25%, transparent)",
            }}
          >
            {isSelected && (
              <div className="absolute top-2 right-2 flex items-center justify-center w-5 h-5 rounded-none bg-primary text-primary-foreground">
                <Check className="h-3 w-3 text-primary-foreground" />
              </div>
            )}
            <div
              className={`
                shrink-0 flex items-center justify-center w-9 h-9 transition-all duration-200
                bg-primary/5 text-primary  border border-border rounded-none
                ${isSelected ? "border border-border" : ""}
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
