"use client";

/**
 * ComponentSettings Component
 *
 * Collapsible panel for configuring component-level settings.
 * Displays below the header in the Component Builder.
 *
 * Settings included:
 * - Description
 * - Category (for organizing components)
 * - Icon selector (Lucide icons)
 * - Preview Image URL
 * - Hidden toggle
 *
 * Note: The Component name is now set in the BuilderHeader (singularName field).
 *
 * @module pages/dashboard/component/builder/components/ComponentSettings
 */

import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Textarea,
} from "@revnixhq/ui";
import { useState, useMemo, useCallback, useEffect } from "react";

import type { LucideIcon } from "@admin/components/icons";
import * as Icons from "@admin/components/icons";
import { FormLabelWithTooltip } from "@admin/components/ui/form-label-with-tooltip";
import { cn } from "@admin/lib/utils";

// ============================================================
// Types
// ============================================================

/**
 * Component-level settings data
 */
export interface ComponentSettingsData {
  /** Component description */
  description?: string;
  /** Admin configuration options */
  admin?: {
    /** Category for organizing components (e.g., "Shared", "Blocks") */
    category?: string;
    /** Lucide icon name */
    icon?: string;
    /** Hide from Admin UI */
    hidden?: boolean;
    /** Preview image URL for component selector */
    imageURL?: string;
  };
}

/**
 * Props for the ComponentSettings component
 */
export interface ComponentSettingsProps {
  /** Current settings data */
  settings: ComponentSettingsData;
  /** Callback when settings change */
  onSettingsChange: (settings: ComponentSettingsData) => void;
  /** Whether the panel is expanded */
  isExpanded?: boolean;
  /** Callback when expanded state changes */
  onExpandedChange?: (expanded: boolean) => void;
  /** Display variant */
  variant?: "collapsible" | "card" | "none";
  /** Whether the advanced settings section is open */
  isAdvancedOpen?: boolean;
}

// ============================================================
// Icon Picker Configuration
// ============================================================

/**
 * Curated list of icons for the component icon picker.
 * Includes component-specific icons at the top.
 */
const ICON_PICKER_ICONS = [
  // Component-specific icons
  { name: "Puzzle", label: "Puzzle" },
  { name: "Component", label: "Component" },
  { name: "Box", label: "Box" },
  { name: "Boxes", label: "Boxes" },
  { name: "LayoutTemplate", label: "Template" },
  { name: "Blocks", label: "Blocks" },
  // Content & Documents
  { name: "FileText", label: "Document" },
  { name: "File", label: "File" },
  { name: "Folder", label: "Folder" },
  { name: "Clipboard", label: "Clipboard" },
  { name: "Bookmark", label: "Bookmark" },
  // Media
  { name: "Image", label: "Image" },
  { name: "Video", label: "Video" },
  { name: "Camera", label: "Camera" },
  { name: "Music", label: "Music" },
  // Data & Layout
  { name: "Database", label: "Database" },
  { name: "Layers", label: "Layers" },
  { name: "LayoutGrid", label: "Grid" },
  { name: "Grid3x3", label: "Grid 3x3" },
  { name: "List", label: "List" },
  { name: "LayoutDashboard", label: "Dashboard" },
  // Users & Social
  { name: "User", label: "User" },
  { name: "Users", label: "Users" },
  // Communication
  { name: "Mail", label: "Mail" },
  { name: "MessageSquare", label: "Message" },
  { name: "Bell", label: "Bell" },
  { name: "Send", label: "Send" },
  // Commerce
  { name: "ShoppingCart", label: "Cart" },
  { name: "CreditCard", label: "Credit Card" },
  { name: "Package", label: "Package" },
  { name: "Tag", label: "Tag" },
  // Location & Navigation
  { name: "MapPin", label: "Location" },
  { name: "Map", label: "Map" },
  { name: "Globe", label: "Globe" },
  { name: "Home", label: "Home" },
  // Actions & Status
  { name: "Settings", label: "Settings" },
  { name: "Edit", label: "Edit" },
  { name: "Star", label: "Star" },
  { name: "Heart", label: "Heart" },
  { name: "Flag", label: "Flag" },
  { name: "Zap", label: "Zap" },
  { name: "Sparkles", label: "Sparkles" },
  { name: "Search", label: "Search" },
  // Security & Access
  { name: "Lock", label: "Lock" },
  { name: "Key", label: "Key" },
  { name: "Shield", label: "Shield" },
  // Time & Calendar
  { name: "Calendar", label: "Calendar" },
  { name: "Clock", label: "Clock" },
  // Misc
  { name: "Link", label: "Link" },
  { name: "Code", label: "Code" },
  { name: "Braces", label: "JSON" },
  { name: "Activity", label: "Activity" },
  { name: "Quote", label: "Quote" },
  { name: "Type", label: "Text" },
  { name: "Heading1", label: "Heading" },
] as const;

// Icon mapping
const iconMap = Icons as unknown as Record<string, LucideIcon>;

// ============================================================
// Icon Picker Component
// ============================================================

interface IconPickerProps {
  value?: string;
  onChange: (iconName: string) => void;
}

