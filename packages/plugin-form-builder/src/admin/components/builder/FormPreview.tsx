"use client";

/**
 * Form Preview
 *
 * An interactive simulation of the form: real enabled inputs, conditional
 * logic evaluated live against what you type (the same evaluator the
 * runtime uses), the form's actual settings (button text, confirmation
 * behavior), and a device-width toggle. It is honest about what it is —
 * a faithful simulation inside the admin, not the published form; nothing
 * here submits anywhere.
 *
 * @module admin/components/builder/FormPreview
 */

import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@nextlyhq/ui";
import { Eye, Monitor, Paperclip, RotateCcw, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";

import type { AnyFormField, CustomFormField, FormField } from "../../../types";
import { isKnownFormField } from "../../../types";
import { evaluateConditions } from "../../../utils/evaluate-conditions";
import { useFormBuilder } from "../../context/FormBuilderContext";

// ---------------------------------------------------------------------------
// Field rendering
// ---------------------------------------------------------------------------

function PreviewFieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `preview-${field.name}`;
  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={e => onChange(e.target.value)}
          rows={"rows" in field ? (field.rows ?? 4) : 4}
          placeholder={field.placeholder}
        />
      );
    case "checkbox":
      // A real checkbox, not a toggle switch — the preview should look like
      // what a frontend form renders for this type.
      return (
        <Checkbox
          id={id}
          checked={Boolean(value)}
          onCheckedChange={checked => onChange(checked === true)}
        />
      );
    case "select": {
      const options = "options" in field ? (field.options ?? []) : [];
      return (
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={onChange}
        >
          <SelectTrigger
            id={id}
            className="w-full bg-transparent border-input dark:bg-muted/50"
          >
            <SelectValue placeholder={field.placeholder ?? "Select…"} />
          </SelectTrigger>
          <SelectContent>
            {options.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case "radio": {
      const options = "options" in field ? (field.options ?? []) : [];
      return (
        <RadioGroup
          value={typeof value === "string" ? value : ""}
          onValueChange={onChange}
          className="flex flex-col gap-2"
        >
          {options.map(option => (
            <div key={option.value} className="flex items-center gap-2">
              <RadioGroupItem
                value={option.value}
                id={`${id}-${option.value}`}
              />
              <Label htmlFor={`${id}-${option.value}`} className="font-normal">
                {option.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      );
    }
    case "number":
      return (
        <Input
          id={id}
          type="number"
          value={
            typeof value === "number" || typeof value === "string"
              ? String(value)
              : ""
          }
          onChange={e =>
            onChange(e.target.value === "" ? "" : Number(e.target.value))
          }
          placeholder={field.placeholder}
        />
      );
    case "date":
    case "time":
      return (
        <Input
          id={id}
          type={field.type}
          value={typeof value === "string" ? value : ""}
          onChange={e => onChange(e.target.value)}
        />
      );
    case "file":
      // Nothing uploads from a preview; the affordance is shown, disabled.
      return (
        <div className="flex items-center gap-2 border border-dashed border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          File upload (disabled in preview)
        </div>
      );
    default:
      return (
        <Input
          id={id}
          type={
            field.type === "email"
              ? "email"
              : field.type === "url"
                ? "url"
                : field.type === "phone"
                  ? "tel"
                  : "text"
          }
          value={typeof value === "string" ? value : ""}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      );
  }
}

/**
 * Preview for a plugin-contributed field. The plugin owns the real input, which
 * renders from its own component in the live form; the builder preview shows a
 * labeled placeholder so the field's presence and order stay visible.
 */
function PluginFieldPreview({ field }: { field: CustomFormField }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`preview-${field.name}`}>
        {field.label || field.name}
        {field.required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <div className="flex items-center gap-2 border border-dashed border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        Custom field ({field.type}) — renders from its plugin component in the
        live form.
      </div>
      {field.helpText && (
        <p className="text-xs text-muted-foreground">{field.helpText}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface FormPreviewProps {
  /** Array of form fields to preview (built-in or plugin-contributed). */
  fields: AnyFormField[];
  /** Form metadata */
  formData?: {
    name?: string;
    slug?: string;
    description?: string;
  };
}

export function FormPreview({ fields, formData }: FormPreviewProps) {
  const { settings } = useFormBuilder();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [confirmed, setConfirmed] = useState(false);
  const [missingRequired, setMissingRequired] = useState<Set<string>>(
    new Set()
  );

  // Conditional logic runs against the live values with the SAME evaluator
  // the runtime uses — typing into the preview shows/hides fields for real.
  // Visibility is computed in field order against the values of fields that
  // are themselves visible: a hidden field's leftover value must not keep
  // satisfying a downstream condition (chained show/hide would misbehave).
  const visibleFields = useMemo(() => {
    const effectiveValues: Record<string, unknown> = {};
    const visible: AnyFormField[] = [];
    for (const field of fields) {
      if (field.type === "hidden") continue;
      const isVisible =
        !field.conditionalLogic?.enabled ||
        evaluateConditions(field.conditionalLogic, effectiveValues);
      if (isVisible) {
        visible.push(field);
        if (field.name in values) {
          effectiveValues[field.name] = values[field.name];
        }
      }
    }
    return visible;
  }, [fields, values]);

  const hiddenCount = fields.filter(field => field.type === "hidden").length;

  const reset = () => {
    setValues({});
    setConfirmed(false);
    setMissingRequired(new Set());
  };

  // The real form would refuse an empty required field, so the simulation
  // does too — an admin previewing required fields sees the requirement.
  const simulateSubmit = () => {
    const missing = new Set(
      visibleFields
        .filter(field => {
          // A plugin field renders a non-interactive placeholder in the preview
          // (its real input lives in the plugin's component in the live form),
          // so it can never be filled here — excluded like `file`, otherwise the
          // simulated submit would block forever with no way to satisfy it.
          if (!field.required || field.type === "file") return false;
          if (!isKnownFormField(field)) return false;
          const value = values[field.name];
          return value === undefined || value === "" || value === false;
        })
        .map(field => field.name)
    );
    setMissingRequired(missing);
    if (missing.size === 0) setConfirmed(true);
  };

  return (
    <div className="space-y-4">
      {/* Preview chrome: honest framing + device toggle + reset */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Eye className="h-4 w-4" aria-hidden="true" />
          Preview — a simulation of this form. Nothing here submits anywhere.
        </div>
        <div className="flex items-center gap-2">
          <Tabs
            value={device}
            onValueChange={value => setDevice(value as "desktop" | "mobile")}
          >
            <TabsList className="rounded-none">
              <TabsTrigger value="desktop" className="rounded-none gap-1.5">
                <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
                Desktop
              </TabsTrigger>
              <TabsTrigger value="mobile" className="rounded-none gap-1.5">
                <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
                Mobile
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button type="button" variant="outline" size="sm" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </Button>
        </div>
      </div>

      {/* The simulated form */}
      <div className="flex justify-center border border-border bg-muted/30 p-6">
        <div
          className={`w-full space-y-5 border border-border bg-background p-6 ${
            device === "mobile" ? "max-w-95" : "max-w-2xl"
          }`}
        >
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {formData?.name || "Untitled form"}
            </h3>
            {formData?.description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {formData.description}
              </p>
            )}
          </div>

          {confirmed ? (
            <div className="space-y-4">
              {settings.confirmationType === "redirect" ? (
                <p className="border border-border bg-muted/40 p-4 text-sm text-foreground">
                  The visitor would now be redirected to{" "}
                  <span className="font-mono">
                    {settings.redirectUrl || "(no redirect URL set)"}
                  </span>
                  .
                </p>
              ) : (
                <p className="border border-border bg-muted/40 p-4 text-sm text-foreground">
                  {settings.successMessage || "Thank you for your submission!"}
                </p>
              )}
              <Button type="button" variant="outline" onClick={reset}>
                Fill again
              </Button>
            </div>
          ) : (
            <>
              {visibleFields.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No visible fields — add fields in the Builder tab.
                </p>
              )}
              {visibleFields.map(field =>
                !isKnownFormField(field) ? (
                  <PluginFieldPreview key={field.name} field={field} />
                ) : (
                  <div key={field.name} className="space-y-1.5">
                    {field.type !== "checkbox" && (
                      <Label htmlFor={`preview-${field.name}`}>
                        {field.label || field.name}
                        {field.required && (
                          <span className="ml-1 text-destructive">*</span>
                        )}
                      </Label>
                    )}
                    {field.type === "checkbox" ? (
                      <div className="flex items-center gap-2">
                        <PreviewFieldInput
                          field={field}
                          value={values[field.name]}
                          onChange={value =>
                            setValues(prev => ({
                              ...prev,
                              [field.name]: value,
                            }))
                          }
                        />
                        <Label htmlFor={`preview-${field.name}`}>
                          {field.label || field.name}
                          {field.required && (
                            <span className="ml-1 text-destructive">*</span>
                          )}
                        </Label>
                      </div>
                    ) : (
                      <PreviewFieldInput
                        field={field}
                        value={values[field.name]}
                        onChange={value =>
                          setValues(prev => ({ ...prev, [field.name]: value }))
                        }
                      />
                    )}
                    {field.helpText && (
                      <p className="text-xs text-muted-foreground">
                        {field.helpText}
                      </p>
                    )}
                    {missingRequired.has(field.name) && (
                      <p className="text-xs text-destructive">
                        This field is required.
                      </p>
                    )}
                  </div>
                )
              )}

              <Button
                type="button"
                onClick={simulateSubmit}
                disabled={visibleFields.length === 0}
              >
                {settings.submitButtonText || "Submit"}
              </Button>
            </>
          )}

          {hiddenCount > 0 && !confirmed && (
            <p className="text-xs text-muted-foreground">
              <Badge
                variant="outline"
                className="mr-1.5 rounded-none border-border px-1 py-0 text-[10px]"
              >
                {hiddenCount}
              </Badge>
              hidden {hiddenCount === 1 ? "field" : "fields"} will be submitted
              invisibly.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default FormPreview;
