"use client";

/**
 * FieldPalette Component
 *
 * Sidebar panel showing field types grouped by accordion categories.
 * "Text" section is open by default, all others closed.
 * Vertical left-line shown for open sections (like screenshot).
 * Scrollbar hidden.
 */

import { useDraggable } from "@dnd-kit/core";
import {
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@revnixhq/ui";
import { useMemo, useState } from "react";

import * as Icons from "@admin/components/icons";
import type { LucideIcon } from "@admin/components/icons";

import type { FieldPaletteProps, PaletteDragData } from "./types";

const iconMap = Icons as unknown as Record<string, LucideIcon>;

const FIELD_CATEGORIES = [
  {
    name: "Basic",
    types: [
      {
        type: "text",
        label: "Text",
        description: "Short text input",
        icon: "Type",
      },
      {
        type: "textarea",
        label: "Textarea",
        description: "Multi-line text content",
        icon: "AlignLeft",
      },
      {
        type: "richText",
        label: "Rich Text",
        description: "Rich text editor with formatting",
        icon: "Edit",
      },
      {
        type: "email",
        label: "Email",
        description: "Email address field",
        icon: "Mail",
      },
      {
        type: "password",
        label: "Password",
        description: "Secure text input",
        icon: "Eye",
      },
      {
        type: "number",
        label: "Number",
        description: "Numeric values",
        icon: "Hash",
      },
      {
        type: "code",
        label: "Code",
        description: "Code editor with syntax highlighting",
        icon: "Code2",
      },
      {
        type: "date",
        label: "Date",
        description: "Date and time picker",
        icon: "Calendar",
      },
      {
        type: "select",
        label: "Select",
        description: "Dropdown from options",
        icon: "ChevronDown",
      },
      {
        type: "radio",
        label: "Radio",
        description: "Single choice from options",
        icon: "Circle",
      },
      {
        type: "checkbox",
        label: "Checkbox",
        description: "Boolean toggle",
        icon: "CheckSquare",
      },
      {
        type: "toggle",
        label: "Toggle",
        description: "On/off switch",
        icon: "ToggleLeft",
      },
      {
        type: "upload",
        label: "Upload",
        description: "File or image upload",
        icon: "Upload",
      },
      {
        type: "chips",
        label: "Chips",
        description: "Free-form tags or keywords",
        icon: "Tags",
      },
    ],
  },
  {
    name: "Advanced",
    types: [
      {
        type: "group",
        label: "Group",
        description: "Nested group of fields",
        icon: "FolderOpen",
      },
      {
        type: "repeater",
        label: "Repeater",
        description: "Repeatable group of fields",
        icon: "Layers",
      },
      {
        type: "component",
        label: "Component",
        description: "Embed reusable field groups",
        icon: "Puzzle",
      },
      {
        type: "json",
        label: "JSON",
        description: "Raw JSON data",
        icon: "Braces",
      },
      {
        type: "relationship",
        label: "Relationship",
        description: "Reference other collections",
        icon: "Link2",
      },
    ],
  },
];

function DraggablePaletteItem({
  fieldType,
  label,
  description,
  icon,
  onFieldAdd,
}: {
  fieldType: string;
  label: string;
  description: string;
  icon: string;
  onFieldAdd: (fieldType: string) => void;
}) {
  const dragData: PaletteDragData = {
    source: "palette",
    fieldType,
    label,
    icon,
  };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${fieldType}`,
    data: dragData,
  });
  const IconComponent = iconMap[icon] || Icons.FileText;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={setNodeRef}
          type="button"
          onClick={() => onFieldAdd(fieldType)}
          className={`
            flex items-center gap-3 w-full px-2 py-2 rounded-none text-left group
            hover-subtle-row transition-all duration-150
            cursor-grab active:cursor-grabbing active:scale-[0.98]
            ${isDragging ? "opacity-50 bg-primary/5" : ""}
          `}
          {...attributes}
          {...listeners}
        >
          {/* Blue icon box */}
          <div className="shrink-0 flex items-center justify-center w-9 h-9 bg-primary/5 text-primary dark:bg-primary/20 dark:text-primary-foreground/80">
            <IconComponent className="h-4 w-4" />
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
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[180px]">
        <p className="text-xs">{description}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function CategorySection({
  name,
  types,
  isOpen,
  onToggle,
  onFieldAdd,
}: {
  name: string;
  types: (typeof FIELD_CATEGORIES)[0]["types"];
  isOpen: boolean;
  onToggle: () => void;
  onFieldAdd: (fieldType: string) => void;
}) {
  return (
    <div>
      {/* Accordion trigger */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 w-full py-2 px-1 text-left select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-none"
      >
        {/* Chevron — rotates on open */}
        <Icons.ChevronDown
          className={`h-3 w-3 transition-transform duration-200 shrink-0 text-muted-foreground/50 ${
            isOpen ? "rotate-0" : "-rotate-90"
          }`}
        />
        {/* Category name */}
        <span className="text-[13px] font-semibold tracking-widest uppercase text-muted-foreground/50">
          {name}
        </span>
        {/* Count badge — pushed to the far right */}
        <span className="ml-auto text-[10px] font-medium leading-none bg-primary/5 px-1.5 py-0.5 rounded-none] text-muted-foreground/50">
          {types.length}
        </span>
      </button>

      {/* Expanded items with subtle vertical line */}
      {isOpen && (
        <div className="mb-1 space-y-0.5 ml-2.5 pl-2.5  border-l border-primary/5">
          {types.map(field => (
            <DraggablePaletteItem
              key={field.type}
              fieldType={field.type}
              label={field.label}
              description={field.description}
              icon={field.icon}
              onFieldAdd={onFieldAdd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FieldPalette({
  onFieldAdd,
  searchQuery,
  onSearchChange,
}: FieldPaletteProps) {
  const [openSection, setOpenSection] = useState<string>("Basic");

  const toggleSection = (name: string) => {
    setOpenSection(prev => (prev === name ? "" : name));
  };

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return FIELD_CATEGORIES;
    const query = searchQuery.toLowerCase();
    return FIELD_CATEGORIES.map(category => ({
      ...category,
      types: category.types.filter(
        f =>
          f.label.toLowerCase().includes(query) ||
          f.type.toLowerCase().includes(query) ||
          f.description.toLowerCase().includes(query)
      ),
    })).filter(c => c.types.length > 0);
  }, [searchQuery]);

  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Search */}
      <div className="px-3 py-3  border-b border-primary/5">
        <div className="relative">
          <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <Input
            type="search"
            placeholder="Search 18 field types..."
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className="text-[13px] pl-9 bg-primary/5 border-primary/5 rounded-none] h-[38px]"
          />
        </div>
      </div>

      {/* Accordion list — hide scrollbar */}
      <div
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
        style={
          {
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }
        }
      >
        {/* Hide webkit scrollbar via inline style approach */}
        <style>{`.field-palette-scroll::-webkit-scrollbar { display: none; }`}</style>

        <TooltipProvider delayDuration={300}>
          {filteredCategories.map(category => (
            <CategorySection
              key={category.name}
              name={category.name}
              types={category.types}
              isOpen={isSearching ? true : openSection === category.name}
              onToggle={() => toggleSection(category.name)}
              onFieldAdd={onFieldAdd}
            />
          ))}
        </TooltipProvider>

        {filteredCategories.length === 0 && (
          <div className="text-center py-12">
            <Icons.Search className="h-7 w-7 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No fields found</p>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2.5  border-t border-primary/5">
        <p className="text-[11px] text-muted-foreground/50 text-center">
          Drag fields to the canvas to add them
        </p>
      </div>
    </div>
  );
}
