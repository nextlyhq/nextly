/**
 * "What search engines received": one of the site's pages, fetched as
 * Googlebot, LinkedIn, X and Slack, each crawler's values beside what Nextly
 * holds for the page, and every difference explained in plain words.
 *
 * Opened from a page's SEO tab with `?address=` naming the page, or from the
 * SEO menu, where it checks the first of the site's pages. Any of the site's
 * own addresses may be typed in; anything else is refused by the server.
 *
 * @module admin/SeoReceivedPage
 */
import {
  apiErrorMessage,
  navigateTo,
  usePluginRoute,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import {
  AlertTriangle,
  Check,
  CircleCheck,
  ExternalLink,
  Info,
  RefreshCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";

import { sitesNamed } from "../received/addresses";
import {
  CRAWLERS,
  fileOf,
  RECEIVED_PAGES_ROUTE_PATH,
  RECEIVED_ROUTE_PATH,
  RECEIVED_ROWS,
  type CrawlerResult,
  type ReceivedAnswer,
  type ReceivedCell,
  type ReceivedPagesBody,
  type RowKey,
  type StoredValues,
} from "../received/contract";
import { SEO_PLUGIN_NAME, SETTINGS_PAGE_HREF } from "../settings/contract";

import { ReceivedStyles } from "./received-styles";
import { ROOT, SeoStyles } from "./styles";

/** The address the screen's own address names, where it names one. */
function addressInAddress(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const named = new URLSearchParams(window.location.search).get("address");
  return named === null || named.trim() === "" ? undefined : named;
}

/** Keeps the page being checked in the address, without adding to history. */
function showAddressInAddress(address: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("address", address);
  window.history.replaceState(window.history.state, "", url);
}

/** How long ago `when` was, for "Fetched …". */
function fetchedAgo(when: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(when)) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/** What the screen is showing. */
type CheckState =
  | { state: "idle" }
  | { state: "fetching"; address: string; was?: ReceivedAnswer }
  | { state: "done"; answer: ReceivedAnswer }
  | { state: "failed"; address: string; message: string };

/** The check of one address, and a way to run it again. */
function useCheck(): {
  check: CheckState;
  /** Checks `address`; the function it answers stops that check. */
  run: (address: string) => () => void;
} {
  const [check, setCheck] = useState<CheckState>({ state: "idle" });
  const controller = useRef<AbortController | null>(null);
  const run = useCallback((address: string) => {
    controller.current?.abort();
    const asking = new AbortController();
    controller.current = asking;
    setCheck(was => ({
      state: "fetching",
      address,
      ...(was.state === "done" ? { was: was.answer } : {}),
    }));
    writePluginRoute<ReceivedAnswer>({
      plugin: SEO_PLUGIN_NAME,
      path: RECEIVED_ROUTE_PATH,
      body: { address },
      signal: asking.signal,
    }).then(
      answer => {
        if (asking.signal.aborted) return;
        setCheck(
          answer === undefined
            ? {
                state: "failed",
                address,
                message: "The check answered nothing.",
              }
            : { state: "done", answer }
        );
      },
      (error: unknown) => {
        if (asking.signal.aborted) return;
        setCheck({ state: "failed", address, message: apiErrorMessage(error) });
      }
    );
    return () => {
      if (controller.current === asking) asking.abort();
    };
  }, []);
  useEffect(() => () => controller.current?.abort(), []);
  return { check, run };
}

/** A clock that moves every half minute, for "Fetched … ago". */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The screen, as the admin mounts it. */
export function SeoReceivedPage(): JSX.Element {
  const pages = usePluginRoute<ReceivedPagesBody>({
    plugin: SEO_PLUGIN_NAME,
    path: RECEIVED_PAGES_ROUTE_PATH,
    staleTime: 0,
  });
  const origins = pages.data?.origins ?? [];
  const { check, run } = useCheck();
  // The page the screen's address named as it opened, read once: a check
  // asked for later changes the address, and is not the opening one.
  const [opened] = useState(addressInAddress);
  const [typed, setTyped] = useState(() => opened ?? "");
  const first = opened ?? pages.data?.pages[0];

  // Checked as the screen opens: the page its address names, else the first
  // of the site's pages once they are read. Stopped if the screen goes, and
  // asked again if React sets the screen up a second time.
  useEffect(() => {
    if (first === undefined) return undefined;
    setTyped(first);
    return run(first);
  }, [first, run]);

  const submit = (address: string) => {
    const asked = address.trim();
    if (asked === "") return;
    showAddressInAddress(asked);
    run(asked);
  };

  return (
    <div className={`${ROOT} nx-seo-page`}>
      <SeoStyles />
      <ReceivedStyles />
      <div className="nx-seo-head">
        <div>
          <h1>What search engines received</h1>
          <p>
            Fetches one of your pages as each crawler would, and compares it
            with what Nextly holds.
            {origins.length > 0
              ? ` Only ${sitesNamed(origins)} addresses can be checked.`
              : ""}
          </p>
        </div>
      </div>
      <div className="nx-seo-body nx-seo-rcv">
        <PagePicker
          typed={typed}
          pages={pages.data?.pages ?? []}
          check={check}
          onType={setTyped}
          onSubmit={submit}
        />
        <Body check={check} pages={pages} />
      </div>
    </div>
  );
}

/** The page to check: one of the site's, or any address typed in. */
function PagePicker({
  typed,
  pages,
  check,
  onType,
  onSubmit,
}: {
  typed: string;
  pages: readonly string[];
  check: CheckState;
  onType: (value: string) => void;
  onSubmit: (address: string) => void;
}): JSX.Element {
  const id = useId();
  const now = useNow();
  const fetching = check.state === "fetching";
  const when =
    check.state === "done" && check.answer.kind === "checked"
      ? `Fetched ${fetchedAgo(check.answer.fetchedAt, now)}`
      : "";
  return (
    <form
      className="nx-seo-rcv-bar"
      onSubmit={event => {
        event.preventDefault();
        onSubmit(typed);
      }}
    >
      <label className="nx-seo-rcv-lbl" htmlFor={`${id}-page`}>
        Page
      </label>
      <input
        id={`${id}-page`}
        className="nx-seo-rcv-addr"
        list={`${id}-pages`}
        value={typed}
        placeholder="https://"
        spellCheck={false}
        autoComplete="off"
        onChange={event => {
          const value = event.target.value;
          onType(value);
          // Choosing one of the site's pages checks it at once.
          if (pages.includes(value)) onSubmit(value);
        }}
      />
      <datalist id={`${id}-pages`}>
        {pages.map(page => (
          <option key={page} value={page} />
        ))}
      </datalist>
      <button type="submit" className="nx-seo-rcv-btn" disabled={fetching}>
        <RefreshCw aria-hidden="true" /> Fetch again
      </button>
      <span className="nx-seo-rcv-when" role="status">
        {fetching ? `Fetching as ${CRAWLERS.length} crawlers…` : when}
      </span>
    </form>
  );
}

/** What the site's pages, read before any check, say. */
interface PagesRead {
  pending: boolean;
  error: unknown;
  data: ReceivedPagesBody | undefined;
}

/** What the screen says before any page has been checked. */
function NotChecked({ pages }: { pages: PagesRead }): JSX.Element {
  if (pages.error) {
    return (
      <p className="nx-seo-alert" role="alert">
        The site's pages could not be read. {apiErrorMessage(pages.error)}
      </p>
    );
  }
  return pages.pending ? (
    <p className="nx-seo-state" role="status">
      Reading the site's pages…
    </p>
  ) : (
    <p className="nx-seo-state">
      Enter one of the site's pages to see what search engines receive.
    </p>
  );
}

/** Where the site has no production address, nothing can be checked. */
function NoSite(): JSX.Element {
  return (
    <Note tone="warn">
      <b>The site has no production address yet.</b> Only the site's own pages
      can be checked.{" "}
      <a
        href={SETTINGS_PAGE_HREF}
        onClick={event => {
          event.preventDefault();
          navigateTo(SETTINGS_PAGE_HREF);
        }}
      >
        Set it in the SEO settings
      </a>
    </Note>
  );
}

/** Each difference, numbered as the table numbers it, in plain words. */
function Differences({
  answer,
}: {
  answer: Extract<ReceivedAnswer, { kind: "checked" }>;
}): ReactNode {
  if (answer.differences.length === 0) return null;
  return (
    <>
      <div className="nx-seo-rcv-flabel">Differences, explained</div>
      <ol className="nx-seo-rcv-explain">
        {answer.differences.map(difference => (
          <li className="nx-seo-rcv-ex" key={difference.number}>
            <Mark value={difference.number} />
            <div>
              <b>{difference.title}</b>
              <p>{difference.text}</p>
              {difference.action === undefined ? null : (
                <div className="acts">
                  <a
                    className="nx-seo-rcv-btn sm"
                    href={difference.action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {difference.action.label}{" "}
                    <ExternalLink aria-hidden="true" />
                  </a>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

/** Everything under the picker, for what the check has come to. */
function Body({
  check,
  pages,
}: {
  check: CheckState;
  pages: PagesRead;
}): ReactNode {
  if (pages.data !== undefined && pages.data.origins.length === 0) {
    return <NoSite />;
  }
  if (check.state === "failed") {
    return (
      <p className="nx-seo-alert" role="alert">
        The page could not be checked. {check.message}
      </p>
    );
  }
  if (check.state === "idle") return <NotChecked pages={pages} />;
  if (check.state === "done" && check.answer.kind === "refused") {
    return (
      <Note tone="warn">
        <b>This address can't be checked.</b> {check.answer.message}
      </Note>
    );
  }
  const answer = check.state === "done" ? check.answer : check.was;
  const shown = answer?.kind === "checked" ? answer : undefined;
  const settled = check.state === "done" ? shown : undefined;
  return (
    <>
      {settled === undefined ? null : <Summary answer={settled} />}
      <ReceivedTable answer={shown} fetching={check.state === "fetching"} />
      {settled === undefined ? null : <Differences answer={settled} />}
    </>
  );
}

/** A note above the table, in the tone of what it says. */
function Note({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "plain";
  children: ReactNode;
}): JSX.Element {
  const Icon =
    tone === "ok" ? CircleCheck : tone === "warn" ? AlertTriangle : Info;
  return (
    <div
      className={`nx-seo-rcv-note${tone === "plain" ? "" : ` ${tone}`}`}
      role="status"
    >
      <Icon size={16} aria-hidden="true" />
      <div className="t">{children}</div>
    </div>
  );
}

/** What the check found, in one sentence. */
function Summary({
  answer,
}: {
  answer: Extract<ReceivedAnswer, { kind: "checked" }>;
}): JSX.Element {
  const count = answer.differences.length;
  if (answer.stored === undefined) {
    return (
      <Note tone="plain">
        <b>No published page in Nextly has this address.</b> What each crawler
        received is shown, with nothing to compare it with.
      </Note>
    );
  }
  if (count === 0) {
    return (
      <Note tone="ok">
        <b>Every crawler received what Nextly holds.</b> Google may still show a
        title of its own, or an older copy, until it next visits the page.
      </Note>
    );
  }
  return (
    <Note tone="warn">
      <b>
        {count === 1
          ? "1 difference between what crawlers received and what Nextly holds."
          : `${count} differences between what crawlers received and what Nextly holds.`}
      </b>{" "}
      {count === 1 ? "It's explained below." : "Each is explained below."}
    </Note>
  );
}

/** A difference's number, as the table and the list both show it. */
function Mark({ value }: { value: number }): JSX.Element {
  return (
    <span className="nx-seo-rcv-k" aria-label={`Difference ${value}`}>
      {value}
    </span>
  );
}

/** What a crawler's column says it was answered. */
function CrawlerHead({ crawler }: { crawler: CrawlerResult }): JSX.Element {
  const seconds = `${(crawler.ms / 1000).toFixed(1)} s`;
  const answered =
    crawler.status === undefined
      ? "Nothing received"
      : `${crawler.status} · ${seconds}${crawler.redirected ? " · redirected" : ""}`;
  return (
    <th scope="col">
      <b>{crawler.name}</b>
      {crawler.difference === undefined ? null : (
        <Mark value={crawler.difference} />
      )}
      {answered}
    </th>
  );
}

/** What Nextly holds for a row, as its cell shows it. */
function StoredCell({
  row,
  stored,
}: {
  row: RowKey;
  stored: StoredValues | undefined;
}): ReactNode {
  if (stored === undefined) {
    return <span className="nx-seo-rcv-help">Not in Nextly</span>;
  }
  const none = <span className="nx-seo-rcv-help">None</span>;
  switch (row) {
    case "title":
      return stored.title ?? none;
    case "description":
      return stored.description ?? none;
    case "image": {
      if (stored.image === undefined) return none;
      const file = fileOf(stored.image.url);
      const { width, height } = stored.image;
      return (
        <>
          {file}
          {width === undefined || height === undefined ? null : (
            <span className="nx-seo-rcv-help">
              {width} × {height}
            </span>
          )}
        </>
      );
    }
    case "canonical":
      return stored.canonical === undefined ? (
        none
      ) : (
        <span className="nx-seo-mono">{stored.canonical}</span>
      );
    case "robots":
      return stored.listed ? "Listed in search" : "Hidden from search";
  }
}

/** What one crawler's cell says, beside what Nextly holds. */
function CrawlerCell({
  row,
  cell,
  name,
}: {
  row: RowKey;
  cell: ReceivedCell;
  name: string;
}): ReactNode {
  switch (cell.kind) {
    case "same":
      return (
        <>
          <span className="nx-seo-rcv-same">
            <Check aria-hidden="true" /> Same
          </span>
          {cell.note === undefined ? null : (
            <span className="nx-seo-rcv-help">{cell.note}</span>
          )}
        </>
      );
    case "different":
      return (
        <span className="nx-seo-rcv-diff">
          <Mark value={cell.difference} />
          {receivedText(row, name, cell.received)}
        </span>
      );
    case "received":
      return cell.received === undefined ? (
        <span className="nx-seo-rcv-help">None</span>
      ) : row === "canonical" ? (
        <span className="nx-seo-mono">{cell.received}</span>
      ) : (
        cell.received
      );
    case "not-used":
      return <span className="nx-seo-rcv-help">Not used</span>;
    case "none":
      return <span className="nx-seo-rcv-help">Not received</span>;
  }
}

/** What a crawler received that differs, said in a few words. */
function receivedText(
  row: RowKey,
  name: string,
  received: string | undefined
): string {
  if (row === "robots") {
    return received === "Hidden from search"
      ? `${name} was told not to list it`
      : `${name} wasn't told to hide it`;
  }
  if (received === undefined) return `${name} received none`;
  return row === "image" || row === "canonical"
    ? `${name} received ${received}`
    : `${name} received “${received}”`;
}

/** The table: what Nextly holds, and what each crawler received. */
function ReceivedTable({
  answer,
  fetching,
}: {
  answer: Extract<ReceivedAnswer, { kind: "checked" }> | undefined;
  fetching: boolean;
}): JSX.Element {
  const crawlers: CrawlerResult[] =
    answer?.crawlers ??
    CRAWLERS.map(({ key, name }) => ({ key, name, ms: 0, redirected: false }));
  return (
    // Scrolls sideways on a narrow screen, so it can be reached and
    // scrolled from the keyboard too.
    <div
      className="nx-seo-rcv-box"
      role="region"
      aria-label="What each crawler received"
      tabIndex={0}
    >
      <table className="nx-seo-rcv-grid">
        <thead>
          <tr>
            <th scope="col">
              <span className="nx-seo-rcv-sr">Value</span>
            </th>
            <th scope="col">
              <b>Stored in Nextly</b>what the page should say
            </th>
            {crawlers.map(crawler =>
              fetching || answer === undefined ? (
                <th scope="col" key={crawler.key}>
                  <b>{crawler.name}</b>Fetching…
                </th>
              ) : (
                <CrawlerHead key={crawler.key} crawler={crawler} />
              )
            )}
          </tr>
        </thead>
        <tbody>
          {RECEIVED_ROWS.map(({ key: row, label }) => (
            <tr key={row}>
              <th scope="row">{label}</th>
              <td>
                <StoredCell row={row} stored={answer?.stored} />
              </td>
              {crawlers.map(crawler => (
                <td key={crawler.key}>
                  {fetching || answer === undefined ? (
                    <span className="nx-seo-rcv-help">Fetching…</span>
                  ) : (
                    <CrawlerCell
                      row={row}
                      cell={answer.rows[row][crawler.key]}
                      name={crawler.name}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