function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredIcons = useMemo(() => {
    if (!search) return ICON_PICKER_ICONS;
    const lowerSearch = search.toLowerCase();
    return ICON_PICKER_ICONS.filter(
      icon =>
        icon.name.toLowerCase().includes(lowerSearch) ||
        icon.label.toLowerCase().includes(lowerSearch)
    );
  }, [search]);

  const selectedIcon = value ? iconMap[value] : null;
  const SelectedIconComponent = selectedIcon || Icons.Puzzle;

  const handleSelect = useCallback(
    (iconName: string) => {
      onChange(iconName);
      setOpen(false);
      setSearch("");
    },
    [onChange]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full h-9 justify-start gap-2"
        >
          <SelectedIconComponent className="h-4 w-4" />
          <span className="text-sm">
            {value
              ? ICON_PICKER_ICONS.find(i => i.name === value)?.label || value
              : "Select icon..."}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search icons..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>
        <div className="p-2 max-h-[280px] overflow-y-auto">
          {filteredIcons.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No icons found
            </p>
          ) : (
            <div className="grid grid-cols-6 gap-1">
              {filteredIcons.map(icon => {
                const IconComponent = iconMap[icon.name];
                if (!IconComponent) return null;
                const isSelected = value === icon.name;
                return (
                  <button
                    key={icon.name}
                    type="button"
                    onClick={() => handleSelect(icon.name)}
                    className={cn(
                      "flex items-center justify-center p-2 rounded-none transition-colors",
                      "hover:bg-accent hover:text-accent-foreground",
                      isSelected && "bg-primary text-primary-foreground"
                    )}
                    title={icon.label}
                  >
                    <IconComponent className="h-5 w-5" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================
// Main Component
// ============================================================

export function ComponentSettings({
  settings,
  onSettingsChange,
  isExpanded = false,
  onExpandedChange,
  variant = "collapsible",
}: ComponentSettingsProps) {
  const [localExpanded, setLocalExpanded] = useState(isExpanded);

  // Sync with external expanded state
  useEffect(() => {
    setLocalExpanded(isExpanded);
  }, [isExpanded]);

  const handleExpandedChange = useCallback(
    (expanded: boolean) => {
      setLocalExpanded(expanded);
      onExpandedChange?.(expanded);
    },
    [onExpandedChange]
  );

  // Handle settings updates
  const handleUpdate = useCallback(
    (updates: Partial<ComponentSettingsData>) => {
      onSettingsChange({ ...settings, ...updates });
    },
    [settings, onSettingsChange]
  );

  // Handle admin config update
  const handleAdminUpdate = useCallback(
    (updates: Partial<ComponentSettingsData["admin"]>) => {
      handleUpdate({
        admin: {
          ...settings.admin,
          ...updates,
        },
      });
    },
    [settings.admin, handleUpdate]
  );

  const Content = (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6">
        {/* ==================== Basic Info Section ==================== */}
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"></h3>

          {/* Description */}
          <div className="space-y-1.5">
            <Label
              htmlFor="component-description"
              className="text-xs font-medium"
            >
              Description
            </Label>
            <Textarea
              id="component-description"
              value={settings.description || ""}
              onChange={e => handleUpdate({ description: e.target.value })}
              placeholder="Brief description of this component..."
              className="text-sm resize-none"
              rows={2}
            />
          </div>
        </div>

        {/* ==================== Admin Options Section ==================== */}
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Admin Options
          </h3>

          {/* Category */}
          <div className="space-y-1.5">
            <FormLabelWithTooltip
              htmlFor="component-category"
              className="text-xs font-medium"
              label="Category"
              description="Organize components in sidebar and selector"
            />
            <Input
              id="component-category"
              value={settings.admin?.category || ""}
              onChange={e => handleAdminUpdate({ category: e.target.value })}
              placeholder="e.g., Shared, Blocks, Elements"
              className="h-8 text-sm"
            />
          </div>

          {/* Icon */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Icon</Label>
            <IconPicker
              value={settings.admin?.icon}
              onChange={icon => handleAdminUpdate({ icon })}
            />
          </div>
        </div>
      </div>

      {/* ==================== Advanced Section ==================== */}
      <div className="mt-6 pt-6 border-t border-border space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Advanced
        </h3>

        <div className="grid grid-cols-1 gap-6">
          {/* Preview Image URL */}
          <div className="space-y-1.5 border-border/50 py-2">
            <FormLabelWithTooltip
              htmlFor="component-image-url"
              className="text-xs font-medium"
              label="Preview Image URL"
              description="Thumbnail shown in component selector"
            />
            <Input
              id="component-image-url"
              value={settings.admin?.imageURL || ""}
              onChange={e => handleAdminUpdate({ imageURL: e.target.value })}
              placeholder="https://example.com/preview.png"
              className="h-8 text-sm"
            />
          </div>

          {/* Hidden */}
          <div className="flex items-center justify-between py-2 border-border/50">
            <div className="space-y-0.5">
              <FormLabelWithTooltip
                htmlFor="toggle-hidden-component"
                className="text-sm font-medium cursor-pointer"
                label="Hidden"
                description="Hide from component selector"
              />
            </div>
            <Switch
              id="toggle-hidden-component"
              checked={settings.admin?.hidden || false}
              onCheckedChange={checked =>
                handleAdminUpdate({ hidden: checked })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );

  if (variant === "card") {
    return (
      <div className="border border-border rounded-none bg-card shadow-none p-6">
        <div className="flex items-center gap-2 mb-6">
          <Icons.Settings className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold tracking-tight">
            Configuration
          </h3>
        </div>
        {Content}
      </div>
    );
  }

  if (variant === "none") {
    return Content;
  }

  return (
    <Collapsible
      open={localExpanded}
      onOpenChange={handleExpandedChange}
      className="border-b border-border bg-primary/5"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-between w-full px-6 py-3 text-left hover-unified transition-colors"
        >
          <div className="flex items-center gap-2">
            <Icons.Settings className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Component Settings</span>
            {!localExpanded && settings.admin?.category && (
              <span className="text-xs text-muted-foreground ml-2">
                ({settings.admin.category})
              </span>
            )}
          </div>
          <Icons.ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              localExpanded && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-6">{Content}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
