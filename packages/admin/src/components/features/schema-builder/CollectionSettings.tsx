"use client";

/**
 * CollectionSettings Component
 *
 * Collapsible panel for configuring collection-level settings.
 * Displays below the header in the Collection Builder.
 *
 * Settings included:
 * - Description
 * - Icon selector (Lucide icons)
 * - Admin group (for sidebar organization)
 * - Timestamps toggle
 * - Use as title field selector
 * - Hidden toggle
 *
 * @module components/features/schema-builder/CollectionSettings
 */

import {
  Button,
  Checkbox,
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
import { useQueryClient } from "@tanstack/react-query";
import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";

import type { LucideIcon } from "@admin/components/icons";
import * as Icons from "@admin/components/icons";
import { FormLabelWithTooltip } from "@admin/components/ui/form-label-with-tooltip";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { protectedApi } from "@admin/lib/api/protectedApi";
import { cn } from "@admin/lib/utils";

import type { BuilderField, CollectionSettingsData } from "./types";

// ============================================================
// Icon Picker Configuration
// ============================================================

/**
 * Curated list of icons for the collection icon picker.
 * Organized by category for easy browsing.
 */
const ICON_PICKER_ICONS = [
  // Content & Documents
  { name: "FileText", label: "Document" },
  { name: "File", label: "File" },
  { name: "Folder", label: "Folder" },
  { name: "FolderOpen", label: "Folder Open" },
  { name: "Archive", label: "Archive" },
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
  { name: "UserPlus", label: "Add User" },
  // Communication
  { name: "Mail", label: "Mail" },
  { name: "MessageSquare", label: "Message" },
  { name: "MessageCircle", label: "Chat" },
  { name: "Bell", label: "Bell" },
  { name: "Send", label: "Send" },
  { name: "Phone", label: "Phone" },
  { name: "Inbox", label: "Inbox" },
  // Commerce
  { name: "ShoppingCart", label: "Cart" },
  { name: "ShoppingBag", label: "Bag" },
  { name: "CreditCard", label: "Credit Card" },
  { name: "DollarSign", label: "Dollar" },
  { name: "Wallet", label: "Wallet" },
  { name: "Package", label: "Package" },
  { name: "Truck", label: "Shipping" },
  { name: "Tag", label: "Tag" },
  { name: "Gift", label: "Gift" },
  // Location & Navigation
  { name: "MapPin", label: "Location" },
  { name: "Map", label: "Map" },
  { name: "Globe", label: "Globe" },
  { name: "Home", label: "Home" },
  { name: "Building", label: "Building" },
  // Actions & Status
  { name: "Settings", label: "Settings" },
  { name: "Edit", label: "Edit" },
  { name: "Pencil", label: "Pencil" },
  { name: "Star", label: "Star" },
  { name: "Heart", label: "Heart" },
  { name: "Flag", label: "Flag" },
  { name: "Target", label: "Target" },
  { name: "Zap", label: "Zap" },
  { name: "Sparkles", label: "Sparkles" },
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
  { name: "Briefcase", label: "Briefcase" },
] as const;

// Icon mapping
const iconMap = Icons as unknown as Record<string, LucideIcon>;

// ============================================================
// Component Props
// ============================================================

export interface CollectionSettingsProps {
  /** Current settings data */
  settings: CollectionSettingsData;
  /** Callback when settings change */
  onSettingsChange: (settings: CollectionSettingsData) => void;
  /** List of fields for useAsTitle selector */
  fields: BuilderField[];
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
  const SelectedIconComponent = selectedIcon || Icons.FileText;

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

export function CollectionSettings({
  settings,
  onSettingsChange,
  fields,
  isExpanded = false,
  onExpandedChange,
  variant = "collapsible",
}: CollectionSettingsProps) {
  const [localExpanded, setLocalExpanded] = useState(isExpanded);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const newGroupInputRef = useRef<HTMLInputElement>(null);
  const branding = useBranding();
  const queryClient = useQueryClient();

  // Get custom sidebar groups from admin-meta
  const customGroups = useMemo(() => {
    return branding?.customGroups;
  }, [branding]);

  // Focus the new group input when it appears
  useEffect(() => {
    if (isCreatingGroup) {
      newGroupInputRef.current?.focus();
    }
  }, [isCreatingGroup]);

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

  // Get named fields for selectors (only fields with names)
  const namedFields = useMemo(() => {
    return fields.filter(f => f.name && f.name.trim() !== "");
  }, [fields]);

  // Handle settings updates
  const handleUpdate = useCallback(
    (updates: Partial<CollectionSettingsData>) => {
      onSettingsChange({ ...settings, ...updates });
    },
    [settings, onSettingsChange]
  );

  // Handle admin config update
  const handleAdminUpdate = useCallback(
    (updates: Partial<CollectionSettingsData["admin"]>) => {
      handleUpdate({
        admin: {
          ...settings.admin,
          ...updates,
        },
      });
    },
    [settings.admin, handleUpdate]
  );

  // Handle default column toggle
  const handleDefaultColumnToggle = useCallback(
    (fieldName: string, checked: boolean) => {
      const current = settings.admin?.defaultColumns || [];
      const updated = checked
        ? [...current, fieldName]
        : current.filter(col => col !== fieldName);
      handleAdminUpdate({ defaultColumns: updated });
    },
    [settings.admin?.defaultColumns, handleAdminUpdate]
  );

  // Handle sidebar group selection
  const handleSidebarGroupChange = useCallback(
    (value: string) => {
      if (value === "__create__") {
        setIsCreatingGroup(true);
        setNewGroupName("");
        return;
      }
      handleAdminUpdate({ sidebarGroup: value || undefined });
    },
    [handleAdminUpdate]
  );

  // Handle new group creation (inline) — persists to backend and updates cache
  const handleCreateGroup = useCallback(async () => {
    const trimmed = newGroupName.trim();
    if (!trimmed) {
      setIsCreatingGroup(false);
      return;
    }
    const slug = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!slug) {
      setIsCreatingGroup(false);
      setNewGroupName("");
      return;
    }

    // Build updated groups list (existing + new)
    const existingGroups = customGroups ?? [];
    const alreadyExists = existingGroups.some(g => g.slug === slug);
    if (!alreadyExists) {
      const updatedGroups = [...existingGroups, { slug, name: trimmed }];
      try {
        await protectedApi.patch("/admin-meta/sidebar-groups", {
          groups: updatedGroups,
        });
        // Refresh branding cache so the dropdown shows the new group
        await queryClient.invalidateQueries({ queryKey: ["admin-meta"] });
      } catch (err) {
        console.error(
          "[CollectionSettings] Failed to save sidebar group:",
          err
        );
      }
    }

    handleAdminUpdate({ sidebarGroup: slug });
    setIsCreatingGroup(false);
    setNewGroupName("");
  }, [newGroupName, handleAdminUpdate, customGroups, queryClient]);

  // Auto-remove invalid field references when fields change
  useEffect(() => {
    const namedFieldNames = new Set(namedFields.map(f => f.name));

    // Check useAsTitle
    if (
      settings.admin?.useAsTitle &&
      !namedFieldNames.has(settings.admin.useAsTitle)
    ) {
      handleAdminUpdate({ useAsTitle: undefined });
    }
  }, [namedFields, settings.admin, handleAdminUpdate]);

  const Content = (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6">
        {/* ==================== General Section ==================== */}
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            General
          </h3>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-xs font-medium">
              Description
            </Label>
            <Textarea
              id="description"
              value={settings.description || ""}
              onChange={e => handleUpdate({ description: e.target.value })}
              placeholder="Brief description of this collection..."
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

          {/* Icon */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Icon</Label>
            <IconPicker
              value={settings.admin?.icon}
              onChange={icon => handleAdminUpdate({ icon })}
            />
          </div>

          {/* Sidebar Group */}
          <div className="space-y-1.5">
            <Label htmlFor="sidebar-group" className="text-xs font-medium">
              Sidebar Group
            </Label>
            {isCreatingGroup ? (
              <div className="flex gap-1.5">
                <Input
                  ref={newGroupInputRef}
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreateGroup();
                    }
                    if (e.key === "Escape") setIsCreatingGroup(false);
                  }}
                  placeholder="Group name..."
                  className="h-8 text-sm flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 px-2"
                  onClick={() => { void handleCreateGroup(); }}
                >
                  <Icons.Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  onClick={() => setIsCreatingGroup(false)}
                >
                  <Icons.X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <select
                id="sidebar-group"
                value={settings.admin?.sidebarGroup || ""}
                onChange={e => handleSidebarGroupChange(e.target.value)}
                className="flex w-full rounded-none border border-input bg-background h-10 px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Collections (default)</option>
                {customGroups?.map(group => (
                  <option key={group.slug} value={group.slug}>
                    {group.name}
                  </option>
                ))}
                {/* Show orphaned sidebarGroup value if not in customGroups */}
                {settings.admin?.sidebarGroup &&
                  !customGroups?.some(
                    g => g.slug === settings.admin?.sidebarGroup
                  ) && (
                    <option value={settings.admin.sidebarGroup}>
                      {settings.admin.sidebarGroup}
                    </option>
                  )}
                <option value="__create__">+ Create new group...</option>
              </select>
            )}
            <p className="text-xs text-muted-foreground">
              Assign this collection to a custom sidebar group.
            </p>
          </div>

          {/* Sidebar Order */}
          <div className="space-y-1.5">
            <Label htmlFor="sidebar-order" className="text-xs font-medium">
              Sidebar Order
            </Label>
            <Input
              id="sidebar-order"
              type="number"
              value={settings.admin?.order ?? ""}
              onChange={e =>
                handleAdminUpdate({
                  order: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              placeholder="100"
              className="text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Controls position within the sidebar group. Lower numbers appear
              first.
            </p>
          </div>
        </div>
      </div>

      {/* ==================== Advanced Section ==================== */}
      <div className="mt-6 pt-6 border-t border-border space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Advanced
        </h3>

        <div className="grid grid-cols-1 gap-6">
          {/* Timestamps */}
          <div className="flex items-center justify-between py-2 border-border/50">
            <div className="space-y-0.5">
              <FormLabelWithTooltip
                htmlFor="toggle-timestamps"
                className="text-sm font-medium cursor-pointer"
                label="Timestamps"
                description="Auto-generate createdAt/updatedAt"
              />
            </div>
            <Switch
              id="toggle-timestamps"
              checked={settings.timestamps !== false}
              onCheckedChange={checked => handleUpdate({ timestamps: checked })}
            />
          </div>

          {/* Hidden */}
          <div className="flex items-center justify-between py-2 border-border/50">
            <div className="space-y-0.5">
              <FormLabelWithTooltip
                htmlFor="toggle-hidden"
                className="text-sm font-medium cursor-pointer"
                label="Hidden"
                description="Hide from admin sidebar"
              />
            </div>
            <Switch
              id="toggle-hidden"
              checked={settings.admin?.hidden || false}
              onCheckedChange={checked =>
                handleAdminUpdate({ hidden: checked })
              }
            />
          </div>
        </div>

        {/* Default Columns */}
        <div className="space-y-2 mt-4">
          <FormLabelWithTooltip
            className="text-sm font-medium mb-4"
            label="Default Columns"
            description="Columns to show in list view"
          />
          {namedFields.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2">
              Add fields with names to select columns
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {namedFields.map(field => (
                <label
                  key={field.id}
                  className="flex items-center gap-2 cursor-pointer group"
                >
                  <Checkbox
                    checked={
                      settings.admin?.defaultColumns?.includes(field.name) ||
                      false
                    }
                    onCheckedChange={checked =>
                      handleDefaultColumnToggle(field.name, checked === true)
                    }
                  />
                  <span className="text-sm group-hover-subtle-row transition-colors">
                    {field.label || field.name}
                  </span>
                </label>
              ))}
            </div>
          )}
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
          className="flex items-center justify-between w-full px-6 py-3 text-left hover-subtle-row transition-colors"
        >
          <div className="flex items-center gap-2">
            <Icons.Settings className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Collection Settings</span>
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
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6">
            {/* ==================== General Section ==================== */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                General
              </h3>

              {/* Description */}
              <div className="space-y-1.5">
                <Label htmlFor="description" className="text-xs font-medium">
                  Description
                </Label>
                <Textarea
                  id="description"
                  value={settings.description || ""}
                  onChange={e => handleUpdate({ description: e.target.value })}
                  placeholder="Brief description of this collection..."
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

              {/* Icon */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Icon</Label>
                <IconPicker
                  value={settings.admin?.icon}
                  onChange={icon => handleAdminUpdate({ icon })}
                />
              </div>

              {/* Sidebar Group */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="sidebar-group-collapsible"
                  className="text-xs font-medium"
                >
                  Sidebar Group
                </Label>
                {isCreatingGroup ? (
                  <div className="flex gap-1.5">
                    <Input
                      ref={newGroupInputRef}
                      value={newGroupName}
                      onChange={e => setNewGroupName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleCreateGroup();
                        }
                        if (e.key === "Escape") setIsCreatingGroup(false);
                      }}
                      placeholder="Group name..."
                      className="h-8 text-sm flex-1"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-2"
                      onClick={() => { void handleCreateGroup(); }}
                    >
                      <Icons.Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      onClick={() => setIsCreatingGroup(false)}
                    >
                      <Icons.X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <select
                    id="sidebar-group-collapsible"
                    value={settings.admin?.sidebarGroup || ""}
                    onChange={e => handleSidebarGroupChange(e.target.value)}
                    className="flex w-full rounded-none border border-input bg-background h-10 px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Collections (default)</option>
                    {customGroups?.map(group => (
                      <option key={group.slug} value={group.slug}>
                        {group.name}
                      </option>
                    ))}
                    {/* Show orphaned sidebarGroup value if not in customGroups */}
                    {settings.admin?.sidebarGroup &&
                      !customGroups?.some(
                        g => g.slug === settings.admin?.sidebarGroup
                      ) && (
                        <option value={settings.admin.sidebarGroup}>
                          {settings.admin.sidebarGroup}
                        </option>
                      )}
                    <option value="__create__">+ Create new group...</option>
                  </select>
                )}
                <p className="text-xs text-muted-foreground">
                  Assign this collection to a custom sidebar group.
                </p>
              </div>

              {/* Sidebar Order */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="sidebar-order-collapsible"
                  className="text-xs font-medium"
                >
                  Sidebar Order
                </Label>
                <Input
                  id="sidebar-order-collapsible"
                  type="number"
                  value={settings.admin?.order ?? ""}
                  onChange={e =>
                    handleAdminUpdate({
                      order: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                  placeholder="100"
                  className="text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Controls position within the sidebar group. Lower numbers
                  appear first.
                </p>
              </div>
            </div>

            {/* ==================== Advanced Section ==================== */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Advanced
              </h3>

              {/* Timestamps */}
              <div className="flex items-center justify-between py-2">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Timestamps</Label>
                  <p className="text-xs text-muted-foreground">
                    Auto-generate createdAt/updatedAt
                  </p>
                </div>
                <Switch
                  checked={settings.timestamps !== false}
                  onCheckedChange={checked =>
                    handleUpdate({ timestamps: checked })
                  }
                />
              </div>

              {/* Hidden */}
              <div className="flex items-center justify-between py-2">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Hidden</Label>
                  <p className="text-xs text-muted-foreground">
                    Hide from admin sidebar
                  </p>
                </div>
                <Switch
                  checked={settings.admin?.hidden || false}
                  onCheckedChange={checked =>
                    handleAdminUpdate({ hidden: checked })
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
