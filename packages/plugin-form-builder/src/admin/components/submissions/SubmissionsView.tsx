"use client";

/**
 * Submissions View
 *
 * The submissions list, replacing the generic collection table via the
 * List-view override, and drawn again as a form's own Submissions tab. One
 * form's list has that form's labels as its columns and each answer as it
 * was asked (a choice by its option's label); the list of every form, whose
 * fields differ, shows who sent each, its form and a summary. It filters by
 * status (Spam is a tab of its own: flagged submissions are reviewable and
 * recoverable, never invisible) and by date, and acts on ticked rows alone:
 * Mark as read, Archive, Spam, Export and Delete.
 *
 * There is no way to add a submission here: a submission records what a
 * visitor sent, and the collection declares `disableCreate`.
 *
 * @module admin/components/submissions/SubmissionsView
 */

import {
  DataTableView,
  navigateTo,
  type RowAction,
  TopBarPlace,
} from "@nextlyhq/plugin-sdk/admin";
import { Button } from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  type JSX,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { FormField } from "../../../types";
import { readPermissions } from "../../use-admin-permissions";
import { SUBMISSION_COUNT_KEY } from "../editor/useSubmissionCount";

import {
  type BulkChange,
  bulkRequest,
  outcomeText,
  sendBulk,
} from "./bulk-actions";
import { type DateChoice, sentRange, type SentRange } from "./date-filter";
import { ExportMenu } from "./ExportMenu";
import { SelectionBar } from "./SelectionBar";
import {
  ALL_FORMS_OPTIONAL_COLUMNS,
  allFormsColumns,
  formColumns,
  type FormOption,
} from "./submission-columns";
import {
  listWhere,
  LIST_SORT,
  type StatusTab,
  submissionPageAddress,
  type SubmissionListScope,
} from "./submission-list-scope";
import { formIdOf, type SubmissionRow } from "./submission-row";
import { ColumnsMenu, SubmissionsToolbar } from "./SubmissionsToolbar";
import { useColumnsLeftOut } from "./use-columns-left-out";
import { useStatusCounts } from "./use-status-counts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * What a change to a submission sends: the change, with the version its row
 * had when the list read it, so a change made from an older copy is refused
 * rather than replacing what someone saved since.
 */
export function submissionPatch(
  row: SubmissionRow | undefined,
  changes: Record<string, unknown>
): Record<string, unknown> {
  return typeof row?._rev === "string"
    ? { ...changes, _rev: row._rev }
    : changes;
}

/** What a refused change says when someone saved the submission since. */
const SUBMISSION_CHANGED_SINCE =
  "Someone changed this submission since the list loaded. The list now shows their change; make yours again.";

interface SubmissionsViewProps {
  collectionSlug?: string;
  /**
   * Show only this form's submissions, with no choice of form: the list as a
   * form's own Submissions tab draws it.
   */
  formId?: string;
}

/** The collections the list reads, as this install named them. */
interface Slugs {
  forms: string;
  submissions: string;
}

const DEFAULT_SLUGS: Slugs = {
  forms: "forms",
  submissions: "form-submissions",
};

/** What the person may do with submissions. */
interface Rights {
  update: boolean;
  delete: boolean;
  export: boolean;
}

const NO_RIGHTS: Rights = { update: false, delete: false, export: false };

const PAGE_SIZE = 25;

/** How many per-field columns are visible before the rest hide behind the selector. */
const VISIBLE_FIELD_COLUMNS = 4;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** A form entry as the entries API answers it. */
type FormEntry = { id: string; name?: string; fields?: FormField[] };

/** A form as the list uses it: its id, name and fields. */
function formOptionOf(item: FormEntry): FormOption {
  return {
    id: item.id,
    name: item.name ?? item.id,
    fields: Array.isArray(item.fields) ? item.fields : [],
  };
}

/**
 * Every form, page by page: a capped single fetch would silently drop forms
 * from the filter and the per-field column lookup. The entries API reads the
 * page size from `limit` and answers its default page when that is absent, so
 * the size goes there: under any other name the first page comes back short
 * and the loop reads it as the last.
 */
async function readAllForms(formsSlug: string): Promise<FormOption[]> {
  const allForms: FormOption[] = [];
  const formsPageSize = 200;
  for (let formsPage = 1; ; formsPage += 1) {
    const formsRes = await fetch(
      `/admin/api/collections/${formsSlug}/entries?limit=${formsPageSize}&page=${formsPage}`,
      { credentials: "include" }
    );
    if (!formsRes.ok) break;
    const json = (await formsRes.json()) as { items?: FormEntry[] };
    const items = json.items ?? [];
    allForms.push(...items.map(formOptionOf));
    if (items.length < formsPageSize) break;
  }
  return allForms;
}

