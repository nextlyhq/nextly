/**
 * A submission as the entries API answers it, and the readings of it the
 * list and a submission's page share, so the two cannot read it differently.
 *
 * @module admin/components/submissions/submission-row
 */

export interface SubmissionRow {
  id: string;
  form: string | { id: string; name?: string };
  data: Record<string, unknown>;
  status: string;
  spamReason?: string | null;
  notes?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  submittedAt?: string | null;
  createdAt?: string | null;
  editedAt?: string | null;
  editedBy?: string | null;
  /** What it was asked, as the write seam stored it. */
  asked?: unknown;
  /** Its version as read, sent back with a change. */
  _rev?: string;
}

/** The form a submission belongs to, by id. */
export function formIdOf(row: Pick<SubmissionRow, "form">): string {
  return typeof row.form === "object" ? row.form.id : row.form;
}

/** A date and time as a person reads it; nothing for none or an invalid one. */
export function whenText(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
