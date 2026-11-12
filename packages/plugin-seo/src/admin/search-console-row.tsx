/**
 * Search Console on the Connections tab: the button that starts a sign-in
 * with Google, who is connected once it finishes, the last failure in plain
 * words, and what Search Console says about the site. Nothing here ever
 * holds a credential: the server answers who is connected, never with what.
 *
 * @module admin/search-console-row
 */
import {
  apiErrorMessage,
  Button,
  SettingsRowGroup,
  usePluginRoute,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { useState, type JSX } from "react";

import {
  SEARCH_CONSOLE_CONNECT_PATH,
  SEARCH_CONSOLE_DISCONNECT_PATH,
  SEARCH_CONSOLE_REPORT_PATH,
  type ConnectionAttempt,
  type SearchConsoleConnectBody,
  type SearchConsoleReportBody,
  type SearchConsoleState,
} from "../connections/contract";
import { SEO_PLUGIN_NAME } from "../settings/contract";

import { ControlNote } from "./settings-parts";

/** A day and time, as the admin reads them. */
export function whenOf(attempt: ConnectionAttempt): string {
  const at = new Date(attempt.at);
  return Number.isNaN(at.getTime())
    ? attempt.at
    : at.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** A property's name, as a person knows the site: its host. */
function propertyName(property: string): string {
  if (property.startsWith("sc-domain:")) {
    return property.slice("sc-domain:".length);
  }
  try {
    return new URL(property).host;
  } catch {
    return property;
  }
}

/** A page's address without the site's own host, as the list shows it. */
function pathOf(address: string): string {
  try {
    const url = new URL(address);
    return `${url.pathname}${url.search}`;
  } catch {
    return address;
  }
}

/** A list's heading inside the report. */
function ListHeading({ children }: { children: string }): JSX.Element {
  return (
    <span className="mb-1 block text-xs font-semibold text-foreground">
      {children}
    </span>
  );
}

/** One line of a list in the report: what, and how much. */
function ReportLine({
  what,
  much,
  mono = false,
}: {
  what: string;
  much: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <li className="flex min-w-0 justify-between gap-3 text-sm">
      <span
        className={`min-w-0 [overflow-wrap:anywhere] ${mono ? "font-mono text-xs" : ""}`}
      >
        {what}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{much}</span>
    </li>
  );
}

/** What Search Console says about the site over the last 28 days. */
function Report(): JSX.Element {
  const report = usePluginRoute<SearchConsoleReportBody>({
    plugin: SEO_PLUGIN_NAME,
    path: SEARCH_CONSOLE_REPORT_PATH,
  });
  if (report.pending) {
    return <ControlNote>Reading Search Console…</ControlNote>;
  }
  if (report.error || report.data === undefined || report.data === null) {
    return (
      <p className="mt-1.5 text-xs font-medium text-warning-text" role="status">
        {report.error
          ? apiErrorMessage(report.error)
          : "Search Console answered nothing."}
      </p>
    );
  }
  const { clicks, queries, otherAddress, checked } = report.data;
  return (
    <div className="mt-3 grid gap-3 border-t border-border pt-3">
      <p className="text-sm text-foreground">
        <b className="font-semibold">{clicks.toLocaleString()}</b> clicks from
        Google in the last 28 days.
      </p>
      {queries.length > 0 ? (
        <div>
          <ListHeading>What people searched</ListHeading>
          <ul className="grid gap-1">
            {queries.slice(0, 5).map(row => (
              <ReportLine
                key={row.query}
                what={row.query}
                much={`${row.clicks.toLocaleString()} clicks`}
              />
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <ListHeading>
          Where Google chose a different official address
        </ListHeading>
        {otherAddress.length === 0 ? (
          <ControlNote>None of the {checked} most visited pages.</ControlNote>
        ) : (
          <ul className="grid gap-1">
            {otherAddress.map(row => (
              <ReportLine
                key={row.page}
                mono
                what={pathOf(row.page)}
                much={`Google uses ${pathOf(row.chosen)}`}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Search Console's row: connect, who is connected, and what it says. */
export function SearchConsoleRow({
  state,
  refresh,
}: {
  state: SearchConsoleState | undefined;
  refresh: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const connected = state?.connected;

  const connect = () => {
    setBusy(true);
    setProblem(null);
    writePluginRoute<SearchConsoleConnectBody>({
      plugin: SEO_PLUGIN_NAME,
      path: SEARCH_CONSOLE_CONNECT_PATH,
    }).then(
      answer => {
        // Google asks the person to sign in and approve, then sends them back.
        if (answer?.url !== undefined) window.location.assign(answer.url);
        else setBusy(false);
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(apiErrorMessage(error));
      }
    );
  };
  const disconnect = () => {
    setBusy(true);
    setProblem(null);
    writePluginRoute({
      plugin: SEO_PLUGIN_NAME,
      path: SEARCH_CONSOLE_DISCONNECT_PATH,
    }).then(
      () => {
        setBusy(false);
        refresh();
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(apiErrorMessage(error));
      }
    );
  };

  const failed = problem ?? state?.failed?.message;
  return (
    <SettingsRowGroup
      label="Google Search Console"
      description="See clicks, what people searched, and pages where Google chose a different official address. Nextly asks Google for read-only access and never changes anything there."
    >
      <div className="flex flex-wrap items-center gap-3">
        {connected === undefined ? (
          <Button
            type="button"
            size="sm"
            disabled={busy || state?.configured !== true}
            onClick={connect}
          >
            Connect Search Console
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={disconnect}
          >
            Disconnect
          </Button>
        )}
        {connected === undefined ? null : (
          <span className="text-sm font-medium text-success-text">
            Connected
            {connected.email === undefined ? "" : ` as ${connected.email}`}
            {connected.property === undefined
              ? ""
              : ` · ${propertyName(connected.property)}`}
          </span>
        )}
      </div>
      {state !== undefined && !state.configured ? (
        <ControlNote tone="warning">
          Needs a Google sign-in in the site&apos;s configuration first, as the
          SEO plugin&apos;s documentation shows.
        </ControlNote>
      ) : null}
      {failed === undefined ? null : (
        <p
          className="mt-1.5 text-xs font-medium text-warning-text"
          role="status"
        >
          {failed}
        </p>
      )}
      {connected?.property === undefined ? null : <Report />}
    </SettingsRowGroup>
  );
}
