"use client";

/**
 * A submission's answers as its page reads them: each by the label it was
 * asked under, an option by its label, a date in words, an address or a
 * phone number as a link, a file as a file (name, size, download), and a
 * field its conditions hid as not asked.
 *
 * @module admin/components/submissions/SubmissionAnswers
 */

import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, FileText } from "lucide-react";
import type { JSX, ReactNode } from "react";

import type { AskedField, AskedSnapshot } from "../../../utils/asked-fields";
import { isConsentAnswer } from "../../../utils/consent";
import { formatExportValue, optionLabels } from "../../../utils/export-formats";

import { ConsentValue } from "./submission-fields";

/** A file in the Media library, as the page shows it. */
interface MediaItem {
  id: string;
  filename?: string;
  originalFilename?: string;
  mimeType?: string;
  size?: number;
  url?: string;
}

const muted = (text: string) => (
  <span className="text-muted-foreground">{text}</span>
);

/** A file's size in the units a person reads. */
function fileSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A date answer in words, "Tue 24 Nov 2026"; the stored text otherwise. */
function dateInWords(value: string): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(day.getTime())) return value;
  return day.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** One media item, read from the library; nothing while it loads or fails. */
function useMediaItem(id: string) {
  return useQuery({
    queryKey: ["form-builder", "submission-file", id],
    queryFn: async (): Promise<MediaItem | null> => {
      const response = await fetch(
        `/admin/api/media/${encodeURIComponent(id)}`,
        { credentials: "include" }
      );
      if (!response.ok) return null;
      const body = (await response.json()) as MediaItem & { item?: MediaItem };
      return body.item ?? body;
    },
    staleTime: 60_000,
  });
}

/** What a file answer's card says, while it loads, once read, or if gone. */
function fileLines(
  item: MediaItem | null | undefined,
  isLoading: boolean,
  name: string
): { title: string; note: string } {
  if (isLoading) return { title: "Loading file…", note: "" };
  if (!item) {
    return {
      title: "File not found",
      note: "It may have been deleted from the Media library.",
    };
  }
  return {
    title: name,
    note: [fileSize(item.size), "in the Media library"]
      .filter(Boolean)
      .join(" · "),
  };
}

/** A file's type as its card's badge: its extension, at most four letters. */
function extensionOf(name: string): string {
  const extension = name.includes(".") ? name.split(".").pop() : undefined;
  return extension ? extension.slice(0, 4).toUpperCase() : "FILE";
}

