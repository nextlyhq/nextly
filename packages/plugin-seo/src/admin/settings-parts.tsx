/**
 * The pieces every Settings tab is drawn with, all from the admin's own
 * parts: the card a tab's rows sit in, a row with one text control, and the
 * short line under a control. A tab is a card of rows, each its label and
 * one plain sentence on the left and its control on the right, as the
 * admin's own settings pages are.
 *
 * @module admin/settings-parts
 */
import { Card, FieldShell, Input, Textarea } from "@nextlyhq/plugin-sdk/admin";
import type { JSX, ReactNode } from "react";

/**
 * A tab's rows, in one card. The rows' rhythm is the admin's own
 * (`nx-form-section-rows`, the rule its settings sections space rows by), so
 * these rows sit exactly as a core settings page's do.
 */
export function SettingsCard({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <Card className="overflow-hidden">
      <div className="nx-form-section-rows divide-y divide-foreground/10 px-6">
        {children}
      </div>
    </Card>
  );
}

/** A line under a control: help, a count, or where a value is set. */
export function ControlNote({
  id,
  tone = "muted",
  children,
}: {
  id?: string;
  tone?: "muted" | "warning" | "danger";
  children: ReactNode;
}): JSX.Element {
  const colour =
    tone === "danger"
      ? "font-medium text-danger-text"
      : tone === "warning"
        ? "font-medium text-warning-text"
        : "text-muted-foreground";
  return (
    <p id={id} className={`mt-1.5 text-xs leading-normal ${colour}`}>
      {children}
    </p>
  );
}

/** One row with a text control: its label and sentence, and a note under it. */
export function TextRow({
  label,
  description,
  value,
  onChange,
  note,
  noteTone,
  placeholder,
  multiline = false,
  readOnly = false,
  mono = false,
  error,
}: {
  label: string;
  description: ReactNode;
  value: string;
  onChange?: (value: string) => void;
  /** The line under the control, if any. */
  note?: ReactNode;
  noteTone?: "muted" | "warning";
  placeholder?: string;
  multiline?: boolean;
  readOnly?: boolean;
  /** An address or a pattern, set in the admin's code face. */
  mono?: boolean;
  error?: string | null;
}): JSX.Element {
  return (
    <FieldShell
      layout="row"
      label={label}
      description={description}
      error={error ?? undefined}
    >
      {field => {
        const noteId = `${field.id}-note`;
        const describedBy =
          [field.describedBy, note === undefined ? undefined : noteId]
            .filter(Boolean)
            .join(" ") || undefined;
        const shared = {
          id: field.id,
          value,
          placeholder,
          readOnly,
          "aria-describedby": describedBy,
          "aria-invalid": field.invalid,
          className: [
            mono ? "font-mono text-[13px]" : "",
            readOnly ? "bg-muted" : "",
          ]
            .filter(Boolean)
            .join(" "),
        };
        return (
          <div>
            {multiline ? (
              <Textarea
                {...shared}
                rows={3}
                onChange={event => onChange?.(event.target.value)}
              />
            ) : (
              <Input
                {...shared}
                onChange={event => onChange?.(event.target.value)}
              />
            )}
            {note === undefined ? null : (
              <ControlNote id={noteId} tone={noteTone}>
                {note}
              </ControlNote>
            )}
          </div>
        );
      }}
    </FieldShell>
  );
}
