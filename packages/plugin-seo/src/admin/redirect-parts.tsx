/**
 * The parts of the redirects screen's Redirects tab: the add form, the list
 * with its inline edit, and the import's dry run.
 *
 * @module admin/redirect-parts
 */
import { Button } from "@nextlyhq/plugin-sdk/admin";
import { Fragment, type JSX, type ReactNode, type RefObject } from "react";

import type {
  ImportResult,
  ImportRowView,
  RedirectType,
  RedirectView,
} from "../redirects/contract";

import { changedWhen, initialsOf } from "./redirect-format";
import { Icon } from "./styles";

/** A line under the add form: a hint, a warning, or what was done. */
export interface FormMessage {
  kind: "help" | "warn" | "ok";
  text: string;
  /** The redirect already from the typed address, to offer editing it. */
  existing?: string;
}

/**
 * The head of one of the screen's tables: its column names, then an Actions
 * column named for screen readers only, the same in every table.
 */
export function TableHead(props: { labels: readonly string[] }): JSX.Element {
  return (
    <thead>
      <tr>
        {props.labels.map(label => (
          <th key={label}>{label}</th>
        ))}
        <th>
          <span className="nx-seo-vh">Actions</span>
        </th>
      </tr>
    </thead>
  );
}

const TYPE_LABEL: Record<RedirectType, string> = {
  permanent: "Permanent",
  temporary: "Temporary",
};

/** A Permanent or Temporary choice. */
function TypeSelect(props: {
  id: string;
  value: RedirectType;
  onChange: (value: RedirectType) => void;
  label?: string;
}): JSX.Element {
  return (
    <select
      className="nx-seo-in"
      id={props.id}
      aria-label={props.label}
      value={props.value}
      onChange={event => props.onChange(event.target.value as RedirectType)}
    >
      <option value="permanent">Permanent</option>
      <option value="temporary">Temporary</option>
    </select>
  );
}

