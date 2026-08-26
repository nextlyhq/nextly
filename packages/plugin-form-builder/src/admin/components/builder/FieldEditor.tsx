"use client";

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
import {
  drawsAnyValidationRule,
  FieldOptionsEditor,
  ValidationRulesEditor,
  withOptionIds,
  type FieldOptionsEditorProps,
  type ValidationRuleValues,
} from "@nextlyhq/plugin-sdk/admin";
import {
  FormLabelWithTooltip,
  Input,
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
} from "@nextlyhq/ui";
import { validationRulesForFieldType } from "nextly/field-catalog";
import { useState, useCallback, useMemo } from "react";

import type {
  AnyFieldValidation,
  AnyFormField,
  FormField,
  SelectFormField,
  RadioFormField,
} from "../../../types";
import { isKnownFormField } from "../../../types";
import { ENFORCED_VALIDATION_RULES } from "../../../utils/generate-schema";

import { ConditionalLogicEditor } from "./ConditionalLogicEditor";

// ============================================================================
// Types
// ============================================================================

export interface FieldEditorProps {
  /** The field being edited (built-in or plugin-contributed). */
  field: AnyFormField;
  /** All fields in the form (for conditional logic references) */
  allFields: AnyFormField[];
  /** Callback when field is updated */
  onUpdate: (updates: Partial<AnyFormField>) => void;
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
  field: AnyFormField;
  allFields: AnyFormField[];
  onUpdate: (updates: Partial<AnyFormField>) => void;
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
          <p className="text-[11px] text-warning font-medium">
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
          <SelectTrigger className="w-full bg-transparent border-input dark:bg-muted/50">
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

