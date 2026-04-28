/**
 * Field Library
 *
 * Displays available field types that can be dragged onto the form canvas.
 * Styled to match the Collection Builder's FieldPalette:
 * - Search input at the top
 * - Accordion category sections (Basic / Advanced)
 * - Blue icon boxes with label + description rows
 * - Drag-to-add and click-to-add support
 *
 * @module admin/components/builder/FieldLibrary
 * @since 0.1.0
 */

"use client";

import { useDraggable } from "@dnd-kit/core";
import { useMemo, useState } from "react";

import type { FormFieldType } from "../../../types";
import {
  useFormBuilder,
  createFieldFromType,
} from "../../context/FormBuilderContext";

// ============================================================================
// Field Type Definitions
// ============================================================================

interface FieldTypeConfig {
  type: FormFieldType;
  label: string;
  description: string;
  /** Lucide-compatible SVG path data for the icon */
  iconPath: string;
  category: "basic" | "advanced";
}

const FIELD_TYPES: FieldTypeConfig[] = [
  // -------------------------------------------------------------------------
  // Basic
  // -------------------------------------------------------------------------
  {
    type: "text",
    label: "Text",
    description: "Single line text input",
    iconPath: "M4 7h16M4 12h16M4 17h10",
    category: "basic",
  },
  {
    type: "email",
    label: "Email",
    description: "Email address with validation",
    iconPath:
      "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    category: "basic",
  },
  {
    type: "number",
    label: "Number",
    description: "Numeric input",
    iconPath: "M7 20l4-16m2 16l4-16M6 9h14M4 15h14",
    category: "basic",
  },
  {
    type: "phone",
    label: "Phone",
    description: "Phone number input",
    iconPath:
      "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498A1 1 0 0121 15.72V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
    category: "basic",
  },
  {
    type: "url",
    label: "URL",
    description: "Website URL input",
    iconPath:
      "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
    category: "basic",
  },
  {
    type: "textarea",
    label: "Textarea",
    description: "Multi-line text input",
    iconPath: "M4 6h16M4 12h16M4 18h7",
    category: "basic",
  },
  {
    type: "select",
    label: "Dropdown",
    description: "Dropdown select menu",
    iconPath: "M8 9l4-4 4 4m0 6l-4 4-4-4",
    category: "basic",
  },
  {
    type: "checkbox",
    label: "Checkbox",
    description: "Single checkbox",
    iconPath: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    category: "basic",
  },
  {
    type: "radio",
    label: "Radio",
    description: "Radio button group",
    iconPath:
      "M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-6a4 4 0 100-8 4 4 0 000 8z",
    category: "basic",
  },
  // -------------------------------------------------------------------------
  // Advanced
  // -------------------------------------------------------------------------
  {
    type: "file",
    label: "File Upload",
    description: "File attachment",
    iconPath:
      "M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13",
    category: "advanced",
  },
  {
    type: "date",
    label: "Date",
    description: "Date picker",
    iconPath:
      "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    category: "advanced",
  },
  {
    type: "time",
    label: "Time",
    description: "Time picker",
    iconPath: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    category: "advanced",
  },
  {
    type: "hidden",
    label: "Hidden",
    description: "Hidden field with static value",
    iconPath:
      "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21",
    category: "advanced",
  },
];

const CATEGORIES = [
  { key: "basic" as const, label: "Basic" },
  { key: "advanced" as const, label: "Advanced" },
];

// ============================================================================
// Draggable Item
// ============================================================================

function DraggableFieldItem({
  type,
  label,
  description,
  iconPath,
  onAdd,
}: FieldTypeConfig & { onAdd: (type: FormFieldType) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `library-${type}`,
    data: {
      isLibraryItem: true,
      fieldType: type,
    },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onAdd(type)}
      title={description}
      className={`flex items-center gap-3 w-full px-2 py-2 rounded-md text-left group hover:bg-muted/50 transition-all duration-150 cursor-grab active:cursor-grabbing active:scale-[0.98] ${
        isDragging ? "opacity-50 bg-primary/5" : ""
      }`}
      {...attributes}
      {...listeners}
    >
      {/* Blue icon box — same as Collection Builder FieldPalette */}
      <div
        className="shrink-0 flex items-center justify-center w-9 h-9 bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-foreground/80"
        style={{
          borderRadius: "6px",
          border: "1px solid hsl(var(--primary) / 0.25)",
        }}
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={iconPath} />
        </svg>
      </div>

      {/* Label + description */}
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] font-semibold text-foreground leading-snug">
          {label}
        </span>
        <span className="text-[11px] text-muted-foreground/80 leading-snug truncate">
          {description}
        </span>
      </div>
    </button>
  );
}

