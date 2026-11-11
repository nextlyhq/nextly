/**
 * The redirects screen: every redirect, with a form to add one by hand or by
 * pattern and edit or remove any, a CSV import that shows what it would do
 * before it changes anything, and the addresses people asked for that were
 * not found, each one click from a redirect to the closest live page.
 *
 * @module admin/SeoRedirectsPage
 */
import {
  apiErrorMessage,
  Button,
  toastMutationResult,
  usePluginRoute,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";

import {
  REDIRECT_ROUTES,
  type ImportResult,
  type NotFoundView,
  type RedirectType,
  type RedirectView,
} from "../redirects/contract";
import { SEO_PLUGIN_NAME } from "../settings/contract";

import { lastSeenWhen } from "./redirect-format";
import {
  AddForm,
  Address,
  ImportBox,
  RedirectTable,
  TableHead,
  type EditState,
  type FormMessage,
} from "./redirect-parts";
import { RedirectStyles } from "./redirect-styles";
import { Icon, ROOT, SeoStyles } from "./styles";

type Tab = "list" | "notfound";

interface ListBody<T> {
  items: T[];
}

interface Written<T> {
  message: string;
  item: T;
}

/** A write to one of the screen's routes. */
function write<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
) {
  return writePluginRoute<Written<T>>({
    plugin: SEO_PLUGIN_NAME,
    path,
    method,
    ...(body === undefined ? {} : { body }),
  });
}

/** A chosen file's text, read the way every browser can. */
function textOf(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () =>
      reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsText(file);
  });
}

/** The tab the address names, so a link can land on the Not found tab. */
function tabInAddress(): Tab {
  if (typeof window === "undefined") return "list";
  return new URLSearchParams(window.location.search).get("tab") === "notfound"
    ? "notfound"
    : "list";
}

/**
 * The screen's busy flag and the one way it runs a write: busy while it runs,
 * with a refusal's words handed to `onRefused` rather than thrown.
 */
