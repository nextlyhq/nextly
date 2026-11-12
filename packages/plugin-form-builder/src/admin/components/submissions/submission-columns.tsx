"use client";

/**
 * The submissions list's columns. One form's list has that form's labels as
 * its columns, each answer read as the submission was asked it (a choice by
 * its option's label); the list of every form, whose fields differ, has who
 * sent each, its form and a summary of its first answers. Both end with its
 * status, as a quiet chip with a dot, and when it was sent.
 *
 * @module admin/components/submissions/submission-columns
 */

import type { NextlyColumn } from "@nextlyhq/plugin-sdk/admin";
import type { JSX } from "react";

import type { FormField } from "../../../types";
import { answerReader } from "../../../utils/export-formats";

import {
  formIdOf,
  shortWhenText,
  STATUS_LOOK,
  type SubmissionRow,
  type SubmissionStatus,
  whenText,
} from "./submission-row";

/** A form as the list uses it: its id, name and fields. */
export interface FormOption {
  id: string;
  name: string;
  fields: FormField[];
}

/** A submission's status as a quiet chip with a dot. */
function StatusChip({ status }: { status: string }): JSX.Element {
  const look = STATUS_LOOK[status as SubmissionStatus] ?? {
    label: status,
    dot: "bg-muted-foreground",
  };
  return (
    <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-2 text-xs font-medium text-foreground">
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${look.dot}`}
      />
      {look.label}
    </span>
  );
}

/**
 * The row's lead text, bold, with a dot after it while the submission is
 * New, so unread rows stand out as they do in an inbox. The dot is drawn
 * only: the Status column says New in words.
 */
function Lead({
  text,
  unread,
}: {
  text: string;
  unread: boolean;
}): JSX.Element {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 font-medium text-foreground">
      <span className="truncate">{text || "—"}</span>
      {unread && (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-info-solid"
        />
      )}
    </span>
  );
}

/** How many files a file answer holds, as a list cell reads it. */
function filesText(value: unknown): string {
  const count = Array.isArray(value) ? value.length : value ? 1 : 0;
  if (count === 0) return "";
  return count === 1 ? "1 file" : `${count} files`;
}

/**
 * Reads each row's answers as it was asked, once per row however many of its
 * cells read them.
 */
function rowAnswers(fields: readonly FormField[]) {
  const readers = new WeakMap<SubmissionRow, (field: FormField) => string>();
  return (row: SubmissionRow, field: FormField): string => {
    let read = readers.get(row);
    if (read === undefined) {
      read = answerReader(row, fields);
      readers.set(row, read);
    }
    return field.type === "file"
      ? filesText(row.data?.[field.name])
      : read(field);
  };
}

/** The status and sent columns every list ends with. */
const TRAILING_COLUMNS: NextlyColumn<SubmissionRow>[] = [
  {
    name: "status",
    header: "Status",
    accessor: row => row.status,
    cell: ({ row }) => <StatusChip status={row.status} />,
  },
  {
    name: "submittedAt",
    header: "Submitted",
    accessor: row => shortWhenText(row.submittedAt),
    // The full date and time on hover; the column keeps to the short one.
    cell: ({ row }) => (
      <span
        className="whitespace-nowrap text-muted-foreground"
        title={whenText(row.submittedAt)}
      >
        {shortWhenText(row.submittedAt)}
      </span>
    ),
  },
];

/**
 * One form's columns: its fields by label, those in `hidden` left out, the
 * first drawn as the row's lead.
 */
export function formColumns(
  form: FormOption,
  hidden: ReadonlySet<string>
): NextlyColumn<SubmissionRow>[] {
  const answer = rowAnswers(form.fields);
  const shown = form.fields.filter(field => !hidden.has(field.name));
  const fieldColumns = shown.map<NextlyColumn<SubmissionRow>>(
    (field, index) => ({
      name: `data.${field.name}`,
      header: field.label || field.name,
      accessor: row => answer(row, field),
      // Past the lead, answers are wide; the card on a phone keeps to the
      // lead, the status and when.
      hideOnMobile: index > 0,
      ...(index === 0
        ? {
            cell: ({ row }) => (
              <Lead text={answer(row, field)} unread={row.status === "new"} />
            ),
          }
        : {}),
    })
  );
  return [...fieldColumns, ...TRAILING_COLUMNS];
}

/** The first email address a submission answered, by its form's fields. */
function emailOf(row: SubmissionRow, form: FormOption | undefined): string {
  const field = form?.fields.find(
    each => each.type === "email" && typeof row.data?.[each.name] === "string"
  );
  return field ? String(row.data[field.name]) : "";
}

/** The kinds of answer a one-line summary leaves out. */
const UNSUMMARISED: ReadonlySet<string> = new Set([
  "file",
  "consent",
  "hidden",
]);

/**
 * A submission's first few answers, in its form's order, as one line: what
 * it is about at a glance. Who sent it is in the From column, so the answers
 * shown there are left out here.
 */
function summaryOf(row: SubmissionRow, form: FormOption | undefined): string {
  if (!form) return "";
  const answer = answerReader(row, form.fields);
  const shown = new Set([row.title ?? "", emailOf(row, form)]);
  return form.fields
    .filter(field => !UNSUMMARISED.has(field.type))
    .map(answer)
    .filter(text => text !== "" && !shown.has(text))
    .slice(0, 3)
    .join(" · ");
}

/** Who sent a submission, and their address, as the From column draws them. */
function From({
  row,
  form,
}: {
  row: SubmissionRow;
  form: FormOption | undefined;
}): JSX.Element {
  const email = emailOf(row, form);
  const sender = row.title || email;
  return (
    <span className="flex min-w-0 flex-col">
      <Lead text={sender} unread={row.status === "new"} />
      {email && email !== sender ? (
        <span className="truncate text-xs text-muted-foreground">{email}</span>
      ) : null}
    </span>
  );
}

/** The columns of every form's list. */
export function allFormsColumns(
  forms: ReadonlyMap<string, FormOption>
): NextlyColumn<SubmissionRow>[] {
  const formOf = (row: SubmissionRow) => forms.get(formIdOf(row));
  return [
    {
      name: "from",
      header: "From",
      accessor: row => row.title ?? "",
      cell: ({ row }) => <From row={row} form={formOf(row)} />,
    },
    {
      name: "form",
      header: "Form",
      accessor: row => formOf(row)?.name ?? formIdOf(row),
    },
    {
      name: "summary",
      header: "Summary",
      hideOnMobile: true,
      accessor: row => summaryOf(row, formOf(row)),
      cell: ({ value }) => (
        <span className="line-clamp-2 max-w-56 whitespace-normal text-muted-foreground">
          {typeof value === "string" ? value : ""}
        </span>
      ),
    },
    ...TRAILING_COLUMNS,
  ];
}
