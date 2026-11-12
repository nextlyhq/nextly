"use client";

/**
 * A submission's own page: an Editor page with its own address, the answers
 * as the visitor was asked them, its activity, and a side panel with its
 * status, internal note and details. The bar moves to the newer or older
 * submission of the list it was opened from, keeping that list's filter.
 * Opening a New submission marks it Read for a person who may update it; one
 * who may only read leaves it New.
 *
 * @module admin/SubmissionPage
 */

import {
  type DocumentLockGates,
  navigateTo,
  PageFrame,
  PageHeader,
  TopBarPlace,
  useReportUnsavedWork,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Textarea,
} from "@nextlyhq/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Ban,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Inbox,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import type { FormField } from "../types";
import { type AskedSnapshot, askedFieldsOf } from "../utils/asked-fields";
import { formatExportValue } from "../utils/export-formats";
import { senderOf } from "../utils/submission-title";

import { SUBMISSION_COUNT_KEY } from "./components/editor/useSubmissionCount";
import { browserLabel } from "./components/submissions/browser-label";
import {
  canEditAnswer,
  ConsentValue,
  FieldValueInput,
} from "./components/submissions/submission-fields";
import {
  LIST_SORT,
  listWithWhere,
  neighbourQueries,
  scopeFromSearch,
  type SubmissionListScope,
  submissionPageAddress,
} from "./components/submissions/submission-list-scope";
import {
  formIdOf,
  type SubmissionRow,
  whenText,
} from "./components/submissions/submission-row";
import {
  AnswerValue,
  SubmissionAnswers,
} from "./components/submissions/SubmissionAnswers";
import { readPermissions } from "./use-admin-permissions";
import { useBuilderConfig } from "./use-builder-config";
import {
  type SubmissionExtensionField,
  useSubmissionFields,
} from "./use-submission-fields";

/** A submission as the entries API answers it. */
export type SubmissionDocument = SubmissionRow;

interface FormDocument {
  id: string;
  name?: string;
  fields?: FormField[];
}

export interface SubmissionPageProps {
  entryId?: string;
  collectionSlug?: string;
  initialData?: Partial<SubmissionDocument>;
  /**
   * What a colleague's claim on this submission withholds, as the entry page
   * hands it over. While either is set the page offers no change and sends
   * none, the automatic Read among them.
   */
  documentLock?: DocumentLockGates;
  /**
   * Tells the entry page the submission was deleted: it stands its leave
   * guard down and returns to the list. Used when unsaved work is on the
   * page; otherwise the page moves to the next submission itself.
   */
  onDelete?: () => void;
}

const STATUSES = [
  { value: "new", label: "New", dot: "bg-primary" },
  { value: "read", label: "Read", dot: "bg-muted-foreground" },
  { value: "archived", label: "Archived", dot: "bg-muted-foreground/50" },
  { value: "spam", label: "Spam", dot: "bg-destructive" },
] as const;

/** The initials a sender shows as, at most two. */
function initialsOf(sender: string): string {
  if (sender === "Submission") return "S";
  const parts = sender
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join("") || "S"
  );
}

async function readJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

/** The submission as stored now. */
function useSubmission(
  slug: string,
  id: string,
  initial: Partial<SubmissionDocument> | undefined
) {
  return useQuery({
    queryKey: ["form-builder", "submission", slug, id],
    queryFn: async () => {
      const body = await readJson<
        SubmissionDocument & { item?: SubmissionDocument }
      >(
        `/admin/api/collections/${encodeURIComponent(slug)}/entries/${encodeURIComponent(id)}`
      );
      if (!body) throw new Error("This submission could not be read.");
      return body.item ?? body;
    },
    ...(initial?.id === id && initial.data
      ? { initialData: initial as SubmissionDocument }
      : {}),
  });
}

/** Where this submission sits in its list, and its neighbours. */
interface ListPlace {
  index: number;
  total: number;
  newer?: string;
  older?: string;
}

/**
 * This submission's place in the list it was opened from, by the list's own
 * filter and order: how many are newer, how many in all, and the one just
 * newer and just older.
 */
