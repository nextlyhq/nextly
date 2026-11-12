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
  Switch,
  Textarea,
} from "@nextlyhq/ui";
import { Eye, Monitor, Paperclip, RotateCcw, Smartphone } from "lucide-react";
import { type JSX, useMemo, useState } from "react";

import type { AnyFormField, CustomFormField, FormField } from "../../../types";
import { isKnownFormField } from "../../../types";
import { useFormBuilder } from "../../context/FormBuilderContext";

import { hasStoredRedirectPage } from "./FormSettingsTab";
import {
  previewFields,
  previewIssues,
  type HiddenBecause,
} from "./preview-checks";

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
    case "consent":
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

/**
 * What the visitor is told after a successful submission.
 *
 * Its own component because the fall-through belongs to the MESSAGE branch: a
 * confirmation this does not name is previewed as a thank-you note, which is
 * how the page redirect came to be previewed as something it is not. Each
 * confirmation that is not a message has to be named here.
 */
function Confirmation({
  settings,
}: {
  settings: {
    confirmationType?: string;
    redirectUrl?: string;
    successMessage?: string;
    redirectPage?: unknown;
  };
}) {
  const panel = "border border-border bg-muted/40 p-4 text-sm text-foreground";

  if (settings.confirmationType === "redirect") {
    return (
      <p className={panel}>
        The visitor would now be redirected to{" "}
        <span className="font-mono">
          {settings.redirectUrl || "(no redirect URL set)"}
        </span>
        .
      </p>
    );
  }

  if (settings.confirmationType === "relationship") {
    // Whether a page is actually named, not merely that this confirmation is
    // chosen. Claiming a redirect with no page saved describes something that
    // cannot happen: the save is refused, and a form that reached this state
    // another way resolves to no redirect at all.
    const named = hasStoredRedirectPage(settings);
    return (
      <p className={panel}>
        {named
          ? "The visitor would now be redirected to the linked page. Its URL is built when the form is submitted, from the pattern the site configured for that collection."
          : "No page is selected yet, so this form has no destination. Choose one under Settings, or pick a different confirmation."}
      </p>
    );
  }

  return (
    <p className={panel}>
      {settings.successMessage || "Thank you for your submission!"}
    </p>
  );
}

/** The widths the preview draws the form at. */
const DEVICES = [
  { value: "desktop", label: "Desktop", icon: Monitor },
  { value: "phone", label: "Phone", icon: Smartphone },
] as const;

type Device = (typeof DEVICES)[number]["value"];

/** Desktop or Phone, as a pair of pressed buttons rather than tabs. */
function DeviceSwitch({
  device,
  onChange,
}: {
  device: Device;
  onChange: (device: Device) => void;
}): JSX.Element {
  return (
    <div
      role="group"
      aria-label="Preview width"
      className="inline-flex rounded-md border border-border bg-card p-0.5"
    >
      {DEVICES.map(each => (
        <button
          key={each.value}
          type="button"
          aria-pressed={device === each.value}
          onClick={() => onChange(each.value)}
          className="inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground"
        >
          <each.icon className="h-3.5 w-3.5" aria-hidden="true" />
          {each.label}
        </button>
      ))}
    </div>
  );
}

/** Why a shown-anyway field is not on the visitor's page. */
const HIDDEN_NOTE: Record<HiddenBecause, string> = {
  "hidden-field": "Hidden field: sent with every submission, never shown.",
  condition: "Hidden by a condition: shown once its condition is met.",
};

