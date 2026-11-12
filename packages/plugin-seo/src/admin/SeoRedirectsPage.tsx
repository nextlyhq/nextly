/**
 * The redirects screen: every redirect, with how often each still answers a
 * visitor, added or edited in a dialog and imported from a CSV file after a
 * dry run; and, on its Not found tab, the addresses people asked for that no
 * page answered, each one click from a redirect or set aside with Ignore.
 *
 * The two tabs are addresses of their own (`redirects`, and
 * `redirects?tab=notfound`), so a link or a bookmark lands on either. Where
 * the site's Proxy does not run, the redirects are saved but not served, and
 * the list says so with the note a developer needs, decided by the problem
 * list's own rule (`proxyProblems`).
 *
 * Drawn only from the admin's own parts: `PageFrame`, `PageHeader` with
 * `PageTabs`, `ListView`, `Alert`, `Badge`, `Button`, `Checkbox`, `Select`
 * and `Dialog`.
 *
 * @module admin/SeoRedirectsPage
 */
import {
  Alert,
  AlertDescription,
  AlertTitle,
  apiErrorMessage,
  Badge,
  Button,
  Checkbox,
  Label,
  ListView,
  PageFrame,
  PageHeader,
  PageTab,
  PageTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toastMutationResult,
  usePluginRoute,
  writePluginRoute,
  type NextlyColumn,
} from "@nextlyhq/plugin-sdk/admin";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from "react";

import { proxyProblems } from "../problems/site-checks";
import {
  REDIRECT_ROUTES,
  REDIRECTS_PAGE,
  type ImportResult,
  type NotFoundView,
  type ProxyStatus,
  type RedirectView,
} from "../redirects/contract";
import { SEO_ADMIN_SLUG, SEO_PLUGIN_NAME } from "../settings/contract";

import { copyNote } from "./copy-note";
import {
  ImportDialog,
  RedirectDialog,
  TYPE_TEXT,
  type DraftNote,
  type ReadFile,
  type RedirectDraft,
} from "./redirect-dialogs";
import { lastSeenWhen } from "./redirect-format";
import { AdminLink, SeoTrail, type TrailStep } from "./section";

/** Where the redirects screen is, and its Not found tab. */
const REDIRECTS_HREF = `/admin/plugins/${SEO_ADMIN_SLUG}/${REDIRECTS_PAGE.path}`;
const NOT_FOUND_HREF = `${REDIRECTS_HREF}?tab=notfound`;

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

/** The tab the address names. */
function tabIn(search: string): Tab {
  return new URLSearchParams(search).get("tab") === "notfound"
    ? "notfound"
    : "list";
}

/**
 * The new redirect the address asks for, from a link such as the Overview's
 * Redirect on an address not found: `?from=` and, where one is suggested,
 * `&to=`. None where the address names no From.
 */
export function redirectAskedFor(
  search: string
): Pick<NotFoundView, "from" | "suggestion"> | null {
  const query = new URLSearchParams(search);
  const from = query.get("from")?.trim() ?? "";
  if (from === "") return null;
  const to = query.get("to")?.trim() ?? "";
  return { from, suggestion: to === "" ? null : to };
}

/** The hint under the form once an address not found fills it. */
function suggestionNote(suggestion: string | null): DraftNote {
  return {
    kind: "help",
    text:
      suggestion === null
        ? "No live page looks close. Fill in where it should go."
        : `Suggested: ${suggestion}, the closest live page. Change it if it's wrong.`,
  };
}

/** Who made a redirect, as the list says it. */
export function madeBy(redirect: RedirectView): string {
  if (redirect.origin === "automatic") return "Page moved";
  if (redirect.origin === "import") return "Imported";
  if (redirect.byYou) return "You";
  return redirect.addedBy ?? "Someone";
}

/** A range the Not found tab narrows to, by when an address was last asked for. */
type Range = "1" | "7" | "30" | "all";

/** The ranges, as the tab offers them, each its number of days back. */
const RANGES: readonly { value: Range; label: string; days: number }[] = [
  { value: "1", label: "Last 24 hours", days: 1 },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "all", label: "All time", days: Number.POSITIVE_INFINITY },
];

/**
 * The addresses not found the tab shows: the ignored ones only when asked
 * for, and those last asked for within `range`. Their counts are all-time.
 */
