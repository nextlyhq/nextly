"use client";

/**
 * Submission Sheet
 *
 * Drawer detail for one submission: the submitted values in field order,
 * metadata, status + internal notes, and — behind the update permission —
 * inline editing of the submitted data. Prev/next walks the current table
 * page without losing filter context.
 *
 * @module admin/components/submissions/SubmissionSheet
 */

import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
} from "@nextlyhq/ui";
import { ChevronLeft, ChevronRight, Pencil, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import type { FormField } from "../../../types";
import { formatExportValue } from "../../../utils/export-formats";

import type { FormOption, SubmissionRow } from "./SubmissionsView";

interface SubmissionSheetProps {
  submission: SubmissionRow;
  form: FormOption;
  canUpdate: boolean;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** One editable input per field type; unsupported types render read-only. */
function FieldValueInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `submission-field-${field.name}`;
  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={e => onChange(e.target.value)}
          rows={3}
        />
      );
    case "checkbox":
      return (
        <Switch
          id={id}
          checked={Boolean(value)}
          onCheckedChange={checked => onChange(checked)}
        />
      );
    case "select":
    case "radio": {
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
            <SelectValue />
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
    case "text":
    case "email":
    case "url":
    case "phone":
      return (
        <Input
          id={id}
          type={field.type === "email" ? "email" : "text"}
          value={typeof value === "string" ? value : ""}
          onChange={e => onChange(e.target.value)}
        />
      );
    case "file":
    case "hidden":
    default:
      // Files are media references, hidden fields are machine values, and
      // unknown types may hold structured data — coercing any of them
      // through a text input would corrupt them, so they stay read-only.
      return (
        <p className="text-sm text-muted-foreground">
          {formatExportValue(value, field) || "—"}
        </p>
      );
  }
}

export function SubmissionSheet({
  submission,
  form,
  canUpdate,
  onClose,
  onPrev,
  onNext,
  onSave,
}: SubmissionSheetProps) {
  const [editing, setEditing] = useState(false);
  const [draftData, setDraftData] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState(submission.status);
  const [notes, setNotes] = useState(submission.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Prev/next swaps the submission while the sheet stays open — every piece
  // of local state must follow the record it belongs to.
  useEffect(() => {
    setEditing(false);
    setDraftData(submission.data ?? {});
    setStatus(submission.status);
    setNotes(submission.notes ?? "");
    setSaveError(null);
  }, [submission]);

  const fieldNames = new Set(form.fields.map(field => field.name));
  // Forms evolve after submissions exist: keys no longer on the form are
  // shown honestly instead of silently dropped.
  const orphanedEntries = Object.entries(submission.data ?? {}).filter(
    ([key]) => !fieldNames.has(key)
  );

  // Only a real value difference counts as a data edit — entering edit mode
  // and saving untouched values must not write `data` or earn an edit stamp.
  const dataChanged =
    editing &&
    form.fields.some(field => {
      const before = (submission.data ?? {})[field.name];
      const after = draftData[field.name];
      return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
    });

  const dirty =
    dataChanged ||
    status !== submission.status ||
    notes !== (submission.notes ?? "");

  const handleSave = async () => {
    if (!canUpdate) return;
    setSaving(true);
    setSaveError(null);
    try {
      const changes: Record<string, unknown> = {};
      if (status !== submission.status) {
        changes.status = status;
        // Recovering from spam clears the stale detection reason.
        if (submission.status === "spam" && status !== "spam") {
          changes.spamReason = null;
        }
      }
      if (notes !== (submission.notes ?? "")) changes.notes = notes;
      if (dataChanged) changes.data = draftData;
      if (Object.keys(changes).length > 0) await onSave(changes);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-[560px] sm:max-w-[560px] p-0 flex flex-col"
      >
        <SheetHeader className="p-4 border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="min-w-0 truncate">
              Submission — {form.name}
            </SheetTitle>
            <div className="flex shrink-0 items-center gap-1 mr-6">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-none"
                disabled={!onPrev}
                onClick={onPrev}
                aria-label="Previous submission"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-none"
                disabled={!onNext}
                onClick={onNext}
                aria-label="Next submission"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
          <SheetDescription>
            Submitted {formatDate(submission.submittedAt)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Spam banner */}
          {submission.status === "spam" && (
            <div className="flex items-center gap-2 border border-destructive bg-destructive/5 p-3 text-sm text-destructive">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              Flagged as spam
              {submission.spamReason ? ` (${submission.spamReason})` : ""}. Set
              the status to New to recover it.
            </div>
          )}

          {/* Submitted values */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">
                Submitted values
              </p>
              {canUpdate && !editing && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit
                </Button>
              )}
            </div>

            <div className="space-y-3 border border-border p-3">
              {form.fields.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  The form&apos;s fields are unavailable.
                </p>
              )}
              {form.fields.map(field => (
                <div key={field.name} className="space-y-1">
                  <Label htmlFor={`submission-field-${field.name}`}>
                    {field.label || field.name}
                  </Label>
                  {editing ? (
                    <FieldValueInput
                      field={field}
                      value={draftData[field.name]}
                      onChange={value =>
                        setDraftData(prev => ({
                          ...prev,
                          [field.name]: value,
                        }))
                      }
                    />
                  ) : (
                    <p className="text-sm text-foreground wrap-break-word">
                      {formatExportValue(
                        (submission.data ?? {})[field.name],
                        field
                      ) || <span className="text-muted-foreground">—</span>}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {orphanedEntries.length > 0 && (
              <div className="space-y-2 border border-border bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  No longer on the form
                </p>
                {orphanedEntries.map(([key, value]) => (
                  <p key={key} className="text-sm text-muted-foreground">
                    <span className="font-mono">{key}</span>:{" "}
                    {formatExportValue(value)}
                  </p>
                ))}
              </div>
            )}

            {submission.editedAt && (
              <p className="text-xs text-muted-foreground">
                Edited {formatDate(submission.editedAt)}
                {submission.editedBy ? ` by ${submission.editedBy}` : ""} — the
                values above are not necessarily what the visitor sent.
              </p>
            )}
          </div>

          {/* Status + notes */}
          <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="submission-status">Status</Label>
              {/* Status/notes writes go through the same update permission
                  as data edits — without it, everything here is read-only. */}
              <Select
                value={status}
                onValueChange={setStatus}
                disabled={!canUpdate}
              >
                <SelectTrigger
                  id="submission-status"
                  className="w-full bg-transparent border-input dark:bg-muted/50"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="read">Read</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                  <SelectItem value="spam">Spam</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="submission-notes">Internal notes</Label>
              <Textarea
                id="submission-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Visible to admins only"
                disabled={!canUpdate}
              />
            </div>
          </div>

          {/* Metadata */}
          <div className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
            <p>
              IP: {submission.ipAddress || "—"}
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              ID: <span className="font-mono">{submission.id}</span>
            </p>
            {submission.userAgent && (
              <p className="break-all">Agent: {submission.userAgent}</p>
            )}
            {submission.spamReason && submission.status !== "spam" && (
              <p>
                Previously flagged:{" "}
                <Badge
                  variant="outline"
                  className="rounded-none border-border px-1 py-0 text-[10px]"
                >
                  {submission.spamReason}
                </Badge>
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted p-4">
          {saveError ? (
            <p className="text-xs text-destructive">{saveError}</p>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canUpdate || !dirty || saving}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default SubmissionSheet;