function useListPlace(
  slug: string,
  submission: SubmissionDocument | undefined,
  scope: SubmissionListScope
) {
  return useQuery({
    enabled: submission?.submittedAt != null,
    queryKey: ["form-builder", "submission-place", slug, submission?.id, scope],
    queryFn: async (): Promise<ListPlace> => {
      const around = neighbourQueries(
        scope,
        submission!.submittedAt!,
        submission!.id
      );
      const page = async (where: object, sort: string) =>
        readJson<{ items?: Array<{ id: string }>; meta?: { total?: number } }>(
          `/admin/api/collections/${encodeURIComponent(slug)}/entries?${new URLSearchParams(
            { limit: "1", sort, where: JSON.stringify(where) }
          )}`
        );
      const [all, newer, older] = await Promise.all([
        page(listWithWhere(scope, submission!.id), LIST_SORT),
        page(around.newer.where, around.newer.sort),
        page(around.older.where, around.older.sort),
      ]);
      return {
        index: newer?.meta?.total ?? 0,
        total: all?.meta?.total ?? 0,
        newer: newer?.items?.[0]?.id,
        older: older?.items?.[0]?.id,
      };
    },
  });
}

/**
 * What a change says when someone else changed the submission since: the
 * server refused its version, or the values it was made from are gone.
 */
const CHANGED_SINCE_MESSAGE =
  "Someone changed this submission since you opened it. It now shows their change; make yours again.";

/**
 * What a refused change says: someone saved it since, the server's own
 * reason for an answer it refused, or that it could not be saved.
 */
function refusalMessage(body: unknown): string {
  const error = (
    body as {
      error?: {
        code?: string;
        message?: string;
        data?: { errors?: Array<{ message?: string }> };
      };
    } | null
  )?.error;
  if (error?.code === "STALE_VERSION") return CHANGED_SINCE_MESSAGE;
  return (
    error?.data?.errors?.[0]?.message ??
    error?.message ??
    "The change could not be saved."
  );
}