export function shownNotFound(
  rows: readonly NotFoundView[],
  range: Range,
  showIgnored: boolean,
  now: number = Date.now()
): NotFoundView[] {
  const days = RANGES.find(each => each.value === range)?.days ?? 7;
  const since = now - days * 24 * 60 * 60 * 1000;
  return rows.filter(row => {
    if (row.ignored && !showIgnored) return false;
    const seen = Date.parse(row.lastSeen);
    return Number.isFinite(seen) ? seen >= since : days === Infinity;
  });
}

/**
 * The screen's busy flag and the one way it runs a write: busy while it
 * runs, a refusal's words handed to `onRefused` rather than thrown.
 */
function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (
    work: () => Promise<void>,
    onRefused: (text: string, error: unknown) => void
  ) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      onRefused(apiErrorMessage(error), error);
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** Says a refused write in a toast. */
const toastRefused = (text: string) => toastMutationResult(text, undefined);

/** The redirects' columns: From, To, Type, Made by, Hits and Last hit. */
const REDIRECT_COLUMNS: NextlyColumn<RedirectView>[] = [
  {
    name: "from",
    header: "From",
    cell: ({ row }) => <span className="font-mono">{row.from}</span>,
  },
  {
    name: "to",
    header: "To",
    cell: ({ row }) =>
      row.type === "gone" ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="font-mono text-muted-foreground">{row.to}</span>
      ),
  },
  {
    name: "type",
    header: "Type",
    cell: ({ row }) => <Badge>{TYPE_TEXT[row.type].short}</Badge>,
  },
  {
    name: "by",
    header: "Made by",
    cell: ({ row }) => madeBy(row),
  },
  {
    name: "hits",
    header: "Hits",
    // A redirect the Proxy has not counted yet shows none, rather than a
    // count of 0 that would claim no one came.
    cell: ({ row }) => (row.lastHit === null ? "—" : String(row.hits)),
  },
  {
    name: "lastHit",
    header: "Last hit",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.lastHit === null ? "—" : lastSeenWhen(row.lastHit)}
      </span>
    ),
  },
];

/**
 * Says the redirects are saved but not served, where the site's Proxy never
 * ran or has gone quiet, with the note a developer needs to wire it.
 */
function NotServed(props: {
  status: ProxyStatus | undefined;
  redirects: number;
}): JSX.Element | null {
  if (props.status === undefined) return null;
  const [problem] = proxyProblems(props.status, props.redirects);
  if (problem === undefined) return null;
  const note = problem.fix.place === "developer" ? problem.fix.note : "";
  const since = props.status.lastSeen?.slice(0, 10);
  return (
    <Alert variant="destructive">
      <AlertTitle>These redirects are saved but not served</AlertTitle>
      <AlertDescription>
        {props.status.state === "not-wired"
          ? "The site's proxy.ts doesn't call Nextly's Proxy yet, so visitors to these addresses still see the old page or a 404."
          : `No request has reached the site's Proxy since ${since ?? "it last ran"}, so visitors to these addresses may still see the old page or a 404.`}{" "}
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => copyNote(note)}
        >
          Copy a note for a developer
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** The Not found tab's filters: the range, and whether ignored ones show. */
function NotFoundFilters(props: {
  range: Range;
  showIgnored: boolean;
  onRange: (range: Range) => void;
  onShowIgnored: (show: boolean) => void;
}): JSX.Element {
  const ignoredId = useId();
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Select
        value={props.range}
        onValueChange={value => props.onRange(value as Range)}
      >
        <SelectTrigger aria-label="Last asked for" className="w-auto">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGES.map(range => (
            <SelectItem key={range.value} value={range.value}>
              {range.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <Checkbox
          id={ignoredId}
          checked={props.showIgnored}
          onCheckedChange={checked => props.onShowIgnored(checked === true)}
        />
        <Label htmlFor={ignoredId}>Show ignored</Label>
      </div>
    </div>
  );
}

/** The addresses not found's columns, the last holding Redirect and Ignore. */
function notFoundColumns(actions: {
  onRedirect: (row: NotFoundView) => void;
  onIgnore: (row: NotFoundView) => void;
  busy: boolean;
}): NextlyColumn<NotFoundView>[] {
  return [
    {
      name: "path",
      header: "Address asked for",
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono">{row.path}</span>
          {row.kind === "moved" ? (
            <span className="text-xs text-muted-foreground">
              Moved by a deploy, with no redirect
            </span>
          ) : null}
        </div>
      ),
    },
    {
      name: "hits",
      header: "Times",
      cell: ({ row }) => <span className="font-semibold">{row.hits}</span>,
    },
    {
      name: "lastSeen",
      header: "Last asked",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {lastSeenWhen(row.lastSeen)}
        </span>
      ),
    },
    {
      name: "cameFrom",
      header: "Came from",
      cell: ({ row }) => row.cameFrom ?? "Direct",
    },
    {
      name: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Redirect ${row.path}`}
            onClick={() => actions.onRedirect(row)}
          >
            Redirect
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${row.ignored ? "Show again" : "Ignore"} ${row.path}`}
            disabled={actions.busy}
            onClick={() => actions.onIgnore(row)}
          >
            {row.ignored ? "Show again" : "Ignore"}
          </Button>
        </div>
      ),
    },
  ];
}

