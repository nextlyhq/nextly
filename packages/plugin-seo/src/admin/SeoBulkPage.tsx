/**
 * The bulk edit screen: the titles and descriptions of every page of one
 * content type in one table, each cell a text box showing the automatic
 * value in grey until something is typed, saved together in one step; and
 * beside it the import of SEO values from where a site keeps them today.
 *
 * Everything the person chooses or types is kept in the screen's own state
 * and never in the address: the admin mounts a plugin's page again when its
 * address changes, which would throw away unsaved edits.
 *
 * @module admin/SeoBulkPage
 */
import {
  apiErrorMessage,
  Button,
  readPluginRoute,
  toastMutationResult,
  usePluginRoute,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from "react";

import {
  BULK_ROWS_PATH,
  BULK_SAVE_LIMIT,
  BULK_SAVE_PATH,
  BULK_TYPES_PATH,
  type BulkRow,
  type BulkRowsBody,
  type BulkSaveBody,
  type BulkSaveRequest,
  type BulkType,
  type BulkTypesBody,
} from "../bulk/contract";
import { SEO_PLUGIN_NAME } from "../settings/contract";

import { ImportPanel } from "./bulk-import";
import { BulkStyles } from "./bulk-styles";
import {
  cellMeta,
  cellValue,
  changeCount,
  changed,
  changesOf,
  editKey,
  shownRows,
  type BulkEdits,
  type BulkField,
  type BulkFilter,
} from "./bulk-view";
import { ROOT, SeoStyles } from "./styles";

/** The filters the table offers, and their names. */
const FILTERS: readonly [BulkFilter, string][] = [
  ["all", "All"],
  ["typed", "Typed"],
  ["auto", "Automatic only"],
];

/** A type's pages as read so far, page by page. */
interface Loaded {
  rows: BulkRow[];
  total: number;
  more: boolean;
  /** How many pages of rows have been read. */
  pages: number;
}

/** One page of a type's rows. */
function readRows(slug: string, page: number) {
  return readPluginRoute<BulkRowsBody>({
    plugin: SEO_PLUGIN_NAME,
    path: `${BULK_ROWS_PATH}?type=${encodeURIComponent(slug)}&page=${page}`,
  });
}

/**
 * Each type's rows, read a page at a time and kept per type, so moving to
 * another type and back shows the same rows (and every edit made on them).
 * Only the latest read is taken: one that answers after another was asked
 * is dropped. Reading again reads every page read so far.
 */
function useRows(type: string | undefined) {
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const latest = useRef(0);

  const read = useCallback(
    async (slug: string, pages: number, keep: readonly BulkRow[]) => {
      const asked = ++latest.current;
      setReading(true);
      setError(null);
      try {
        const rows = [...keep];
        let body: BulkRowsBody | undefined;
        const first = keep.length === 0 ? 1 : pages;
        for (let page = first; page <= pages; page++) {
          body = await readRows(slug, page);
          if (body === undefined || asked !== latest.current) return;
          rows.push(...body.rows);
        }
        if (body === undefined) return;
        const answer = body;
        setLoaded(current => ({
          ...current,
          [slug]: { rows, total: answer.total, more: answer.more, pages },
        }));
      } catch (failure) {
        if (asked === latest.current) setError(apiErrorMessage(failure));
      } finally {
        if (asked === latest.current) setReading(false);
      }
    },
    []
  );

  const known = type === undefined ? undefined : loaded[type];
  useEffect(() => {
    if (type !== undefined && known === undefined) void read(type, 1, []);
  }, [type, known, read]);

  return {
    loaded: known ?? null,
    error,
    reading,
    more: () => {
      if (type !== undefined && known !== undefined) {
        void read(type, known.pages + 1, known.rows);
      }
    },
    // Every page read so far, read again from the first.
    again: (slug: string | undefined = type) => {
      if (slug !== undefined) void read(slug, loaded[slug]?.pages ?? 1, []);
    },
  };
}

/**
 * Every cell of a row grows to its tallest text, the grey automatic value
 * included, so the counts under the text never sit on top of words.
 */
function useFittedRows(
  table: RefObject<HTMLTableElement | null>,
  shown: readonly BulkRow[],
  edits: BulkEdits
) {
  useLayoutEffect(() => {
    const element = table.current;
    if (element === null) return;
    const fit = () => {
      for (const row of element.querySelectorAll("tbody tr")) {
        const boxes = [...row.querySelectorAll("textarea")];
        if (boxes.length === 0) continue;
        for (const box of boxes) box.style.height = "auto";
        const tallest = Math.max(
          64,
          ...boxes.map(box =>
            Math.max(box.scrollHeight, placeholderHeight(box))
          )
        );
        for (const box of boxes) box.style.height = `${tallest}px`;
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [table, shown, edits]);
}

/** The height a text box's grey placeholder needs, which it does not report. */
function placeholderHeight(box: HTMLTextAreaElement): number {
  if (box.value !== "" || box.placeholder === "") return 0;
  const copy = box.cloneNode(false) as HTMLTextAreaElement;
  copy.removeAttribute("id");
  copy.removeAttribute("aria-label");
  copy.value = box.placeholder;
  Object.assign(copy.style, {
    position: "absolute",
    visibility: "hidden",
    left: "-9999px",
    top: "0",
    height: "auto",
    width: `${box.offsetWidth}px`,
  });
  box.parentNode?.appendChild(copy);
  const height = copy.scrollHeight;
  copy.remove();
  return height;
}

/** One cell: the text box, and what it says under the text. */
function Cell({
  row,
  field,
  edits,
  locked,
  onEdit,
}: {
  row: BulkRow;
  field: BulkField;
  edits: BulkEdits;
  /** While a save runs, nothing more is typed. */
  locked: boolean;
  onEdit: (row: BulkRow, field: BulkField, value: string) => void;
}): JSX.Element {
  const meta = cellMeta(row, field, edits);
  const automatic =
    (field === "title" ? row.autoTitle : row.autoDescription) ?? "";
  const name = field === "title" ? "Title on Google" : "Description on Google";
  return (
    <div
      className={`nx-seo-cell${changed(row, field, edits) ? " changed" : ""}`}
    >
      <textarea
        rows={2}
        aria-label={`${name} for ${row.label}`}
        placeholder={automatic}
        value={cellValue(row, field, edits)}
        readOnly={!row.editable || locked}
        title={
          row.editable ? undefined : "You can't change this page's SEO here."
        }
        onChange={event => onEdit(row, field, event.target.value)}
      />
      <span className="nx-seo-cm">
        <span>{meta.typed ? "Typed" : "Automatic"}</span>
        <span
          className={meta.over ? "over" : undefined}
          title={
            meta.over ? "Longer than Google shows, which cuts it" : undefined
          }
        >
          {meta.length} / {meta.limit}
          {meta.over ? (
            <span className="nx-seo-vh">, longer than Google shows</span>
          ) : null}
        </span>
      </span>
    </div>
  );
}

/** The table's bar of filters: the type, which rows, and how many. */
function Toolbar({
  types,
  type,
  filter,
  shown,
  onType,
  onFilter,
}: {
  types: readonly BulkType[];
  type: BulkType | undefined;
  filter: BulkFilter;
  shown: number;
  onType: (slug: string) => void;
  onFilter: (filter: BulkFilter) => void;
}): JSX.Element {
  return (
    <div className="nx-seo-bulkbar">
      <label className="nx-seo-help" htmlFor="nx-seo-bulk-type">
        Content type
      </label>
      <select
        id="nx-seo-bulk-type"
        className="nx-seo-select"
        value={type?.slug ?? ""}
        onChange={event => onType(event.target.value)}
      >
        {types.map(each => (
          <option key={each.slug} value={each.slug}>
            {each.label} ({each.total})
          </option>
        ))}
      </select>
      <span className="nx-seo-help">Show</span>
      <div className="nx-seo-seg" role="group" aria-label="Show">
        {FILTERS.map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={filter === value}
            onClick={() => onFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {type !== undefined ? (
        <span className="nx-seo-help nx-seo-bulkcount">
          Showing {shown} of {type.total}
          {type.titlePattern !== undefined ? (
            <>
              {" "}
              · grey text is automatic, from <code>{type.titlePattern}</code>
            </>
          ) : (
            " · grey text is automatic"
          )}
        </span>
      ) : null}
    </div>
  );
}

/** The bar of unsaved changes, with their discard and save. */
function ChangesBar({
  count,
  pages,
  busy,
  onDiscard,
  onSave,
}: {
  count: number;
  /** How many pages the changes are on. */
  pages: number;
  busy: boolean;
  onDiscard: () => void;
  onSave: () => void;
}): JSX.Element | null {
  if (count === 0) return null;
  const tooMany = pages > BULK_SAVE_LIMIT;
  return (
    <div className="nx-seo-changes" role="status">
      <b>
        {count} {count === 1 ? "change" : "changes"}
      </b>
      <span className="nx-seo-grow nx-seo-help">
        {tooMany
          ? `Not saved yet. One save takes up to ${BULK_SAVE_LIMIT} pages; discard some first.`
          : "Not saved yet."}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="nx-seo-sbtn"
        disabled={busy}
        onClick={onDiscard}
      >
        Discard
      </Button>
      <Button
        type="button"
        size="sm"
        className="nx-seo-sbtn"
        disabled={busy || tooMany}
        onClick={onSave}
      >
        Save all
      </Button>
    </div>
  );
}

/**
 * The edits typed into one type's rows, kept per type so moving to another
 * type and back keeps them, each page's version as it was when first edited,
 * and their save in one step. A save takes only what it sends out of the
 * edits, so anything typed while it runs stays.
 */
function useBulkEdits(
  type: string | undefined,
  rows: readonly BulkRow[],
  onSaved: (type: string) => void
) {
  const [edits, setEdits] = useState<Record<string, BulkEdits>>({});
  const [revs, setRevs] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const typeEdits = (type === undefined ? undefined : edits[type]) ?? {};
  const typeRevs = (type === undefined ? undefined : revs[type]) ?? {};
  const changes = changesOf(rows, typeEdits, typeRevs);

  /** Drop `ids`' edits and versions in `slug`, or every one. */
  const forget = (slug: string, ids?: ReadonlySet<string>) => {
    const keep = <T,>(record: Record<string, T> | undefined) =>
      ids === undefined
        ? {}
        : Object.fromEntries(
            Object.entries(record ?? {}).filter(
              ([key]) => !ids.has(key.split(":")[0] ?? key)
            )
          );
    setEdits(current => ({ ...current, [slug]: keep(current[slug]) }));
    setRevs(current => ({ ...current, [slug]: keep(current[slug]) }));
  };

  const edit = (row: BulkRow, field: BulkField, value: string) => {
    if (type === undefined) return;
    setEdits(current => ({
      ...current,
      [type]: { ...current[type], [editKey(row.id, field)]: value },
    }));
    if (row.rev !== undefined && typeRevs[row.id] === undefined) {
      const rev = row.rev;
      setRevs(current => ({
        ...current,
        [type]: { ...current[type], [row.id]: rev },
      }));
    }
  };

  const save = async () => {
    if (type === undefined || changes.length > BULK_SAVE_LIMIT) return;
    const request: BulkSaveRequest = { type, changes };
    setBusy(true);
    setFailed(null);
    try {
      const answer = await writePluginRoute<BulkSaveBody & { message: string }>(
        { plugin: SEO_PLUGIN_NAME, path: BULK_SAVE_PATH, body: request }
      );
      if (answer === undefined) return;
      toastMutationResult(answer.message, []);
      forget(type, new Set(changes.map(change => change.id)));
      onSaved(type);
    } catch (error) {
      setFailed(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return {
    edits: typeEdits,
    edit,
    changes,
    clear: () => {
      if (type !== undefined) forget(type);
    },
    save,
    busy,
    failed,
    dismiss: () => setFailed(null),
  };
}

/** What the table says in place of rows, when it has none to show. */
function emptyText(type: BulkType, loaded: boolean, total: number): string {
  if (!loaded) return "Reading the pages…";
  return total === 0
    ? `There are no ${type.label} yet.`
    : `No ${type.label} match this filter.`;
}

/** The table of one type's pages, its cells text boxes. */
function Sheet({
  type,
  shown,
  edits,
  rows,
  locked,
  onEdit,
}: {
  type: BulkType;
  shown: readonly BulkRow[];
  edits: BulkEdits;
  rows: ReturnType<typeof useRows>;
  locked: boolean;
  onEdit: (row: BulkRow, field: BulkField, value: string) => void;
}): JSX.Element {
  const table = useRef<HTMLTableElement | null>(null);
  useFittedRows(table, shown, edits);
  return (
    <div className="nx-seo-tbox">
      <table className="nx-seo-sheet" ref={table}>
        <colgroup>
          <col className="nx-seo-colpage" />
          <col className="nx-seo-coltitle" />
          <col className="nx-seo-coldesc" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{type.singular}</th>
            <th scope="col">Title on Google</th>
            <th scope="col">Description on Google</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(row => (
            <tr key={row.id}>
              <td className="nx-seo-pg">
                <b>{row.label}</b>
                {row.path !== undefined ? (
                  <span className="nx-seo-mono">{row.path}</span>
                ) : null}
              </td>
              <td data-label="Title on Google">
                <Cell
                  row={row}
                  field="title"
                  edits={edits}
                  locked={locked}
                  onEdit={onEdit}
                />
              </td>
              <td data-label="Description on Google">
                <Cell
                  row={row}
                  field="description"
                  edits={edits}
                  locked={locked}
                  onEdit={onEdit}
                />
              </td>
            </tr>
          ))}
          {shown.length === 0 ? (
            <tr>
              <td colSpan={3} className="nx-seo-pg nx-seo-help">
                {emptyText(
                  type,
                  rows.loaded !== null,
                  rows.loaded?.rows.length ?? 0
                )}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {rows.loaded?.more === true ? (
        <div className="nx-seo-more">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="nx-seo-sbtn"
            disabled={rows.reading}
            onClick={rows.more}
          >
            Show more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** What the screen says above the table: a refusal, and a type's drafts. */
function Notices({
  failure,
  type,
  onReadAgain,
}: {
  failure: string | null;
  type: BulkType | undefined;
  /** Where a save was refused: discard the edits and read the table again. */
  onReadAgain?: () => void;
}): JSX.Element {
  return (
    <>
      {failure !== null ? (
        <div className="nx-seo-error nx-seo-refused" role="alert">
          <span>{failure}</span>
          {onReadAgain === undefined ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="nx-seo-sbtn"
              onClick={onReadAgain}
            >
              Discard changes and read again
            </Button>
          )}
        </div>
      ) : null}
      {type?.drafts === true ? (
        <p className="nx-seo-note">
          {type.label} keep drafts, so their SEO is changed on each page, where
          its draft is. They are shown here to read.
        </p>
      ) : null}
    </>
  );
}

/** What the screen says where there is no type to show. */
function noTypeText(pending: boolean): string {
  return pending
    ? "Reading the content types…"
    : "No content type has SEO you can read.";
}

/** The first of the screen's refusals, if any. */
function failureOf(...errors: (string | Error | null)[]): string | null {
  const first = errors.find(error => error !== null) ?? null;
  return first === null || typeof first === "string"
    ? first
    : apiErrorMessage(first);
}

/** The bulk edit screen, as the admin mounts it. */
export function SeoBulkPage(): JSX.Element {
  const read = usePluginRoute<BulkTypesBody>({
    plugin: SEO_PLUGIN_NAME,
    path: BULK_TYPES_PATH,
    staleTime: 0,
  });
  const types = read.data?.types ?? [];
  const [chosen, setChosen] = useState<string | undefined>();
  const type = types.find(each => each.slug === chosen) ?? types[0];
  const rows = useRows(type?.slug);
  const [filter, setFilter] = useState<BulkFilter>("all");
  const loaded = rows.loaded?.rows ?? [];
  const editing = useBulkEdits(type?.slug, loaded, rows.again);
  const shown = useMemo(() => shownRows(loaded, filter), [loaded, filter]);
  const failure = failureOf(editing.failed, rows.error, read.error);
  return (
    <div className={`${ROOT} nx-seo-page`}>
      <SeoStyles />
      <BulkStyles />
      <div className="nx-seo-head nx-seo-phead">
        <div>
          <h1>Bulk edit</h1>
          <p>
            Titles and descriptions for every page of one type. Every change is
            saved in one step, or none of them is.
          </p>
        </div>
      </div>
      <div className="nx-seo-bulkwrap">
        <div className="nx-seo-bulkmain">
          {types.length > 0 ? (
            <Toolbar
              types={types}
              type={type}
              filter={filter}
              shown={shown.length}
              onType={setChosen}
              onFilter={setFilter}
            />
          ) : null}
          <Notices
            failure={failure}
            type={type}
            {...(editing.failed === null
              ? {}
              : {
                  onReadAgain: () => {
                    editing.clear();
                    editing.dismiss();
                    rows.again();
                  },
                })}
          />
          <ChangesBar
            count={changeCount(loaded, editing.edits)}
            pages={editing.changes.length}
            busy={editing.busy}
            onDiscard={editing.clear}
            onSave={() => void editing.save()}
          />
          {type === undefined ? (
            <p className="nx-seo-state">{noTypeText(read.pending)}</p>
          ) : (
            <Sheet
              type={type}
              shown={shown}
              edits={editing.edits}
              rows={rows}
              locked={editing.busy}
              onEdit={editing.edit}
            />
          )}
        </div>
        <aside className="nx-seo-bulkside" aria-label="Import">
          <ImportPanel
            onImported={() => {
              rows.again();
              read.refetch();
            }}
          />
        </aside>
      </div>
    </div>
  );
}
