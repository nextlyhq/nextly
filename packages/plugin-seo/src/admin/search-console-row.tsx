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

import { Icon } from "./styles";

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

/** What Search Console says about the site over the last 28 days. */
function Report(): JSX.Element {
  const report = usePluginRoute<SearchConsoleReportBody>({
    plugin: SEO_PLUGIN_NAME,
    path: SEARCH_CONSOLE_REPORT_PATH,
  });
  if (report.pending) {
    return <p className="nx-seo-help">Reading Search Console…</p>;
  }
  if (report.error || report.data === undefined || report.data === null) {
    return (
      <p className="nx-seo-help nx-seo-connfail" role="status">
        <span className="nx-seo-warnc">
          <Icon name="warn" />
        </span>{" "}
        {report.error
          ? apiErrorMessage(report.error)
          : "Search Console answered nothing."}
      </p>
    );
  }
  const { clicks, queries, otherAddress, checked } = report.data;
  return (
    <div className="nx-seo-gsc">
      <p className="nx-seo-help">
        <b>{clicks.toLocaleString()}</b> clicks from Google in the last 28 days.
      </p>
      {queries.length > 0 ? (
        <div>
          <span className="nx-seo-label">What people searched</span>
          <ul className="nx-seo-gsclist">
            {queries.slice(0, 5).map(row => (
              <li key={row.query}>
                <span>{row.query}</span>
                <span className="nx-seo-help">
                  {row.clicks.toLocaleString()} clicks
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <span className="nx-seo-label">
          Where Google chose a different official address
        </span>
        {otherAddress.length === 0 ? (
          <p className="nx-seo-help">
            None of the {checked} most visited pages.
          </p>
        ) : (
          <ul className="nx-seo-gsclist">
            {otherAddress.map(row => (
              <li key={row.page}>
                <span className="nx-seo-mono">{pathOf(row.page)}</span>
                <span className="nx-seo-help">
                  Google uses {pathOf(row.chosen)}
                </span>
              </li>
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
    <div className="nx-seo-conn">
      <div>
        <b>Google Search Console</b>
        <p className="nx-seo-help">
          See clicks, what people searched, and pages where Google chose a
          different official address. Nextly asks Google for read-only access
          and never changes anything there.
        </p>
        {connected === undefined ? null : (
          <p className="nx-seo-help nx-seo-connok">
            <span className="nx-seo-okc">
              <Icon name="check" />
            </span>{" "}
            Connected
            {connected.email === undefined ? "" : ` as ${connected.email}`}
            {connected.property === undefined
              ? ""
              : ` · ${propertyName(connected.property)}`}
          </p>
        )}
        {state !== undefined && !state.configured ? (
          <p className="nx-seo-help nx-seo-connfail">
            Needs a Google sign-in in the site's configuration first, as the SEO
            plugin's documentation shows.
          </p>
        ) : null}
        {failed === undefined ? null : (
          <p className="nx-seo-help nx-seo-connfail" role="status">
            <span className="nx-seo-warnc">
              <Icon name="warn" />
            </span>{" "}
            {failed}
          </p>
        )}
      </div>
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
      {connected?.property === undefined ? null : (
        <div className="nx-seo-connmore">
          <Report />
        </div>
      )}
    </div>
  );
}
