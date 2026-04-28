/**
 * Field Editor
 *
 * Properties panel for editing the selected field's configuration.
 * Provides tabbed interface for General, Validation, and Conditional settings.
 *
 * @module admin/components/builder/FieldEditor
 * @since 0.1.0
 */

"use client";
import { FormLabelWithTooltip } from "@revnixhq/admin";
import {
  Input,
  Button,
  Checkbox,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";
import { useState, useCallback, useMemo } from "react";

import type {
  FormField,
  TextFormField,
  SelectFormField,
  RadioFormField,
} from "../../../types";

import { ConditionalLogicEditor } from "./ConditionalLogicEditor";

// ============================================================================
// Types
// ============================================================================

export interface FieldEditorProps {
  /** The field being edited */
  field: FormField;
  /** All fields in the form (for conditional logic references) */
  allFields: FormField[];
  /** Callback when field is updated */
  onUpdate: (updates: Partial<FormField>) => void;
  /** Callback when field is deleted */
  onDelete: () => void;
  /** Callback when field is duplicated */
  onDuplicate?: () => void;
}

// ============================================================================
// Helper Components
// ============================================================================

/**
 * General properties tab - common field settings
 */
function GeneralTab({
  field,
  allFields,
  onUpdate,
}: {
  field: FormField;
  allFields: FormField[];
  onUpdate: (updates: Partial<FormField>) => void;
}) {
  // Check if other fields have conditional logic referencing this field
  const hasConditionalReferences = useMemo(() => {
    return allFields.some(f => {
      if (f.name === field.name || !f.conditionalLogic?.enabled) return false;
      return f.conditionalLogic.conditions.some(c => c.field === field.name);
    });
  }, [allFields, field.name]);

  return (
    <div className="space-y-6 py-4">
      {/* Field Name */}
      <div className="space-y-2">
        <FormLabelWithTooltip
          label="Field Name (ID)"
          htmlFor="field-name"
          description="Used as the key in submission data. Should be unique and contain no spaces."
        />
        <Input
          id="field-name"
          type="text"
          value={field.name}
          onChange={e => onUpdate({ name: e.target.value })}
          pattern="^[a-zA-Z][a-zA-Z0-9_]*$"
          className="bg-transparent"
        />
        {hasConditionalReferences && (
          <p className="text-[11px] text-amber-500 font-medium">
            ⚠️ Changing this may break conditional logic referencing this field
          </p>
        )}
      </div>

      {/* Label - not shown for hidden fields */}
      {field.type !== "hidden" && (
        <div className="space-y-2">
          <FormLabelWithTooltip
            label="Label"
            htmlFor="field-label"
            description="The text displayed above the field in the form."
          />
          <Input
            id="field-label"
            type="text"
            value={field.label}
            onChange={e => onUpdate({ label: e.target.value })}
            className="bg-transparent"
          />
        </div>
      )}

      {/* Placeholder - for text-like fields */}
      {(field.type === "text" ||
        field.type === "email" ||
        field.type === "phone" ||
        field.type === "url" ||
        field.type === "number" ||
        field.type === "textarea") && (
        <div className="space-y-2">
          <FormLabelWithTooltip
            label="Placeholder"
            htmlFor="field-placeholder"
            description="The faint text shown inside the field when empty."
          />
          <Input
            id="field-placeholder"
            type="text"
            value={field.placeholder || ""}
            onChange={e => onUpdate({ placeholder: e.target.value })}
            className="bg-transparent"
          />
        </div>
      )}

      {/* Help Text - not shown for hidden fields */}
      {field.type !== "hidden" && (
        <div className="space-y-2">
          <FormLabelWithTooltip
            label="Help Text"
            htmlFor="field-help"
            description="Additional instructions displayed below the field."
          />
          <Input
            id="field-help"
            type="text"
            value={field.helpText || ""}
            onChange={e => onUpdate({ helpText: e.target.value })}
            className="bg-transparent"
          />
        </div>
      )}

      {/* Required - not shown for hidden or checkbox fields */}
      {field.type !== "hidden" && field.type !== "checkbox" && (
        <div className="flex items-center gap-3 pt-1">
          <Checkbox
            id="field-required"
            checked={field.required || false}
            onCheckedChange={checked =>
              onUpdate({ required: checked === true })
            }
          />
          <FormLabelWithTooltip
            label="Required field"
            htmlFor="field-required"
            description="Forces the user to fill this field before submitting."
          />
        </div>
      )}

      {/* Width */}
      <div className="space-y-2">
        <FormLabelWithTooltip
          label="Width"
          htmlFor="field-width"
          description="How much space this field takes in a horizontal row."
        />
        <Select
          value={field.admin?.width || "100%"}
          onValueChange={value =>
            onUpdate({
              admin: {
                ...field.admin,
                width: value as "25%" | "33%" | "50%" | "66%" | "75%" | "100%",
              },
            })
          }
        >
          <SelectTrigger className="w-full bg-transparent border-input dark:bg-slate-900/50">
            <SelectValue placeholder="Select width" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="100%">Full Width (100%)</SelectItem>
            <SelectItem value="75%">Three Quarters (75%)</SelectItem>
            <SelectItem value="66%">Two Thirds (66%)</SelectItem>
            <SelectItem value="50%">Half (50%)</SelectItem>
            <SelectItem value="33%">One Third (33%)</SelectItem>
            <SelectItem value="25%">One Quarter (25%)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Type-specific options */}
      <TypeSpecificOptions field={field} onUpdate={onUpdate} />
    </div>
  );
}

