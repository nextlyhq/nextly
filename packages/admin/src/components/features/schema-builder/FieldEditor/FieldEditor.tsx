"use client";

/**
 * FieldEditor Component
 *
 * Right panel of the Collection Builder.
 * Configuration panel for the selected field with four tabs:
 * - General: Name, Label, Type, Description, Required, Default value
 * - Validation: Type-specific validation options
 * - Admin: Width, Position, Read-only, Hidden, Condition builder
 * - Advanced: Unique, Index, Localized
 *
 * @module components/features/schema-builder/FieldEditor
 */

import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@revnixhq/ui";
import { useState, useEffect } from "react";

import * as Icons from "@admin/components/icons";
import { generateSlug } from "@admin/lib/fields";

import type {
  BuilderField,
  BuilderFieldAdmin,
  BuilderFieldAdvanced,
  BuilderFieldValidation,
  FieldEditorProps,
  FieldCondition,
} from "../types";

import { AdminSettingsPanel } from "./AdminSettingsPanel";
import { AdvancedOptionsPanel } from "./AdvancedOptionsPanel";
import { GeneralPanel } from "./GeneralPanel";
import {
  FIELD_TYPE_ICONS,
  formatFieldType,
  iconMap,
  isLayoutField,
} from "./utils";
import { ValidationOptionsPanel } from "./ValidationOptionsPanel";

export function FieldEditor({
  field,
  onFieldUpdate,
  onClose,
  siblingFields = [],
}: FieldEditorProps) {
  // Local state for form values
  const [localField, setLocalField] = useState<BuilderField | null>(field);

  // Sync local state with prop
  useEffect(() => {
    setLocalField(field);
  }, [field]);

  // Handle field updates
  const handleUpdate = (updates: Partial<BuilderField>) => {
    setLocalField(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      onFieldUpdate(updated);
      return updated;
    });
  };

  // Handle validation updates
  const handleValidationUpdate = (updates: Partial<BuilderFieldValidation>) => {
    if (!localField) return;
    const validation = { ...localField.validation, ...updates };
    handleUpdate({ validation });
  };

  // Handle admin updates
  const handleAdminUpdate = (updates: Partial<BuilderFieldAdmin>) => {
    if (!localField) return;
    const admin = { ...localField.admin, ...updates };
    handleUpdate({ admin });
  };

  // Handle advanced updates
  const handleAdvancedUpdate = (updates: Partial<BuilderFieldAdvanced>) => {
    if (!localField) return;
    const advanced = { ...localField.advanced, ...updates };
    handleUpdate({ advanced });
  };

  // Handle condition updates
  const handleConditionUpdate = (updates: Partial<FieldCondition> | null) => {
    if (!localField) return;
    if (updates === null) {
      // Remove condition
      // Reason: destructuring to omit `condition` from restAdmin — `_` must be
      // present to separate the property but is intentionally unused.

      const { condition: _, ...restAdmin } = localField.admin || {};
      handleUpdate({ admin: restAdmin });
    } else {
      const currentCondition = localField.admin?.condition || {
        field: "",
        equals: "",
      };
      const condition = { ...currentCondition, ...updates };
      handleAdminUpdate({ condition });
    }
  };

  // Handle label change to auto-generate name
  const handleLabelChange = (label: string) => {
    const previousLabel = localField?.label || "";
    const currentName = localField?.name || "";
    const newName = generateSlug(label).replace(/-/g, "_");

    // Auto-generate name if it hasn't been manually edited
    if (
      !currentName ||
      currentName === generateSlug(previousLabel).replace(/-/g, "_")
    ) {
      handleUpdate({ label, name: newName });
    } else {
      handleUpdate({ label });
    }
  };

  // Empty state - no field selected
  if (!field || !localField) {
    return null;
  }

  const iconName = FIELD_TYPE_ICONS[localField.type] || "FileText";
  const IconComponent = iconMap[iconName] || Icons.FileText;
  const isLayout = isLayoutField(localField.type);
  const isSystemField = localField.isSystem === true;

  return (
    <div className="h-full flex flex-col bg-muted/30">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-background border border-border flex items-center justify-center">
              <IconComponent className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {localField.label || localField.name || "Unnamed Field"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {formatFieldType(localField.type)}
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <Icons.X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="general" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full justify-start rounded-none bg-transparent px-0 shrink-0 gap-0!">
          <TabsTrigger value="general" className="text-xs flex-1">
            General
          </TabsTrigger>
          {!isLayout && (
            <TabsTrigger value="validation" className="text-xs flex-1">
              Validation
            </TabsTrigger>
          )}
          <TabsTrigger value="admin" className="text-xs flex-1">
            Display
          </TabsTrigger>
          {!isLayout && (
            <TabsTrigger value="advanced" className="text-xs flex-1">
              Advanced
            </TabsTrigger>
          )}
        </TabsList>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* ==================== GENERAL TAB ==================== */}
          <TabsContent value="general" className="p-4 space-y-4 mt-0">
            <GeneralPanel
              localField={localField}
              isSystemField={isSystemField}
              isLayout={isLayout}
              onUpdate={handleUpdate}
              onLabelChange={handleLabelChange}
              onValidationUpdate={handleValidationUpdate}
              onAdminUpdate={handleAdminUpdate}
            />
          </TabsContent>

          {/* ==================== VALIDATION TAB ==================== */}
          {!isLayout && (
            <TabsContent value="validation" className="p-4 space-y-4 mt-0">
              <ValidationOptionsPanel
                localField={localField}
                onValidationUpdate={handleValidationUpdate}
              />
            </TabsContent>
          )}

          {/* ==================== ADMIN TAB ==================== */}
          <TabsContent value="admin" className="p-4 space-y-4 mt-0">
            <AdminSettingsPanel
              localField={localField}
              siblingFields={siblingFields}
              onAdminUpdate={handleAdminUpdate}
              onConditionUpdate={handleConditionUpdate}
            />
          </TabsContent>

          {/* ==================== ADVANCED TAB ==================== */}
          {!isLayout && (
            <TabsContent value="advanced" className="p-4 space-y-4 mt-0">
              <AdvancedOptionsPanel
                localField={localField}
                onAdvancedUpdate={handleAdvancedUpdate}
              />
            </TabsContent>
          )}
        </div>
      </Tabs>
    </div>
  );
}