function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (
    work: () => Promise<void>,
    onRefused: (text: string) => void
  ) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      onRefused(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/**
 * The line under the add form for a refused add: where the typed address
 * already has a redirect, it offers to edit that one.
 */
function refusalOf(
  text: string,
  from: string,
  rows: readonly RedirectView[]
): FormMessage {
  const existing = rows.find(row => row.from === from.trim());
  return existing !== undefined && text.includes("already has a redirect")
    ? { kind: "warn", text, existing: existing.id }
    : { kind: "warn", text };
}

/** The hint under the add form once an address not found fills it. */
function suggestionNote(suggestion: string | null): FormMessage {
  return {
    kind: "help",
    text:
      suggestion === null
        ? "No live page looks close. Fill in where it should go."
        : `Suggested: ${suggestion}, the closest live page. Change it if it's wrong.`,
  };
}

/** The panel's content once both lists are read, or why they are not. */
function Loaded(props: {
  failed: unknown;
  pending: boolean;
  children: ReactNode;
}): JSX.Element {
  if (props.failed) {
    return (
      <p className="nx-seo-alert" role="alert">
        The redirects could not be read. {apiErrorMessage(props.failed)}
      </p>
    );
  }
  if (props.pending) {
    return (
      <p className="nx-seo-state" role="status">
        Loading the redirects…
      </p>
    );
  }
  return <>{props.children}</>;
}

/** The Redirects and Not found tabs, each with its count. */
function RedirectTabs(props: {
  tab: Tab;
  redirects: number;
  missing: number;
  onTab: (tab: Tab) => void;
}): JSX.Element {
  return (
    <div className="nx-seo-tabs" role="tablist" aria-label="Redirects">
      <button
        type="button"
        role="tab"
        className="nx-seo-tab"
        id="nx-seo-redirects-tab-list"
        aria-selected={props.tab === "list"}
        aria-controls="nx-seo-redirects-panel"
        onClick={() => props.onTab("list")}
      >
        Redirects <span className="nx-seo-cnt n">{props.redirects}</span>
      </button>
      <button
        type="button"
        role="tab"
        className="nx-seo-tab"
        id="nx-seo-redirects-tab-notfound"
        aria-selected={props.tab === "notfound"}
        aria-controls="nx-seo-redirects-panel"
        onClick={() => props.onTab("notfound")}
      >
        Not found{" "}
        <span className={props.missing > 0 ? "nx-seo-cnt" : "nx-seo-cnt n"}>
          {props.missing}
        </span>
      </button>
    </div>
  );
}

/** The page's title, its line, and Import CSV with its hidden file input. */
function PageHead(props: {
  busy: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
}): JSX.Element {
  return (
    <div className="nx-seo-head">
      <div>
        <h1>Redirects</h1>
        <p>
          Send an old address to a new one. Renaming a published page adds one
          by itself.
        </p>
      </div>
      <div className="nx-seo-acts">
        <Button
          type="button"
          variant="outline"
          onClick={() => props.fileRef.current?.click()}
          disabled={props.busy}
        >
          <Icon name="upload" /> Import CSV
        </Button>
        <input
          ref={props.fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={event => {
            const file = event.target.files?.[0];
            // Emptied so choosing the same file again reads it again.
            event.target.value = "";
            if (file !== undefined) props.onFile(file);
          }}
        />
      </div>
    </div>
  );
}

interface Imported {
  name: string;
  file: string;
  result: ImportResult;
}

type Run = ReturnType<typeof useBusy>["run"];

/**
 * The add form and the inline edit: what is typed in each, the line under
 * the form, and the writes that add, save and remove a redirect.
 */
function useRedirectForm(
  rows: readonly RedirectView[],
  run: Run,
  reread: () => void
) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState<RedirectType>("permanent");
  const [message, setMessage] = useState<FormMessage | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const toRef = useRef<HTMLInputElement | null>(null);
  const editRef = useRef<HTMLInputElement | null>(null);
  const [focusTo, setFocusTo] = useState(0);

  useEffect(() => {
    if (focusTo > 0) toRef.current?.focus();
  }, [focusTo]);
  useEffect(() => {
    editRef.current?.focus();
    editRef.current?.select();
  }, [editing?.id]);

  const warn = (text: string) => setMessage({ kind: "warn", text });

  const add = () =>
    run(
      async () => {
        const answer = await write<RedirectView>(REDIRECT_ROUTES.list, "POST", {
          from,
          to,
          type,
        });
        setMessage({ kind: "ok", text: answer?.message ?? "Added." });
        setFrom("");
        setTo("");
        reread();
      },
      text => setMessage(refusalOf(text, from, rows))
    );

  const startEdit = (row: RedirectView) => {
    setEditing({ id: row.id, to: row.to, type: row.type, error: null });
    setMessage(null);
  };

  const save = (current: EditState) =>
    run(
      async () => {
        const answer = await write<RedirectView>(
          `${REDIRECT_ROUTES.list}/${current.id}`,
          "PATCH",
          { to: current.to, type: current.type }
        );
        setEditing(null);
        setMessage({ kind: "ok", text: answer?.message ?? "Saved." });
        reread();
      },
      text => setEditing({ ...current, error: text })
    );

  const remove = (row: RedirectView) =>
    run(async () => {
      const answer = await write<RedirectView>(
        `${REDIRECT_ROUTES.list}/${row.id}`,
        "DELETE"
      );
      setEditing(current => (current?.id === row.id ? null : current));
      toastMutationResult(
        answer?.message ?? `Removed the redirect from ${row.from}`,
        undefined
      );
      reread();
    }, warn);

  /** Fills the form from an address not found, its To the suggestion. */
  const fillFrom = (row: NotFoundView) => {
    setEditing(null);
    setFrom(row.path);
    setTo(row.suggestion ?? "");
    setMessage(suggestionNote(row.suggestion));
    setFocusTo(count => count + 1);
  };

  return {
    from,
    to,
    type,
    message,
    editing,
    toRef,
    editRef,
    setFrom,
    setTo,
    setType,
    setEditing,
    warn,
    add,
    startEdit,
    save,
    remove,
    fillFrom,
  };
}

type RedirectForm = ReturnType<typeof useRedirectForm>;

/**
 * A chosen CSV file: its dry run, read on choosing it, and the import of the
 * same text, which shows the rows again where one is refused by then.
 */
function useImportFile(
  run: Run,
  onRefused: (text: string) => void,
  onRead: () => void,
  reread: () => void
) {
  const [imported, setImported] = useState<Imported | null>(null);

  const readFile = (file: File) =>
    run(async () => {
      const text = await textOf(file);
      const answer = await write<ImportResult>(REDIRECT_ROUTES.import, "POST", {
        file: text,
      });
      if (answer === undefined) return;
      onRead();
      setImported({ name: file.name, file: text, result: answer.item });
    }, onRefused);

  const importFile = (current: Imported) =>
    run(async () => {
      const answer = await write<ImportResult>(REDIRECT_ROUTES.import, "POST", {
        file: current.file,
        apply: true,
      });
      if (answer === undefined) return;
      if (!answer.item.applied) {
        // A row refused since the dry run: show the file's rows as they are now.
        setImported({ ...current, result: answer.item });
        return;
      }
      setImported(null);
      toastMutationResult(answer.message, undefined);
      reread();
    }, onRefused);

  return { imported, readFile, importFile, cancel: () => setImported(null) };
}

type ImportFlow = ReturnType<typeof useImportFile>;

/** The Redirects tab: a file's dry run, the add form, and the list. */
function ListTab(props: {
  rows: RedirectView[];
  form: RedirectForm;
  importer: ImportFlow;
  busy: boolean;
  onChooseFile: () => void;
}): JSX.Element {
  const { form, importer, rows, busy } = props;
  const { imported } = importer;
  return (
    <>
      {imported !== null && (
        <ImportBox
          name={imported.name}
          result={imported.result}
          busy={busy}
          onFixed={props.onChooseFile}
          onCancel={importer.cancel}
          onImport={() => void importer.importFile(imported)}
        />
      )}
      <AddForm
        from={form.from}
        to={form.to}
        type={form.type}
        message={form.message}
        busy={busy}
        toRef={form.toRef}
        onFrom={form.setFrom}
        onTo={form.setTo}
        onType={form.setType}
        onAdd={() => void form.add()}
        onEditExisting={id => {
          const row = rows.find(each => each.id === id);
          if (row !== undefined) form.startEdit(row);
        }}
      />
      {rows.length > 0 && (
        <RedirectTable
          rows={rows}
          editing={form.editing}
          busy={busy}
          editRef={form.editRef}
          onEdit={form.startEdit}
          onEditTo={value =>
            form.setEditing(
              current => current && { ...current, to: value, error: null }
            )
          }
          onEditType={value =>
            form.setEditing(current => current && { ...current, type: value })
          }
          onSave={() => form.editing !== null && void form.save(form.editing)}
          onCancel={() => form.setEditing(null)}
          onRemove={row => void form.remove(row)}
        />
      )}
    </>
  );
}

/** The redirects screen, as the admin mounts it. */
export function SeoRedirectsPage(): JSX.Element {
  const redirects = usePluginRoute<ListBody<RedirectView>>({
    plugin: SEO_PLUGIN_NAME,
    path: REDIRECT_ROUTES.list,
    staleTime: 0,
  });
  const notFound = usePluginRoute<ListBody<NotFoundView>>({
    plugin: SEO_PLUGIN_NAME,
    path: REDIRECT_ROUTES.notFound,
    staleTime: 0,
  });
  // The address is read once, so a link can open the Not found tab, and never
  // written: the admin remounts a page whose address changes, which would
  // throw away a half-filled form or a file's dry run.
  const [tab, setTab] = useState<Tab>(tabInAddress);
  const { busy, run } = useBusy();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const rows = redirects.data?.items ?? [];
  const missing = notFound.data?.items ?? [];
  const reread = () => {
    redirects.refetch();
    notFound.refetch();
  };
  const form = useRedirectForm(rows, run, reread);
  const importer = useImportFile(run, form.warn, () => setTab("list"), reread);
  const chooseFile = () => fileRef.current?.click();

  return (
    <div className={`${ROOT} nx-seo-page`}>
      <SeoStyles />
      <RedirectStyles />
      <PageHead
        busy={busy}
        fileRef={fileRef}
        onFile={file => void importer.readFile(file)}
      />
      <RedirectTabs
        tab={tab}
        redirects={rows.length}
        missing={missing.length}
        onTab={setTab}
      />
      <div
        className="nx-seo-body"
        role="tabpanel"
        id="nx-seo-redirects-panel"
        aria-labelledby={`nx-seo-redirects-tab-${tab}`}
      >
        <Loaded
          failed={redirects.error ?? notFound.error}
          pending={redirects.pending || notFound.pending}
        >
          {tab === "list" ? (
            <ListTab
              rows={rows}
              form={form}
              importer={importer}
              busy={busy}
              onChooseFile={chooseFile}
            />
          ) : (
            <NotFoundList
              rows={missing}
              onRedirect={row => {
                setTab("list");
                form.fillFrom(row);
              }}
            />
          )}
        </Loaded>
      </div>
    </div>
  );
}

/** The addresses not found, most visited first, each one click from a redirect. */
function NotFoundList(props: {
  rows: NotFoundView[];
  onRedirect: (row: NotFoundView) => void;
}): JSX.Element {
  const host =
    typeof window === "undefined" ? "this site" : window.location.host;
  const most = Math.max(1, ...props.rows.map(row => row.hits));
  return (
    <>
      <p className="nx-seo-help nx-seo-nflead">
        Addresses on {host} that people or search engines asked for and that
        don&apos;t exist, grouped by address, most visited first. Admin, API and
        file requests are left out, and only recent and frequent addresses are
        kept.
      </p>
      {props.rows.length === 0 ? (
        <div className="nx-seo-tbox nx-seo-empty">
          <b>No addresses not found yet</b>
          <p className="nx-seo-help">
            New ones appear here, most visited first, as people or search
            engines ask for them.
          </p>
        </div>
      ) : (
        <div className="nx-seo-tbox">
          <table className="nx-seo-tbl nx-seo-rtbl">
            <TableHead labels={["Address asked for", "Visits", "Last seen"]} />
            <tbody>
              {props.rows.map(row => (
                <tr key={row.id}>
                  <td className="nx-seo-mono" data-label="Address asked for">
                    <Address value={row.path} />
                    {row.kind === "moved" && (
                      <span className="nx-seo-moved">
                        Moved by a deploy, with no redirect
                      </span>
                    )}
                  </td>
                  <td data-label="Visits">
                    <span className="nx-seo-hits">{row.hits}</span>
                    <span
                      className="nx-seo-hitbar"
                      aria-hidden="true"
                      style={{ width: Math.max(4, (row.hits / most) * 120) }}
                    />
                  </td>
                  <td className="nx-seo-help" data-label="Last seen">
                    {lastSeenWhen(row.lastSeen)}
                  </td>
                  <td className="nx-seo-rowcell nx-seo-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`Redirect ${row.path}`}
                      onClick={() => props.onRedirect(row)}
                    >
                      Redirect…
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
