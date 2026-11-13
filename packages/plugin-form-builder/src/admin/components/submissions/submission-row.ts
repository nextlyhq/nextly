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
  /** Who sent it, as the write seam named it (`utils/submission-title`). */
  title?: string | null;
  spamReason?: string | null;
  notes?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** The page it was sent from: origin and path. */
  page?: string | null;
  submittedAt?: string | null;
  createdAt?: string | null;
  editedAt?: string | null;
  editedBy?: string | null;
  /** What it was asked, as the write seam stored it. */
  asked?: unknown;
  /** Its version as read, sent back with a change. */
  _rev?: string;
}

/** A submission's review status, as stored. */
export type SubmissionStatus = "new" | "read" | "archived" | "spam";

/**
 * Each status as the admin shows it: its name, and the colour of the dot its
 * quiet chip carries (tokens only). New stands out, Spam warns, and Read and
 * Archived recede.
 */
export const STATUS_LOOK: Readonly<
  Record<SubmissionStatus, { label: string; dot: string }>
> = {
  new: { label: "New", dot: "bg-info-solid" },
  read: { label: "Read", dot: "bg-muted-foreground" },
  archived: { label: "Archived", dot: "bg-muted-foreground/50" },
  spam: { label: "Spam", dot: "bg-danger-solid" },
};

/** The form a submission belongs to, by id. */
export function formIdOf(row: Pick<SubmissionRow, "form">): string {
  return typeof row.form === "object" ? row.form.id : row.form;
}

/** A stored date and time, or none for none or an invalid one. */
function dateOf(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** A date and time as a person reads it; nothing for none or an invalid one. */
export function whenText(value: string | null | undefined): string {
  return (
    dateOf(value)?.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }) ?? ""
  );
}

/**
 * A date and time as a list's narrow column reads it: the year only when it
 * is not this one ("Nov 12, 6:27 PM").
 */
export function shortWhenText(
  value: string | null | undefined,
  now: Date = new Date()
): string {
  const date = dateOf(value);
  if (date === undefined) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}
