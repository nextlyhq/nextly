/**
 * Pages in Edit mode: each listed page's title and description as boxes
 * typed straight into, the grey text in an empty box the automatic value
 * that fills it, and a bar that saves or discards every change.
 *
 * A page with an entry is read and saved through bulk edit's routes, one
 * content type per save, so a type's pages are saved together or not at
 * all; a page built in code through its own save. A save that stops part-way
 * says which pages were saved and which were not, and keeps the changes not
 * saved to be saved again. What each box holds, and how a save is split, is
 * worked out in `pages-edit`.
 *
 * @module admin/pages-editor
 */
import {
  Alert,
  AlertDescription,
  AlertTitle,
  apiErrorMessage,
  Button,
  Input,
  readPluginRoute,
  Textarea,
  toastMutationResult,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type JSX,
  type ReactNode,
  type SetStateAction,
} from "react";

import {
  BULK_ROWS_PATH,
  BULK_SAVE_PATH,
  type BulkRow,
  type BulkRowsBody,
  type BulkSaveRequest,
} from "../bulk/contract";
import {
  CODE_PAGE_SEO_ROUTE_PATH,
  LONGEST_SEO_TEXT,
  type SiteAddress,
} from "../code-pages/contract";
import { SEO_PLUGIN_NAME } from "../settings/contract";

import {
  boxChanged,
  boxLine,
  boxValue,
  editable,
  editRowsOf,
  editsAfter,
  pagesText,
  rowChanged,
  saveOutcome,
  saveSteps,
  typesToRead,
  type EditField,
  type EditRow,
  type PageEdits,
  type SaveOutcome,
  type SaveStep,
  type StepResult,
  withEdit,
  withoutEdits,
} from "./pages-edit";
import { problemsOf, type ProblemsByPage } from "./pages-view";

/** Every page of one content type, read a page of rows at a time. */
async function readEveryRow(type: string): Promise<BulkRow[]> {
  const rows: BulkRow[] = [];
  for (let page = 1; ; page++) {
    const body = await readPluginRoute<BulkRowsBody>({
      plugin: SEO_PLUGIN_NAME,
      path: `${BULK_ROWS_PATH}?type=${encodeURIComponent(type)}&page=${page}`,
    });
    if (body === undefined) return rows;
    // A page created meanwhile moves the pages along, so a row read already
    // can come again: it is kept once.
    const seen = new Set(rows.map(row => row.id));
    rows.push(...body.rows.filter(row => !seen.has(row.id)));
    if (!body.more) return rows;
  }
}

/**
 * The rows of each content type `types` names, each read once as it is
 * first needed, and read again after a save changed it. A refused read is
 * kept as its error, so that type's pages are shown and say why.
 */
function useTypeRows(types: readonly string[]) {
  const [rows, setRows] = useState<ReadonlyMap<string, BulkRow[] | Error>>(
    () => new Map()
  );
  const asked = useRef(new Set<string>());
  const read = useCallback(async (type: string) => {
    let answer: BulkRow[] | Error;
    try {
      answer = await readEveryRow(type);
    } catch (error) {
      answer = new Error(apiErrorMessage(error));
    }
    setRows(current => new Map(current).set(type, answer));
  }, []);
  const key = types.join("\u0000");
  useEffect(() => {
    for (const type of key === "" ? [] : key.split("\u0000")) {
      if (asked.current.has(type)) continue;
      asked.current.add(type);
      void read(type);
    }
  }, [key, read]);
  return {
    rows,
    again: (again: readonly string[]) => Promise.all(again.map(read)),
  };
}

/** Sends one step of a save: a content type's pages, or a page built in code. */
async function sendStep(step: SaveStep): Promise<void> {
  if (step.kind === "entries") {
    const body: BulkSaveRequest = { type: step.type, changes: step.changes };
    await writePluginRoute({
      plugin: SEO_PLUGIN_NAME,
      path: BULK_SAVE_PATH,
      body,
    });
    return;
  }
  await writePluginRoute({
    plugin: SEO_PLUGIN_NAME,
    path: CODE_PAGE_SEO_ROUTE_PATH,
    body: step.input,
  });
}

/** Runs every step, each on its own, and says how each went. */
async function runSteps(steps: readonly SaveStep[]): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const step of steps) {
    try {
      await sendStep(step);
      results.push({ step, saved: true });
    } catch (error) {
      results.push({ step, saved: false, message: apiErrorMessage(error) });
    }
  }
  return results;
}