/** The draft being edited, the note under it, and the writes that save one. */
function useDraft(
  rows: readonly RedirectView[],
  run: ReturnType<typeof useBusy>["run"],
  reread: () => void
) {
  const [draft, setDraft] = useState<RedirectDraft | null>(null);
  const [note, setNote] = useState<DraftNote | null>(null);

  const open = (next: RedirectDraft, hint: DraftNote | null = null) => {
    setDraft(next);
    setNote(hint);
  };
  const close = () => {
    setDraft(null);
    setNote(null);
  };
  const edit = (row: RedirectView) =>
    open({ editing: row.id, from: row.from, to: row.to, type: row.type });

  const save = (current: RedirectDraft) =>
    run(
      async () => {
        const body = { to: current.to, type: current.type };
        const answer =
          current.editing === undefined
            ? await write<RedirectView>(REDIRECT_ROUTES.list, "POST", {
                ...body,
                from: current.from,
              })
            : await write<RedirectView>(
                `${REDIRECT_ROUTES.list}/${current.editing}`,
                "PATCH",
                body
              );
        close();
        toastMutationResult(answer?.message ?? "Saved.", undefined);
        reread();
      },
      text => {
        // Where the From address has a redirect already, offer to edit it.
        const existing = rows.find(row => row.from === current.from.trim());
        setNote(
          existing !== undefined &&
            current.editing === undefined &&
            text.includes("already has a redirect")
            ? { kind: "refused", text, existing: existing.id }
            : { kind: "refused", text }
        );
      }
    );

  return {
    draft,
    note,
    open,
    close,
    edit,
    save,
    change: (next: RedirectDraft) => {
      setDraft(next);
      // A typed change answers the refusal it was made for.
      setNote(current => (current?.kind === "refused" ? null : current));
    },
  };
}

/** A chosen CSV file: its dry run, read on choosing it, and its import. */
function useImport(run: ReturnType<typeof useBusy>["run"], reread: () => void) {
  const [file, setFile] = useState<ReadFile | null>(null);

  const read = (chosen: File) =>
    run(async () => {
      const text = await textOf(chosen);
      const answer = await write<ImportResult>(REDIRECT_ROUTES.import, "POST", {
        file: text,
      });
      if (answer !== undefined) {
        setFile({ name: chosen.name, text, result: answer.item });
      }
    }, toastRefused);

  const apply = (current: ReadFile) =>
    run(async () => {
      const answer = await write<ImportResult>(REDIRECT_ROUTES.import, "POST", {
        file: current.text,
        apply: true,
      });
      if (answer === undefined) return;
      if (!answer.item.applied) {
        // A row refused since the dry run: the rows as they are now.
        setFile({ ...current, result: answer.item });
        return;
      }
      setFile(null);
      toastMutationResult(answer.message, undefined);
      reread();
    }, toastRefused);

  return { file, read, apply, close: () => setFile(null) };
}

/** The Redirects and Not found tabs, each an address of its own, with its count. */
function RedirectsTabs(props: {
  tab: Tab;
  redirects: number;
  notFound: number;
}): JSX.Element {
  return (
    <PageTabs label="Redirects">
      <PageTab asChild current={props.tab === "list"} className="gap-1.5">
        <AdminLink href={REDIRECTS_HREF}>
          {/* Spaced by the tab's gap; the space keeps the name "Redirects 3". */}
          Redirects{" "}
          <span className="font-normal text-muted-foreground">
            {props.redirects}
          </span>
        </AdminLink>
      </PageTab>
      <PageTab asChild current={props.tab === "notfound"} className="gap-1.5">
        <AdminLink href={NOT_FOUND_HREF}>
          Not found{" "}
          <span className="font-normal text-muted-foreground">
            {props.notFound}
          </span>
        </AdminLink>
      </PageTab>
    </PageTabs>
  );
}

