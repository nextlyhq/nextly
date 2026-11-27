/**
 * The Settings screen's Connections tab: the optional services, each off
 * until someone switches it on, as a card of rows. A switch changes the
 * draft, and the page saves it with every other tab.
 *
 * IndexNow switches on only once its key file answers at the site's
 * production address: Bing refuses every notice from a site whose key it
 * cannot read. Turning the switch on checks the file first; a file that
 * does not answer leaves the switch off and says why, with a way to check
 * again. While IndexNow is on, the file is checked again once a day.
 *
 * @module admin/connections
 */
import {
  Button,
  SettingsRowGroup,
  Switch,
  usePluginRoute,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import {
  CONNECTIONS_ROUTE_PATH,
  INDEXNOW_KEY_CHECK_PATH,
  KEY_CHECK_STANDS_MS,
  indexNowLine,
  keyCheckLine,
  type ConnectionsBody,
  type IndexNowKeyCheck,
} from "../connections/contract";
import { SEO_PLUGIN_NAME } from "../settings/contract";

import { SearchConsoleRow, whenOf } from "./search-console-row";
import type { VerificationDraft } from "./settings-draft";
import { SettingsCard } from "./settings-parts";
import { siteHostOf, type TabProps } from "./tabs";
import { VerificationCard } from "./verification";

/** A line under a connection: how its last attempt went. */
function StatusLine({
  line,
}: {
  line: { ok: boolean; text: string } | undefined;
}): JSX.Element | null {
  if (line === undefined) return null;
  return (
    <p
      className={`mt-1.5 text-xs font-medium ${line.ok ? "text-success-text" : "text-warning-text"}`}
      role="status"
    >
      {line.text}
    </p>
  );
}

/** Whether a key check found at `check` is older than a day, or there is none. */
function checkDue(check: IndexNowKeyCheck | undefined): boolean {
  if (check === undefined) return true;
  const at = Date.parse(check.at);
  return Number.isNaN(at) || Date.now() - at >= KEY_CHECK_STANDS_MS;
}

/**
 * The key check as the row runs it: the last one the connections route
 * reported, replaced by each run here. `run` answers what the check found,
 * or nothing where it could not be asked.
 */
function useKeyCheck(reported: IndexNowKeyCheck | undefined): {
  check: IndexNowKeyCheck | undefined;
  checking: boolean;
  failed: boolean;
  run: () => Promise<IndexNowKeyCheck | undefined>;
} {
  const [ran, setRan] = useState<IndexNowKeyCheck | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = useCallback(async () => {
    setChecking(true);
    setFailed(false);
    try {
      const found = await writePluginRoute<IndexNowKeyCheck>({
        plugin: SEO_PLUGIN_NAME,
        path: INDEXNOW_KEY_CHECK_PATH,
        body: {},
      });
      if (found === undefined) setFailed(true);
      else setRan(found);
      return found;
    } catch {
      setFailed(true);
      return undefined;
    } finally {
      setChecking(false);
    }
  }, []);
  return { check: ran ?? reported, checking, failed, run };
}

/**
 * What the key file's check says under the switch: under way, what it
 * found, or that it couldn't be asked, with a way to check again where the
 * file doesn't answer.
 */
function KeyFileStatus({
  checking,
  failed,
  line,
  checkAgain,
}: {
  checking: boolean;
  failed: boolean;
  line: { ok: boolean; text: string } | undefined;
  checkAgain: () => void;
}): JSX.Element {
  if (checking) {
    return (
      <p className="mt-1.5 text-xs text-muted-foreground" role="status">
        Checking the key file…
      </p>
    );
  }
  return (
    <>
      <StatusLine line={line} />
      {failed ? (
        <StatusLine
          line={{
            ok: false,
            text: "The key file couldn't be checked. Try again.",
          }}
        />
      ) : null}
      {line?.ok === false || failed ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={checkAgain}
        >
          Check again
        </Button>
      ) : null}
    </>
  );
}

/** IndexNow's row: the switch, the key file's state, and the last notice. */
function IndexNowRow({
  draft,
  change,
  body,
}: Pick<TabProps, "draft" | "change"> & {
  body: ConnectionsBody | undefined;
}): JSX.Element {
  const { check, checking, failed, run } = useKeyCheck(body?.indexNow.keyCheck);
  // Asked to switch on, and refused until the key file answers.
  const [refused, setRefused] = useState(false);
  const switchOn = useCallback(async () => {
    const found = await run();
    if (found?.result === "answering") {
      setRefused(false);
      change(current => ({ ...current, indexNow: true }));
    } else {
      setRefused(true);
    }
  }, [run, change]);
  // Once a day while switched on, once the route has answered: a check
  // run here, as the one switching it on, counts.
  const dailyAsked = useRef(false);
  const loaded = body !== undefined;
  const due = checkDue(check);
  useEffect(() => {
    if (!loaded || !draft.indexNow || !due || dailyAsked.current) return;
    dailyAsked.current = true;
    void run();
  }, [loaded, draft.indexNow, due, run]);
  const keyLine =
    check === undefined || (!draft.indexNow && !refused)
      ? undefined
      : keyCheckLine(check);
  const checkAgain = () => {
    // Refused on the way on: a check that passes switches it on.
    if (refused) void switchOn();
    else void run();
  };
  return (
    <SettingsRowGroup
      label="IndexNow"
      description="Tells Bing and other search engines the moment a page is published, changed or removed. Google doesn't take part."
    >
      <Switch
        aria-label="IndexNow"
        checked={draft.indexNow}
        disabled={checking}
        onCheckedChange={indexNow => {
          if (!indexNow) {
            setRefused(false);
            change(current => ({ ...current, indexNow }));
            return;
          }
          void switchOn();
        }}
      />
      <KeyFileStatus
        checking={checking}
        failed={failed}
        line={keyLine}
        checkAgain={checkAgain}
      />
      {draft.indexNow ? (
        <StatusLine
          line={indexNowLine(
            body?.indexNow.last,
            body?.indexNow.last === undefined
              ? undefined
              : whenOf(body.indexNow.last)
          )}
        />
      ) : null}
    </SettingsRowGroup>
  );
}

/**
 * Optional services, each off until switched on, and the codes other
 * services verify the site with; `saved` is the codes as stored.
 */
export function ConnectionsTab({
  draft,
  change,
  saved,
  serverAddresses,
}: TabProps & {
  saved: VerificationDraft;
  serverAddresses: readonly string[];
}): JSX.Element {
  const connections = usePluginRoute<ConnectionsBody>({
    plugin: SEO_PLUGIN_NAME,
    path: CONNECTIONS_ROUTE_PATH,
    staleTime: 0,
  });
  const body = connections.data ?? undefined;
  return (
    <>
      <SettingsCard>
        <SearchConsoleRow
          state={body?.searchConsole}
          refresh={() => connections.refetch()}
        />
        <IndexNowRow draft={draft} change={change} body={body} />
      </SettingsCard>
      <VerificationCard
        draft={draft}
        change={change}
        saved={saved}
        host={siteHostOf(draft, serverAddresses)}
      />
    </>
  );
}
