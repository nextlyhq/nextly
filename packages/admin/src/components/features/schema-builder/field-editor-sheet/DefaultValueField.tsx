// Why: Default Value was on the legacy FieldEditor/GeneralPanel and was
// dropped in the new FieldEditorSheet. Restoring it here as a focused
// component keeps GeneralTab readable and the per-type renderer matrix
// in one place. Type matrix decided 2026-05-03 with Mobeen.
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@revnixhq/ui";
import { useId, useMemo, useState } from "react";

import type { BuilderField } from "../types";

const TEXT_INPUT_TYPES = new Set([
  "text",
  "textarea",
  "richText",
  "email",
  "code",
]);

const PICKER_TYPES = new Set(["select", "radio"]);

const SUPPORTED_TYPES = new Set([
  ...TEXT_INPUT_TYPES,
  ...PICKER_TYPES,
  "number",
  "date",
  "checkbox",
  "toggle",
  "boolean",
  "json",
  "chips",
]);

type Value = string | number | boolean | null;

type Props = {
  field: BuilderField;
  readOnly?: boolean;
  onChange: (value: Value) => void;
};

/**
 * Render the per-type Default Value editor. Returns null for types where
 * a default doesn't make sense (relationship, upload, password, container
 * types) or where the user hasn't set up the prerequisite (select/radio
 * with no options yet).
 */
export function DefaultValueField({
  field,
  readOnly = false,
  onChange,
}: Props) {
  const inputId = useId();

  if (!SUPPORTED_TYPES.has(field.type)) {
    return null;
  }

  // Why: dropdown with no options is meaningless; hide until user defines
  // options in the select/radio editor below.
  if (PICKER_TYPES.has(field.type) && (field.options ?? []).length === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={inputId}>Default value</Label>
      {renderEditor({
        field,
        value: field.defaultValue ?? null,
        inputId,
        readOnly,
        onChange,
      })}
      <p className="text-xs text-muted-foreground">
        Used when creating a new entry without an explicit value.
      </p>
      {PICKER_TYPES.has(field.type) && <StaleDefaultWarning field={field} />}
    </div>
  );
}

function renderEditor({
  field,
  value,
  inputId,
  readOnly,
  onChange,
}: {
  field: BuilderField;
  value: Value;
  inputId: string;
  readOnly: boolean;
  onChange: (value: Value) => void;
}) {
  if (TEXT_INPUT_TYPES.has(field.type)) {
    return (
      <Input
        id={inputId}
        value={value == null ? "" : String(value)}
        disabled={readOnly}
        onChange={e => onChange(e.target.value === "" ? null : e.target.value)}
      />
    );
  }

  if (field.type === "number") {
    return (
      <Input
        id={inputId}
        type="number"
        value={value == null ? "" : String(value)}
        disabled={readOnly}
        onChange={e =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
      />
    );
  }

  if (field.type === "date") {
    const dateOnly = (() => {
      if (typeof value !== "string") return "";
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
    })();
    return (
      <Input
        id={inputId}
        type="date"
        value={dateOnly}
        disabled={readOnly}
        onChange={e =>
          onChange(
            e.target.value === "" ? null : `${e.target.value}T00:00:00.000Z`
          )
        }
      />
    );
  }

  if (
    field.type === "checkbox" ||
    field.type === "toggle" ||
    field.type === "boolean"
  ) {
    return (
      <Switch
        id={inputId}
        checked={value === true}
        disabled={readOnly}
        onCheckedChange={v => onChange(v === true)}
      />
    );
  }

  if (PICKER_TYPES.has(field.type)) {
    // Why: Radix Select disallows empty-string values (reserved for "clear
    // selection"). Brand-new options in SelectOptionsEditor start with
    // value === "" until the user types a value. Filter them out so the
    // default picker doesn't crash when a fresh option exists.
    const opts = (field.options ?? []).filter(o => o.value !== "");
    return (
      <Select
        value={typeof value === "string" ? value : undefined}
        disabled={readOnly}
        onValueChange={v => onChange(v)}
      >
        <SelectTrigger id={inputId}>
          <SelectValue placeholder="None" />
        </SelectTrigger>
        <SelectContent>
          {opts.map(o => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === "json") {
    return (
      <JsonEditor
        inputId={inputId}
        value={value}
        readOnly={readOnly}
        onChange={onChange}
      />
    );
  }

  if (field.type === "chips") {
    // Why: store the user's raw input verbatim. Earlier versions normalized
    // on every keystroke (split/trim/dedupe/join), which ate trailing
    // commas and made the input feel stuck. Runtime code that consumes the
    // default is responsible for splitting + trimming + deduping on read.
    const display = value == null ? "" : String(value);
    return (
      <Input
        id={inputId}
        placeholder="value1, value2, value3"
        value={display}
        disabled={readOnly}
        onChange={e => onChange(e.target.value === "" ? null : e.target.value)}
      />
    );
  }

  return null;
}

function JsonEditor({
  inputId,
  value,
  readOnly,
  onChange,
}: {
  inputId: string;
  value: Value;
  readOnly: boolean;
  onChange: (value: Value) => void;
}) {
  const [raw, setRaw] = useState(typeof value === "string" ? value : "");
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Textarea
        id={inputId}
        rows={3}
        value={raw}
        disabled={readOnly}
        onChange={e => {
          const next = e.target.value;
          setRaw(next);
          if (next.trim() === "") {
            setError(null);
            onChange(null);
            return;
          }
          try {
            JSON.parse(next);
            setError(null);
            onChange(next);
          } catch (err) {
            setError((err as Error).message);
            // Persist the raw text so the user can keep editing; final
            // validation happens at save time.
            onChange(next);
          }
        }}
      />
      {error && (
        <p className="text-xs text-destructive">Invalid JSON: {error}</p>
      )}
    </>
  );
}

function StaleDefaultWarning({ field }: { field: BuilderField }) {
  const stale = useMemo(() => {
    const def = field.defaultValue;
    if (typeof def !== "string" || def === "") return false;
    return !(field.options ?? []).some(o => o.value === def);
  }, [field.defaultValue, field.options]);

  if (!stale) return null;

  return (
    <p className="text-xs text-amber-600">
      Default {`"${field.defaultValue}"`} no longer matches any option. It will
      be cleared on save.
    </p>
  );
}