/** Import CSV, with its hidden file input, and Add redirect. */
function ListActions(props: {
  busy: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
  onAdd: () => void;
}): JSX.Element {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={props.busy}
        onClick={() => props.fileRef.current?.click()}
      >
        Import CSV
      </Button>
      <Button type="button" onClick={props.onAdd}>
        Add redirect
      </Button>
      <input
        ref={props.fileRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={event => {
          const chosen = event.target.files?.[0];
          // Emptied so choosing the same file again reads it again.
          event.target.value = "";
          if (chosen !== undefined) props.onFile(chosen);
        }}
      />
    </>
  );
}

/** Why a list could not be read, as the table shows it, or null. */
function readFailure(what: string, error: unknown): string | null {
  return error === null || error === undefined
    ? null
    : `The ${what} could not be read. ${apiErrorMessage(error)}`;
}

/** The Redirects tab's list, with the note where they are not served. */
function RedirectsList(props: {
  rows: RedirectView[];
  pending: boolean;
  error: unknown;
  proxy: ProxyStatus | undefined;
  busy: boolean;
  onEdit: (row: RedirectView) => void;
  onRemove: (row: RedirectView) => void;
}): JSX.Element {
  return (
    <ListView<RedirectView>
      ariaLabel="Redirects"
      columns={REDIRECT_COLUMNS}
      rows={props.rows}
      rowActions={row => [
        { id: "edit", label: "Edit", onSelect: props.onEdit },
        {
          id: "remove",
          label: "Remove",
          destructive: true,
          isDisabled: () => props.busy,
          onSelect: () => props.onRemove(row),
        },
      ]}
      loading={props.pending}
      error={readFailure("redirects", props.error)}
      empty={{
        title: "No redirects yet",
        description:
          "Pages that move get one automatically. Add one by hand, or import a CSV file.",
      }}
      slots={{
        beforeList: (
          <NotServed status={props.proxy} redirects={props.rows.length} />
        ),
      }}
    />
  );
}

/** The Not found tab's list, narrowed by its own filters. */
function NotFoundList(props: {
  rows: NotFoundView[];
  pending: boolean;
  error: unknown;
  busy: boolean;
  onRedirect: (row: NotFoundView) => void;
  onIgnore: (row: NotFoundView) => void;
}): JSX.Element {
  const [range, setRange] = useState<Range>("7");
  const [showIgnored, setShowIgnored] = useState(false);
  return (
    <ListView<NotFoundView>
      ariaLabel="Addresses not found"
      columns={notFoundColumns(props)}
      rows={shownNotFound(props.rows, range, showIgnored)}
      loading={props.pending}
      error={readFailure("addresses not found", props.error)}
      hasActiveFilters={range !== "all" || showIgnored}
      empty={{
        title: "No addresses not found",
        description:
          "New ones appear here, most asked for first, as people or search engines ask for them.",
      }}
      emptyFiltered={{
        title: "None in this range",
        description:
          "No address was asked for and not found in this time. Choose a longer range to see older ones.",
      }}
      slots={{
        beforeList: (
          <NotFoundFilters
            range={range}
            showIgnored={showIgnored}
            onRange={setRange}
            onShowIgnored={setShowIgnored}
          />
        ),
        afterList: (
          <p className="text-xs text-muted-foreground">
            Bots probing for admin pages of other systems (/wp-login.php and the
            like) are left out.
          </p>
        ),
      }}
    />
  );
}

/** The three reads the screen draws from, each read afresh on every visit. */
function useRedirectReads() {
  return {
    redirects: usePluginRoute<ListBody<RedirectView>>({
      plugin: SEO_PLUGIN_NAME,
      path: REDIRECT_ROUTES.list,
      staleTime: 0,
    }),
    notFound: usePluginRoute<ListBody<NotFoundView>>({
      plugin: SEO_PLUGIN_NAME,
      path: REDIRECT_ROUTES.notFound,
      staleTime: 0,
    }),
    proxy: usePluginRoute<ProxyStatus>({
      plugin: SEO_PLUGIN_NAME,
      path: REDIRECT_ROUTES.proxy,
      staleTime: 0,
    }),
  };
}

