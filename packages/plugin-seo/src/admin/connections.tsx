/**
 * The Settings screen's Connections tab: the optional services, each off
 * until someone switches it on, as a card of rows. A switch changes the
 * draft, and the page saves it with every other tab.
 *
 * @module admin/connections
 */
import {
  SettingsRowGroup,
  Switch,
  usePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import type { JSX } from "react";

import {
  CONNECTIONS_ROUTE_PATH,
  indexNowLine,
  type ConnectionsBody,
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
        <SettingsRowGroup
          label="IndexNow"
          description="Tells Bing and other search engines the moment a page is published, changed or removed. Google doesn't take part."
        >
          <Switch
            aria-label="IndexNow"
            checked={draft.indexNow}
            onCheckedChange={indexNow =>
              change(current => ({ ...current, indexNow }))
            }
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