/** One box of a row, with the line under it. */
function Box({
  row,
  field,
  edits,
  locked,
  problems,
  onEdit,
}: {
  row: EditRow;
  field: EditField;
  edits: PageEdits;
  locked: boolean;
  problems: ReturnType<typeof problemsOf>;
  onEdit: (row: EditRow, field: EditField, value: string) => void;
}): JSX.Element {
  const line = boxLine(row, field, edits, problems);
  const label = `${field === "title" ? "Title" : "Description"} for ${row.name}`;
  const lineId = `nx-seo-edit-${field}-${row.path}`;
  const shared = {
    "aria-label": label,
    "aria-describedby": lineId,
    value: boxValue(row, field, edits),
    placeholder:
      (field === "title" ? row.autoTitle : row.autoDescription) ?? "",
    readOnly: locked || !editable(row),
    maxLength: LONGEST_SEO_TEXT,
    onChange: (event: { target: { value: string } }) =>
      onEdit(row, field, event.target.value),
  };
  const changed = boxChanged(row, field, edits);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground md:sr-only" aria-hidden>
        {field === "title" ? "Title in search" : "Description"}
      </span>
      {field === "title" ? (
        <Input
          {...shared}
          className={changed ? "border-foreground" : undefined}
        />
      ) : (
        <Textarea
          {...shared}
          rows={2}
          className={`resize-none ${changed ? "border-foreground" : ""}`}
        />
      )}
      <span
        id={lineId}
        className={`text-xs ${line.tone === "warning" ? "text-warning-text" : "text-muted-foreground"}`}
      >
        {line.text}
      </span>
    </div>
  );
}

/** What a save that stopped part-way says: what was saved, and what was not. */
function PartSaved({ outcome }: { outcome: SaveOutcome }): JSX.Element {
  const notSaved = outcome.failed.reduce(
    (count, each) => count + each.names.length,
    0
  );
  return (
    <Alert variant="destructive">
      <AlertTitle>
        {outcome.saved.length === 0
          ? "Nothing was saved"
          : `${pagesText(outcome.saved.length)} saved, ${pagesText(notSaved)} not`}
      </AlertTitle>
      <AlertDescription>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {outcome.failed.map(each => (
            <li key={each.names.join("\u0000")}>
              {each.names.join(", ")}: {each.message}
            </li>
          ))}
        </ul>
        <p className="mt-2">
          Their changes are kept here. Save again to try them again.
        </p>
      </AlertDescription>
    </Alert>
  );
}