/**
 * Type-specific field options
 */
function TypeSpecificOptions({
  field,
  onUpdate,
}: {
  field: FormField;
  onUpdate: (updates: Partial<FormField>) => void;
}) {
  switch (field.type) {
    case "select":
    case "radio":
      return <OptionsEditor field={field} onUpdate={onUpdate} />;

    case "textarea": {
      const textareaField = field;
      return (
        <div className="space-y-2">
          <FormLabelWithTooltip
            label="Rows"
            htmlFor="field-rows"
            description="Height of the textarea in text lines."
          />
          <Input
            id="field-rows"
            type="number"
            min={2}
            max={20}
            value={textareaField.rows || 4}
            onChange={e => onUpdate({ rows: parseInt(e.target.value) || 4 })}
            className="w-24 bg-transparent"
          />
        </div>
      );
    }

    case "file": {
      const fileField = field;
      return (
        <>
          <div className="space-y-2">
            <FormLabelWithTooltip
              label="Accepted File Types"
              htmlFor="field-accept"
              description="Comma-separated MIME types (e.g., image/*, application/pdf)."
            />
            <Input
              id="field-accept"
              type="text"
              value={fileField.accept || ""}
              onChange={e => onUpdate({ accept: e.target.value })}
              placeholder="image/*,application/pdf"
              className="bg-transparent"
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Checkbox
              id="field-multiple"
              checked={fileField.multiple || false}
              onCheckedChange={checked =>
                onUpdate({ multiple: checked === true })
              }
            />
            <FormLabelWithTooltip
              label="Allow multiple files"
              htmlFor="field-multiple"
              description="Users can upload more than one file at once."
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Checkbox
              id="field-attach-to-email"
              checked={fileField.attachToEmail || false}
              onCheckedChange={checked =>
                onUpdate({ attachToEmail: checked === true })
              }
            />
            <FormLabelWithTooltip
              label="Attach to notification emails"
              htmlFor="field-attach-to-email"
              description="Uploaded files will be attached to all notification emails for this form."
            />
          </div>
        </>
      );
    }

    case "hidden": {
      const hiddenField = field;
      return (
        <div className="space-y-2">
          <FormLabelWithTooltip
            label="Default Value"
            htmlFor="field-default"
            description="This value will be submitted silently with the form."
          />
          <Input
            id="field-default"
            type="text"
            value={hiddenField.defaultValue || ""}
            onChange={e => onUpdate({ defaultValue: e.target.value })}
            className="bg-transparent"
          />
        </div>
      );
    }

    case "date": {
      const dateField = field;
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <FormLabelWithTooltip
              label="Minimum Date"
              htmlFor="min-date"
              description="Lower bound for date selection."
            />
            <Input
              id="min-date"
              type="date"
              value={dateField.min || ""}
              onChange={e => onUpdate({ min: e.target.value })}
              className="bg-transparent"
            />
          </div>
          <div className="space-y-2">
            <FormLabelWithTooltip
              label="Maximum Date"
              htmlFor="max-date"
              description="Upper bound for date selection."
            />
            <Input
              id="max-date"
              type="date"
              value={dateField.max || ""}
              onChange={e => onUpdate({ max: e.target.value })}
              className="bg-transparent"
            />
          </div>
        </div>
      );
    }

    case "number": {
      const numField = field;
      return (
        <div className="space-y-2">
          <FormLabelWithTooltip
            label="Step"
            htmlFor="field-step"
            description="Increment/decrement step (e.g., 0.01 for decimals)."
          />
          <Input
            id="field-step"
            type="number"
            value={numField.validation?.step || ""}
            onChange={e =>
              onUpdate({
                validation: {
                  ...numField.validation,
                  step: parseFloat(e.target.value) || undefined,
                },
              })
            }
            placeholder="1"
            className="w-24 bg-transparent"
          />
        </div>
      );
    }

    default:
      return null;
  }
}

