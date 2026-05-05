"use client";

/**
 * UploadEditor Component
 *
 * Editor for configuring upload field settings. PR H (feedback 2.2)
 * cleanup: trimmed to only the knobs that have a real runtime
 * consumer. Per-knob audit:
 *
 * - hasMany (Allow Multiple) -- KEPT, wired in UploadInput
 * - mimeTypes (File Type Filter) -- KEPT, passed to MediaPickerDialog
 * - maxFileSize (Max File Size) -- KEPT, enforced at upload time
 * - allowCreate -- KEPT (was broken: editor wrote field.allowCreate
 *   while UploadInput read field.admin?.allowCreate). PR H stores it
 *   under field.admin.allowCreate to match the framework's
 *   UploadFieldAdminOptions and the runtime path.
 *
 * Removed (dead UI never read at runtime, per PR H per-knob calls):
 *
 * - relationTo (Media Collection picker)
 * - allowEdit
 * - isSortable
 * - displayPreview
 *
 * @module components/features/schema-builder/UploadEditor
 */

import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@revnixhq/ui";
import { useCallback, useMemo, useState } from "react";

import * as Icons from "@admin/components/icons";
import { FormLabelWithTooltip } from "@admin/components/ui/form-label-with-tooltip";

import type {
  MimeTypeCategory,
  FileSizeUnit,
  UploadEditorProps,
} from "./types";
import {
  MIME_TYPE_CATEGORIES,
  FILE_SIZE_UNITS,
  getMimePatternFromCategory,
  getCategoryFromMimePattern,
  convertToBytes,
  convertFromBytes,
} from "./types";

// ============================================================
// UploadEditor Component
// ============================================================

export function UploadEditor({
  hasMany,
  onHasManyChange,
  mimeTypes,
  onMimeTypesChange,
  maxFileSize,
  onMaxFileSizeChange,
  allowCreate,
  onAllowCreateChange,
}: UploadEditorProps) {
  const [customMimeType, setCustomMimeType] = useState("");

  // Local state for file size with unit
  const [fileSizeValue, setFileSizeValue] = useState<string>(() => {
    if (!maxFileSize) return "";
    const { value } = convertFromBytes(maxFileSize);
    return String(value);
  });
  const [fileSizeUnit, setFileSizeUnit] = useState<FileSizeUnit>(() => {
    if (!maxFileSize) return "MB";
    const { unit } = convertFromBytes(maxFileSize);
    return unit;
  });

  // Determine current MIME type category
  const currentMimeCategory = useMemo(() => {
    return getCategoryFromMimePattern(mimeTypes);
  }, [mimeTypes]);

  // Handle MIME type category change
  const handleMimeCategoryChange = useCallback(
    (category: MimeTypeCategory) => {
      if (category === "custom") {
        // Keep existing custom value or empty
        onMimeTypesChange?.(customMimeType || undefined);
      } else {
        const pattern = getMimePatternFromCategory(category);
        onMimeTypesChange?.(pattern);
      }
    },
    [onMimeTypesChange, customMimeType]
  );

  // Handle custom MIME type input
  const handleCustomMimeTypeChange = useCallback(
    (value: string) => {
      setCustomMimeType(value);
      onMimeTypesChange?.(value || undefined);
    },
    [onMimeTypesChange]
  );

  // Handle file size change
  const handleFileSizeValueChange = useCallback(
    (value: string) => {
      setFileSizeValue(value);
      if (!value) {
        onMaxFileSizeChange?.(undefined);
      } else {
        const numValue = parseFloat(value);
        if (!isNaN(numValue) && numValue > 0) {
          const bytes = convertToBytes(numValue, fileSizeUnit);
          onMaxFileSizeChange?.(bytes);
        }
      }
    },
    [fileSizeUnit, onMaxFileSizeChange]
  );

  // Handle file size unit change
  const handleFileSizeUnitChange = useCallback(
    (unit: FileSizeUnit) => {
      setFileSizeUnit(unit);
      if (fileSizeValue) {
        const numValue = parseFloat(fileSizeValue);
        if (!isNaN(numValue) && numValue > 0) {
          const bytes = convertToBytes(numValue, unit);
          onMaxFileSizeChange?.(bytes);
        }
      }
    },
    [fileSizeValue, onMaxFileSizeChange]
  );

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center gap-2">
        <Icons.Upload className="h-4 w-4 text-muted-foreground" />
        <Label className="text-xs font-medium">Upload Configuration</Label>
      </div>

      {/* Allow Multiple */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <FormLabelWithTooltip
            className="text-sm font-medium"
            label="Allow Multiple"
            description="Upload multiple files"
          />
        </div>
        <Switch checked={hasMany || false} onCheckedChange={onHasManyChange} />
      </div>

      {/* File Type Filter */}
      <div className="space-y-3 pt-2 border-t border-primary/5">
        <Label className="text-xs font-medium text-muted-foreground">
          File Type Filter
        </Label>

        {/* MIME Type Category Selector */}
        <div className="space-y-2">
          <Label className="text-xs font-medium">Allowed File Types</Label>
          <Select
            value={currentMimeCategory}
            onValueChange={(value: MimeTypeCategory) =>
              handleMimeCategoryChange(value)
            }
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select file type" />
            </SelectTrigger>
            <SelectContent>
              {MIME_TYPE_CATEGORIES.map(category => (
                <SelectItem key={category.value} value={category.value}>
                  <div className="flex items-center gap-2">
                    <span>{category.label}</span>
                    {category.description && (
                      <span className="text-muted-foreground text-xs">
                        ({category.description})
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Custom MIME Type Input (shown when "Custom" is selected) */}
        {currentMimeCategory === "custom" && (
          <div className="space-y-2">
            <FormLabelWithTooltip
              className="text-xs font-medium"
              label="Custom MIME Types"
              description="Comma-separated MIME types or patterns (e.g., image/*)"
            />
            <Input
              value={mimeTypes || ""}
              onChange={e => handleCustomMimeTypeChange(e.target.value)}
              placeholder="e.g., image/png,image/jpeg,application/pdf"
              className="h-8 text-sm font-mono"
            />
          </div>
        )}

        {/* Max File Size */}
        <div className="space-y-2">
          <FormLabelWithTooltip
            className="text-xs font-medium"
            label="Max File Size"
            description="Maximum allowed file size for uploads"
          />
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              value={fileSizeValue}
              onChange={e => handleFileSizeValueChange(e.target.value)}
              placeholder="No limit"
              className="h-8 text-sm flex-1"
            />
            <Select
              value={fileSizeUnit}
              onValueChange={(value: FileSizeUnit) =>
                handleFileSizeUnitChange(value)
              }
            >
              <SelectTrigger className="h-8 text-sm w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILE_SIZE_UNITS.map(unit => (
                  <SelectItem key={unit.value} value={unit.value}>
                    {unit.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Admin Options */}
      <div className="space-y-3 pt-2 border-t border-primary/5">
        <Label className="text-xs font-medium text-muted-foreground">
          Admin Options
        </Label>

        {/* Allow Create -- the only surviving Admin Options toggle.
            Stored at field.admin.allowCreate (via patchAdmin in
            TypeSpecificEditor) to match the framework's
            UploadFieldAdminOptions.allowCreate, which is where the
            runtime UploadInput already reads from. Default true. */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Allow Create"
              description="Upload new files from this field"
            />
          </div>
          <Switch
            checked={allowCreate !== false}
            onCheckedChange={onAllowCreateChange}
          />
        </div>
      </div>
    </div>
  );
}