/** One form, for the list fixed to it; none if it cannot be read. */
async function readOneForm(
  formsSlug: string,
  formId: string
): Promise<FormOption[]> {
  const response = await fetch(
    `/admin/api/collections/${formsSlug}/entries/${encodeURIComponent(formId)}`,
    { credentials: "include" }
  );
  if (!response.ok) return [];
  const json = (await response.json()) as FormEntry & { item?: FormEntry };
  return [formOptionOf(json.item ?? json)];
}

/** The collections' installed names, or the defaults when they cannot be read. */
async function readSlugs(): Promise<Slugs> {
  const response = await fetch(
    "/admin/api/plugins/@nextlyhq/plugin-form-builder/builder-config",
    { credentials: "include" }
  );
  if (!response.ok) return DEFAULT_SLUGS;
  const config = (await response.json()) as { slugs?: Slugs };
  return config.slugs ?? DEFAULT_SLUGS;
}

/** What the person may do with `submissions`; nothing while unknown. */
async function readRights(submissions: string): Promise<Rights> {
  const has = await readPermissions().catch(() => undefined);
  if (has === undefined) return NO_RIGHTS;
  return {
    update: has(`update-${submissions}`),
    delete: has(`delete-${submissions}`),
    export: has("export-submissions"),
  };
}

/**
 * The installed collection names, the forms the list needs (one form's tab
 * that form alone, the list of every form all of them, for its picker and
 * its columns), and the person's rights. `ready` once all of them are known,
 * or known to be unreadable: until then the list cannot tell which columns
 * and tick boxes to draw.
 */
function useBootstrap(formId: string | undefined) {
  const [slugs, setSlugs] = useState<Slugs>();
  const [forms, setForms] = useState<FormOption[]>([]);
  const [rights, setRights] = useState<Rights>(NO_RIGHTS);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void (async () => {
      try {
        const resolved = await readSlugs();
        if (cancelled) return;
        setSlugs(resolved);
        // Read together, since the list waits for both.
        const [found, held] = await Promise.all([
          formId === undefined
            ? readAllForms(resolved.forms)
            : readOneForm(resolved.forms, formId),
          readRights(resolved.submissions),
        ]);
        if (cancelled) return;
        setForms(found);
        setRights(held);
      } catch {
        // Bootstrap failures degrade to the default slugs — without them
        // the list fetch would wait forever and the loading state never end.
        if (!cancelled) setSlugs(current => current ?? DEFAULT_SLUGS);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formId]);
  return { slugs, forms, rights, ready };
}

/** One page of the list's rows for `scope`, read again on `refetch`. */
function useRows(
  slug: string | undefined,
  scope: SubmissionListScope,
  page: number
) {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request sequence: rapid filter changes overlap fetches, and
  // only the LATEST request may commit rows — an older response finishing
  // last must never overwrite the current filter's data.
  const fetchSeqRef = useRef(0);
  const refetch = useCallback(async () => {
    if (slug === undefined) return;
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      // `limit`, the entries API's page size: the pager counts pages of
      // PAGE_SIZE, so a page the server cut to its default would skip rows.
      // The filter is built where a submission's page builds it, so its
      // newer and older move through this same list.
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        sort: LIST_SORT,
        where: JSON.stringify(listWhere(scope)),
      });
      const res = await fetch(
        `/admin/api/collections/${slug}/entries?${params}`,
        { credentials: "include" }
      );
      if (!res.ok)
        throw new Error(`Failed to load submissions (${res.status})`);
      const json = (await res.json()) as {
        items?: SubmissionRow[];
        meta?: { total?: number };
      };
      if (seq !== fetchSeqRef.current) return;
      setRows(json.items ?? []);
      setTotal(json.meta?.total ?? (json.items ?? []).length);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to load submissions"
      );
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [slug, scope, page]);
  useEffect(() => {
    void refetch();
  }, [refetch]);
  return { rows, total, loading, error, setError, refetch };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * The ticked rows of the page on screen. Ticks belong to the rows they were
 * made on: a new filter or page starts with none, and a row that leaves the
 * list (moved to another tab, deleted) leaves the selection with it.
 */