/** A file answer: its name, type, size, and a download link. */
function FileAnswer({ id }: { id: string }): JSX.Element {
  const { data: item, isLoading } = useMediaItem(id);
  const name = item?.originalFilename || item?.filename || id;
  const lines = fileLines(item, isLoading, name);
  return (
    <div className="flex max-w-md items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground"
      >
        {item ? extensionOf(name) : <FileText className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {lines.title}
        </span>
        <span className="block text-xs text-muted-foreground">
          {lines.note}
        </span>
      </span>
      {item?.url ? (
        <a
          href={item.url}
          download={name}
          aria-label={`Download ${name}`}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

/**
 * Whether a file reference is an address rather than a Media library id. A
 * file answer may hold either; an address is web (`https://…`, `//…`) or the
 * site's own (`/…`), never another scheme, so it is safe to link to.
 */
function isFileAddress(reference: string): boolean {
  return /^(?:https?:)?\/\//i.test(reference) || reference.startsWith("/");
}

/** The file name an address ends in, or the address itself. */
function nameFromAddress(address: string): string {
  const last = address.split(/[?#]/)[0].split("/").filter(Boolean).pop();
  if (!last) return address;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** A file answer stored as an address: its name, and a link that opens it. */
function LinkedFile({ address }: { address: string }): JSX.Element {
  const name = nameFromAddress(address);
  return (
    <div className="flex max-w-md items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground"
      >
        {extensionOf(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {address}
        </span>
      </span>
      <a
        href={address}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${name}`}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
    </div>
  );
}

/** The ids a file answer holds: one, or several. */
function fileIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter(
    (each): each is string => typeof each === "string" && each !== ""
  );
}

// The underline is drawn in an ink token, not the border's: it is what marks
// the text as a link, so it must read on every surface the page lands on, and
// the border token falls far below that in dark.
const linkClass =
  "text-foreground underline decoration-muted-foreground underline-offset-4 hover:decoration-foreground";

/** An answer as text: the text itself, or read the way exports read it. */
function textOf(value: unknown): string {
  return typeof value === "string" ? value : formatExportValue(value);
}

/** A link answer, or the value plain when it is not text. */
function linkAnswer(
  href: (text: string) => string,
  shown?: (text: string) => ReactNode
) {
  return (value: unknown): JSX.Element => {
    if (typeof value !== "string") return muted(textOf(value));
    return (
      <a className={linkClass} href={href(value)}>
        {shown ? shown(value) : value}
      </a>
    );
  };
}

/** A web address: opened in a new tab, shown without its scheme. */
function urlAnswer(value: unknown): JSX.Element {
  if (typeof value !== "string") return muted(textOf(value));
  return (
    <a
      className={`${linkClass} inline-flex items-center gap-1`}
      href={value}
      target="_blank"
      rel="noopener noreferrer"
    >
      {value.replace(/^https?:\/\//, "")}
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

/** File answers: each a file with its name, size and download. */
function filesAnswer(value: unknown): JSX.Element {
  const ids = fileIds(value);
  if (ids.length === 0) return muted("—");
  return (
    <span className="flex flex-col gap-2">
      {ids.map(reference =>
        isFileAddress(reference) ? (
          <LinkedFile key={reference} address={reference} />
        ) : (
          <FileAnswer key={reference} id={reference} />
        )
      )}
    </span>
  );
}

/** How each kind of field's answer reads. A kind not here reads as text. */
const ANSWER_KINDS: Readonly<
  Record<string, (value: unknown, field: AskedField) => JSX.Element>
> = {
  email: linkAnswer(text => `mailto:${text}`),
  phone: linkAnswer(text => `tel:${text.replace(/\s+/g, "")}`),
  url: urlAnswer,
  date: value => (
    <span>
      {typeof value === "string" ? dateInWords(value) : textOf(value)}
    </span>
  ),
  select: (value, field) => <span>{optionLabels(field, value)}</span>,
  radio: (value, field) => <span>{optionLabels(field, value)}</span>,
  checkbox: value => (
    <span>{value === true || value === "true" ? "Yes" : "No"}</span>
  ),
  textarea: value => (
    <span className="whitespace-pre-wrap">{textOf(value)}</span>
  ),
  file: filesAnswer,
};

/** Whether an answer is empty: nothing, empty text, or an empty list. */
function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** One answer's value, by the kind of field it answers. */
export function AnswerValue({
  field,
  value,
}: {
  field: AskedField;
  value: unknown;
}): JSX.Element {
  if (field.type === "consent") {
    return <ConsentValue value={value} editing={false} />;
  }
  if (isBlank(value)) return muted("—");
  const kind = ANSWER_KINDS[field.type];
  if (kind) return kind(value, field);
  return <span className="wrap-break-word">{textOf(value) || "—"}</span>;
}

/** One row: the label as asked, and the answer or why there is none. */
function AnswerRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-6">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** Every answer, in the order the submission was asked them. */
export function SubmissionAnswers({
  asked,
  data,
}: {
  asked: AskedSnapshot;
  data: Record<string, unknown>;
}): JSX.Element {
  const hidden = new Set(asked.hidden);
  const shown = asked.fields.filter(field => field.type !== "hidden");
  const orphans = orphanedAnswers(asked, data);
  return (
    <dl className="px-4 sm:px-5">
      {shown.map(field => (
        <AnswerRow key={field.name} label={field.label}>
          {hidden.has(field.name) && data[field.name] === undefined ? (
            <span className="text-muted-foreground italic">
              Not asked: a condition hid it
            </span>
          ) : (
            <AnswerValue field={field} value={data[field.name]} />
          )}
        </AnswerRow>
      ))}
      {orphans.map(field => (
        <AnswerRow
          key={field.name}
          label={
            <>
              <span className="font-mono">{field.name}</span>
              <span className="block text-xs">No longer on the form</span>
            </>
          }
        >
          <AnswerValue field={field} value={data[field.name]} />
        </AnswerRow>
      ))}
    </dl>
  );
}

/**
 * The answers stored under a name the snapshot does not describe. A
 * submission sent before snapshots existed is described by the form as it is
 * now, so an answer to a field since removed or renamed has no descriptor:
 * it is still what the visitor sent, so it shows under its stored name rather
 * than vanishing. A field the snapshot names, hidden ones among them, never
 * lands here.
 */
function orphanedAnswers(
  asked: AskedSnapshot,
  data: Record<string, unknown>
): AskedField[] {
  const described = new Set(asked.fields.map(field => field.name));
  return Object.keys(data)
    .filter(name => !described.has(name))
    .map(name => ({
      name,
      label: name,
      type: isConsentAnswer(data[name]) ? "consent" : "text",
    }));
}