/** One section of the main column, as the prototype draws a box. */
function Box({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section
      aria-label={title}
      className="rounded-lg border border-border bg-card"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One line of the activity trail. */
function ActivityItem({
  icon,
  children,
  when,
}: {
  icon: ReactNode;
  children: ReactNode;
  when?: string;
}): JSX.Element {
  return (
    <li className="flex items-start gap-3 py-2">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-sm text-foreground">{children}</span>
      {when ? (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {when}
        </span>
      ) : null}
    </li>
  );
}

/** One row of the details list. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-foreground">
        {children}
      </dd>
    </div>
  );
}

/**
 * Save a change. `basis` names the stored values the change was made from,
 * such as the answers as they were when editing began: if the submission no
 * longer holds them when the change would be sent, someone else changed them
 * since, and the change is refused rather than written over theirs.
 */
type Save = (
  changes: Record<string, unknown>,
  basis?: Record<string, unknown>
) => Promise<void>;

/** The bar: where it sits in its list, newer and older, and its actions. */
function SubmissionBar({
  place,
  go,
  canUpdate,
  canDelete,
  status,
  save,
  submission,
  setConfirmDelete,
}: {
  place: ListPlace | undefined;
  go: (target: string | undefined) => void;
  canUpdate: boolean;
  canDelete: boolean;
  status: string;
  save: Save;
  submission: SubmissionDocument;
  setConfirmDelete: (open: boolean) => void;
}): JSX.Element {
  return (
    <TopBarPlace name="end">
      <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
        {place && place.total > 0 ? (
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground tabular-nums lg:inline">
            {place.index + 1} of {place.total}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Newer submission"
          disabled={!place?.newer}
          onClick={() => go(place?.newer)}
        >
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Older submission"
          disabled={!place?.older}
          onClick={() => go(place?.older)}
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
        {canUpdate ? (
          <>
            <span
              aria-hidden="true"
              className="mx-1 hidden h-5 w-px bg-border sm:block"
            />
            <Button
              type="button"
              variant="outline"
              className="hidden md:inline-flex"
              onClick={() =>
                void save(
                  status === "spam"
                    ? { status: "new", spamReason: null }
                    : { status: "spam" }
                ).catch(() => undefined)
              }
            >
              <Ban className="h-4 w-4" aria-hidden="true" />
              {status === "spam" ? "Not spam" : "Spam"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="hidden md:inline-flex"
              disabled={status === "archived"}
              onClick={() =>
                void save({ status: "archived" }).catch(() => undefined)
              }
            >
              <Archive className="h-4 w-4" aria-hidden="true" />
              Archive
            </Button>
          </>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="More">
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                void navigator.clipboard?.writeText(submission.id)
              }
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy submission ID
            </DropdownMenuItem>
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete submission
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TopBarPlace>
  );
}

/**
 * One answer while editing: an input where staff may change it, and the
 * answer as the page reads it where they may not (a file, a hidden value,
 * a consent, which keeps what the visitor agreed to).
 */
function EditableAnswer({
  field,
  asked,
  value,
  onChange,
}: {
  field: FormField;
  asked: AskedSnapshot;
  value: unknown;
  onChange: (value: unknown) => void;
}): JSX.Element {
  if (field.type === "consent") return <ConsentValue value={value} editing />;
  if (canEditAnswer(field.type)) {
    return <FieldValueInput field={field} value={value} onChange={onChange} />;
  }
  const shown = asked.fields.find(each => each.name === field.name) ?? {
    name: field.name,
    label: field.label || field.name,
    type: field.type,
  };
  return (
    <div className="text-sm">
      <AnswerValue field={shown} value={value} />
    </div>
  );
}

/**
 * Whether a draft changes any of the form's answers. Compared by value, so an
 * answer only re-typed to what it was is no change.
 */
function answersChanged(
  fields: readonly FormField[],
  stored: Record<string, unknown> | undefined,
  draft: Record<string, unknown>
): boolean {
  const before = stored ?? {};
  return fields.some(
    field =>
      JSON.stringify(before[field.name] ?? null) !==
      JSON.stringify(draft[field.name] ?? null)
  );
}

/**
 * What on the page holds unsaved work, by key: each part reports to the
 * admin's leave guard and to the page, which asks before handing off a
 * deleted submission.
 */
const UnsavedOnPage = createContext<(key: string, unsaved: boolean) => void>(
  () => undefined
);

/** The page's record of which of its parts hold unsaved work. */
function useUnsavedOnPage() {
  const held = useRef(new Map<string, boolean>());
  const report = useCallback((key: string, unsaved: boolean) => {
    held.current.set(key, unsaved);
  }, []);
  const any = useCallback(() => [...held.current.values()].some(Boolean), []);
  return { report, any };
}

/** Report unsaved work to the admin's leave guard and to the page. */
function useHoldPage(key: string, unsaved: boolean): void {
  useReportUnsavedWork(key, unsaved);
  const report = useContext(UnsavedOnPage);
  useEffect(() => {
    report(key, unsaved);
    return () => report(key, false);
  }, [report, key, unsaved]);
}

/** The keys this page reports its unsaved answers and note under. */
const UNSAVED_ANSWERS_KEY = "forms.submission-answers";
const UNSAVED_NOTE_KEY = "forms.submission-note";

/**
 * Editing a submission's answers: the draft, the answers it is made from, and
 * saving it. An answer changed and not yet saved holds the page until it is
 * saved or the person cancels. Edits made while a save is on its way stay
 * open, now made from the answers just saved.
 */
function useAnswerDraft(
  submission: SubmissionDocument,
  fields: readonly FormField[],
  save: Save
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const draftNow = useRef(draft);
  draftNow.current = draft;
  // The answers as they were when editing began, which the draft is made from.
  const [basis, setBasis] = useState<Record<string, unknown> | null>(null);
  const changed = editing && answersChanged(fields, basis ?? undefined, draft);
  useHoldPage(UNSAVED_ANSWERS_KEY, changed);
  // Another submission opened: not editing it.
  useEffect(() => setEditing(false), [submission.id]);
  const begin = () => {
    setDraft(submission.data ?? {});
    setBasis(submission.data ?? null);
    setEditing(true);
  };
  const change = (name: string, value: unknown) =>
    setDraft(current => ({ ...current, [name]: value }));
  const afterSave = (sent: Record<string, unknown>) => {
    if (JSON.stringify(draftNow.current) === JSON.stringify(sent)) {
      setEditing(false);
    } else {
      setBasis(sent);
    }
  };
  const saveDraft = () => {
    // Saving untouched answers writes nothing: a `data` write stamps the
    // submission as edited in the admin.
    if (!answersChanged(fields, submission.data, draft)) {
      setEditing(false);
      return;
    }
    const sent = draft;
    void save({ data: sent }, { data: basis })
      .then(() => afterSave(sent))
      .catch(() => undefined);
  };
  return {
    editing,
    draft,
    begin,
    change,
    saveDraft,
    cancel: () => setEditing(false),
  };
}

/** The answers as inputs, and saving or leaving them. */
function AnswerEditor({
  fields,
  asked,
  draft,
}: {
  fields: readonly FormField[];
  asked: AskedSnapshot;
  draft: ReturnType<typeof useAnswerDraft>;
}): JSX.Element {
  return (
    <div className="space-y-4 px-4 py-4 sm:px-5">
      {fields.map(field => (
        <div key={field.name} className="space-y-1.5">
          <label
            htmlFor={`submission-field-${field.name}`}
            className="text-sm font-medium text-foreground"
          >
            {field.label || field.name}
          </label>
          <EditableAnswer
            field={field}
            asked={asked}
            value={draft.draft[field.name]}
            onChange={value => draft.change(field.name, value)}
          />
        </div>
      ))}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={draft.cancel}>
          Cancel
        </Button>
        <Button type="button" onClick={draft.saveDraft}>
          Save answers
        </Button>
      </div>
    </div>
  );
}

/** The answers, as asked, and editing them for a person who may. */
function AnswersBox({
  submission,
  form,
  asked,
  canUpdate,
  save,
}: {
  submission: SubmissionDocument;
  form: FormDocument | null | undefined;
  asked: AskedSnapshot;
  canUpdate: boolean;
  save: Save;
}): JSX.Element {
  const fields = form?.fields ?? [];
  const draft = useAnswerDraft(submission, fields, save);
  return (
    <Box
      title="Answers"
      action={
        canUpdate && !draft.editing ? (
          <Button type="button" variant="ghost" size="sm" onClick={draft.begin}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit answers
          </Button>
        ) : null
      }
    >
      {draft.editing ? (
        <AnswerEditor fields={fields} asked={asked} draft={draft} />
      ) : (
        <SubmissionAnswers asked={asked} data={submission.data ?? {}} />
      )}
    </Box>
  );
}

/** What has happened to it: submitted, flagged, edited, its status. */
function ActivityBox({
  submission,
  status,
}: {
  submission: SubmissionDocument;
  status: string;
}): JSX.Element {
  return (
    <Box title="Activity">
      <ol className="px-4 py-2 sm:px-5">
        <ActivityItem
          icon={<Inbox className="h-3 w-3" />}
          when={whenText(submission.submittedAt ?? submission.createdAt)}
        >
          Submitted
          {submission.spamReason ? (
            <span className="block text-xs text-muted-foreground">
              Flagged as spam ({submission.spamReason})
            </span>
          ) : null}
        </ActivityItem>
        {submission.editedAt ? (
          <ActivityItem
            icon={<Pencil className="h-3 w-3" />}
            when={whenText(submission.editedAt)}
          >
            Answers edited in the admin
          </ActivityItem>
        ) : null}
        {status !== "new" ? (
          <ActivityItem icon={<Eye className="h-3 w-3" />}>
            Now {STATUSES.find(each => each.value === status)?.label ?? status}
          </ActivityItem>
        ) : null}
      </ol>
    </Box>
  );
}

/**
 * The internal note as the person types it, saved when they leave it.
 *
 * Each save names the note it replaces: the stored note, or, while one of the
 * page's own note saves is on its way, the text that save will store. A newer
 * stored note replaces the textarea only while it holds nothing typed since
 * the stored note it last showed, so text typed while a save is on its way is
 * never wiped by that save's answer. "Saved" is said only of the text saved.
 */
function useNoteDraft(submission: SubmissionDocument, save: Save) {
  const stored = submission.notes ?? "";
  const [note, setNote] = useState(stored);
  const [savedText, setSavedText] = useState<string | null>(null);
  const noteNow = useRef(note);
  noteNow.current = note;
  // The stored note the textarea's text was last brought up to.
  const shown = useRef(stored);
  // The stored note once the page's own saves have landed, and how many are on their way.
  const expected = useRef<string>(stored);
  const pending = useRef(0);
  // The note as stored before the page's current run of note saves: what a
  // retry replaces if the whole run fails, since a failed save drops the
  // saves queued behind it.
  const runBasis = useRef<string>(stored);
  const openedId = useRef(submission.id);
  useEffect(() => {
    // Another submission opened: its note, nothing typed, nothing saved.
    if (openedId.current !== submission.id) {
      openedId.current = submission.id;
      setNote(stored);
      shown.current = stored;
      expected.current = stored;
      setSavedText(null);
      return;
    }
    // Text typed since the stored note last shown keeps its basis: a newer
    // stored note, someone else's, must not become what the draft replaces.
    const typed = noteNow.current !== shown.current;
    if (!typed) setNote(stored);
    shown.current = stored;
    // "Saved" names text the server holds; a newer stored note ends that.
    setSavedText(current => (current === stored ? current : null));
    if (pending.current === 0 && !typed) expected.current = stored;
  }, [submission.id, stored]);
  const saveNote = () => {
    const text = noteNow.current;
    if (text === expected.current) return;
    const basis = expected.current;
    if (pending.current === 0) runBasis.current = basis;
    expected.current = text;
    pending.current += 1;
    void save({ notes: text }, { notes: basis })
      .then(() => {
        setSavedText(text);
        runBasis.current = text;
      })
      .catch(() => {
        // Not stored: once no other note save is on its way, the next one
        // replaces the note as stored before this run of saves, so leaving
        // the note retries it, and is refused again if someone else changed
        // the note meanwhile.
        if (pending.current === 1) expected.current = runBasis.current;
      })
      .finally(() => {
        pending.current -= 1;
      });
  };
  // A note typed and not yet stored holds the page: leaving it asks first.
  useHoldPage(UNSAVED_NOTE_KEY, note !== stored && note !== savedText);
  return {
    note,
    edit: (text: string) => setNote(text),
    saveNote,
    saved: savedText !== null && savedText === note,
  };
}

/**
 * The fields a host added to submissions, with their values. Read-only: the
 * page draws no editor for a field it does not know, so they are changed
 * through the API, as the documentation says.
 */
function ExtensionDetails({
  submission,
  fields,
}: {
  submission: SubmissionDocument;
  fields: readonly SubmissionExtensionField[];
}): JSX.Element | null {
  const values = submission as unknown as Record<string, unknown>;
  return (
    <>
      {fields.map(field => (
        <Detail key={field.name} label={field.label}>
          {formatExportValue(values[field.name]) || "—"}
        </Detail>
      ))}
    </>
  );
}

/** The side panel: its status, the internal note, and its details. */
function SidePanel({
  submission,
  status,
  canUpdate,
  save,
  formId,
  formName,
  formsSlug,
  extensionFields,
}: {
  submission: SubmissionDocument;
  status: string;
  canUpdate: boolean;
  save: Save;
  formId: string | undefined;
  formName: string;
  formsSlug: string;
  extensionFields: readonly SubmissionExtensionField[];
}): JSX.Element {
  const { note, edit, saveNote, saved } = useNoteDraft(submission, save);
  return (
    <aside
      aria-label="Submission details"
      className="w-full shrink-0 border-t border-border bg-card lg:w-80 lg:border-t-0 lg:border-l"
    >
      <div className="space-y-6 px-4 py-6 sm:px-6">
        <section
          aria-labelledby="submission-status-label"
          className="space-y-2"
        >
          <h2
            id="submission-status-label"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Status
          </h2>
          <div
            role="group"
            aria-labelledby="submission-status-label"
            className="grid grid-cols-2 gap-1.5"
          >
            {STATUSES.map(each => (
              <button
                key={each.value}
                type="button"
                aria-pressed={status === each.value}
                disabled={!canUpdate}
                onClick={() =>
                  void save(
                    each.value === "spam" || status !== "spam"
                      ? { status: each.value }
                      : { status: each.value, spamReason: null }
                  ).catch(() => undefined)
                }
                className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:border-foreground aria-pressed:bg-accent aria-pressed:font-medium"
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${each.dot}`}
                />
                {each.label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <label htmlFor="submission-note">Internal note</label>
          </h2>
          <Textarea
            id="submission-note"
            rows={4}
            value={note}
            disabled={!canUpdate}
            placeholder="Only people in the admin see this."
            onChange={event => edit(event.target.value)}
            onBlur={saveNote}
          />
          <p className="text-xs text-muted-foreground" role="status">
            Only people in the admin see notes.
            {saved ? " Saved." : ""}
          </p>
        </section>

        <section className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Details
          </h2>
          <dl>
            <Detail label="Form">
              {formId ? (
                <a
                  className="underline decoration-border underline-offset-4 hover:decoration-foreground"
                  href={`/admin/collections/${encodeURIComponent(formsSlug)}/${encodeURIComponent(formId)}`}
                >
                  {formName}
                </a>
              ) : (
                formName
              )}
            </Detail>
            <Detail label="Submitted">
              {whenText(submission.submittedAt ?? submission.createdAt)}
            </Detail>
            {submission.userAgent ? (
              <Detail label="Browser">
                {browserLabel(submission.userAgent)}
              </Detail>
            ) : null}
            {submission.ipAddress ? (
              <Detail label="IP address">
                <span className="font-mono">{submission.ipAddress}</span>
              </Detail>
            ) : null}
            <Detail label="ID">
              <span className="font-mono">{submission.id.slice(0, 8)}</span>
            </Detail>
            <ExtensionDetails
              submission={submission}
              fields={extensionFields}
            />
          </dl>
        </section>
      </div>
    </aside>
  );
}

/** The form's name: as read, as the submission carries it, or "Form". */
function formNameOf(
  form: FormDocument | null | undefined,
  submission: SubmissionDocument
): string {
  if (form?.name) return form.name;
  return typeof submission.form === "object" && submission.form.name
    ? submission.form.name
    : "Form";
}

/** Who sent it, the form and when, under the sender's initials. */
function SubmissionHeader({
  sender,
  formName,
  when,
}: {
  sender: string;
  formName: string;
  when: string;
}): JSX.Element {
  return (
    <PageHeader
      title={sender}
      media={
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-sm font-semibold text-foreground"
        >
          {initialsOf(sender)}
        </span>
      }
      description={
        <span className="text-sm text-muted-foreground">
          {formName} · {when}
        </span>
      }
    />
  );
}

/** What a refused change said, above the answers. */
function ChangeError({ error }: { error: string | null }): JSX.Element | null {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

/** Asks before a submission is deleted for good. */
function DeleteDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this submission?</AlertDialogTitle>
          <AlertDialogDescription>
            Its answers are deleted, and the emails it sent are forgotten, for
            good.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Delete submission
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The list the page was opened from, as its address carries it. */
function initialScope(): SubmissionListScope {
  return typeof window === "undefined"
    ? { status: "all" }
    : scopeFromSearch(window.location.search);
}

/**
 * Moving from this page: to a newer or older submission of its list, or,
 * once it is deleted, to the next one there or the list itself.
 */
function usePageMoves(
  slug: string,
  scope: SubmissionListScope,
  place: ListPlace | undefined,
  remove: () => Promise<boolean>,
  leaveDeleted: { onDelete?: () => void; holdsUnsaved: () => boolean }
) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const go = (target: string | undefined) => {
    if (target) navigateTo(submissionPageAddress(slug, target, scope));
  };
  const deleteSubmission = async () => {
    setConfirmDelete(false);
    if (!(await remove())) return;
    // With unsaved work on the page the admin's leave guard would ask about a
    // submission that no longer exists, so the page hands the move to the
    // host, which stands the guard down and returns to the list.
    if (leaveDeleted.holdsUnsaved() && leaveDeleted.onDelete) {
      leaveDeleted.onDelete();
      return;
    }
    const next = place?.older ?? place?.newer;
    navigateTo(
      next
        ? submissionPageAddress(slug, next, scope)
        : `/admin/collections/${encodeURIComponent(slug)}`
    );
  };
  return { go, confirmDelete, setConfirmDelete, deleteSubmission };
}

/**
 * What this person may do with this submission: nothing until it is known,
 * and nothing while a colleague holds it.
 */
function useSubmissionRights(slug: string, held: boolean) {
  const { data: has } = useQuery({
    queryKey: ["plugin-form-builder", "me-permissions"],
    queryFn: readPermissions,
    retry: false,
  });
  return {
    known: has !== undefined,
    canUpdate: !held && has?.(`update-${slug}`) === true,
    canDelete: !held && has?.(`delete-${slug}`) === true,
  };
}

/** What the page shows of a submission: its answers as asked, who, when. */
function describe(
  submission: SubmissionDocument,
  form: FormDocument | null | undefined
) {
  const data = submission.data ?? {};
  const asked = askedFieldsOf(submission.asked, form?.fields ?? [], data);
  return {
    asked,
    sender: senderOf(asked.fields, data) ?? "Submission",
    formName: formNameOf(form, submission),
    when: whenText(submission.submittedAt ?? submission.createdAt),
  };
}

/** The form a submission belongs to, read from its collection. */
function useSubmissionForm(submission: SubmissionDocument | undefined) {
  const formId = submission ? formIdOf(submission) : undefined;
  // The forms collection as this install names it; a host may rename it.
  const formsSlug = useBuilderConfig().formsSlug ?? "forms";
  const { data: form } = useQuery({
    enabled: formId !== undefined,
    queryKey: ["form-builder", "submission-form", formsSlug, formId],
    queryFn: async () => {
      const body = await readJson<FormDocument & { item?: FormDocument }>(
        `/admin/api/collections/${encodeURIComponent(formsSlug)}/entries/${encodeURIComponent(formId!)}`
      );
      return body ? (body.item ?? body) : null;
    },
  });
  return { formId, form, formsSlug };
}

/** What the page says when reading the submission again failed. */
const REFRESH_FAILED_MESSAGE =
  "This submission could not be read again, so it may have changed since. Your edits are kept.";

/** What a change the server never received says; the page keeps the draft. */
const UNSENT_MESSAGE =
  "The change could not be sent. Check your connection and try again.";

/** What a change held by a colleague's claim says. */
const HELD_MESSAGE =
  "Someone else is editing this submission. Your change was not saved.";

/** Whether the stored submission still holds the values a change was made from. */
function holdsBasis(
  stored: SubmissionDocument | undefined,
  basis: Record<string, unknown> | undefined
): boolean {
  if (basis === undefined) return true;
  const now = (stored ?? {}) as Record<string, unknown>;
  // Nothing, null and empty text are one value: a cleared note is stored as
  // "" and read back as either.
  const plain = (value: unknown) =>
    JSON.stringify(value === undefined || value === "" ? null : value);
  return Object.entries(basis).every(
    ([name, value]) => plain(now[name]) === plain(value)
  );
}

/**
 * Saving and deleting this submission, and what a refusal said. Saves run one
 * at a time, each with the version the one before it left: a note saved on
 * blur and the status button clicked straight after would otherwise both send
 * the version the page was read at, and the second be refused as stale.
 *
 * Taking the newest version is only safe for the page's own saves, so a
 * change made from stored values (an answer draft, a note) names them, and is
 * refused when someone else has changed them since. A refused save also drops
 * every save queued behind it: those were asked for on a page that was
 * already behind, and the refusal's message stays until the person acts
 * again. While a colleague holds the submission every write is refused here,
 * before it is sent, judged when it would run rather than when it was asked
 * for.
 */
function useSubmissionWrites(slug: string, id: string, held: boolean) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const heldNow = useRef(held);
  heldNow.current = held;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // Moves on at each refusal; a save asked for in an earlier one is dropped.
  const generation = useRef(0);
  const address = `/admin/api/collections/${encodeURIComponent(slug)}/entries/${encodeURIComponent(id)}`;
  const key = ["form-builder", "submission", slug, id];
  /** Refuse with `message`, dropping every save queued behind this one. */
  const refuse = (message: string): never => {
    generation.current += 1;
    setError(message);
    throw new Error(message);
  };
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({
      queryKey: ["form-builder", "submission-place", slug],
    });
    void queryClient.invalidateQueries({ queryKey: SUBMISSION_COUNT_KEY });
  };
  /** Send a change, with the version the page holds now. */
  const send: Save = async (changes, basis) => {
    if (heldNow.current) refuse(HELD_MESSAGE);
    const stored = queryClient.getQueryData<SubmissionDocument>(key);
    if (!holdsBasis(stored, basis)) refuse(CHANGED_SINCE_MESSAGE);
    setError(null);
    const rev = stored?._rev;
    const response = await fetch(address, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(
        typeof rev === "string" ? { ...changes, _rev: rev } : changes
      ),
    }).catch(() => refuse(UNSENT_MESSAGE));
    if (!response.ok) {
      const message = refusalMessage(await response.json().catch(() => null));
      await refresh();
      refuse(message);
    }
    // The saved submission, as the update answered it, is what the page
    // holds now, before reading it again: a read that then fails must not
    // leave the page holding the version this save replaced.
    const saved = (await response.json().catch(() => null)) as {
      item?: SubmissionDocument;
    } | null;
    if (saved?.item?.id === id) queryClient.setQueryData(key, saved.item);
    await refresh();
  };
  /**
   * Save a change once every change asked for before it has settled, unless
   * one of those was refused.
   */
  const save: Save = (changes, basis) => {
    const asked = generation.current;
    const run = queue.current.then(() =>
      asked === generation.current
        ? send(changes, basis)
        : Promise.reject(new Error("Dropped behind a refused change."))
    );
    queue.current = run.catch(() => undefined);
    return run;
  };
  /** Delete it, answering whether it went. */
  const remove = async (): Promise<boolean> => {
    if (heldNow.current) {
      setError(HELD_MESSAGE);
      return false;
    }
    const response = await fetch(address, {
      method: "DELETE",
      credentials: "include",
    }).catch(() => null);
    if (!response?.ok) {
      setError("The submission could not be deleted.");
      return false;
    }
    void queryClient.invalidateQueries({ queryKey: SUBMISSION_COUNT_KEY });
    return true;
  };
  return { save, remove, error };
}

/**
 * Opening a New submission reads it: it is marked Read for a person who may
 * update it. Judged once per submission opened, as it was when opened, so a
 * person who then sets it back to New keeps it New. The save is read through
 * a ref, so the effect runs on what changes, not on each render's function.
 */
function useReadOnOpen(
  submission: SubmissionDocument | undefined,
  permissionsKnown: boolean,
  canUpdate: boolean,
  save: Save
): void {
  const saveNow = useRef(save);
  saveNow.current = save;
  const openedOnce = useRef<string | null>(null);
  const openedId = submission?.id;
  const statusWhenOpened = useRef<string | undefined>(undefined);
  if (openedId && openedOnce.current !== openedId) {
    statusWhenOpened.current = submission?.status;
  }
  useEffect(() => {
    if (!openedId || !permissionsKnown) return;
    if (openedOnce.current === openedId) return;
    openedOnce.current = openedId;
    if (canUpdate && statusWhenOpened.current === "new") {
      void saveNow.current({ status: "read" }).catch(() => undefined);
    }
  }, [openedId, permissionsKnown, canUpdate]);
}

/** The page while the submission is read, or why it could not be. */
function PageMessage({ error }: { error?: Error | null }): JSX.Element {
  return (
    <PageFrame type="editor">
      {error ? (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        </div>
      ) : (
        <p role="status" className="p-6 text-sm text-muted-foreground">
          Loading submission…
        </p>
      )}
    </PageFrame>
  );
}

/** The submission the page is of, and its collection, as the host names them. */
function pageTarget(
  collectionSlug: string | undefined,
  entryId: string | undefined,
  initialData: Partial<SubmissionDocument> | undefined
): { slug: string; id: string } {
  return {
    slug: collectionSlug ?? "form-submissions",
    id: entryId ?? initialData?.id ?? "",
  };
}

/** Whether a colleague's claim withholds every change. */
function heldBy(lock: DocumentLockGates | undefined): boolean {
  return lock?.readOnly === true || lock?.actionsDisabled === true;
}

/** What the page says above the answers: a refused change, or a failed refresh. */
function pageNotice(error: string | null, readError: unknown): string | null {
  if (error) return error;
  return readError ? REFRESH_FAILED_MESSAGE : null;
}

export function SubmissionPage({
  entryId,
  collectionSlug,
  initialData,
  documentLock,
  onDelete,
}: SubmissionPageProps): JSX.Element {
  const { slug, id } = pageTarget(collectionSlug, entryId, initialData);
  const [scope] = useState<SubmissionListScope>(initialScope);
  const { data: submission, error: readError } = useSubmission(
    slug,
    id,
    initialData
  );
  const { formId, form, formsSlug } = useSubmissionForm(submission);
  const extensionFields = useSubmissionFields();
  const held = heldBy(documentLock);
  const { known, canUpdate, canDelete } = useSubmissionRights(slug, held);
  const { data: place } = useListPlace(slug, submission, scope);
  const { save, remove, error } = useSubmissionWrites(slug, id, held);
  useReadOnOpen(submission, known, canUpdate, save);
  const unsaved = useUnsavedOnPage();
  const { go, confirmDelete, setConfirmDelete, deleteSubmission } =
    usePageMoves(slug, scope, place, remove, {
      onDelete,
      holdsUnsaved: unsaved.any,
    });

  // Only a submission never read replaces the page. A refresh that fails
  // after it was read keeps the page, and every draft on it, and says so.
  if (!submission) return <PageMessage error={readError} />;

  const { asked, sender, formName, when } = describe(submission, form);
  const status = submission.status;

  return (
    <UnsavedOnPage.Provider value={unsaved.report}>
      <SubmissionBar
        place={place}
        go={go}
        canUpdate={canUpdate}
        canDelete={canDelete}
        status={status}
        save={save}
        submission={submission}
        setConfirmDelete={setConfirmDelete}
      />
      <DeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={() => void deleteSubmission()}
      />

      <PageFrame type="editor">
        <div className="flex min-h-full flex-col lg:flex-row">
          <div className="min-w-0 flex-1 space-y-5 px-4 py-6 sm:px-6 lg:px-8">
            <SubmissionHeader sender={sender} formName={formName} when={when} />
            <ChangeError error={pageNotice(error, readError)} />

            <AnswersBox
              submission={submission}
              form={form}
              asked={asked}
              canUpdate={canUpdate}
              save={save}
            />

            <ActivityBox submission={submission} status={status} />
          </div>

          <SidePanel
            submission={submission}
            status={status}
            canUpdate={canUpdate}
            save={save}
            formId={formId}
            formName={formName}
            formsSlug={formsSlug}
            extensionFields={extensionFields}
          />
        </div>
      </PageFrame>
    </UnsavedOnPage.Provider>
  );
}
