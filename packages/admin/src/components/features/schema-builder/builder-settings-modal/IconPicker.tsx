// Why: searchable popover that selects a Lucide icon by name. Extracted from
// the legacy CollectionSettings.tsx so the new BuilderSettingsModal Basics
// tab can reuse it. The curated icon list lives here too (single source of
// truth) — when the legacy CollectionSettings file is deleted in PR 2/3
// nothing else needs to change.
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@revnixhq/ui";
import { useCallback, useMemo, useState } from "react";

import * as Icons from "@admin/components/icons";
import type { LucideIcon } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

/**
 * Curated icons grouped by content category for collection / single /
 * component pickers. Matches the legacy list verbatim — kept stable so
 * existing collections that picked an icon continue to render.
 */
export const ICON_PICKER_ICONS = [
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

const iconMap = Icons as unknown as Record<string, LucideIcon>;

export interface IconPickerProps {
  value?: string;
  onChange: (iconName: string) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
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