// ============================================================================
// Category Section (accordion)
// ============================================================================

function CategorySection({
  name,
  types,
  isOpen,
  onToggle,
  onAdd,
}: {
  name: string;
  types: FieldTypeConfig[];
  isOpen: boolean;
  onToggle: () => void;
  onAdd: (type: FormFieldType) => void;
}) {
  return (
    <div>
      {/* Accordion trigger */}
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 w-full py-2 px-1 text-left select-none cursor-pointer"
      >
        {/* Chevron */}
        <svg
          className={`h-3 w-3 transition-transform duration-200 shrink-0 ${
            isOpen ? "rotate-0" : "-rotate-90"
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#9ca3af"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>

        {/* Category name */}
        <span
          className="text-[13px] font-semibold tracking-widest uppercase"
          style={{ color: "#9ca3af" }}
        >
          {name}
        </span>

        {/* Count badge */}
        <span
          className="ml-auto text-[10px] font-medium leading-none"
          style={{
            background: "#f3f4f6",
            color: "#9ca3af",
            padding: "2px 6px",
            borderRadius: "4px",
          }}
        >
          {types.length}
        </span>
      </button>

      {/* Expanded items with vertical left line */}
      {isOpen && (
        <div
          className="mb-1 space-y-0.5"
          style={{
            marginLeft: "10px",
            paddingLeft: "10px",
            borderLeft: "1px solid #e5e7eb",
          }}
        >
          {types.map(field => (
            <DraggableFieldItem key={field.type} {...field} onAdd={onAdd} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// FieldLibrary Component
// ============================================================================

/**
 * FieldLibrary — Right-sidebar field type palette
 *
 * Mirrors the Collection Builder's FieldPalette:
 * - Search bar at top
 * - Accordion categories (Basic / Advanced)
 * - Blue icon boxes with draggable rows
 * - Click or drag to add a field
 */
export function FieldLibrary() {
  const { addField } = useFormBuilder();

  const [searchQuery, setSearchQuery] = useState("");
  const [openSection, setOpenSection] = useState<string>("Basic");

  const handleAdd = (type: FormFieldType) => {
    const newField = createFieldFromType(type);
    addField(newField);
  };

  const toggleSection = (name: string) => {
    setOpenSection(prev => (prev === name ? "" : name));
  };

  const isSearching = searchQuery.trim().length > 0;

  const filteredCategories = useMemo(() => {
    const byCategory: Record<"basic" | "advanced", FieldTypeConfig[]> = {
      basic: [],
      advanced: [],
    };

    for (const field of FIELD_TYPES) {
      byCategory[field.category].push(field);
    }

    return CATEGORIES.map(cat => ({
      ...cat,
      types: byCategory[cat.key].filter(f => {
        if (!isSearching) return true;
        const q = searchQuery.toLowerCase();
        return (
          f.label.toLowerCase().includes(q) ||
          f.type.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q)
        );
      }),
    })).filter(c => c.types.length > 0);
  }, [searchQuery, isSearching]);

  const activeFieldCount = filteredCategories.reduce(
    (acc, cat) => acc + cat.types.length,
    0
  );

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Search */}
      <div className="px-3 py-3 border-b border-border">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            placeholder={`Search ${activeFieldCount} field types...`}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="text-[13px] pl-9 flex h-9 w-full rounded-md border border-input bg-muted/20 px-3 py-1 text-sm shadow-none transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            style={{ borderRadius: "6px", height: "38px" }}
          />
        </div>
      </div>

      {/* Accordion list */}
      <div
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        {filteredCategories.map(category => (
          <CategorySection
            key={category.key}
            name={category.label}
            types={category.types}
            isOpen={isSearching ? true : openSection === category.label}
            onToggle={() => toggleSection(category.label)}
            onAdd={handleAdd}
          />
        ))}

        {filteredCategories.length === 0 && (
          <div className="text-center py-12">
            <svg
              className="h-7 w-7 text-muted-foreground/20 mx-auto mb-2"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <p className="text-sm text-muted-foreground">No fields found</p>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2.5 border-t border-border">
        <p className="text-[11px] text-muted-foreground/50 text-center">
          Drag fields to the canvas to add them
        </p>
      </div>
    </div>
  );
}

export default FieldLibrary;