/** Each tab's line under the title, and its trail. */
const TAB_TEXT: Record<Tab, { description: string; steps: TrailStep[] }> = {
  list: {
    description:
      "Send an old address to its new one. Pages that move get one automatically.",
    steps: [{ label: "Redirects" }],
  },
  notfound: {
    description:
      "Addresses visitors asked for that no page answered. Redirect the ones that matter.",
    steps: [
      { label: "Redirects", href: REDIRECTS_HREF },
      { label: "Not found" },
    ],
  },
};

/** The redirects screen, as the admin mounts it. */
export function SeoRedirectsPage(): JSX.Element {
  const { redirects, notFound, proxy } = useRedirectReads();
  // The admin remounts a page whose address changes, so each tab, and a
  // link asking for a new redirect, is read from the address once.
  const [tab] = useState<Tab>(() =>
    typeof window === "undefined" ? "list" : tabIn(window.location.search)
  );
  const { busy, run } = useBusy();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const rows = redirects.data?.items ?? [];
  const missing = notFound.data?.items ?? [];
  const reread = () => {
    redirects.refetch();
    notFound.refetch();
  };
  const form = useDraft(rows, run, reread);
  const importer = useImport(run, reread);

  const fromAddress = (row: Pick<NotFoundView, "from" | "suggestion">) =>
    form.open(
      { from: row.from, to: row.suggestion ?? "", type: "permanent" },
      suggestionNote(row.suggestion)
    );
  // A link asking for a new redirect opens the form once, filled from it.
  const asked = useRef(
    typeof window === "undefined"
      ? null
      : redirectAskedFor(window.location.search)
  );
  useEffect(() => {
    const once = asked.current;
    if (once === null) return;
    asked.current = null;
    fromAddress(once);
  });

  const ignore = (row: NotFoundView) =>
    run(async () => {
      const answer = await write<NotFoundView>(
        `${REDIRECT_ROUTES.notFound}/${row.id}`,
        "PATCH",
        { ignored: !row.ignored }
      );
      toastMutationResult(answer?.message ?? "Saved.", undefined);
      notFound.refetch();
    }, toastRefused);

  const remove = (row: RedirectView) =>
    run(async () => {
      const answer = await write<RedirectView>(
        `${REDIRECT_ROUTES.list}/${row.id}`,
        "DELETE"
      );
      toastMutationResult(
        answer?.message ?? `Removed the redirect from ${row.from}`,
        undefined
      );
      reread();
    }, toastRefused);

  return (
    <PageFrame type="list">
      <PageHeader
        title="Redirects"
        description={TAB_TEXT[tab].description}
        breadcrumbs={<SeoTrail steps={TAB_TEXT[tab].steps} />}
        actions={
          tab === "list" ? (
            <ListActions
              busy={busy}
              fileRef={fileRef}
              onFile={chosen => void importer.read(chosen)}
              onAdd={() => form.open({ from: "", to: "", type: "permanent" })}
            />
          ) : null
        }
        tabs={
          <RedirectsTabs
            tab={tab}
            redirects={rows.length}
            notFound={missing.filter(row => !row.ignored).length}
          />
        }
      />
      {tab === "list" ? (
        <RedirectsList
          rows={rows}
          pending={redirects.pending}
          error={redirects.error}
          proxy={proxy.data}
          busy={busy}
          onEdit={form.edit}
          onRemove={row => void remove(row)}
        />
      ) : (
        <NotFoundList
          rows={missing}
          pending={notFound.pending}
          error={notFound.error}
          busy={busy}
          onRedirect={fromAddress}
          onIgnore={row => void ignore(row)}
        />
      )}
      <RedirectDialog
        draft={form.draft}
        note={form.note}
        busy={busy}
        onChange={form.change}
        onSave={draft => void form.save(draft)}
        onEditExisting={id => {
          const row = rows.find(each => each.id === id);
          if (row !== undefined) form.edit(row);
        }}
        onClose={form.close}
      />
      <ImportDialog
        file={importer.file}
        busy={busy}
        onImport={file => void importer.apply(file)}
        onChooseAgain={() => fileRef.current?.click()}
        onClose={importer.close}
      />
    </PageFrame>
  );
}