/** One field on the preview's page, with what the checks said about it. */
function PreviewFieldRow({
  field,
  hidden,
  value,
  issue,
  onChange,
}: {
  field: AnyFormField;
  hidden: HiddenBecause | undefined;
  value: unknown;
  issue: string | undefined;
  onChange: (value: unknown) => void;
}): JSX.Element {
  if (!isKnownFormField(field)) return <PluginFieldPreview field={field} />;
  const label = (
    <Label htmlFor={`preview-${field.name}`}>
      {field.label || field.name}
      {field.required && <span className="ml-1 text-destructive">*</span>}
    </Label>
  );
  return (
    <div
      className={`space-y-1.5 ${hidden === undefined ? "" : "rounded-md border border-dashed border-border p-3 opacity-70"}`}
    >
      {field.type === "consent" ? (
        // The box is labelled by what the visitor agrees to, as a site shows
        // it; the field's own label names the question above it.
        <>
          <p className="text-sm font-medium text-foreground">
            {field.label || field.name}
          </p>
          <div className="flex items-start gap-2">
            <PreviewFieldInput
              field={field}
              value={value}
              onChange={onChange}
            />
            <Label
              htmlFor={`preview-${field.name}`}
              className="block font-normal leading-snug"
            >
              {field.agreementText}
              <span className="ml-1 text-destructive">*</span>
            </Label>
          </div>
        </>
      ) : field.type === "checkbox" ? (
        <div className="flex items-center gap-2">
          <PreviewFieldInput field={field} value={value} onChange={onChange} />
          {label}
        </div>
      ) : (
        <>
          {label}
          <PreviewFieldInput field={field} value={value} onChange={onChange} />
        </>
      )}
      {field.helpText && (
        <p className="text-xs text-muted-foreground">{field.helpText}</p>
      )}
      {issue === undefined ? null : (
        <p className="text-xs text-destructive">{issue}</p>
      )}
      {hidden === undefined ? null : (
        <p className="text-xs text-muted-foreground">{HIDDEN_NOTE[hidden]}</p>
      )}
    </div>
  );
}

export function FormPreview({
  fields,
  formData,
}: FormPreviewProps): JSX.Element {
  const { settings } = useFormBuilder();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [device, setDevice] = useState<Device>("desktop");
  const [showHidden, setShowHidden] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [issues, setIssues] = useState<ReadonlyMap<string, string>>(
    () => new Map()
  );

  // The fields as the visitor meets them, with their conditions run against
  // what has been typed (the same evaluator the site runs).
  const all = useMemo(() => previewFields(fields, values), [fields, values]);
  const onPage = all.filter(each => each.hidden === undefined);
  const drawn = showHidden ? all : onPage;

  const reset = () => {
    setValues({});
    setConfirmed(false);
    setIssues(new Map());
  };

  // The site's own checks over the fields on the page: what it would refuse,
  // the preview refuses, field by field. Nothing is sent anywhere.
  const simulateSubmit = () => {
    const refused = previewIssues(
      onPage.map(each => each.field),
      values
    );
    setIssues(refused);
    if (refused.size === 0) setConfirmed(true);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <DeviceSwitch device={device} onChange={setDevice} />
        <label className="inline-flex items-center gap-2 text-sm text-foreground">
          <Switch
            checked={showHidden}
            onCheckedChange={setShowHidden}
            aria-label="Show hidden fields"
          />
          Show hidden fields
        </label>
        <span className="flex-1" />
        <Button type="button" variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset
        </Button>
      </div>

      {/* The form on a tinted stage, so the sheet inside reads as the
          visitor's page rather than as more of the admin. */}
      <div className="flex justify-center rounded-md border border-border bg-muted/30 p-4 sm:p-6">
        <div
          data-preview-device={device}
          className={`w-full space-y-5 rounded-md border border-border bg-background p-6 ${
            device === "phone" ? "max-w-95" : "max-w-2xl"
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
              <Confirmation settings={settings} />
              <Button type="button" variant="outline" onClick={reset}>
                Fill again
              </Button>
            </div>
          ) : (
            <>
              {onPage.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No fields to show yet. Add them on Builder.
                </p>
              )}
              {drawn.map(({ field, hidden }) => (
                <PreviewFieldRow
                  key={field.name}
                  field={field}
                  hidden={hidden}
                  value={values[field.name]}
                  issue={issues.get(field.name)}
                  onChange={value =>
                    setValues(prev => ({ ...prev, [field.name]: value }))
                  }
                />
              ))}
              <Button
                type="button"
                onClick={simulateSubmit}
                disabled={onPage.length === 0}
              >
                {settings.submitButtonText || "Submit"}
              </Button>
            </>
          )}
        </div>
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {
          "Answers here run the form's conditions and checks, but are never saved and send no email."
        }
      </p>
    </div>
  );
}

export default FormPreview;