/** The bar of unsaved changes, with their discard and save. */
function ChangesBar({
  pages,
  saving,
  onDiscard,
  onSave,
}: {
  pages: number;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}): JSX.Element | null {
  if (pages === 0) return null;
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-lg border border-border bg-popover py-2.5 pl-4 pr-3 text-sm text-popover-foreground shadow-lg"
    >
      <span>{pagesText(pages)} changed</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={saving}
        onClick={onDiscard}
      >
        Discard
      </Button>
      <Button type="button" size="sm" disabled={saving} onClick={onSave}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

/** The rows, or what stands in their place while there are none to show. */
function EditBody({
  rows,
  failure,
  loading,
  problemsFor,
  edits,
  saving,
  onEdit,
}: {
  rows: readonly EditRow[];
  failure: string | null;
  loading: boolean;
  problemsFor: (row: EditRow) => ReturnType<typeof problemsOf>;
  edits: PageEdits;
  saving: boolean;
  onEdit: (row: EditRow, field: EditField, value: string) => void;
}): JSX.Element {
  if (failure !== null) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{failure}</AlertDescription>
      </Alert>
    );
  }
  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Reading the site&apos;s pages…
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No pages match.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div
        className="hidden border-b border-border text-xs text-muted-foreground md:grid md:grid-cols-[200px_minmax(0,1fr)_minmax(0,1.4fr)]"
        aria-hidden
      >
        <div className="px-3.5 py-2.5">Page</div>
        <div className="px-3 py-2.5">Title in search</div>
        <div className="px-3 py-2.5">Description</div>
      </div>
      <ul className="m-0 list-none p-0" aria-label="Pages">
        {rows.map(row => (
          <li
            key={row.path}
            className={`grid grid-cols-1 gap-2 border-b border-border px-3.5 py-3 last:border-b-0 md:grid-cols-[200px_minmax(0,1fr)_minmax(0,1.4fr)] md:gap-0 md:px-0 md:py-0 ${rowChanged(row, edits) ? "bg-muted/40" : ""}`}
          >
            <div className="flex min-w-0 flex-col gap-0.5 md:px-3.5 md:py-3">
              <span className="font-medium text-foreground">{row.name}</span>
              <span className="break-all font-mono text-xs text-muted-foreground">
                {row.path}
              </span>
            </div>
            {(["title", "description"] as const).map(field => (
              <div key={field} className="md:px-3 md:py-2">
                <Box
                  row={row}
                  field={field}
                  edits={edits}
                  locked={saving}
                  problems={problemsFor(row)}
                  onEdit={onEdit}
                />
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Edit mode, over the pages the filters keep. */
export function PagesEditor({
  shown,
  filters,
  loading,
  failure,
  byPage,
  edits,
  onEdits,
  saving,
  onSaving,
  list,
  onSaved,
}: {
  shown: readonly SiteAddress[];
  filters: ReactNode;
  loading: boolean;
  failure: string | null;
  byPage: ProblemsByPage | undefined;
  edits: PageEdits;
  onEdits: Dispatch<SetStateAction<PageEdits>>;
  /**
   * Whether a save is on its way: kept by the screen, so leaving Edit mode
   * and coming back while it runs still holds the boxes.
   */
  saving: boolean;
  onSaving: (saving: boolean) => void;
  /** The list as last read, which a new read replaces. */
  list: unknown;
  /** Called once a save has run, so the list and the problems are read again. */
  onSaved: () => void;
}): JSX.Element {
  const types = useMemo(() => typesToRead(shown), [shown]);
  const { rows: typeRows, again } = useTypeRows(types);
  const rows = useMemo(() => editRowsOf(shown, typeRows), [shown, typeRows]);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  // A save of pages built in code waiting for the list to be read again.
  const held = useRef<{
    list: unknown;
    paths: string[];
    sent: PageEdits;
  } | null>(null);
  useEffect(() => {
    const waiting = held.current;
    if (waiting === null) return;
    // The list read again, or a read that failed: either way it is let go.
    if (list === waiting.list && failure === null) return;
    held.current = null;
    onEdits(current => editsAfter(current, waiting.paths, waiting.sent));
    onSaving(false);
  }, [list, failure, onEdits, onSaving]);
  const changedPages = rows.filter(row => rowChanged(row, edits)).length;
  const byPath = useMemo(
    () => new Map(shown.map(item => [item.path, item])),
    [shown]
  );

  const edit = (row: EditRow, field: EditField, value: string) => {
    onEdits(current => withEdit(current, row, field, value));
  };

  const save = async () => {
    const steps = saveSteps(rows, edits);
    if (steps.length === 0) return;
    // The edits as the save takes them, so one typed since is kept.
    const sent = edits;
    onSaving(true);
    setOutcome(null);
    const result = saveOutcome(await runSteps(steps), rows);
    // Each type a step saved is read again, for the values and versions the
    // save gave its pages, before its changes are let go.
    const saved = new Set(result.saved);
    await again(
      steps.flatMap(step =>
        step.kind === "entries" && step.paths.some(path => saved.has(path))
          ? [step.type]
          : []
      )
    );
    // A page built in code is read again with the whole list: its edits,
    // and the lock, are held until that read arrives, so a box never shows,
    // or sends, the value the save replaced.
    const code = result.saved.filter(path =>
      steps.some(step => step.kind === "code" && step.paths.includes(path))
    );
    const entries = result.saved.filter(path => !code.includes(path));
    onEdits(current => editsAfter(current, entries, sent));
    if (code.length === 0) onSaving(false);
    else held.current = { list, paths: code, sent };
    onSaved();
    if (result.failed.length === 0) {
      toastMutationResult(`Saved ${pagesText(result.saved.length)}.`, []);
    } else {
      setOutcome(result);
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-20">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {filters}
      </div>
      {outcome === null ? null : <PartSaved outcome={outcome} />}
      <EditBody
        rows={rows}
        failure={failure}
        loading={loading}
        problemsFor={row => {
          const item = byPath.get(row.path);
          return item === undefined || byPage === undefined
            ? []
            : problemsOf(item, byPage);
        }}
        edits={edits}
        saving={saving}
        onEdit={edit}
      />
      <ChangesBar
        pages={changedPages}
        saving={saving}
        onDiscard={() => {
          // The pages shown, as Save saves them: an edit the filters hide stays.
          const shownPaths = rows.map(row => row.path);
          onEdits(current => withoutEdits(current, shownPaths));
          setOutcome(null);
        }}
        onSave={() => void save()}
      />
    </div>
  );
}