/** The hint the form shows until something is typed and sent. */
function FormHint(): JSX.Element {
  return (
    <span className="nx-seo-help">
      Use <code>*</code> for the rest of an address: <code>/old/*</code> to{" "}
      <code>/new/*</code>. Permanent tells search engines the page has moved for
      good; choose Temporary only if it&apos;s coming back.
    </span>
  );
}

/** The add form: From, To, type, and the line under it. */
export function AddForm(props: {
  from: string;
  to: string;
  type: RedirectType;
  message: FormMessage | null;
  busy: boolean;
  toRef: RefObject<HTMLInputElement | null>;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onType: (value: RedirectType) => void;
  onAdd: () => void;
  onEditExisting: (id: string) => void;
}): JSX.Element {
  const onEnter = (event: { key: string }) => {
    if (event.key === "Enter") props.onAdd();
  };
  const message = props.message;
  return (
    <div className="nx-seo-addform">
      <div>
        <label htmlFor="nx-seo-redirect-from">From</label>
        <input
          className="nx-seo-in"
          id="nx-seo-redirect-from"
          placeholder="/old-address or /old/*"
          value={props.from}
          onChange={event => props.onFrom(event.target.value)}
          onKeyDown={onEnter}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <span className="nx-seo-arrow">
        <Icon name="arrow" />
      </span>
      <div>
        <label htmlFor="nx-seo-redirect-to">To</label>
        <input
          ref={props.toRef}
          className="nx-seo-in"
          id="nx-seo-redirect-to"
          placeholder="/new-address or /new/*"
          value={props.to}
          onChange={event => props.onTo(event.target.value)}
          onKeyDown={onEnter}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="nx-seo-typefield">
        <label htmlFor="nx-seo-redirect-type">Type</label>
        <TypeSelect
          id="nx-seo-redirect-type"
          value={props.type}
          onChange={props.onType}
        />
      </div>
      <Button
        type="button"
        onClick={props.onAdd}
        disabled={props.busy}
        className="h-9 nx-seo-addbtn"
      >
        <Icon name="plus" /> Add redirect
      </Button>
      <div className="nx-seo-msg" role="status" aria-live="polite">
        {message === null ? (
          <FormHint />
        ) : (
          <span
            className={
              message.kind === "warn"
                ? "nx-seo-warnc"
                : message.kind === "ok"
                  ? "nx-seo-okc"
                  : "nx-seo-help"
            }
          >
            {message.text}
            {message.existing !== undefined && (
              <>
                {" "}
                <button
                  type="button"
                  className="nx-seo-linkbtn"
                  onClick={() => props.onEditExisting(message.existing ?? "")}
                >
                  Edit that redirect
                </button>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * An address, with a place to wrap after each `/`, so a long one breaks
 * between its parts rather than inside a word.
 */
export function Address({ value }: { value: string }): JSX.Element {
  const parts = value.split("/");
  return (
    <span className="nx-seo-addr">
      {parts.map((part, at) => (
        <Fragment key={at}>
          {part}
          {at < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </Fragment>
      ))}
    </span>
  );
}

/** Who added a redirect: a page's own move, or a person. */
function Who({ redirect }: { redirect: RedirectView }): JSX.Element {
  if (redirect.origin === "automatic") {
    return (
      <span className="nx-seo-who">
        <span className="nx-seo-pill">Automatic</span> on rename
      </span>
    );
  }
  const name = redirect.addedBy ?? "Someone";
  return (
    <span className="nx-seo-who">
      <span className="nx-seo-avatar" aria-hidden="true">
        {initialsOf(name)}
      </span>
      {name}
      {redirect.origin === "import" && " · from a file"}
    </span>
  );
}

/** The inline edit of one redirect's To address and type. */
export interface EditState {
  id: string;
  to: string;
  type: RedirectType;
  error: string | null;
}

/** The list of redirects, one of them perhaps being edited. */
export function RedirectTable(props: {
  rows: RedirectView[];
  editing: EditState | null;
  busy: boolean;
  editRef: RefObject<HTMLInputElement | null>;
  onEdit: (row: RedirectView) => void;
  onEditTo: (value: string) => void;
  onEditType: (value: RedirectType) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove: (row: RedirectView) => void;
}): JSX.Element {
  const { editing } = props;
  return (
    <div className="nx-seo-tbox nx-seo-listbox">
      <table className="nx-seo-tbl nx-seo-rtbl">
        <TableHead labels={["From", "To", "Type", "Added by", "Added"]} />
        <tbody>
          {props.rows.map(row =>
            editing?.id === row.id ? (
              <EditRows key={row.id} {...props} row={row} editing={editing} />
            ) : (
              <tr key={row.id}>
                <td className="nx-seo-mono nx-seo-from" data-label="From">
                  <Address value={row.from} />
                </td>
                <td className="nx-seo-mono" data-label="To">
                  <Address value={row.to} />
                </td>
                <td data-label="Type">
                  <span
                    className={
                      row.type === "temporary" ? "nx-seo-pill t" : "nx-seo-pill"
                    }
                  >
                    {TYPE_LABEL[row.type]}
                  </span>
                </td>
                <td data-label="Added by">
                  <Who redirect={row} />
                </td>
                <td className="nx-seo-help nx-seo-nowrap" data-label="Added">
                  {changedWhen(row.addedAt, row.editedAt)}
                </td>
                <td className="nx-seo-rowcell">
                  <div className="nx-seo-rowacts">
                    <button
                      type="button"
                      className="nx-seo-iconbtn"
                      aria-label={`Edit redirect from ${row.from}`}
                      title="Edit"
                      onClick={() => props.onEdit(row)}
                    >
                      <Icon name="pen" />
                    </button>
                    <button
                      type="button"
                      className="nx-seo-iconbtn"
                      aria-label={`Remove redirect from ${row.from}`}
                      title="Remove"
                      disabled={props.busy}
                      onClick={() => props.onRemove(row)}
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

/** A redirect's row while it is edited, and its error under it. */
function EditRows(props: {
  row: RedirectView;
  editing: EditState;
  busy: boolean;
  editRef: RefObject<HTMLInputElement | null>;
  onEditTo: (value: string) => void;
  onEditType: (value: RedirectType) => void;
  onSave: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { row, editing } = props;
  const onKey = (event: { key: string }) => {
    if (event.key === "Enter") props.onSave();
    if (event.key === "Escape") props.onCancel();
  };
  return (
    <>
      <tr className="nx-seo-editrow">
        <td className="nx-seo-mono nx-seo-from" data-label="From">
          <Address value={row.from} />
        </td>
        <td data-label="To">
          <input
            ref={props.editRef}
            className="nx-seo-in"
            aria-label={`New destination for ${row.from}`}
            aria-invalid={editing.error !== null}
            value={editing.to}
            onChange={event => props.onEditTo(event.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
          />
        </td>
        <td data-label="Type">
          <TypeSelect
            id={`nx-seo-edit-type-${row.id}`}
            label={`Type for ${row.from}`}
            value={editing.type}
            onChange={props.onEditType}
          />
        </td>
        <td data-label="Added by">
          <Who redirect={row} />
        </td>
        <td className="nx-seo-help nx-seo-nowrap" data-label="Added">
          {changedWhen(row.addedAt, row.editedAt)}
        </td>
        <td className="nx-seo-rowcell">
          <div className="nx-seo-rowacts nx-seo-editacts">
            <Button
              type="button"
              size="sm"
              onClick={props.onSave}
              disabled={props.busy}
            >
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={props.onCancel}
            >
              Cancel
            </Button>
          </div>
        </td>
      </tr>
      {editing.error !== null && (
        <tr className="nx-seo-editrow">
          <td aria-hidden="true" />
          <td colSpan={5} className="nx-seo-wide">
            <p className="nx-seo-rowerr" role="alert">
              <Icon name="warn" /> {editing.error}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

const RESULT_ICON: Record<ImportRowView["kind"], ReactNode> = {
  new: <Icon name="plus" />,
  joined: <Icon name="warn" />,
  replaced: <Icon name="warn" />,
  same: <Icon name="check" />,
  refused: <Icon name="x" />,
};

const RESULT_CLASS: Record<ImportRowView["kind"], string> = {
  new: "new",
  joined: "warn",
  replaced: "warn",
  same: "same",
  refused: "bad",
};

/** What the file's rows add up to, as one line. */
function importSummary(rows: ImportRowView[]): ReactNode[] {
  const count = (...kinds: ImportRowView["kind"][]) =>
    rows.filter(row => kinds.includes(row.kind)).length;
  const refused = rows.filter(row => row.kind === "refused");
  const loops = refused.every(row => row.refusal === "loop");
  const parts: ReactNode[] = [];
  if (count("new") > 0) parts.push(`${count("new")} new`);
  if (count("joined", "replaced") > 0) {
    parts.push(
      <span key="w" className="nx-seo-warnc nx-seo-inline">
        {count("joined", "replaced")} joined or replaced
      </span>
    );
  }
  if (count("same") > 0) parts.push(`${count("same")} already there`);
  if (refused.length > 0) {
    parts.push(
      <span key="b" className="nx-seo-dangerc">
        {refused.length} {loops ? "with a loop" : "that can't be imported"}
      </span>
    );
  }
  return parts.flatMap((part, at) => (at === 0 ? [part] : [", ", part]));
}

/** The dry run of an uploaded file, and its import. */
export function ImportBox(props: {
  name: string;
  result: ImportResult;
  busy: boolean;
  onFixed: () => void;
  onCancel: () => void;
  onImport: () => void;
}): JSX.Element {
  const { rows } = props.result;
  const refused = rows.filter(row => row.kind === "refused");
  const loops = refused.every(row => row.refusal === "loop");
  const adds = rows.filter(
    row => row.kind !== "same" && row.kind !== "refused"
  ).length;
  return (
    <div
      className="nx-seo-impbox"
      role="region"
      aria-label={`Import ${props.name}`}
    >
      <div className="nx-seo-imp-h">
        <div>
          <b>Import {props.name} · dry run</b>
          <p className="nx-seo-help">
            {rows.length} row{rows.length === 1 ? "" : "s"} read. Nothing has
            changed yet. A file is applied in full or not at all.
          </p>
        </div>
        <button
          type="button"
          className="nx-seo-iconbtn"
          aria-label="Close import"
          onClick={props.onCancel}
        >
          <Icon name="x" />
        </button>
      </div>
      <table className="nx-seo-tbl nx-seo-rtbl">
        <thead>
          <tr>
            <th>From</th>
            <th>To</th>
            <th>What happens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={row.line}
              className={row.kind === "refused" ? "nx-seo-badrow" : undefined}
            >
              <td className="nx-seo-mono nx-seo-from" data-label="From">
                <Address value={row.from} />
              </td>
              <td className="nx-seo-mono" data-label="To">
                <Address value={row.to} />
              </td>
              <td className="nx-seo-wide" data-label="What happens">
                <span className={`nx-seo-res ${RESULT_CLASS[row.kind]}`}>
                  {RESULT_ICON[row.kind]} <span>{row.says}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="nx-seo-imp-h foot">
        <span className="nx-seo-help">
          {importSummary(rows)}.
          {refused.length > 0 && (
            <>
              {" "}
              <b className="nx-seo-strong">
                Fix the {refused.length} row{refused.length === 1 ? "" : "s"}{" "}
                {loops ? "with a loop" : "that can't be imported"} and upload
                again.
              </b>{" "}
              Nothing in this file is imported until then.
            </>
          )}
        </span>
        <div className="nx-seo-imp-acts">
          {refused.length > 0 && (
            <Button type="button" variant="outline" onClick={props.onFixed}>
              <Icon name="upload" /> Upload the fixed file
            </Button>
          )}
          <Button type="button" variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={props.onImport}
            disabled={props.busy || refused.length > 0 || adds === 0}
            title={
              refused.length > 0
                ? "Fix the rows with a problem first"
                : undefined
            }
          >
            Import {adds} redirect{adds === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </div>
  );
}