/**
 * Options editor for select/radio/checkbox-group fields
 */
function OptionsEditor({
  field,
  onUpdate,
}: {
  field: FormField;
  onUpdate: (updates: Partial<FormField>) => void;
}) {
  const optionsField = field as SelectFormField | RadioFormField;
  const options = useMemo(
    () => optionsField.options || [],
    [optionsField.options]
  );

  const addOption = useCallback(() => {
    const newOptions = [
      ...options,
      {
        label: `Option ${options.length + 1}`,
        value: `option_${options.length + 1}`,
      },
    ];
    onUpdate({ options: newOptions });
  }, [options, onUpdate]);

  const updateOption = useCallback(
    (index: number, key: "label" | "value", value: string) => {
      const newOptions = options.map((opt, i: number) =>
        i === index ? { ...opt, [key]: value } : opt
      );
      onUpdate({ options: newOptions });
    },
    [options, onUpdate]
  );

  const removeOption = useCallback(
    (index: number) => {
      const newOptions = options.filter((_, i: number) => i !== index);
      onUpdate({ options: newOptions });
    },
    [options, onUpdate]
  );

  return (
    <div className="space-y-3 pt-6">
      <FormLabelWithTooltip
        label="Options"
        description="List of choices available for this field."
      />

      {options.length === 0 ? (
        <div className="p-4 bg-muted/30 rounded-md border border-dashed border-border text-center text-xs text-muted-foreground">
          No options defined. Add an option to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {options.map((opt, index) => (
            <div key={index} className="flex items-center gap-2 group">
              <Input
                type="text"
                value={opt.label}
                onChange={e => updateOption(index, "label", e.target.value)}
                placeholder="Label"
                className="flex-1 h-9 bg-transparent"
              />
              <Input
                type="text"
                value={opt.value}
                onChange={e => updateOption(index, "value", e.target.value)}
                placeholder="Value"
                className="flex-1 h-9 bg-transparent"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => removeOption(index)}
                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                title="Remove option"
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addOption}
        className="w-full border-dashed text-xs h-8"
      >
        + Add Option
      </Button>
    </div>
  );
}

/**
 * Validation tab - field validation settings
 */
function ValidationTab({
  field,
  onUpdate,
}: {
  field: FormField;
  onUpdate: (updates: Partial<FormField>) => void;
}) {
  const validation = useMemo(() => field.validation || {}, [field.validation]);

  const updateValidation = useCallback(
    (key: string, value: string | number | undefined) => {
      onUpdate({
        validation: { ...validation, [key]: value },
      });
    },
    [validation, onUpdate]
  );

  return (
    <div className="space-y-6 pt-2">
      {/* Custom error message */}
      <div className="space-y-2">
        <FormLabelWithTooltip
          label="Custom Error Message"
          htmlFor="error-message"
          description="Override the default browser validation message."
        />
        <Input
          id="error-message"
          type="text"
          value={validation.errorMessage || ""}
          onChange={e => updateValidation("errorMessage", e.target.value)}
          placeholder="This field is required"
          className="bg-transparent"
        />
      </div>

      {/* Text/Textarea length validation */}
      {(field.type === "text" || field.type === "textarea") && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <FormLabelWithTooltip
              label="Min Length"
              htmlFor="min-len"
              description="Minimum characters required."
            />
            <Input
              id="min-len"
              type="number"
              min={0}
              value={(field as TextFormField).validation?.minLength ?? ""}
              onChange={e =>
                updateValidation(
                  "minLength",
                  e.target.value ? parseInt(e.target.value) : undefined
                )
              }
              className="bg-transparent"
            />
          </div>
          <div className="space-y-2">
            <FormLabelWithTooltip
              label="Max Length"
              htmlFor="max-len"
              description="Maximum characters allowed."
            />
            <Input
              id="max-len"
              type="number"
              min={0}
              value={(field as TextFormField).validation?.maxLength ?? ""}
              onChange={e =>
                updateValidation(
                  "maxLength",
                  e.target.value ? parseInt(e.target.value) : undefined
                )
              }
              className="bg-transparent"
            />
          </div>
        </div>
      )}

      {/* Number min/max validation */}
      {field.type === "number" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <FormLabelWithTooltip
              label="Min Value"
              htmlFor="min-val"
              description="Minimum numerical value."
            />
            <Input
              id="min-val"
              type="number"
              value={field.validation?.min ?? ""}
              onChange={e =>
                updateValidation(
                  "min",
                  e.target.value ? parseFloat(e.target.value) : undefined
                )
              }
              className="bg-transparent"
            />
          </div>
          <div className="space-y-2">
            <FormLabelWithTooltip
              label="Max Value"
              htmlFor="max-val"
              description="Maximum numerical value."
            />
            <Input
              id="max-val"
              type="number"
              value={field.validation?.max ?? ""}
              onChange={e =>
                updateValidation(
                  "max",
                  e.target.value ? parseFloat(e.target.value) : undefined
                )
              }
              className="bg-transparent"
            />
          </div>
        </div>
      )}

      {/* Pattern validation for text fields */}
      {(field.type === "text" ||
        field.type === "email" ||
        field.type === "phone" ||
        field.type === "url") && (
        <div className="space-y-2">
          <FormLabelWithTooltip
            label="Pattern (Regex)"
            htmlFor="val-pattern"
            description="Regular expression for advanced validation."
          />
          <Input
            id="val-pattern"
            type="text"
            value={(field as TextFormField).validation?.pattern || ""}
            onChange={e => updateValidation("pattern", e.target.value)}
            placeholder="^[A-Za-z]+$"
            className="bg-transparent"
          />
        </div>
      )}

      {/* File size validation */}
      {field.type === "file" && (
        <div className="space-y-2">
          <FormLabelWithTooltip
            label="Max File Size (bytes)"
            htmlFor="max-file-size"
            description="Maximum allowed size in bytes (10MB ≈ 10485760)."
          />
          <Input
            id="max-file-size"
            type="number"
            min={0}
            value={field.maxFileSize ?? ""}
            onChange={e =>
              onUpdate({
                maxFileSize: e.target.value
                  ? parseInt(e.target.value)
                  : undefined,
              })
            }
            placeholder="10485760"
            className="bg-transparent"
          />
        </div>
      )}

      {/* Info for fields without validation options */}
      {(field.type === "checkbox" || field.type === "hidden") && (
        <div className="p-3 bg-muted/30 rounded-md text-xs text-muted-foreground text-center border border-dashed border-border">
          No additional validation options for this field type.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * FieldEditor - Field properties configuration panel
 *
 * Provides a tabbed interface for editing field properties:
 * - General: name, label, placeholder, help text, required, width, type-specific options
 * - Validation: error messages, min/max length, patterns, etc.
 * - Conditional: show/hide logic based on other field values
 *
 * @example
 * ```tsx
 * <FieldEditor
 *   field={selectedField}
 *   allFields={allFields}
 *   onUpdate={handleUpdate}
 *   onDelete={handleDelete}
 *   onDuplicate={handleDuplicate}
 * />
 * ```
 */
export function FieldEditor({
  field,
  allFields,
  onUpdate,
  onDelete,
  onDuplicate,
}: FieldEditorProps) {
  const [activeTab, setActiveTab] = useState<string>("general");

  // Get human-readable type label
  const getTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      text: "Text",
      email: "Email",
      number: "Number",
      phone: "Phone",
      url: "URL",
      textarea: "Textarea",
      select: "Select",
      checkbox: "Checkbox",
      radio: "Radio",
      file: "File",
      date: "Date",
      time: "Time",
      hidden: "Hidden",
    };
    return labels[type] || type;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          Field Properties
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold dark:bg-primary/20 dark:text-primary-foreground/90">
            {getTypeLabel(field.type)}
          </span>
        </h3>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col"
      >
        <div className="border-b bg-muted/10 border-border">
          <TabsList className="w-full justify-start gap-0">
            <TabsTrigger
              value="general"
              className="w-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background/50 transition-all"
            >
              General
            </TabsTrigger>
            <TabsTrigger
              value="validation"
              className="w-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background/50 transition-all"
            >
              Validation
            </TabsTrigger>
            <TabsTrigger
              value="conditional"
              className="w-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background/50 transition-all"
            >
              Conditional
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 pb-20">
          <TabsContent value="general" className="mt-0">
            <GeneralTab
              field={field}
              allFields={allFields}
              onUpdate={onUpdate}
            />
          </TabsContent>

          <TabsContent value="validation" className="mt-0">
            <ValidationTab field={field} onUpdate={onUpdate} />
          </TabsContent>

          <TabsContent value="conditional" className="mt-0">
            <ConditionalLogicEditor
              field={field}
              allFields={allFields}
              onUpdate={onUpdate}
            />
          </TabsContent>
        </div>
      </Tabs>

      {/* Sticky Footer with actions */}
      <div className="p-4 bg-background border-t border-border flex gap-2 shrink-0">
        {onDuplicate && (
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-9"
            onClick={onDuplicate}
          >
            Duplicate
          </Button>
        )}
        <Button
          type="button"
          variant="destructive"
          className="flex-1 h-9"
          onClick={onDelete}
        >
          Delete Field
        </Button>
      </div>
    </div>
  );
}

export default FieldEditor;
