/**
 * Form Preview (STUB)
 *
 * Renders a preview of how the form will appear to end users.
 * Shows the form layout with actual input fields (non-functional).
 *
 * @module admin/components/builder/FormPreview
 * @since 0.1.0
 *
 */

"use client";

import { Input, Button } from "@revnixhq/ui";
import type React from "react";

import type { FormField } from "../../../types";

// ============================================================================
// Types
// ============================================================================

export interface FormPreviewProps {
  /** Array of form fields to preview */
  fields: FormField[];
  /** Form metadata */
  formData?: {
    name?: string;
    slug?: string;
    description?: string;
    status?: string;
  };
}

// ============================================================================
// Component
// ============================================================================

/**
 * FormPreview - Visual form preview
 *
 * This is a stub component that shows a preview of the form.
 * The full implementation will include:
 * - Rendered form fields with proper styling
 * - Responsive preview modes (desktop, tablet, mobile)
 * - Theme preview options
 * - Conditional logic simulation
 *
 * @example
 * ```tsx
 * <FormPreview fields={fields} formData={formData} />
 * ```
 */
export function FormPreview({ fields, formData }: FormPreviewProps) {
  if (fields.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-muted/20 rounded-md border-2 border-dashed border-border text-center">
        <div className="text-4xl mb-3">📝</div>
        <p className="text-sm font-medium text-muted-foreground">
          Add some fields to preview your form
        </p>
      </div>
    );
  }

  return (
    <div className="bg-background max-w-2xl mt-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground">
          {formData?.name || "Untitled Form"}
        </h2>
        {formData?.description && (
          <p className="text-sm text-muted-foreground mt-2">
            {formData.description}
          </p>
        )}
      </div>

      <div className="space-y-6">
        {fields.map(field => (
          <div key={field.name} className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">
              {field.label}
              {field.required && (
                <span className="text-destructive ml-1">*</span>
              )}
            </label>

            {renderFieldPreview(field)}

            {field.helpText && (
              <p className="text-xs text-muted-foreground mt-1">
                {field.helpText}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 pt-6 border-t border-border flex items-center gap-4">
        <Button type="button" disabled>
          Submit
        </Button>
        <p className="text-xs text-muted-foreground">
          This is a preview. Submissions are disabled.
        </p>
      </div>
    </div>
  );
}

/**
 * Render a preview of a field based on its type
 */
function renderFieldPreview(field: FormField): React.ReactNode {
  switch (field.type) {
    case "text":
    case "email":
    case "phone":
    case "url":
      return (
        <Input
          type={field.type === "email" ? "email" : "text"}
          placeholder={
            field.placeholder || `Enter ${field.label.toLowerCase()}`
          }
          disabled
        />
      );

    case "number":
      return (
        <Input
          type="number"
          placeholder={field.placeholder || "Enter a number"}
          disabled
        />
      );

    case "textarea":
      return (
        <textarea
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={
            field.placeholder || `Enter ${field.label.toLowerCase()}`
          }
          rows={field.rows || 4}
          disabled
        />
      );

    case "select":
      return (
        <select
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-none focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          disabled
        >
          <option value="">Select an option</option>
          {field.options?.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case "checkbox":
      return (
        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
            disabled
          />
          <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {field.label}
          </span>
        </div>
      );

    case "radio":
      return (
        <div className="flex flex-col space-y-2">
          {field.options?.map(opt => (
            <div key={opt.value} className="flex items-center space-x-2">
              <input
                type="radio"
                name={field.name}
                className="h-4 w-4 rounded-full border border-input text-primary focus:ring-primary"
                disabled
              />
              <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                {opt.label}
              </span>
            </div>
          ))}
        </div>
      );

    case "file":
      return (
        <div className="flex items-center">
          <Input type="file" disabled />
        </div>
      );

    case "date":
      return <Input type="date" disabled />;

    case "time":
      return <Input type="time" disabled />;

    case "hidden":
      return (
        <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground bg-muted/20 border-2 border-dashed border-border rounded-md">
          <span className="text-lg">👁️</span>
          <span>Hidden field</span>
        </div>
      );

    default:
      return <Input type="text" placeholder="Unknown field type" disabled />;
  }
}

export default FormPreview;