function useSelection(rows: readonly SubmissionRow[], listKey: string) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => setIds([]), [listKey]);
  useEffect(
    () =>
      setIds(current => {
        const kept = current.filter(id => rows.some(row => row.id === id));
        return kept.length === current.length ? current : kept;
      }),
    [rows]
  );
  const toggle = useCallback(
    (row: SubmissionRow) =>
      setIds(current =>
        current.includes(row.id)
          ? current.filter(id => id !== row.id)
          : [...current, row.id]
      ),
    []
  );
  const toggleAll = useCallback(
    (page: SubmissionRow[], allSelected: boolean) =>
      setIds(allSelected ? [] : page.map(row => row.id)),
    []
  );
  const ticked = useMemo(
    () => rows.filter(row => ids.includes(row.id)),
    [rows, ids]
  );
  return { ids, ticked, setIds, toggle, toggleAll };
}

/** The one form every ticked row belongs to, for a CSV of them; none if mixed. */
function commonForm(rows: readonly SubmissionRow[]): string | undefined {
  const forms = new Set(rows.map(formIdOf));
  return forms.size === 1 ? [...forms][0] : undefined;
}

/**
 * A row's checkbox answers Space and Enter itself. Without this the key also
 * reaches the row around it, which opens the submission on the same keys, so
 * a keyboard could not tick a row without leaving the list.
 */
