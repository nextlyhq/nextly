"use client";

/**
 * Field Renderer Component
 *
 * Main field renderer that dynamically selects the appropriate input component
 * based on field type. Handles field wrapping, error display, and conditional rendering.
 *
 * This component serves as the central dispatcher for all field types, enabling
 * extensibility and consistent handling across the entry form system.
 *
 * @module components/entries/fields/FieldRenderer
 * @since 1.0.0
 */

import type {
  FieldConfig,
  TextFieldConfig,
  TextareaFieldConfig,
  EmailFieldConfig,
  PasswordFieldConfig,
  CodeFieldConfig,
  NumberFieldConfig,
  CheckboxFieldConfig,
  SelectFieldConfig,
  RadioFieldConfig,
  DateFieldConfig,
  UploadFieldConfig,
  RelationshipFieldConfig,
  GroupFieldConfig,
  JSONFieldConfig,
  RichTextFieldConfig,
  ChipsFieldConfig,
} from "@revnixhq/nextly/config";
import { lazy, Suspense, useState, useEffect } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { FieldWrapper } from "./FieldWrapper";
import { UploadInput } from "./media/UploadInput";
import { NumberInput } from "./number/NumberInput";
import { JoinField } from "./relational/JoinField";
import { RelationshipInput } from "./relational/RelationshipInput";
import { CheckboxInput } from "./selection/CheckboxInput";
import { ChipsInput } from "./selection/ChipsInput";
import { DateInput } from "./selection/DateInput";
import { RadioInput } from "./selection/RadioInput";
import { SelectInput } from "./selection/SelectInput";
import { ToggleInput } from "./selection/ToggleInput";
import { ArrayInput } from "./structured/ArrayInput";
import { ComponentInput } from "./structured/ComponentInput";
import { GroupInput } from "./structured/GroupInput";
import { JsonInput } from "./structured/JsonInput";
import { EmailInput } from "./text/EmailInput";
import { PasswordInput } from "./text/PasswordInput";
import { TextareaInput } from "./text/TextareaInput";
import { TextInput } from "./text/TextInput";

// RichTextInput uses Lexical which has PrismJS - must be lazy loaded for SSR
const RichTextInput = lazy(() =>
  import("./special/RichTextInput").then(mod => ({
    default: mod.RichTextInput,
  }))
);
// CodeInput uses CodeMirror which has PrismJS - must be lazy loaded for SSR
const CodeInput = lazy(() =>
  import("./text/CodeInput").then(mod => ({ default: mod.CodeInput }))
);

// Special inputs

/**
 * Loading skeleton for editor components during SSR/lazy loading
 */
function EditorSkeleton() {
  return (
    <div className="flex h-[200px] items-center justify-center rounded-none  border border-primary/5 bg-primary/5 animate-pulse">
      <span className="text-sm text-muted-foreground">Loading editor...</span>
    </div>
  );
}

/**
 * Client-side only wrapper for components with browser dependencies
 */
function ClientOnly({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return fallback ? <>{fallback}</> : <EditorSkeleton />;
  }

  return <>{children}</>;
}

// ============================================================================
// Types
// ============================================================================