      {/* Type-specific options — built-ins only; a plugin field owns its own
          editor component and carries no built-in type-specific settings. */}
      {isKnownFormField(field) && (
        <TypeSpecificOptions field={field} onUpdate={onUpdate} />
      )}
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

type KitOption = FieldOptionsEditorProps["options"][number];

/**
 * Options editor for select/radio fields, delegating to the SDK's
 * FieldOptionsEditor (drag reorder, auto-generated values, CSV/JSON import,
 * duplicate-value reporting). The kit works on id-carrying rows for
 * drag-and-drop; the form stores plain {label, value} pairs, so ids live in
 * local state and are stripped before every write.
 */
function OptionsEditor({
  field,
  onUpdate,
}: {
  field: FormField;
  onUpdate: (updates: Partial<FormField>) => void;
}) {
  const optionsField = field as SelectFormField | RadioFormField;

  const [kitOptions, setKitOptions] = useState<KitOption[]>(() =>
    withOptionIds(optionsField.options || [])
  );

  const handleOptionsChange = useCallback(
    (next: KitOption[]) => {
      setKitOptions(next);
      onUpdate({
        options: next.map(({ label, value }) => ({ label, value })),
      });
    },
    [onUpdate]
  );

  return (
    <div className="space-y-3 pt-6">
      <FormLabelWithTooltip
        label="Options"
        description="List of choices available for this field."
      />
      <FieldOptionsEditor
        options={kitOptions}
        onOptionsChange={handleOptionsChange}
      />
    </div>
  );
}

/**
 * Validation tab - field validation settings.
 *
 * Which rules a type accepts is ASKED of core rather than decided here. This
 * previously branched on `field.type === "text" || field.type === "textarea"`
 * and similar, which is a list that cannot see a type it was not written to
 * know about — a plugin-contributed field type was offered nothing at all, and
 * `url` and `phone` were handled by yet another list further down.
 *
 * The controls themselves are the shared kit's, so this surface and the schema
 * builder no longer drift on labels, help text or which rules exist. What stays
 * here is what is genuinely this surface's: its own tab chrome, its file-size
 * control (stored on the field rather than in `validation`), and the mapping of
 * its own storage key — this builder stores the custom message as
 * `errorMessage` where core names the rule `message`, and a shared component
 * that silently reconciled the two would make every stored value wrong.
 */
function ValidationTab({
  field,
  onUpdate,
}: {
  field: FormField;
  onUpdate: (updates: Partial<FormField>) => void;
}) {
  // Read across field types rather than narrowing to one: the whole point of
  // the shared editor is that this tab no longer branches on `field.type`.
  const validation: AnyFieldValidation = useMemo(
    () => field.validation ?? {},
    [field.validation]
  );
  // What the type MEANS, narrowed to what this runtime actually enforces.
  // Core offers a textarea `minRows`/`maxRows`; the schema generator has no
  // clause for them, and a control storing a bound nothing reads is worse than
  // no control — the author believes the rule is in force. Both halves are
  // asked rather than restated, so neither can drift behind the other.
  const allowed = useMemo(
    () =>
      validationRulesForFieldType(field.type).filter(rule =>
        (ENFORCED_VALIDATION_RULES as readonly string[]).includes(rule)
      ),
    [field.type]
  );

  const applyRules = useCallback(
    (next: Partial<ValidationRuleValues>) => {
      const { message, ...rules } = next;
      onUpdate({
        validation: {
          ...validation,
          ...rules,
          // This surface's own key for the rule core calls `message`.
          ...(message === undefined ? {} : { errorMessage: message }),
        },
      });
    },
    [validation, onUpdate]
  );

  return (
    <div className="space-y-6 pt-2">
      <ValidationRulesEditor
        allowed={allowed}
        value={{
          minLength: validation.minLength,
          maxLength: validation.maxLength,
          // No row bounds here: this surface neither stores nor enforces them,
          // and `allowed` above never admits them, so passing them would be a
          // value the editor could not draw and the runtime could not read.
          min: validation.min,
          max: validation.max,
          pattern: validation.pattern,
          message: validation.errorMessage,
        }}
        onChange={applyRules}
      />

      {/* Not a validation rule: a file's size limit is stored on the field
          itself rather than in `validation`, so it stays with this surface. */}
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

      {/* Asked, not restated: naming the types with no options here would be a
          third copy of the reasoning this tab just removed. */}
      {!drawsAnyValidationRule(allowed) && field.type !== "file" && (
        // Semantic border token so this info-box boundary is visible at the 3:1 UI minimum.
        <div className="p-3 bg-muted rounded-none text-xs text-muted-foreground text-center border border-dashed border-border">
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
export function FieldEditor({ field, allFields, onUpdate }: FieldEditorProps) {
  const [activeTab, setActiveTab] = useState<string>("general");

  return (
    <div className="flex flex-col">
      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col"
      >
        {/* Semantic border token so the tab-bar bottom edge is visible at the 3:1 UI minimum. */}
        <div className="border-b bg-muted border-border">
          {/* Layout only. The underline, its colours and the square corner come
              from the shared primitive; `w-full` spreads the triggers evenly and
              the active tint is this panel's own surface treatment. */}
          <TabsList className="w-full justify-start gap-0">
            <TabsTrigger
              value="general"
              className="w-full data-[state=active]:bg-background/50"
            >
              General
            </TabsTrigger>
            <TabsTrigger
              value="validation"
              className="w-full data-[state=active]:bg-background/50"
            >
              Validation
            </TabsTrigger>
            <TabsTrigger
              value="conditional"
              className="w-full data-[state=active]:bg-background/50"
            >
              Conditional
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Content */}
        <div className="p-4">
          <TabsContent value="general" className="mt-0">
            <GeneralTab
              field={field}
              allFields={allFields}
              onUpdate={onUpdate}
            />
          </TabsContent>

          <TabsContent value="validation" className="mt-0">
            {isKnownFormField(field) ? (
              <ValidationTab field={field} onUpdate={onUpdate} />
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                This field type manages its own validation.
              </p>
            )}
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
    </div>
  );
}

export default FieldEditor;