function keepKeysOnCheckboxes(event: KeyboardEvent<HTMLDivElement>): void {
  const target = event.target as HTMLElement;
  if (
    target.getAttribute("role") === "checkbox" &&
    (event.key === " " || event.key === "Enter")
  ) {
    event.stopPropagation();
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** What the last change of the ticked rows did, said above the list. */
interface Notice {
  done?: string;
  refused?: string;
}

function ChangeNotice({ notice }: { notice: Notice }): JSX.Element {
  return (
    <div role="status" className="space-y-1 text-sm">
      {notice.done && (
        <p className="flex items-center gap-2 text-foreground">
          <CircleCheck
            className="h-4 w-4 shrink-0 text-success"
            aria-hidden="true"
          />
          {notice.done}
        </p>
      )}
      {notice.refused && (
        <p className="flex items-center gap-2 text-destructive">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          {notice.refused}
        </p>
      )}
    </div>
  );
}

/** The pager under the list. */
function Pager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}): JSX.Element {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span role="status">
        {total === 0
          ? "0 submissions"
          : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span>
          Page {page} of {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/** What the list says when it has no rows. */
function emptyMessage(scope: SubmissionListScope): string {
  if (scope.from || scope.to) return "No submissions were sent in these dates.";
  return scope.status === "spam"
    ? "No spam — nothing has been flagged."
    : "No submissions yet.";
}

/**
 * The columns the list draws, fitted to its box (`useColumnsLeftOut`).
 *
 * The list of every form gives up its Summary, then its Form column. A form's
 * own list shows its first few fields by default, as many of them as fit
 * (always the first), and the Columns menu toggles any field in or out. Once
 * the person has chosen there, their choice is drawn as made, even if the
 * table then scrolls: they asked for those columns.
 */
function useFittedColumns(
  box: RefObject<HTMLElement | null>,
  form: FormOption | undefined,
  formsById: ReadonlyMap<string, FormOption>,
  content: unknown
) {
  const [chosen, setChosen] = useState<{
    form: FormOption;
    hidden: ReadonlySet<string>;
  }>();
  // A choice belongs to the form it was made on.
  const chosenHidden =
    form !== undefined && chosen?.form === form ? chosen.hidden : undefined;
  const byDefault = Math.min(VISIBLE_FIELD_COLUMNS, form?.fields.length ?? 0);
  const optional =
    form === undefined
      ? ALL_FORMS_OPTIONAL_COLUMNS
      : chosenHidden
        ? 0
        : Math.max(0, byDefault - 1);
  const leftOut = useColumnsLeftOut(
    box,
    optional,
    `${form?.id ?? ""}:${chosenHidden ? "chosen" : "default"}`,
    content
  );
  const hidden = useMemo<ReadonlySet<string>>(
    () =>
      chosenHidden ??
      new Set(
        (form?.fields ?? []).slice(byDefault - leftOut).map(field => field.name)
      ),
    [chosenHidden, form, byDefault, leftOut]
  );
  const toggle = useCallback(
    (name: string, shown: boolean) => {
      if (form === undefined) return;
      const next = new Set(hidden);
      if (shown) next.delete(name);
      else next.add(name);
      setChosen({ form, hidden: next });
    },
    [form, hidden]
  );
  const columns = useMemo(
    () =>
      form ? formColumns(form, hidden) : allFormsColumns(formsById, leftOut),
    [form, hidden, formsById, leftOut]
  );
  return { columns, hidden, toggle };
}

export function SubmissionsView({
  collectionSlug,
  formId,
}: SubmissionsViewProps): JSX.Element {
  const { slugs, forms, rights, ready } = useBootstrap(formId);
  const [chosenFormId, setChosenFormId] = useState<string>(() => {
    // Deep links (?form=<id>) preselect the form filter.
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("form") ?? "";
  });
  // A form's own tab names its form; the list of all submissions offers the
  // choice.
  const selectedFormId = formId ?? chosenFormId;
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [date, setDate] = useState<{ choice: DateChoice; range: SentRange }>({
    choice: { kind: "any" },
    range: {},
  });
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<Notice>({});
  const [busy, setBusy] = useState(false);

  const submissionsSlug =
    slugs?.submissions ?? collectionSlug ?? DEFAULT_SLUGS.submissions;

  // What the list shows, one object: its rows, its counts, the page a row
  // opens and the export all read it.
  const scope = useMemo<SubmissionListScope>(
    () => ({
      ...(selectedFormId ? { form: selectedFormId } : {}),
      status: statusTab,
      ...date.range,
    }),
    [selectedFormId, statusTab, date.range]
  );
  const countScope = useMemo(
    () => ({
      ...(selectedFormId ? { form: selectedFormId } : {}),
      ...date.range,
    }),
    [selectedFormId, date.range]
  );
  const { rows, total, loading, error, setError, refetch } = useRows(
    slugs?.submissions,
    scope,
    page
  );
  const counts = useStatusCounts(slugs?.submissions, countScope);
  const selection = useSelection(rows, `${JSON.stringify(scope)}:${page}`);

  // A new filter starts at its first page, with nothing said about a change
  // made in the last one.
  const filterBy = useCallback((change: () => void) => {
    change();
    setPage(1);
    setNotice({});
  }, []);

  const selectedForm = useMemo(
    () => forms.find(form => form.id === selectedFormId),
    [forms, selectedFormId]
  );
  const formsById = useMemo(
    () => new Map(forms.map(form => [form.id, form])),
    [forms]
  );
  const tableBox = useRef<HTMLDivElement>(null);
  // The rows the table draws: none until the list is ready.
  const shownRows = ready ? rows : null;
  const fitted = useFittedColumns(tableBox, selectedForm, formsById, shownRows);
  // Tick boxes only for someone who can act on a ticked row: without update,
  // delete or export a selection would open a bar with nothing in it.
  const canAct = rights.update || rights.delete || rights.export;

  // --- changes ---------------------------------------------------------------
  // The form's submission count, beside the list in the form editor's bar and
  // tab, and the tabs' counts are read again after any change here.
  const queryClient = useQueryClient();
  const changed = useCallback(async () => {
    await refetch();
    void queryClient.invalidateQueries({ queryKey: SUBMISSION_COUNT_KEY });
  }, [refetch, queryClient]);

  // The rows as last read, for the version a change sends.
  const rowsNow = useRef(rows);
  rowsNow.current = rows;
  const patchSubmission = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await fetch(
        `/admin/api/collections/${submissionsSlug}/entries/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(
            submissionPatch(
              rowsNow.current.find(row => row.id === id),
              body
            )
          ),
        }
      );
      if (!res.ok) {
        const refusal = (await res.json().catch(() => null)) as {
          error?: { code?: string };
        } | null;
        // Changed since the list read it: read the list again, so the row
        // shows the change and carries its version, and say so.
        if (refusal?.error?.code === "STALE_VERSION") {
          await refetch();
          throw new Error(SUBMISSION_CHANGED_SINCE);
        }
        throw new Error(`Update failed (${res.status})`);
      }
      await changed();
    },
    [submissionsSlug, refetch, changed]
  );

  const deleteSubmission = useCallback(
    async (id: string) => {
      const res = await fetch(
        `/admin/api/collections/${submissionsSlug}/entries/${id}`,
        { method: "DELETE", credentials: "include" }
      );
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      await changed();
    },
    [submissionsSlug, changed]
  );

  const rowActions = useCallback(
    (row: SubmissionRow): RowAction<SubmissionRow>[] => {
      const actions: RowAction<SubmissionRow>[] = [];
      if (row.status === "spam" && rights.update) {
        actions.push({
          id: "not-spam",
          label: "Not spam",
          // A refusal is said beside the list, as a failed read is: the
          // row is read again, and without this the click would seem to do
          // nothing.
          onSelect: target =>
            void patchSubmission(target.id, {
              status: "new",
              spamReason: null,
            }).catch((reason: unknown) =>
              setError(
                reason instanceof Error ? reason.message : "Update failed."
              )
            ),
        });
      }
      if (rights.delete) {
        actions.push({
          id: "delete",
          label: "Delete",
          destructive: true,
          onSelect: target => void deleteSubmission(target.id),
        });
      }
      return actions;
    },
    [rights.update, rights.delete, patchSubmission, deleteSubmission, setError]
  );

  // One request for every ticked row; the server judges each under the
  // person's rights and answers the ones it refused beside the rest.
  const changeTicked = useCallback(
    async (change: BulkChange) => {
      setBusy(true);
      try {
        const outcome = await sendBulk(
          bulkRequest(submissionsSlug, change, selection.ticked)
        );
        setNotice(outcomeText(change, outcome));
        // Refused rows stay ticked, to try again or look at.
        selection.setIds(outcome.refused.map(each => each.id));
      } catch (reason) {
        setNotice({
          refused:
            reason instanceof Error ? reason.message : "The change failed.",
        });
      } finally {
        setBusy(false);
        await changed();
      }
    },
    [submissionsSlug, selection, changed]
  );

  // --- export ----------------------------------------------------------------
  const tickedScope = useMemo<SubmissionListScope>(() => {
    const form = selectedFormId || commonForm(selection.ticked);
    return { status: statusTab, ...(form ? { form } : {}) };
  }, [selectedFormId, selection.ticked, statusTab]);
  const exportAll = rights.export ? (
    <ExportMenu scope={scope} heading="Export what is shown" />
  ) : null;

  const tickedCount = selection.ticked.length;
  return (
    <div className="space-y-4">
      {/* The list of every form puts Export in the admin's top bar; a form's
          tab leaves that bar to the form editor, whose last action is Save,
          and puts Export at the end of the toolbar. */}
      {formId === undefined && exportAll ? (
        <TopBarPlace name="end">
          <div className="ml-auto flex items-center">{exportAll}</div>
        </TopBarPlace>
      ) : null}

      <SubmissionsToolbar
        forms={formId === undefined ? forms : undefined}
        formId={selectedFormId}
        onFormChange={next => filterBy(() => setChosenFormId(next))}
        status={statusTab}
        counts={counts}
        onStatusChange={next => filterBy(() => setStatusTab(next))}
        date={date.choice}
        onDateChange={choice =>
          filterBy(() =>
            setDate({ choice, range: sentRange(choice, new Date()) })
          )
        }
        end={
          <>
            {selectedForm && selectedForm.fields.length > 0 ? (
              <ColumnsMenu
                fields={selectedForm.fields}
                hidden={fitted.hidden}
                onToggle={fitted.toggle}
              />
            ) : null}
            {formId === undefined ? null : exportAll}
          </>
        }
      />

      {tickedCount > 0 && canAct ? (
        <SelectionBar
          count={tickedCount}
          rights={rights}
          spamTab={statusTab === "spam"}
          busy={busy}
          exportMenu={
            rights.export ? (
              <ExportMenu
                scope={tickedScope}
                ids={selection.ticked.map(row => row.id)}
                heading={
                  tickedCount === 1
                    ? "Export the ticked submission"
                    : `Export the ${tickedCount} ticked submissions`
                }
                compact
              />
            ) : null
          }
          onChange={change => void changeTicked(change)}
          onClear={() => selection.setIds([])}
        />
      ) : null}

      {notice.done || notice.refused ? <ChangeNotice notice={notice} /> : null}

      <div ref={tableBox} onKeyDownCapture={keepKeysOnCheckboxes}>
        {/* Until the forms and the person's rights are known, the list stays
            loading, with no columns and no rows: drawn earlier, a form's tab
            would show every form's columns, and tick boxes, for a moment
            before its own. */}
        <DataTableView<SubmissionRow>
          columns={ready ? fitted.columns : []}
          rows={shownRows ?? []}
          loading={loading || !ready}
          error={error}
          emptyMessage={emptyMessage(scope)}
          ariaLabel="Submissions"
          selection={
            ready && canAct
              ? {
                  selectedIds: selection.ids,
                  onToggle: selection.toggle,
                  onToggleAll: selection.toggleAll,
                }
              : undefined
          }
          // A submission opens as a page of its own, carrying this list's
          // filter so its newer and older follow it.
          onRowClick={row =>
            navigateTo(submissionPageAddress(submissionsSlug, row.id, scope))
          }
          rowActions={rowActions}
        />
      </div>

      <Pager page={page} total={total} onPage={setPage} />

      {ready ? (
        <p className="text-xs text-muted-foreground">
          Click a row to open its page.{" "}
          {canAct ? "Tick rows for bulk actions. " : ""}
          {selectedForm
            ? "Columns use this form's labels and option names."
            : "Pick one form to see its own columns."}
        </p>
      ) : null}
    </div>
  );
}

export default SubmissionsView;