export interface FieldRendererProps {
  /** Field configuration from collection schema */
  field: FieldConfig;
  /** Base path for nested fields (e.g., "metadata" or "items.0") */
  basePath?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Whether the field is read-only */
  readOnly?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Retrieves nested error from React Hook Form errors object.
 * Handles dot-notation paths like "metadata.title" or "items.0.name".
 *
 * @param errors - React Hook Form errors object
 * @param path - Field path in dot notation
 * @returns Error object if found, undefined otherwise
 */
function getNestedError(
  errors: Record<string, unknown>,
  path: string
): { message?: string } | undefined {
  const keys = path.split(".");
  let current: unknown = errors;

  for (const key of keys) {
    if (current && typeof current === "object" && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  // Check if current is an error object with message
  if (
    current &&
    typeof current === "object" &&
    "message" in current &&
    typeof (current as { message?: string }).message === "string"
  ) {
    return current as { message?: string };
  }

  return undefined;
}

// ============================================================================
// Component
// ============================================================================

/**
 * FieldRenderer - Dynamically renders appropriate input component for a field
 *
 * Acts as a type dispatcher that:
 * 1. Determines the correct input component based on field.type
 * 2. Wraps the input in FieldWrapper for consistent styling and error handling
 * 3. Passes through common props (disabled, readOnly, control)
 * 4. Computes the full field path for nested fields
 *
 * ## Supported Field Types
 *
 * ### Text Fields
 * - `text` - Single-line text input
 * - `textarea` - Multi-line text area
 *
 * ### Number Fields
 * - `number` - Number input with min/max/step
 *
 * ### Selection Fields
 * - `checkbox` - Boolean checkbox
 * - `select` - Dropdown select
 * - `date` - Date picker
 *
 * ### Media Fields
 * - `upload` - File upload with preview
 *
 * ### Relational Fields
 * - `relationship` - Reference to other collection entries
 *
 * ### Structured Fields
 * - `array` - Array field for multiple items
 * - `repeater` - Repeater field for multiple items
 * - `group` - Nested field group
 *
 * ### Special Fields
 * - `richText` - Lexical-based rich text editor
 *
 * ## Usage in Forms
 *
 * @example Basic usage
 * ```tsx
 * <FieldRenderer
 *   field={{
 *     name: 'title',
 *     type: 'text',
 *     label: 'Title',
 *     required: true
 *   }}
 * />
 * ```
 *
 * @example Nested field in a group
 * ```tsx
 * <FieldRenderer
 *   field={{ name: 'city', type: 'text', label: 'City' }}
 *   basePath="address"
 * />
 * // Field path will be: "address.city"
 * ```
 *
 * @example Nested field in array
 * ```tsx
 * <FieldRenderer
 *   field={{ name: 'name', type: 'text', label: 'Name' }}
 *   basePath="items.0"
 * />
 * // Field path will be: "items.0.name"
 * ```
 *
 * @param props - FieldRenderer props
 * @returns Rendered field component wrapped in FieldWrapper
 */
export function FieldRenderer({
  field,
  basePath = "",
  disabled,
  readOnly,
}: FieldRendererProps) {
  const {
    formState: { errors },
    control,
  } = useFormContext();

  // Determine if field should be read-only or disabled
  // Cast to any to handle fields that don't have readOnly/disabled in their admin options
  const adminOptions = field.admin as
    | {
        readOnly?: boolean;
        disabled?: boolean;
        condition?: { field: string; equals: string };
      }
    | undefined;
  const isReadOnly = readOnly || adminOptions?.readOnly;
  const isDisabled = disabled || adminOptions?.disabled;

  // Get condition configuration
  const condition = adminOptions?.condition;

  // Compute the full path of the condition field (relative to current basePath)
  const conditionFieldPath = condition?.field
    ? basePath
      ? `${basePath}.${condition.field}`
      : condition.field
    : undefined;

  // Watch the condition field value to enable reactive conditional rendering
  const conditionFieldValue = useWatch({
    control,
    name: conditionFieldPath || "",
    disabled: !conditionFieldPath,
  });

  // Evaluate condition: if condition exists but is not met, don't render the field
  if (condition && conditionFieldPath) {
    const targetValue = condition.equals;
    // Compare as strings to handle both string and number values
    const currentValue = String(conditionFieldValue ?? "");
    if (currentValue !== targetValue) {
      return null;
    }
  }

  // =========================================
  // Virtual Fields (Computed at read time, no data storage)
  // =========================================
  // Join fields display related entries and don't store data.
  // They have a label but no form input/error state.
  if (field.type === "join") {
    return (
      <FieldWrapper field={field} error={undefined}>
        <JoinField field={field} />
      </FieldWrapper>
    );
  }

  // =========================================
  // Data Fields (With FieldWrapper)
  // =========================================
  // Compute full field path for nested fields
  // Use empty string as fallback for fields without names (shouldn't happen for data fields)
  const fieldName = "name" in field ? (field.name as string) : "";
  const fieldPath = basePath ? `${basePath}.${fieldName}` : fieldName;

  // Get error for this field (handles nested paths)
  const error = fieldPath ? getNestedError(errors, fieldPath) : undefined;

  // Common props passed to all input components
  const commonProps = {
    name: fieldPath,
    disabled: isDisabled,
    readOnly: isReadOnly,
    control,
  };

  // Component fields bypass FieldWrapper — they own their own header/label
  // rendering (accordion in sidebar, card in main content).
  const fieldType = field.type as string;
  if (fieldType === "component") {
    return (
      <ComponentInput
        {...commonProps}
        name={fieldPath}
        field={field as Parameters<typeof ComponentInput>[0]["field"]}
      />
    );
  }

  // Determine if horizontal layout should be used (for checkboxes only, not toggles)
  // Removed horizontal layout override for checkboxes based on user feedback
  // to match the vertical layout of radio buttons.
  const useHorizontalLayout = false;

  return (
    <FieldWrapper
      field={field}
      error={error?.message}
      horizontal={useHorizontalLayout}
    >
      {renderField()}
    </FieldWrapper>
  );

  /**
   * Renders the appropriate input component based on field type.
   * Uses type narrowing to ensure type-safe prop passing.
   */
  function renderField() {
    // Cast to string to allow legacy "string" type which isn't in the FieldConfig union
    const fieldType = field.type as string;
    switch (fieldType) {
      // =========================================
      // Text Types
      // =========================================
      case "text":
      case "string": // Legacy alias - some collections store 'string' instead of 'text'
        return <TextInput {...commonProps} field={field as TextFieldConfig} />;

      case "textarea":
        return (
          <TextareaInput
            {...commonProps}
            field={field as TextareaFieldConfig}
          />
        );

      case "email":
        return (
          <EmailInput {...commonProps} field={field as EmailFieldConfig} />
        );

      case "password":
        return (
          <PasswordInput
            {...commonProps}
            field={field as PasswordFieldConfig}
          />
        );

      case "code":
        return (
          <ClientOnly>
            <Suspense fallback={<EditorSkeleton />}>
              <CodeInput {...commonProps} field={field as CodeFieldConfig} />
            </Suspense>
          </ClientOnly>
        );

      // =========================================
      // Number Types
      // =========================================
      case "number":
      case "decimal": // Legacy alias
        return (
          <NumberInput {...commonProps} field={field as NumberFieldConfig} />
        );

      // =========================================
      // Selection Types
      // =========================================
      case "checkbox":
      case "boolean": // Legacy alias
        return (
          <CheckboxInput
            {...commonProps}
            field={field as CheckboxFieldConfig}
          />
        );

      case "toggle":
        return (
          <ToggleInput {...commonProps} field={field as CheckboxFieldConfig} />
        );

      case "select":
        return (
          <SelectInput {...commonProps} field={field as SelectFieldConfig} />
        );

      case "radio":
        return (
          <RadioInput {...commonProps} field={field as RadioFieldConfig} />
        );

      case "chips":
        return (
          <ChipsInput {...commonProps} field={field as ChipsFieldConfig} />
        );

      case "date":
        return <DateInput {...commonProps} field={field as DateFieldConfig} />;

      // =========================================
      // Media Types
      // =========================================
      case "upload":
        return (
          <UploadInput {...commonProps} field={field as UploadFieldConfig} />
        );

      // =========================================
      // Relational Types
      // =========================================
      case "relationship":
      case "relation": // Legacy alias
        return (
          <RelationshipInput
            {...commonProps}
            field={field as RelationshipFieldConfig}
          />
        );

      // =========================================
      // Structured Types
      // =========================================
      case "repeater":
        return (
          <ArrayInput
            {...commonProps}
            name={fieldPath}
            field={field}
            // Pass FieldRenderer recursively for nested fields
            renderField={(subField, subBasePath, subControl, options) => (
              <FieldRenderer
                field={subField}
                basePath={subBasePath}
                disabled={options?.disabled}
                readOnly={options?.readOnly}
              />
            )}
          />
        );

      case "group":
        return (
          <GroupInput
            {...commonProps}
            field={field as GroupFieldConfig}
            basePath={basePath}
          />
        );

      case "component":
        // Handled by early return above (bypasses FieldWrapper).
        return null;

      // =========================================
      // Special Types
      // =========================================
      case "richText":
      case "richtext": // Legacy alias
        return (
          <ClientOnly>
            <Suspense fallback={<EditorSkeleton />}>
              <RichTextInput
                {...commonProps}
                field={field as RichTextFieldConfig}
              />
            </Suspense>
          </ClientOnly>
        );

      case "json":
        return (
          <JsonInput
            {...commonProps}
            name={fieldPath}
            field={field as JSONFieldConfig}
          />
        );

      // =========================================
      // Unknown Type
      // =========================================
      default:
        return (
          <div className="rounded-none  border border-primary/5 border-destructive/50 bg-destructive/10 p-4 text-center">
            <p className="text-sm text-destructive">
              Unknown field type: {(field as { type: string }).type}
            </p>
          </div>
        );
    }
  }
}
